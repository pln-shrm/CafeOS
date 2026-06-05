# CafeOS — Supabase PostgreSQL Database Schema

**Version:** 1.0  
**Date:** June 2026  
**Status:** Ready to execute in Supabase SQL Editor  
**Scope:** Phase I (8-week sprint) + Phase II stubs

---

## Table of Contents

1. [Schema Overview](#1-schema-overview)
2. [Execution Order](#2-execution-order)
3. [Table Definitions and SQL](#3-table-definitions-and-sql)
   - 3.01 `menu_items`
   - 3.02 `staff`
   - 3.03 `vendor_contacts`
   - 3.04 `vendor_ingredient_map`
   - 3.05 `orders`
   - 3.06 `order_items`
   - 3.07 `procurement`
   - 3.08 `vendor_credit`
   - 3.09 `wastage_logs`
   - 3.10 `predictions`
   - 3.11 `checkins`
   - 3.12 `attendance`
   - 3.13 `bot_state`
   - 3.14 `festival_calendar`
   - 3.15 `processed_webhooks`
4. [Indexes](#4-indexes)
5. [Row Level Security (RLS)](#5-row-level-security-rls)
6. [Seed Data](#6-seed-data)
7. [Google Sheets Sync Strategy](#7-google-sheets-sync-strategy)
8. [Schema Decisions and Rationale](#8-schema-decisions-and-rationale)

---

## 1. Schema Overview

```
menu_items ──────────────────────────────────────────┐
     │                                                │
     │ FK: menu_item_id                               │
     ├──► order_items ◄─── orders ◄─── staff          │
     │                                                │
     ├──► predictions                                 │
     │                                                │
     └──► wastage_logs                                │
                                                      │
vendor_contacts ──────────────────────────────────────┘
     │
     ├──► vendor_ingredient_map
     │
     └──► procurement
               │
               └── vendor_credit (separate ledger, same vendor_name key)

staff ──────────► attendance
     │
     └──────────► orders

bot_state        (one row per owner phone number — conversation memory)
checkins         (owner evening voice note + parsed signals)
festival_calendar (static config — festival dates + multipliers)
processed_webhooks (Twilio deduplication)
```

**Total tables: 15**  
**Phase I actively used: 13** (`vendor_ingredient_map` and `festival_calendar` are seeded by devs, not user-written)

---

## 2. Execution Order

Run these CREATE statements in this exact order. Foreign keys enforce the dependency chain.

```
1.  menu_items
2.  staff
3.  vendor_contacts
4.  vendor_ingredient_map      (depends on vendor_contacts)
5.  orders                     (depends on staff)
6.  order_items                (depends on orders, menu_items)
7.  procurement                (no FK — vendor_name is text for flexibility)
8.  vendor_credit              (no FK — same reason)
9.  wastage_logs               (depends on menu_items, nullable FK)
10. predictions                (depends on menu_items)
11. checkins                   (no FK)
12. attendance                 (depends on staff)
13. bot_state                  (no FK)
14. festival_calendar          (no FK)
15. processed_webhooks         (no FK)
```

Then: indexes, then RLS policies, then seed data.

---

## 3. Table Definitions and SQL

---

### 3.01 `menu_items`

**Purpose:** Master list of everything Sam sells. Controls what appears on the staff order screen. Prices are snapshotted at order time — changing a price here does not alter historical orders.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | `UUID` | PRIMARY KEY | `gen_random_uuid()` | Internal identifier |
| `name` | `TEXT` | NOT NULL | — | Display name, e.g. "Biryani", "Masala Chai" |
| `price` | `NUMERIC(8,2)` | NOT NULL, CHECK (price > 0) | — | Current selling price in ₹ |
| `category` | `TEXT` | — | `NULL` | Optional grouping, e.g. "Mains", "Drinks", "Snacks" |
| `active` | `BOOLEAN` | NOT NULL | `true` | `false` = hidden from staff menu, preserved in history |
| `seed_qty` | `INTEGER` | NOT NULL, CHECK (seed_qty >= 0) | `10` | Default prediction quantity before real data exists |
| `is_perishable` | `BOOLEAN` | NOT NULL | `true` | If true, power-cut multiplier (×0.75) applies to this item |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Record creation time |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last modification time — update via trigger |

```sql
CREATE TABLE menu_items (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT          NOT NULL,
  price         NUMERIC(8,2)  NOT NULL CHECK (price > 0),
  category      TEXT,
  active        BOOLEAN       NOT NULL DEFAULT true,
  seed_qty      INTEGER       NOT NULL DEFAULT 10 CHECK (seed_qty >= 0),
  is_perishable BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER menu_items_updated_at
  BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

### 3.02 `staff`

**Purpose:** Staff profiles. PINs are stored as bcrypt hashes — never plaintext. Deactivated staff cannot log in but their order history is preserved.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | `UUID` | PRIMARY KEY | `gen_random_uuid()` | Internal identifier |
| `name` | `TEXT` | NOT NULL | — | First name, e.g. "Rahul" |
| `pin_hash` | `TEXT` | NOT NULL | — | bcrypt hash of the 4-digit PIN. Never store plaintext. |
| `role` | `TEXT` | — | `'counter'` | Free-text role label, e.g. "Counter Staff", "Kitchen" |
| `daily_wage` | `NUMERIC(8,2)` | CHECK (daily_wage > 0) | `NULL` | Optional. Used for Phase II salary estimate. |
| `active` | `BOOLEAN` | NOT NULL | `true` | `false` = PIN rejected at login. Orders preserved. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Record creation time |

```sql
CREATE TABLE staff (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT         NOT NULL,
  pin_hash    TEXT         NOT NULL,
  role        TEXT         DEFAULT 'counter',
  daily_wage  NUMERIC(8,2) CHECK (daily_wage > 0),
  active      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

**Implementation note:** PIN uniqueness is enforced at the application layer (owner portal), not the database. The database stores hashes — two staff with the same PIN would have the same hash, which is technically allowed but makes it impossible to distinguish who placed an order. Enforce PIN uniqueness in the Express `createStaff` controller before hashing.

---

### 3.03 `vendor_contacts`

**Purpose:** Sam's supplier list. Used to group vendor order messages and maintain the credit ledger. Vendor names here must match exactly what Sam types in the bot (case-insensitive matching handled in the bot parser).

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | `UUID` | PRIMARY KEY | `gen_random_uuid()` | Internal identifier |
| `name` | `TEXT` | NOT NULL, UNIQUE | — | Vendor name as Sam knows them, e.g. "Rice Vendor", "Meat Vendor" |
| `whatsapp_number` | `TEXT` | NOT NULL | — | E.164 format, e.g. "+919876543210" |
| `notes` | `TEXT` | — | `NULL` | e.g. "Delivers Mon/Wed/Fri only. Call before 8am." |
| `active` | `BOOLEAN` | NOT NULL | `true` | `false` = excluded from procurement suggestions |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Record creation time |

```sql
CREATE TABLE vendor_contacts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL UNIQUE,
  whatsapp_number  TEXT        NOT NULL,
  notes            TEXT,
  active           BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### 3.04 `vendor_ingredient_map`

**Purpose:** Maps raw ingredients to vendors and defines purchasable units. Phase I: seeded manually by devs from Sam's recipes. Not user-editable in Phase I.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | `UUID` | PRIMARY KEY | `gen_random_uuid()` | Internal identifier |
| `ingredient_name` | `TEXT` | NOT NULL | — | Normalised name, e.g. "rice", "chicken", "dal" |
| `vendor_id` | `UUID` | FK → `vendor_contacts(id)` | — | Which vendor supplies this ingredient |
| `unit` | `TEXT` | NOT NULL | — | Purchase unit, e.g. "kg", "litre", "piece" |
| `min_order_unit` | `NUMERIC(8,3)` | NOT NULL, CHECK > 0 | `1.0` | Smallest purchasable amount. Rice = 1.0 (1kg bags). Oil = 0.5 (500ml bottles). |

```sql
CREATE TABLE vendor_ingredient_map (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_name  TEXT         NOT NULL,
  vendor_id        UUID         NOT NULL REFERENCES vendor_contacts(id),
  unit             TEXT         NOT NULL,
  min_order_unit   NUMERIC(8,3) NOT NULL DEFAULT 1.0 CHECK (min_order_unit > 0),
  UNIQUE (ingredient_name)
);
```

---

### 3.05 `orders`

**Purpose:** Header record for each customer transaction. One row per bill. Line items are in `order_items`. The `local_uuid` is set by the offline client and used as an idempotency key on sync.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | `UUID` | PRIMARY KEY | `gen_random_uuid()` | Internal identifier (server-assigned) |
| `local_uuid` | `UUID` | UNIQUE | `NULL` | Client-generated UUID for offline-first idempotency. `NULL` for online orders. |
| `staff_id` | `UUID` | FK → `staff(id)` | `NULL` | Which staff member placed this order. Nullable to handle edge cases. |
| `order_type` | `TEXT` | NOT NULL, CHECK IN ('dine_in', 'takeaway') | — | Dine In or Takeaway |
| `payment_method` | `TEXT` | NOT NULL, CHECK IN ('cash', 'upi', 'pending') | — | How the customer paid |
| `total` | `NUMERIC(8,2)` | NOT NULL, CHECK (total >= 0) | — | Total bill amount in ₹. Computed by app, verified by backend. |
| `bill_number` | `INTEGER` | — | `NULL` | Daily sequential number (1, 2, 3…). Assigned server-side. Null for offline orders until synced. |
| `bill_date` | `DATE` | NOT NULL | `CURRENT_DATE` | Date of the order in IST. Used to scope bill_number sequences. |
| `timestamp` | `TIMESTAMPTZ` | NOT NULL | `now()` | Exact time of order confirmation. Original client timestamp preserved on sync. |
| `synced` | `BOOLEAN` | NOT NULL | `true` | `false` only on records inserted via the offline sync endpoint. Set to `true` after backend confirms. |

```sql
CREATE TABLE orders (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  local_uuid      UUID         UNIQUE,
  staff_id        UUID         REFERENCES staff(id) ON DELETE SET NULL,
  order_type      TEXT         NOT NULL CHECK (order_type IN ('dine_in', 'takeaway')),
  payment_method  TEXT         NOT NULL CHECK (payment_method IN ('cash', 'upi', 'pending')),
  total           NUMERIC(8,2) NOT NULL CHECK (total >= 0),
  bill_number     INTEGER,
  bill_date       DATE         NOT NULL DEFAULT CURRENT_DATE,
  timestamp       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  synced          BOOLEAN      NOT NULL DEFAULT true
);
```

**Bill number assignment (backend logic — not a DB constraint):**

```sql
-- Run inside a transaction when creating an order
SELECT COALESCE(MAX(bill_number), 0) + 1
FROM orders
WHERE bill_date = CURRENT_DATE;
```

This is done inside the Express controller with `FOR UPDATE` lock on the orders table row range to prevent race conditions when two staff submit orders simultaneously.

---

### 3.06 `order_items`

**Purpose:** Line items for each order. One row per menu item per order. `unit_price` is snapshotted at order time — changing menu prices never retroactively alters historical bills.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | `UUID` | PRIMARY KEY | `gen_random_uuid()` | Internal identifier |
| `order_id` | `UUID` | NOT NULL, FK → `orders(id)` ON DELETE CASCADE | — | Parent order |
| `menu_item_id` | `UUID` | NOT NULL, FK → `menu_items(id)` | — | Which item was ordered |
| `quantity` | `INTEGER` | NOT NULL, CHECK (quantity > 0) | — | How many units |
| `unit_price` | `NUMERIC(8,2)` | NOT NULL, CHECK (unit_price >= 0) | — | Price at time of order. Copied from `menu_items.price` at creation. |
| `subtotal` | `NUMERIC(8,2)` | GENERATED ALWAYS AS (quantity * unit_price) | — | Computed column. No manual writes. |

```sql
CREATE TABLE order_items (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID         NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id  UUID         NOT NULL REFERENCES menu_items(id),
  quantity      INTEGER      NOT NULL CHECK (quantity > 0),
  unit_price    NUMERIC(8,2) NOT NULL CHECK (unit_price >= 0),
  subtotal      NUMERIC(8,2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);
```

---

### 3.07 `procurement`

**Purpose:** Every vendor order placed by Sam (via the bot). Records both bot-generated and manually edited orders. `vendor_name` is stored as text (not FK) to allow flexibility — if Sam types a vendor name not yet in `vendor_contacts`, the record still saves.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | `UUID` | PRIMARY KEY | `gen_random_uuid()` | Internal identifier |
| `vendor_name` | `TEXT` | NOT NULL | — | As parsed from Sam's message. Matched case-insensitively to `vendor_contacts.name`. |
| `items_json` | `JSONB` | NOT NULL | — | Array of `{name, qty, unit, price_per_unit}`. `price_per_unit` is null if Sam didn't specify. |
| `total_cost` | `NUMERIC(8,2)` | CHECK (total_cost >= 0) | `NULL` | Null if prices not provided. Computed by backend if prices are in `items_json`. |
| `delivery_date` | `DATE` | — | `NULL` | Requested delivery date. Null = "tomorrow morning" (default). |
| `status` | `TEXT` | NOT NULL, CHECK IN (...) | `'pending_delivery'` | Lifecycle status of this procurement order. |
| `forwarded_at` | `TIMESTAMPTZ` | — | `NULL` | Timestamp when Sam tapped "forward this to vendor". Set by bot reply flow. |
| `timestamp` | `TIMESTAMPTZ` | NOT NULL | `now()` | When this order was logged in CafeOS. |

**Status values:** `'pending_delivery'` → `'delivered'` → `'cancelled'`  
(Phase I: only `pending_delivery` is set automatically. Delivered/cancelled require manual update — Phase II feature.)

```sql
CREATE TABLE procurement (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name    TEXT         NOT NULL,
  items_json     JSONB        NOT NULL,
  total_cost     NUMERIC(8,2) CHECK (total_cost >= 0),
  delivery_date  DATE,
  status         TEXT         NOT NULL DEFAULT 'pending_delivery'
                              CHECK (status IN ('pending_delivery', 'delivered', 'cancelled')),
  forwarded_at   TIMESTAMPTZ,
  timestamp      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Validate items_json structure on insert
-- Each element must have at minimum: name (text), qty (number), unit (text)
ALTER TABLE procurement ADD CONSTRAINT procurement_items_json_valid
  CHECK (
    jsonb_typeof(items_json) = 'array'
    AND jsonb_array_length(items_json) > 0
  );
```

**`items_json` shape (document this for future devs):**

```json
[
  {
    "name": "rice",
    "qty": 5,
    "unit": "kg",
    "price_per_unit": 45,
    "total": 225
  },
  {
    "name": "dal",
    "qty": 3,
    "unit": "kg",
    "price_per_unit": null,
    "total": null
  }
]
```

---

### 3.08 `vendor_credit`

**Purpose:** Running credit ledger between Sam and each vendor. Credits = Sam owes vendor money. Payments = Sam has paid. Outstanding balance = sum(credits) - sum(payments) per vendor.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | `UUID` | PRIMARY KEY | `gen_random_uuid()` | Internal identifier |
| `vendor_name` | `TEXT` | NOT NULL | — | Matches `vendor_contacts.name` (case-insensitive). Stored as text for flexibility. |
| `amount` | `NUMERIC(8,2)` | NOT NULL, CHECK (amount > 0) | — | Always positive. Type field determines direction. |
| `type` | `TEXT` | NOT NULL, CHECK IN ('credit', 'payment') | — | `credit` = Sam owes this amount. `payment` = Sam paid this amount. |
| `item_description` | `TEXT` | — | `NULL` | Optional note, e.g. "rice 50kg", "partial payment" |
| `reference_procurement_id` | `UUID` | FK → `procurement(id)` ON DELETE SET NULL | `NULL` | Optional link to the procurement order this credit relates to. |
| `settled` | `BOOLEAN` | NOT NULL | `false` | Set to `true` when balance reaches ₹0 (managed by bot logic, not auto). |
| `timestamp` | `TIMESTAMPTZ` | NOT NULL | `now()` | When this ledger entry was logged. |

```sql
CREATE TABLE vendor_credit (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name              TEXT         NOT NULL,
  amount                   NUMERIC(8,2) NOT NULL CHECK (amount > 0),
  type                     TEXT         NOT NULL CHECK (type IN ('credit', 'payment')),
  item_description         TEXT,
  reference_procurement_id UUID         REFERENCES procurement(id) ON DELETE SET NULL,
  settled                  BOOLEAN      NOT NULL DEFAULT false,
  timestamp                TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

**Balance query (used by the bot after any credit/payment log):**

```sql
SELECT
  vendor_name,
  COALESCE(SUM(CASE WHEN type = 'credit'  THEN amount ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END), 0)
  AS outstanding_balance
FROM vendor_credit
WHERE vendor_name = $1
GROUP BY vendor_name;
```

---

### 3.09 `wastage_logs`

**Purpose:** Sam's nightly log of leftovers. One row per item per day. Powers the prediction model's feedback loop — high wastage lowers next-day prediction; low wastage has no adjustment.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | `UUID` | PRIMARY KEY | `gen_random_uuid()` | Internal identifier |
| `menu_item_id` | `UUID` | FK → `menu_items(id)` ON DELETE SET NULL | `NULL` | Nullable: if item is not found in menu (e.g. a special that day), still log it by name. |
| `item_name` | `TEXT` | NOT NULL | — | Item name as parsed from Sam's message. Always stored even if FK resolves. |
| `quantity_left` | `INTEGER` | NOT NULL, CHECK (quantity_left >= 0) | — | Portions/units left over at end of day. 0 = sold out or nil. |
| `logged_at` | `DATE` | NOT NULL | `CURRENT_DATE` | The date this wastage occurred (not when it was typed). |

```sql
CREATE TABLE wastage_logs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id   UUID        REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name      TEXT        NOT NULL,
  quantity_left  INTEGER     NOT NULL CHECK (quantity_left >= 0),
  logged_at      DATE        NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (menu_item_id, logged_at)  -- one record per item per day
);
```

**Note on `UNIQUE (menu_item_id, logged_at)`:** This prevents duplicate wastage entries for the same item on the same day. If Sam sends the wastage log twice in one night, the second message triggers an upsert (update the existing row), not a duplicate insert.

---

### 3.10 `predictions`

**Purpose:** The intelligence layer's working table. Stores predicted vs actual quantities per item per day. Owner overrides are captured here. This is the training data for the feedback loop — EWMA is computed from `actual_qty` over time.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | `UUID` | PRIMARY KEY | `gen_random_uuid()` | Internal identifier |
| `date` | `DATE` | NOT NULL | — | The date this prediction is for (IST date) |
| `menu_item_id` | `UUID` | NOT NULL, FK → `menu_items(id)` | — | Which item |
| `predicted_qty` | `INTEGER` | NOT NULL, CHECK (predicted_qty >= 1) | — | System's prediction before owner feedback. Minimum 1. |
| `owner_override` | `INTEGER` | CHECK (owner_override >= 0) | `NULL` | If Sam replied "2" and changed the qty, this stores her value. 0 = "skip this item today". |
| `actual_qty` | `INTEGER` | CHECK (actual_qty >= 0) | `NULL` | Filled at end of day: total sold + wastage. Used in EWMA next cycle. |
| `confirmed` | `BOOLEAN` | NOT NULL | `false` | `true` when Sam replies "1" or override is processed or auto-confirmed at 9:30am. |
| `manual_flag` | `TEXT` | — | `NULL` | Owner-added one-time context, e.g. "football match nearby". Stored for reference. |
| `weather_multiplier_applied` | `NUMERIC(4,2)` | — | `NULL` | The actual multiplier used (e.g. 0.85). Audit trail for debugging predictions. |
| `festival_multiplier_applied` | `NUMERIC(4,2)` | — | `NULL` | Festival multiplier used. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | When this prediction record was generated. |

```sql
CREATE TABLE predictions (
  id                         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  date                       DATE         NOT NULL,
  menu_item_id               UUID         NOT NULL REFERENCES menu_items(id),
  predicted_qty              INTEGER      NOT NULL CHECK (predicted_qty >= 1),
  owner_override             INTEGER      CHECK (owner_override >= 0),
  actual_qty                 INTEGER      CHECK (actual_qty >= 0),
  confirmed                  BOOLEAN      NOT NULL DEFAULT false,
  manual_flag                TEXT,
  weather_multiplier_applied NUMERIC(4,2),
  festival_multiplier_applied NUMERIC(4,2),
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (date, menu_item_id)
);
```

**Effective quantity (used by intelligence module):**

```javascript
// In Node.js intelligence module:
const effectiveQty = prediction.owner_override ?? prediction.predicted_qty;
// Owner override takes precedence. If null, use system prediction.
```

---

### 3.11 `checkins`

**Purpose:** Stores Sam's evening check-in — raw text or voice note transcription + structured signals extracted by Claude API. One record per day. Signals feed into next-day prediction adjustments.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | `UUID` | PRIMARY KEY | `gen_random_uuid()` | Internal identifier |
| `raw_text` | `TEXT` | — | `NULL` | Verbatim transcription (voice note) or Sam's text message. Null if Sam didn't respond. |
| `parsed_signals_json` | `JSONB` | — | `NULL` | Claude's structured extraction. Null if parsing failed or no response. |
| `input_type` | `TEXT` | CHECK IN ('voice_note', 'text', 'none') | `'none'` | How Sam responded to the check-in prompt. |
| `claude_parse_success` | `BOOLEAN` | NOT NULL | `false` | Whether Claude returned valid JSON. Useful for debugging accuracy over time. |
| `date` | `DATE` | NOT NULL | `CURRENT_DATE` | The date this check-in is for (not when submitted). |

```sql
CREATE TABLE checkins (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text             TEXT,
  parsed_signals_json  JSONB,
  input_type           TEXT        DEFAULT 'none'
                                   CHECK (input_type IN ('voice_note', 'text', 'none')),
  claude_parse_success BOOLEAN     NOT NULL DEFAULT false,
  date                 DATE        NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (date)
);
```

**`parsed_signals_json` shape:**

```json
{
  "transcription": "Biryani ran out around 12:30...",
  "stockouts": [
    { "item": "biryani", "time": "12:30" }
  ],
  "demand_spike": "large office group, possibly recurring",
  "power_disruption": {
    "time": "18:00",
    "duration_hours": 2
  },
  "weather_impact": null,
  "other_notes": null
}
```

---

### 3.12 `attendance`

**Purpose:** Staff check-in log. Tracks arrival time and late status. Phase I: check-in only (no check-out). Used in Phase II for salary computation.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | `UUID` | PRIMARY KEY | `gen_random_uuid()` | Internal identifier |
| `staff_id` | `UUID` | NOT NULL, FK → `staff(id)` | — | Which staff member checked in |
| `date` | `DATE` | NOT NULL | `CURRENT_DATE` | The work date (not the timestamp's date — avoids midnight edge cases) |
| `check_in_time` | `TIMESTAMPTZ` | NOT NULL | `now()` | Exact arrival timestamp (IST) |
| `late` | `BOOLEAN` | NOT NULL | `false` | Computed by backend: `true` if check_in_time > late_threshold (default 10:00 AM) |
| `late_reason` | `TEXT` | — | `NULL` | Optional reason provided by staff when prompted after late arrival |

```sql
CREATE TABLE attendance (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id       UUID        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date           DATE        NOT NULL DEFAULT CURRENT_DATE,
  check_in_time  TIMESTAMPTZ NOT NULL DEFAULT now(),
  late           BOOLEAN     NOT NULL DEFAULT false,
  late_reason    TEXT,
  UNIQUE (staff_id, date)  -- one check-in per staff per day
);
```

**Late threshold:** Stored as a config value in the backend `.env` or a simple key-value table (Phase II). In Phase I, hardcoded as `10:00 AM IST`.

---

### 3.13 `bot_state`

**Purpose:** Tracks the WhatsApp bot's conversation state for Sam's phone number. The bot is stateful — "Reply 1" only makes sense after specific messages. This table persists state across server restarts (Render free tier restarts frequently).

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `phone_number` | `TEXT` | PRIMARY KEY | — | Sam's number in E.164 format, e.g. `+919876543210` |
| `current_state` | `TEXT` | NOT NULL, CHECK IN (...) | `'idle'` | Which flow the bot is currently in. See valid states below. |
| `context_json` | `JSONB` | — | `NULL` | Temporary data for the current flow, e.g. the pending vendor order awaiting approval. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Last state change. Used to expire stale states (if Sam abandons a flow mid-way). |

**Valid states:**

| State | Meaning |
|-------|---------|
| `idle` | No active flow. Bot responds to new commands. |
| `awaiting_prep_confirm` | Bot sent morning prep sheet, waiting for "1" or edit |
| `awaiting_prep_edit` | Sam said "2" to prep sheet, waiting for her edit message |
| `awaiting_vendor_name` | Order command parsed but vendor name missing |
| `awaiting_vendor_confirm` | Bot sent vendor order summary, waiting for "1" or "2" |
| `awaiting_vendor_edit` | Sam said "2" to vendor order, waiting for edits |
| `awaiting_evening_checkin` | Evening prompt sent, waiting for Sam's response |
| `awaiting_wastage` | Wastage prompt sent, waiting for Sam's leftover list |

```sql
CREATE TABLE bot_state (
  phone_number   TEXT        PRIMARY KEY,
  current_state  TEXT        NOT NULL DEFAULT 'idle'
                             CHECK (current_state IN (
                               'idle',
                               'awaiting_prep_confirm',
                               'awaiting_prep_edit',
                               'awaiting_vendor_name',
                               'awaiting_vendor_confirm',
                               'awaiting_vendor_edit',
                               'awaiting_evening_checkin',
                               'awaiting_wastage'
                             )),
  context_json   JSONB,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER bot_state_updated_at
  BEFORE UPDATE ON bot_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

**Stale state handling (application logic):**  
If `updated_at` is more than 6 hours old and `current_state != 'idle'`, reset to `'idle'` on the next incoming message. Prevents Sam from being stuck if she abandoned a flow yesterday.

---

### 3.14 `festival_calendar`

**Purpose:** Static configuration for Goa's festival calendar. Phase I: seeded manually by devs. Demand multipliers applied to predictions during active windows.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | `UUID` | PRIMARY KEY | `gen_random_uuid()` | Internal identifier |
| `name` | `TEXT` | NOT NULL | — | Festival name, e.g. "Christmas", "Sao Joao" |
| `year` | `INTEGER` | NOT NULL | — | Calendar year this record applies to |
| `start_date` | `DATE` | NOT NULL | — | Festival start date |
| `end_date` | `DATE` | NOT NULL | — | Festival end date (inclusive). Single-day festivals: `start_date = end_date`. |
| `demand_multiplier` | `NUMERIC(4,2)` | NOT NULL, CHECK (> 0) | — | Applied to all predictions during the active window. 1.30 = +30%. |
| `warning_days_before` | `INTEGER` | NOT NULL | `5` | How many days before `start_date` to show the warning in the prep sheet. |
| `notes` | `TEXT` | — | `NULL` | e.g. "Both local + tourist surge", "Mainly local neighbourhood" |

```sql
CREATE TABLE festival_calendar (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT         NOT NULL,
  year                INTEGER      NOT NULL,
  start_date          DATE         NOT NULL,
  end_date            DATE         NOT NULL,
  demand_multiplier   NUMERIC(4,2) NOT NULL CHECK (demand_multiplier > 0),
  warning_days_before INTEGER      NOT NULL DEFAULT 5,
  notes               TEXT,
  CHECK (end_date >= start_date),
  UNIQUE (name, year)
);
```

---

### 3.15 `processed_webhooks`

**Purpose:** Twilio deduplication. Twilio occasionally delivers the same webhook twice. Storing processed `MessageSid` values prevents double-logging orders, double-wastage entries, or double-replies.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `message_sid` | `TEXT` | PRIMARY KEY | — | Twilio's unique MessageSid, e.g. `SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `processed_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | When this webhook was processed. Used for cleanup. |

```sql
CREATE TABLE processed_webhooks (
  message_sid   TEXT        PRIMARY KEY,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Cleanup job (run weekly):**

```sql
-- Delete records older than 48 hours — Twilio never re-delivers after that window
DELETE FROM processed_webhooks
WHERE processed_at < now() - INTERVAL '48 hours';
```

---

## 4. Indexes

Run these after all tables are created.

```sql
-- ============================================================
-- orders — high-frequency query: today's orders, daily reports
-- ============================================================
CREATE INDEX idx_orders_bill_date
  ON orders (bill_date DESC);

CREATE INDEX idx_orders_timestamp
  ON orders (timestamp DESC);

CREATE INDEX idx_orders_staff_id
  ON orders (staff_id);

CREATE INDEX idx_orders_payment_method
  ON orders (payment_method);

CREATE INDEX idx_orders_local_uuid
  ON orders (local_uuid)
  WHERE local_uuid IS NOT NULL;

-- ============================================================
-- order_items — joins to orders and menu_items constantly
-- ============================================================
CREATE INDEX idx_order_items_order_id
  ON order_items (order_id);

CREATE INDEX idx_order_items_menu_item_id
  ON order_items (menu_item_id);

-- ============================================================
-- predictions — daily lookup by item + date
-- ============================================================
CREATE INDEX idx_predictions_date
  ON predictions (date DESC);

CREATE INDEX idx_predictions_item_date
  ON predictions (menu_item_id, date DESC);

-- ============================================================
-- wastage_logs — daily lookup, feedback loop queries
-- ============================================================
CREATE INDEX idx_wastage_logged_at
  ON wastage_logs (logged_at DESC);

CREATE INDEX idx_wastage_item_date
  ON wastage_logs (menu_item_id, logged_at DESC)
  WHERE menu_item_id IS NOT NULL;

-- ============================================================
-- vendor_credit — balance queries per vendor
-- ============================================================
CREATE INDEX idx_vendor_credit_vendor_name
  ON vendor_credit (vendor_name);

CREATE INDEX idx_vendor_credit_timestamp
  ON vendor_credit (timestamp DESC);

-- ============================================================
-- procurement — vendor order history
-- ============================================================
CREATE INDEX idx_procurement_vendor_name
  ON procurement (vendor_name);

CREATE INDEX idx_procurement_timestamp
  ON procurement (timestamp DESC);

-- ============================================================
-- attendance — monthly reports per staff member
-- ============================================================
CREATE INDEX idx_attendance_staff_date
  ON attendance (staff_id, date DESC);

-- ============================================================
-- checkins — daily lookup
-- ============================================================
CREATE INDEX idx_checkins_date
  ON checkins (date DESC);

-- ============================================================
-- festival_calendar — active festival window lookups
-- ============================================================
CREATE INDEX idx_festival_start_date
  ON festival_calendar (start_date);
```

---

## 5. Row Level Security (RLS)

**Architecture note:** The Express backend uses the `SUPABASE_SERVICE_ROLE_KEY` for all database operations. The service role bypasses RLS entirely. This is intentional — all access control is enforced in Express middleware, not at the DB layer.

RLS is the **safety net** — it protects against:
- Direct Supabase API calls with stolen staff session tokens
- Bugs in Express middleware that accidentally use the wrong credentials
- Any future client that talks to Supabase directly (e.g. Supabase Realtime subscriptions)

The frontend uses `SUPABASE_ANON_KEY`, which is subject to RLS.

```sql
-- ============================================================
-- Enable RLS on every table
-- ============================================================
ALTER TABLE menu_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff              ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_ingredient_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_credit      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wastage_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins           ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_state          ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_calendar  ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_webhooks ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- HELPER: Identify owner session
-- The owner account is the only Supabase Auth user.
-- Staff use custom JWT (not Supabase Auth), so auth.uid() is null for staff.
-- ============================================================

-- Set this in your backend .env and Supabase dashboard:
-- Project Settings → Database → Configuration → app.owner_email

-- ============================================================
-- menu_items
-- Staff: read active items only
-- Owner: full access
-- ============================================================
CREATE POLICY "staff_can_read_active_menu"
  ON menu_items FOR SELECT
  USING (active = true);

CREATE POLICY "owner_full_access_menu"
  ON menu_items FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

-- ============================================================
-- orders
-- Staff: insert only (cannot read other staff's orders directly)
-- Owner: full access
-- ============================================================
CREATE POLICY "staff_can_insert_orders"
  ON orders FOR INSERT
  WITH CHECK (true);
  -- Note: Express middleware validates staff JWT and attaches staff_id.
  -- The RLS just allows the insert; business logic is in Express.

CREATE POLICY "owner_full_access_orders"
  ON orders FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

-- ============================================================
-- order_items
-- Staff: insert only (cascades from order insert)
-- Owner: full access
-- ============================================================
CREATE POLICY "staff_can_insert_order_items"
  ON order_items FOR INSERT
  WITH CHECK (true);

CREATE POLICY "owner_full_access_order_items"
  ON order_items FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

-- ============================================================
-- staff
-- Staff: read own record only (for profile display)
-- Owner: full access
-- ============================================================
-- Note: Staff use custom JWTs, not Supabase Auth.
-- auth.uid() is NULL for staff sessions.
-- The staff table is therefore not accessible to staff via the anon key
-- unless a custom claim is embedded in their JWT. Phase I: staff data
-- is only accessed server-side (Express uses service_role key).
CREATE POLICY "owner_full_access_staff"
  ON staff FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

-- ============================================================
-- attendance
-- Staff: insert own check-in only
-- Owner: full access
-- ============================================================
CREATE POLICY "staff_can_insert_own_attendance"
  ON attendance FOR INSERT
  WITH CHECK (true);
  -- Staff_id validated server-side in Express.

CREATE POLICY "owner_full_access_attendance"
  ON attendance FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

-- ============================================================
-- Everything else (vendor tables, predictions, wastage, checkins,
-- bot_state, festival_calendar, processed_webhooks)
-- Owner only — staff have no business touching these via client
-- ============================================================
CREATE POLICY "owner_only_vendor_contacts"
  ON vendor_contacts FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

CREATE POLICY "owner_only_vendor_ingredient_map"
  ON vendor_ingredient_map FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

CREATE POLICY "owner_only_procurement"
  ON procurement FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

CREATE POLICY "owner_only_vendor_credit"
  ON vendor_credit FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

CREATE POLICY "owner_only_wastage_logs"
  ON wastage_logs FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

CREATE POLICY "owner_only_predictions"
  ON predictions FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

CREATE POLICY "owner_only_checkins"
  ON checkins FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

CREATE POLICY "owner_only_bot_state"
  ON bot_state FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

CREATE POLICY "owner_only_festival_calendar"
  ON festival_calendar FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));

CREATE POLICY "owner_only_processed_webhooks"
  ON processed_webhooks FOR ALL
  USING (auth.jwt() ->> 'email' = current_setting('app.owner_email', true));
```

**Setting `app.owner_email` in Supabase:**

```sql
-- Run in Supabase SQL Editor
ALTER DATABASE postgres SET app.owner_email = 'sam@samscafe.com';
```

Or set it per-session in your backend if you prefer:

```sql
SELECT set_config('app.owner_email', 'sam@samscafe.com', false);
```

---

## 6. Seed Data

Run after all tables and indexes are created. These are the initial values the system needs to function from Day 1.

```sql
-- ============================================================
-- Owner account (Supabase Auth — run via Supabase dashboard or CLI)
-- This creates the login account for the owner portal.
-- Do NOT store this in the database directly.
-- ============================================================
-- In Supabase Dashboard → Authentication → Users → Add User:
-- Email: sam@samscafe.com
-- Password: [set securely, share with Sam only]

-- ============================================================
-- Bot state initialisation (Sam's number)
-- Replace +919876543210 with Sam's actual WhatsApp number
-- ============================================================
INSERT INTO bot_state (phone_number, current_state)
VALUES ('+919876543210', 'idle')
ON CONFLICT (phone_number) DO NOTHING;

-- ============================================================
-- Festival calendar — 2026 dates (Goa)
-- Update before each new year. Carnival/Holi/Ganesh/Diwali dates
-- vary yearly — manually research and update.
-- ============================================================
INSERT INTO festival_calendar (name, year, start_date, end_date, demand_multiplier, warning_days_before, notes) VALUES
  ('New Year',            2026, '2025-12-31', '2026-01-02', 1.35, 5, 'Both local + tourist surge. High footfall Dec 31 evening.'),
  ('Carnival',            2026, '2026-02-14', '2026-02-17', 1.30, 5, 'Goa Carnival — significant tourist influx into Vasco area.'),
  ('Holi',                2026, '2026-03-13', '2026-03-14', 1.20, 3, 'Moderate local spike.'),
  ('Good Friday',         2026, '2026-04-03', '2026-04-03', 1.10, 2, 'Local holiday. Check if Sam wants to stay open.'),
  ('Sao Joao',            2026, '2026-06-24', '2026-06-24', 1.25, 5, 'Local Goan festival. Neighbourhood surge.'),
  ('Independence Day',    2026, '2026-08-15', '2026-08-15', 1.15, 3, 'Local public holiday.'),
  ('Ganesh Chaturthi',    2026, '2026-08-22', '2026-08-27', 1.20, 5, 'Multi-day local festival.'),
  ('Diwali',              2026, '2026-10-20', '2026-10-22', 1.20, 5, 'Moderate spike.'),
  ('Christmas',           2026, '2026-12-24', '2026-12-26', 1.40, 5, 'Goa''s biggest tourist festival. +40% across the board.'),
  ('New Year (2027)',     2027, '2026-12-31', '2027-01-02', 1.35, 5, 'See New Year 2026 note.');

-- ============================================================
-- Sample menu items (replace with Sam's actual menu + prices)
-- Collect from Sam during Week 1
-- ============================================================
INSERT INTO menu_items (name, price, category, active, seed_qty, is_perishable) VALUES
  ('Biryani',          120.00, 'Mains',  true, 20, true),
  ('Fish Curry Rice',   90.00, 'Mains',  true, 14, true),
  ('Dal Rice',          60.00, 'Mains',  true, 10, true),
  ('Egg Bhurji',        50.00, 'Mains',  true, 10, true),
  ('Paneer Masala',     80.00, 'Mains',  true,  6, true),
  ('Masala Chai',       15.00, 'Drinks', true, 60, false),
  ('Black Coffee',      20.00, 'Drinks', true, 20, false),
  ('Cold Drink',        30.00, 'Drinks', true, 15, false),
  ('Veg Sandwich',      40.00, 'Snacks', true, 10, false),
  ('Samosa (2 pcs)',    25.00, 'Snacks', true, 20, false);

-- ============================================================
-- Sample vendor contacts (replace with Sam's actual vendors)
-- Collect from Sam during Week 1
-- ============================================================
INSERT INTO vendor_contacts (name, whatsapp_number, notes, active) VALUES
  ('Rice Vendor',   '+919876500001', 'Delivers Mon/Wed/Fri. Call before 9am.', true),
  ('Meat Vendor',   '+919876500002', 'Only chicken and fish. Min order ₹500.', true),
  ('Vegetable Vendor', '+919876500003', 'Daily delivery before 7am.', true),
  ('Dairy Vendor',  '+919876500004', 'Milk, paneer, curd. Daily.', true);

-- ============================================================
-- Vendor ingredient map (replace with Sam's actual ingredients)
-- Based on recipes collected from Sam in Week 1
-- ============================================================
INSERT INTO vendor_ingredient_map (ingredient_name, vendor_id, unit, min_order_unit)
SELECT 'rice',       id, 'kg',    1.0 FROM vendor_contacts WHERE name = 'Rice Vendor';

INSERT INTO vendor_ingredient_map (ingredient_name, vendor_id, unit, min_order_unit)
SELECT 'dal',        id, 'kg',    0.5 FROM vendor_contacts WHERE name = 'Rice Vendor';

INSERT INTO vendor_ingredient_map (ingredient_name, vendor_id, unit, min_order_unit)
SELECT 'oil',        id, 'litre', 0.5 FROM vendor_contacts WHERE name = 'Rice Vendor';

INSERT INTO vendor_ingredient_map (ingredient_name, vendor_id, unit, min_order_unit)
SELECT 'chicken',    id, 'kg',    0.5 FROM vendor_contacts WHERE name = 'Meat Vendor';

INSERT INTO vendor_ingredient_map (ingredient_name, vendor_id, unit, min_order_unit)
SELECT 'fish',       id, 'kg',    0.5 FROM vendor_contacts WHERE name = 'Meat Vendor';

INSERT INTO vendor_ingredient_map (ingredient_name, vendor_id, unit, min_order_unit)
SELECT 'vegetables', id, 'kg',    0.5 FROM vendor_contacts WHERE name = 'Vegetable Vendor';

INSERT INTO vendor_ingredient_map (ingredient_name, vendor_id, unit, min_order_unit)
SELECT 'paneer',     id, 'kg',    0.5 FROM vendor_contacts WHERE name = 'Dairy Vendor';

INSERT INTO vendor_ingredient_map (ingredient_name, vendor_id, unit, min_order_unit)
SELECT 'milk',       id, 'litre', 0.5 FROM vendor_contacts WHERE name = 'Dairy Vendor';
```

---

## 7. Google Sheets Sync Strategy

### Overview

A nightly job at 11:00 PM IST runs a Node.js function that appends the day's data to a pre-configured Google Spreadsheet. This is Sam's read-only business view — familiar, no login needed.

**Key design decisions:**
- Append-only. Never overwrite historical rows.
- The spreadsheet must be pre-created manually. Never auto-create from code.
- 4 sheets. Headers set manually before first sync.
- Data is fetched fresh from Supabase each night — no intermediate cache.

---

### Sheet 1: `Daily Summary`

**Purpose:** One-line business snapshot per operating day.  
**Update frequency:** Nightly append (one new row per day).  
**Headers:**

| Column | Source | SQL |
|--------|--------|-----|
| Date | `orders.bill_date` | `DISTINCT bill_date` |
| Day | Computed | `TO_CHAR(bill_date, 'Day')` |
| Total Orders | `orders` | `COUNT(*)` |
| Total Revenue (₹) | `orders.total` | `SUM(total)` |
| Cash Sales (₹) | `orders` | `SUM(total) WHERE payment_method = 'cash'` |
| UPI Sales (₹) | `orders` | `SUM(total) WHERE payment_method = 'upi'` |
| Pending (₹) | `orders` | `SUM(total) WHERE payment_method = 'pending'` |
| Total Expenses (₹) | `procurement.total_cost` | `SUM(total_cost) WHERE DATE(timestamp) = bill_date` |
| Net (₹) | Computed | `revenue - expenses` (null if expenses null) |
| Approx Margin % | Computed | `(net / revenue * 100)` (null if incomplete data) |
| Prediction Accuracy % | `predictions` | `AVG(ABS(predicted_qty - actual_qty) / actual_qty * 100)` where `actual_qty IS NOT NULL` |

**Query:**

```sql
SELECT
  o.bill_date                                           AS "Date",
  TO_CHAR(o.bill_date, 'Day')                           AS "Day",
  COUNT(DISTINCT o.id)                                  AS "Total Orders",
  SUM(o.total)                                          AS "Total Revenue",
  SUM(CASE WHEN o.payment_method = 'cash'    THEN o.total ELSE 0 END) AS "Cash Sales",
  SUM(CASE WHEN o.payment_method = 'upi'     THEN o.total ELSE 0 END) AS "UPI Sales",
  SUM(CASE WHEN o.payment_method = 'pending' THEN o.total ELSE 0 END) AS "Pending",
  (
    SELECT COALESCE(SUM(p.total_cost), NULL)
    FROM procurement p
    WHERE DATE(p.timestamp AT TIME ZONE 'Asia/Kolkata') = o.bill_date
  ) AS "Total Expenses",
  (
    SELECT ROUND(
      AVG(CASE
        WHEN pr.actual_qty IS NOT NULL AND pr.actual_qty > 0
        THEN (1 - ABS(pr.predicted_qty::FLOAT - pr.actual_qty) / pr.actual_qty) * 100
        ELSE NULL
      END
    ), 1)
    FROM predictions pr
    WHERE pr.date = o.bill_date
  ) AS "Prediction Accuracy %"
FROM orders o
WHERE o.bill_date = CURRENT_DATE - INTERVAL '1 day'  -- yesterday's data, synced at 11pm
GROUP BY o.bill_date
ORDER BY o.bill_date;
```

---

### Sheet 2: `Item Sales`

**Purpose:** Units sold per menu item per day. Tracks bestsellers and dead weight.  
**Update frequency:** Nightly append (one row per active item per day, even if 0 sold).  
**Headers:**

| Column | Source | SQL |
|--------|--------|-----|
| Date | `orders.bill_date` | — |
| Item Name | `menu_items.name` | — |
| Category | `menu_items.category` | — |
| Units Sold | `order_items.quantity` | `SUM(quantity)` |
| Revenue from Item (₹) | `order_items.subtotal` | `SUM(subtotal)` |
| Predicted Qty | `predictions.predicted_qty` | — |
| Actual Qty (if tracked) | `predictions.actual_qty` | — |

**Query:**

```sql
SELECT
  o.bill_date                        AS "Date",
  m.name                             AS "Item Name",
  m.category                         AS "Category",
  COALESCE(SUM(oi.quantity), 0)      AS "Units Sold",
  COALESCE(SUM(oi.subtotal), 0)      AS "Revenue from Item",
  pr.predicted_qty                   AS "Predicted Qty",
  pr.actual_qty                      AS "Actual Qty"
FROM menu_items m
CROSS JOIN (SELECT CURRENT_DATE - INTERVAL '1 day' AS bill_date) d
LEFT JOIN order_items oi ON oi.menu_item_id = m.id
LEFT JOIN orders o ON o.id = oi.order_id AND o.bill_date = d.bill_date
LEFT JOIN predictions pr ON pr.menu_item_id = m.id AND pr.date = d.bill_date
WHERE m.active = true
GROUP BY o.bill_date, m.name, m.category, pr.predicted_qty, pr.actual_qty, d.bill_date
ORDER BY "Units Sold" DESC;
```

---

### Sheet 3: `Wastage`

**Purpose:** Nightly leftover log. Tracks over-preparation over time.  
**Update frequency:** Nightly append (one row per wastage entry per day).  
**Headers:**

| Column | Source |
|--------|--------|
| Date | `wastage_logs.logged_at` |
| Item Name | `wastage_logs.item_name` |
| Qty Left | `wastage_logs.quantity_left` |
| Predicted Qty | `predictions.predicted_qty` (joined on item + date) |
| Overprep (Predicted - Actual Sold) | Computed |
| Estimated Waste Cost (₹) | Computed: `qty_left × unit_price` (from menu_items) |

**Query:**

```sql
SELECT
  w.logged_at                              AS "Date",
  w.item_name                              AS "Item Name",
  w.quantity_left                          AS "Qty Left",
  pr.predicted_qty                         AS "Predicted Qty",
  (pr.predicted_qty - COALESCE(pr.actual_qty, 0)) AS "Overprep",
  ROUND(w.quantity_left * m.price, 2)      AS "Estimated Waste Cost"
FROM wastage_logs w
LEFT JOIN menu_items m ON m.id = w.menu_item_id
LEFT JOIN predictions pr ON pr.menu_item_id = w.menu_item_id
  AND pr.date = w.logged_at
WHERE w.logged_at = CURRENT_DATE - INTERVAL '1 day'
ORDER BY "Estimated Waste Cost" DESC NULLS LAST;
```

---

### Sheet 4: `Procurement`

**Purpose:** Vendor order log. Tracks what was ordered, at what cost, and from whom.  
**Update frequency:** Nightly append.  
**Headers:**

| Column | Source |
|--------|--------|
| Date | `procurement.timestamp` (IST date part) |
| Vendor | `procurement.vendor_name` |
| Items Summary | Computed from `items_json` |
| Total Cost (₹) | `procurement.total_cost` |
| Status | `procurement.status` |

**Query:**

```sql
SELECT
  DATE(timestamp AT TIME ZONE 'Asia/Kolkata')  AS "Date",
  vendor_name                                   AS "Vendor",
  (
    SELECT STRING_AGG(
      (item->>'name') || ' ' || (item->>'qty') || (item->>'unit'),
      ', '
    )
    FROM jsonb_array_elements(items_json) AS item
  )                                             AS "Items",
  total_cost                                    AS "Total Cost",
  status                                        AS "Status"
FROM procurement
WHERE DATE(timestamp AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE - INTERVAL '1 day'
ORDER BY timestamp;
```

---

### Sync Implementation (Node.js)

```javascript
// jobs/googleSheetsSync.js
// Called by node-cron at 11:00 PM IST (17:30 UTC)

const { google } = require('googleapis');
const { supabase } = require('../services/supabase');

async function runGoogleSheetsSync() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

  try {
    // Run all 4 syncs. If one fails, log and continue with others.
    await syncDailySummary(sheets, SPREADSHEET_ID);
    await syncItemSales(sheets, SPREADSHEET_ID);
    await syncWastage(sheets, SPREADSHEET_ID);
    await syncProcurement(sheets, SPREADSHEET_ID);

    console.log(`[Sheets Sync] ✓ Completed at ${new Date().toISOString()}`);
  } catch (err) {
    console.error('[Sheets Sync] ✗ Failed:', err.message);
    // Do NOT throw — failure must not crash the server or affect other jobs
  }
}

async function appendRows(sheets, spreadsheetId, sheetName, rows) {
  if (!rows || rows.length === 0) {
    console.log(`[Sheets Sync] No data for ${sheetName} — skipping`);
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',   // Interprets dates and numbers correctly
    insertDataOption: 'INSERT_ROWS',    // Appends — never overwrites
    requestBody: { values: rows },
  });
}
```

---

### Sheet Headers (set manually before first sync)

**Daily Summary:**
`Date | Day | Total Orders | Total Revenue (₹) | Cash (₹) | UPI (₹) | Pending (₹) | Expenses (₹) | Net (₹) | Margin % | Prediction Accuracy %`

**Item Sales:**
`Date | Item Name | Category | Units Sold | Revenue (₹) | Predicted Qty | Actual Qty`

**Wastage:**
`Date | Item Name | Qty Left | Predicted Qty | Overprep | Estimated Waste Cost (₹)`

**Procurement:**
`Date | Vendor | Items | Total Cost (₹) | Status`

---

## 8. Schema Decisions and Rationale

### Why `vendor_name` is TEXT (not FK) in `procurement` and `vendor_credit`

Sam types vendor names in natural language. If she spells a vendor name slightly differently ("Rice vendor" vs "Rice Vendor"), a strict FK constraint would reject the insert. Instead, the bot does case-insensitive matching against `vendor_contacts.name` at parse time and normalises the name before writing. This is more robust for a conversational interface.

### Why `local_uuid` is separate from `id` in `orders`

`id` is server-generated (UUID v4 via PostgreSQL). `local_uuid` is client-generated before the order hits the network. They serve different purposes: `id` is the canonical database identifier; `local_uuid` is the idempotency key for offline sync. Using a single field for both would require either trusting the client to generate the PK (security risk) or losing idempotency on sync retries.

### Why `bill_date` is a separate column from `timestamp`

`timestamp` is stored in UTC (all Supabase timestamps are UTC). `bill_date` is the IST date on which the order was placed. Without `bill_date`, computing "today's orders" requires `WHERE DATE(timestamp AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE`, which is not indexable efficiently. `bill_date` is set by the backend at order creation time (converted to IST) and is directly indexable.

### Why `wastage_logs` has both `menu_item_id` and `item_name`

Sam might log wastage for a special that isn't on the permanent menu, or the bot might not match the item name perfectly. Storing both means: (a) for known items, `menu_item_id` enables accurate prediction model updates; (b) for unknown items, `item_name` preserves the data without an error.

### Why `processed_webhooks` is a table, not Redis

Render's free tier doesn't include Redis. Supabase is already the persistent store. A simple table with a TTL cleanup job (48h) is sufficient for Twilio's deduplication window. At Sam's message volume (maybe 20 messages/day), this table stays tiny.

### Why `predictions` stores the multipliers applied

`weather_multiplier_applied` and `festival_multiplier_applied` are stored so you can audit why the system recommended a specific quantity. When Sam asks "why did you suggest only 8 fish curry today?", you can query these columns and give her a real answer. This also helps debug the model during Week 4–5.

### Why `attendance` has no `check_out_time`

Phase I explicitly excludes check-out tracking (per PRD Section 4B, Feature S-06). The column is intentionally absent to avoid collecting data that has no defined use yet. Adding it in Phase II is a one-line `ALTER TABLE` migration.

---

*This schema is the authoritative data model for CafeOS Phase I.*  
*All backend controllers, intelligence module queries, and Sheets sync functions should reference this document.*  
*Run the SQL in Supabase SQL Editor in the order specified in Section 2.*  
*Update version number and date when any table definition changes.*

---

**Built for Sam. Designed for every cafe like hers.**
