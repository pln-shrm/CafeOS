# CafeOS — REST API Specification

**Version:** 1.0  
**Date:** June 2026  
**Status:** Authoritative reference for all backend development  
**Base URL (dev):** `http://localhost:3000`  
**Base URL (prod):** `https://cafeos-backend.onrender.com`

---

## Table of Contents

1. [Conventions and Global Rules](#1-conventions-and-global-rules)
2. [Authentication Endpoints](#2-authentication-endpoints)
3. [Menu Management Endpoints](#3-menu-management-endpoints)
4. [Order Endpoints](#4-order-endpoints)
5. [Billing and Payment Endpoints](#5-billing-and-payment-endpoints)
6. [Inventory and Predictions Endpoints](#6-inventory-and-predictions-endpoints)
7. [Vendor Order Management Endpoints](#7-vendor-order-management-endpoints)
8. [Attendance Endpoints](#8-attendance-endpoints)
9. [Wastage Logging Endpoints](#9-wastage-logging-endpoints)
10. [Credit Ledger Endpoints](#10-credit-ledger-endpoints)
11. [WhatsApp Webhook Endpoint](#11-whatsapp-webhook-endpoint)
12. [Utility Endpoints](#12-utility-endpoints)
13. [Error Code Reference](#13-error-code-reference)
14. [Auth Middleware Implementation Notes](#14-auth-middleware-implementation-notes)

---

## 1. Conventions and Global Rules

### Auth Tokens

| Actor | Auth Method | Token Location | Expiry |
|---|---|---|---|
| Staff | 4-digit PIN → bcrypt verify → server-signed JWT | `Authorization: Bearer <jwt>` | Midnight daily (client-enforced) |
| Owner | Supabase email/password → Supabase JWT | `Authorization: Bearer <supabase_jwt>` | 7 days |
| Twilio Webhook | HMAC-SHA1 signature in `X-Twilio-Signature` header | Validated in middleware | Per-request |

### Response Envelope

Every API response — success or error — uses this shape:

```json
// Success
{
  "success": true,
  "data": { ... }
}

// Error
{
  "success": false,
  "error": {
    "code": "MENU_ITEM_NOT_FOUND",
    "message": "No menu item found with id: abc-123"
  }
}
```

`data` may be an object or an array depending on the endpoint.  
`error.code` is a machine-readable constant (see [Section 13](#13-error-code-reference)).  
`error.message` is human-readable and safe to surface in dev; mask in production logs if sensitive.

### HTTP Status Codes Used

| Code | Meaning |
|---|---|
| 200 | OK — request succeeded |
| 201 | Created — resource was created |
| 400 | Bad Request — validation failed, missing required fields |
| 401 | Unauthorized — no token or invalid token |
| 403 | Forbidden — token valid but wrong role |
| 404 | Not Found — resource does not exist |
| 409 | Conflict — duplicate resource (e.g. attendance already logged) |
| 422 | Unprocessable Entity — token valid, body valid, but business logic rejected |
| 500 | Internal Server Error — unhandled exception |

### IST Timezone Rule

All `timestamp` and `date` fields are stored in UTC in Supabase. The backend must convert to `Asia/Kolkata` (UTC+5:30) when:
- Generating bill numbers (daily sequential, resets at midnight IST not UTC midnight)
- Computing "today's" orders, attendance, wastage
- All date comparisons in queries

Use `date-fns-tz` or `luxon` in Node.js. Never use plain `new Date()` for IST operations.

### Bill Number Generation

`bill_number` is a daily sequential integer starting at 1, scoped to IST date. It is assigned server-side on order confirmation, never client-side.

```sql
SELECT COALESCE(MAX(bill_number), 0) + 1
FROM orders
WHERE DATE(timestamp AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE AT TIME ZONE 'Asia/Kolkata';
```

### Offline Sync (Orders)

The staff app queues orders offline with a client-generated `local_uuid`. On sync, `POST /api/orders` and `POST /api/orders/sync` both use upsert on `local_uuid` to prevent duplicates. The backend must handle both the live path and the sync path identically.

---

## 2. Authentication Endpoints

### 2.1 Staff Login

```
POST /api/auth/staff/login
Auth: none
```

**Purpose:** Verify a staff member's 4-digit PIN. Returns a signed JWT for use in all subsequent staff-role requests.

**Request Body:**

```json
{
  "pin": "1234"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `pin` | string | yes | Exactly 4 numeric characters |

**Internal Logic:**

1. Fetch all active staff rows from `staff` table where `active = true`.
2. For each staff member, run `bcrypt.compare(pin, staff.pin_hash)`.
3. If a match is found, sign a JWT with payload `{ staff_id, role: "staff", name }` using `process.env.JWT_SECRET`.
4. Check lockout: if `pin_attempts[pin_fingerprint]` >= 3 within the last 5 minutes, reject before bcrypt (see edge cases).
5. Return the JWT and staff profile.

> **Note:** bcrypt.compare is O(n) in number of staff members. At Sam's scale (2–5 staff), this is ~5 bcrypt ops ≈ 1 second. Acceptable. Do NOT parallelize with Promise.all — bcrypt is CPU-bound and will block the event loop. Sequential is fine here.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "staff": {
      "id": "uuid-staff-1",
      "name": "Raju",
      "role": "Counter Staff"
    }
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `pin` missing or not 4 digits |
| 401 | `INVALID_PIN` | No staff member matched the PIN |
| 429 | `RATE_LIMITED` | 3+ failed attempts in 5 minutes |
| 500 | `INTERNAL_ERROR` | DB error |

**Edge Cases:**
- PIN lockout is tracked server-side in a simple in-memory Map: `{ [pin_fingerprint]: { count, first_attempt_at } }`. Reset entry after 5 minutes. This is not persisted — server restart clears it. That's acceptable for this scale.
- If two staff share the same PIN, the first match in DB order wins. The owner can prevent this by assigning unique PINs.
- Staff session expires at midnight IST — this is **not** enforced by JWT expiry (which is set to 24h for safety). The React app enforces it by storing `loginTimestamp` in localStorage and redirecting to login if `loginTimestamp < today's IST midnight`. The backend JWT is still valid until 24h — this is intentional to handle edge cases near midnight.

---

### 2.2 Owner Login

```
POST /api/auth/owner/login
Auth: none
```

**Purpose:** Owner logs in with email/password via Supabase Auth. Returns a Supabase session JWT.

**Request Body:**

```json
{
  "email": "sam@samscafe.com",
  "password": "secretpassword"
}
```

| Field | Type | Required |
|---|---|---|
| `email` | string | yes |
| `password` | string | yes |

**Internal Logic:**

1. Call Supabase Auth: `supabase.auth.signInWithPassword({ email, password })`.
2. Verify the returned user's email matches `process.env.OWNER_EMAIL` (only one owner allowed).
3. Return the Supabase session object.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "some-refresh-token",
    "expires_in": 604800,
    "owner": {
      "id": "supabase-user-uuid",
      "email": "sam@samscafe.com"
    }
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing email or password |
| 401 | `INVALID_CREDENTIALS` | Supabase auth rejected the credentials |
| 403 | `NOT_OWNER` | Credentials valid but email ≠ `OWNER_EMAIL` |
| 500 | `INTERNAL_ERROR` | Supabase unreachable |

**Edge Cases:**
- There is no registration endpoint. The owner account is provisioned once by developers directly in Supabase dashboard.
- Password reset is handled via Supabase's built-in email reset. No backend endpoint needed.

---

### 2.3 Refresh Owner Token

```
POST /api/auth/owner/refresh
Auth: none
```

**Purpose:** Exchange a Supabase refresh token for a new access token. Called automatically by the React app's Supabase client before token expiry.

**Request Body:**

```json
{
  "refresh_token": "some-refresh-token"
}
```

**Internal Logic:**

Calls `supabase.auth.refreshSession({ refresh_token })`. Returns new tokens.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "access_token": "new-jwt...",
    "refresh_token": "new-refresh-token",
    "expires_in": 604800
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 401 | `INVALID_REFRESH_TOKEN` | Token expired or invalid |
| 500 | `INTERNAL_ERROR` | Supabase unreachable |

---

## 3. Menu Management Endpoints

### 3.1 Get All Menu Items

```
GET /api/menu
Auth: staff OR owner
```

**Purpose:** Returns menu items. Staff gets only active items (for order-taking screen). Owner gets all items including inactive ones (for management screen).

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `include_inactive` | boolean | `false` | If `true`, returns inactive items too. Owner only — ignored for staff. |

**Internal Logic:**

1. Determine role from JWT.
2. If staff: `SELECT * FROM menu_items WHERE active = true ORDER BY category, name`.
3. If owner AND `include_inactive=true`: `SELECT * FROM menu_items ORDER BY category, name, active DESC`.
4. If owner AND `include_inactive=false`: same as staff query.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid-item-1",
        "name": "Chicken Biryani",
        "price": 120.00,
        "category": "Mains",
        "active": true,
        "seed_qty": 20,
        "created_at": "2026-06-01T05:30:00Z"
      },
      {
        "id": "uuid-item-2",
        "name": "Masala Chai",
        "price": 15.00,
        "category": "Drinks",
        "active": true,
        "seed_qty": 60,
        "created_at": "2026-06-01T05:30:00Z"
      }
    ]
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 401 | `UNAUTHORIZED` | No token |
| 500 | `INTERNAL_ERROR` | DB error |

---

### 3.2 Create Menu Item

```
POST /api/menu
Auth: owner only
```

**Purpose:** Add a new item to the menu. Immediately visible to staff on next menu load.

**Request Body:**

```json
{
  "name": "Fish Curry",
  "price": 110.00,
  "category": "Mains",
  "active": true,
  "seed_qty": 14
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | string | yes | Non-empty, max 100 chars |
| `price` | number | yes | > 0, max 2 decimal places |
| `category` | string | no | Max 50 chars |
| `active` | boolean | no | Default `true` |
| `seed_qty` | integer | no | Default `10`. Used as prediction until sales data exists. |

**Internal Logic:**

1. Validate fields.
2. Check for duplicate name (case-insensitive): `SELECT id FROM menu_items WHERE LOWER(name) = LOWER($1)`.
3. If duplicate exists: return 409.
4. Insert into `menu_items`.
5. Return created item.

**Success Response (201):**

```json
{
  "success": true,
  "data": {
    "item": {
      "id": "uuid-new-item",
      "name": "Fish Curry",
      "price": 110.00,
      "category": "Mains",
      "active": true,
      "seed_qty": 14,
      "created_at": "2026-06-05T10:30:00Z"
    }
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing name or price, price ≤ 0 |
| 401 | `UNAUTHORIZED` | No token |
| 403 | `FORBIDDEN` | Staff token used |
| 409 | `DUPLICATE_NAME` | Menu item with same name already exists |
| 500 | `INTERNAL_ERROR` | DB error |

---

### 3.3 Update Menu Item

```
PUT /api/menu/:id
Auth: owner only
```

**Purpose:** Edit an existing menu item — name, price, category, active status, or seed_qty.

**URL Params:**

| Param | Type | Description |
|---|---|---|
| `id` | UUID | ID of the menu item to update |

**Request Body (all fields optional — send only what changed):**

```json
{
  "name": "Fish Curry (Goan Style)",
  "price": 120.00,
  "category": "Mains",
  "active": true,
  "seed_qty": 16
}
```

**Internal Logic:**

1. Fetch item by `id`. If not found: 404.
2. Validate any provided fields (same rules as create).
3. If `name` is changing, check for duplicates (excluding self).
4. Build UPDATE statement with only the provided fields (partial update).
5. Return the updated item.

> **Price change behaviour:** New price applies to new orders immediately. Historical orders are unaffected — `order_items.unit_price` is a snapshot taken at order creation time.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "item": {
      "id": "uuid-item-1",
      "name": "Fish Curry (Goan Style)",
      "price": 120.00,
      "category": "Mains",
      "active": true,
      "seed_qty": 16,
      "created_at": "2026-06-01T05:30:00Z"
    }
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Price ≤ 0, name too long, etc. |
| 403 | `FORBIDDEN` | Staff token |
| 404 | `MENU_ITEM_NOT_FOUND` | No item with given `id` |
| 409 | `DUPLICATE_NAME` | Name already taken by another item |
| 500 | `INTERNAL_ERROR` | DB error |

**Edge Cases:**
- Deactivating an item (`active: false`) does not delete it. It disappears from the staff ordering screen but remains in all historical order records.
- Do NOT allow hard-delete via this endpoint. There is no `DELETE /api/menu/:id` — deactivate only.

---

### 3.4 Deactivate Menu Item

```
PATCH /api/menu/:id/deactivate
Auth: owner only
```

**Purpose:** Convenience shortcut to set `active = false` without sending a full update body. Equivalent to `PUT /api/menu/:id` with `{ "active": false }` but more explicit.

**No request body required.**

**Internal Logic:**

1. Fetch item by `id`. If not found: 404.
2. If already inactive: return 200 with `"already_inactive": true` (idempotent).
3. `UPDATE menu_items SET active = false WHERE id = $1`.
4. Return updated item.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "item": { "id": "uuid-item-1", "name": "Fish Curry", "active": false },
    "already_inactive": false
  }
}
```

---

## 4. Order Endpoints

### 4.1 Create Order (Live — Online Path)

```
POST /api/orders
Auth: staff
```

**Purpose:** Create a new completed customer order. This is the primary online path — called when the staff device has internet. The offline sync path is covered by `POST /api/orders/sync`.

**Request Body:**

```json
{
  "local_uuid": "client-generated-uuid-v4",
  "order_type": "dine_in",
  "payment_method": "cash",
  "items": [
    { "menu_item_id": "uuid-item-1", "quantity": 2 },
    { "menu_item_id": "uuid-item-2", "quantity": 3 }
  ]
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `local_uuid` | UUID v4 | yes | Client-generated; used for offline deduplication |
| `order_type` | string | yes | `"dine_in"` or `"takeaway"` |
| `payment_method` | string | yes | `"cash"`, `"upi"`, or `"pending"` |
| `items` | array | yes | Min 1 item |
| `items[].menu_item_id` | UUID | yes | Must be an active menu item |
| `items[].quantity` | integer | yes | > 0 |

**Internal Logic:**

1. Validate all fields and `items` array.
2. For each `menu_item_id`, fetch current price from `menu_items` where `active = true`. If any item is not found or inactive: 422.
3. Compute `unit_price` snapshots and `total`:
   ```
   total = SUM(item.price × item.quantity)
   ```
4. Check for existing order with same `local_uuid` (upsert guard): if exists, return the existing order (idempotent).
5. Assign `bill_number` (daily sequential, IST date — see Section 1).
6. Insert into `orders`:
   ```
   staff_id = req.staffId (from JWT)
   order_type, payment_method, total, bill_number
   local_uuid, synced = true, timestamp = now()
   ```
7. Insert into `order_items` for each line item (with `unit_price` snapshot).
8. Return the created order with bill number.

**Success Response (201):**

```json
{
  "success": true,
  "data": {
    "order": {
      "id": "uuid-order-1",
      "bill_number": 14,
      "local_uuid": "client-generated-uuid-v4",
      "order_type": "dine_in",
      "payment_method": "cash",
      "total": 285.00,
      "staff_id": "uuid-staff-1",
      "timestamp": "2026-06-05T07:30:00Z",
      "items": [
        {
          "id": "uuid-oi-1",
          "menu_item_id": "uuid-item-1",
          "name": "Chicken Biryani",
          "quantity": 2,
          "unit_price": 120.00,
          "subtotal": 240.00
        },
        {
          "id": "uuid-oi-2",
          "menu_item_id": "uuid-item-2",
          "name": "Masala Chai",
          "quantity": 3,
          "unit_price": 15.00,
          "subtotal": 45.00
        }
      ]
    }
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing fields, empty items array, invalid order_type |
| 401 | `UNAUTHORIZED` | No token |
| 403 | `FORBIDDEN` | Owner token used on staff-only route |
| 422 | `MENU_ITEM_INACTIVE` | One or more items not found or inactive |
| 500 | `INTERNAL_ERROR` | DB error |

**Edge Cases:**
- `local_uuid` collision (duplicate): return 200 (not 201) with the existing order. This means the client's sync retry succeeded silently.
- `payment_method: "pending"` is valid — it means Sam will collect later. These appear in the daily report flagged as unpaid.
- `total` is always computed server-side from current prices. Never trust the client-sent total.

---

### 4.2 Sync Offline Orders

```
POST /api/orders/sync
Auth: staff
```

**Purpose:** Flush the IndexedDB queue after reconnecting. Accepts a single offline order (not a batch — orders are synced one by one with exponential backoff). Functionally identical to `POST /api/orders` but the endpoint name signals intent.

**Request Body:** Same schema as `POST /api/orders`.

**Internal Logic:**

Identical to `POST /api/orders`. The `local_uuid` upsert guard means calling this endpoint multiple times for the same order is safe.

**Success Response:** Same as `POST /api/orders`. Returns 200 if order already existed (duplicate sync), 201 if it was new.

---

### 4.3 Get Today's Orders

```
GET /api/orders/today
Auth: owner
```

**Purpose:** Returns all orders placed today (IST date). Used by owner portal dashboard and daily summary.

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `payment_method` | string | — | Filter by `cash`, `upi`, or `pending` |
| `order_type` | string | — | Filter by `dine_in` or `takeaway` |

**Internal Logic:**

```sql
SELECT o.*, 
       json_agg(
         json_build_object(
           'menu_item_id', oi.menu_item_id,
           'name', m.name,
           'quantity', oi.quantity,
           'unit_price', oi.unit_price,
           'subtotal', oi.quantity * oi.unit_price
         )
       ) AS items
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN menu_items m ON m.id = oi.menu_item_id
WHERE DATE(o.timestamp AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE AT TIME ZONE 'Asia/Kolkata'
GROUP BY o.id
ORDER BY o.timestamp DESC;
```

Apply filters if provided.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "date": "2026-06-05",
    "orders": [ ... ],
    "summary": {
      "total_orders": 23,
      "total_revenue": 4850.00,
      "cash": 2200.00,
      "upi": 2400.00,
      "pending": 250.00
    }
  }
}
```

---

### 4.4 Get Order by ID

```
GET /api/orders/:id
Auth: owner OR staff (staff can only fetch orders placed in their current session — enforced client-side; backend returns any order)
```

**Purpose:** Fetch a single order with all line items. Used for e-bill generation.

**Internal Logic:**

Fetch `orders` + `order_items` + `menu_items.name` for the given order `id`.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "order": {
      "id": "uuid-order-1",
      "bill_number": 14,
      "order_type": "dine_in",
      "payment_method": "cash",
      "total": 285.00,
      "timestamp": "2026-06-05T07:30:00Z",
      "staff": { "id": "uuid-staff-1", "name": "Raju" },
      "items": [ ... ]
    }
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `ORDER_NOT_FOUND` | No order with given ID |

---

### 4.5 Get Orders by Date Range

```
GET /api/orders
Auth: owner
```

**Purpose:** Paginated order history for the owner portal reports section.

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `from` | date (YYYY-MM-DD) | yes | Start date (inclusive), IST |
| `to` | date (YYYY-MM-DD) | yes | End date (inclusive), IST |
| `page` | integer | no | Default 1 |
| `limit` | integer | no | Default 50, max 200 |

**Internal Logic:**

Query `orders` filtered by IST date range, paginated. Include `order_items` aggregate for each order.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "orders": [ ... ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 142,
      "pages": 3
    }
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing `from`/`to`, invalid date format, `from > to` |

---

## 5. Billing and Payment Endpoints

### 5.1 Generate E-Bill

```
GET /api/orders/:id/bill
Auth: staff OR owner
```

**Purpose:** Returns formatted bill data for display or printing. The React app renders this as a printable view (browser print dialog). No PDF is generated server-side — the PWA handles the print-to-PDF if needed.

**Internal Logic:**

1. Fetch order with items (same as `GET /api/orders/:id`).
2. Fetch current cafe name and details from a static config (hardcoded as `"Sam's Cafe, Vasco da Gama, Goa"`).
3. Return structured bill object.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "bill": {
      "cafe_name": "Sam's Cafe",
      "cafe_address": "Vasco da Gama, Goa",
      "bill_number": 14,
      "date": "2026-06-05",
      "time": "13:00",
      "order_type": "Dine-In",
      "payment_method": "Cash",
      "items": [
        {
          "name": "Chicken Biryani",
          "quantity": 2,
          "unit_price": 120.00,
          "subtotal": 240.00
        },
        {
          "name": "Masala Chai",
          "quantity": 3,
          "unit_price": 15.00,
          "subtotal": 45.00
        }
      ],
      "subtotal": 285.00,
      "total": 285.00,
      "footer": "Thank you for visiting Sam's Cafe!"
    }
  }
}
```

> **Note on tax:** No GST/tax applied (small cafe, unregistered composition scheme typical in India). If tax needs to be added later, add `tax_rate` and `tax_amount` fields here.

---

### 5.2 Update Payment Method

```
PATCH /api/orders/:id/payment
Auth: owner only
```

**Purpose:** Change the payment method on an existing order. Used when a customer pays a "pending" bill later, or a payment type was logged incorrectly.

**Request Body:**

```json
{
  "payment_method": "upi"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `payment_method` | string | yes | `"cash"`, `"upi"`, or `"pending"` |

**Internal Logic:**

1. Fetch order by `id`. If not found: 404.
2. Validate `payment_method`.
3. `UPDATE orders SET payment_method = $1 WHERE id = $2`.
4. Return updated order.

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid payment_method value |
| 403 | `FORBIDDEN` | Staff token (staff cannot change payment method after the fact) |
| 404 | `ORDER_NOT_FOUND` | Order does not exist |

---

### 5.3 Daily Revenue Summary

```
GET /api/billing/summary
Auth: owner
```

**Purpose:** Returns today's revenue breakdown for the owner portal dashboard and bot `summary` command.

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `date` | date (YYYY-MM-DD) | today (IST) | Which day to summarise |

**Internal Logic:**

```sql
SELECT
  COUNT(DISTINCT o.id)                              AS total_orders,
  COALESCE(SUM(o.total), 0)                         AS total_revenue,
  COALESCE(SUM(CASE WHEN o.payment_method = 'cash' THEN o.total ELSE 0 END), 0)    AS cash,
  COALESCE(SUM(CASE WHEN o.payment_method = 'upi'  THEN o.total ELSE 0 END), 0)    AS upi,
  COALESCE(SUM(CASE WHEN o.payment_method = 'pending' THEN o.total ELSE 0 END), 0) AS pending,
  COALESCE(SUM(CASE WHEN o.order_type = 'dine_in' THEN o.total ELSE 0 END), 0)     AS dine_in_revenue,
  COALESCE(SUM(CASE WHEN o.order_type = 'takeaway' THEN o.total ELSE 0 END), 0)    AS takeaway_revenue
FROM orders o
WHERE DATE(o.timestamp AT TIME ZONE 'Asia/Kolkata') = $1;
```

Also compute top 5 items by quantity sold for the day.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "date": "2026-06-05",
    "total_orders": 28,
    "total_revenue": 5240.00,
    "breakdown": {
      "cash": 2800.00,
      "upi": 2190.00,
      "pending": 250.00,
      "dine_in": 3900.00,
      "takeaway": 1340.00
    },
    "top_items": [
      { "name": "Chicken Biryani", "units_sold": 34, "revenue": 4080.00 },
      { "name": "Masala Chai", "units_sold": 61, "revenue": 915.00 }
    ]
  }
}
```

---

## 6. Inventory and Predictions Endpoints

### 6.1 Get Today's Predictions

```
GET /api/predictions/today
Auth: owner
```

**Purpose:** Returns today's prep predictions, including whether Sam has confirmed them yet. Also used by the bot flow to display predictions.

**Internal Logic:**

```sql
SELECT p.*, m.name AS item_name
FROM predictions p
JOIN menu_items m ON m.id = p.menu_item_id
WHERE p.date = CURRENT_DATE AT TIME ZONE 'Asia/Kolkata'
ORDER BY m.category, m.name;
```

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "date": "2026-06-05",
    "confirmed": false,
    "predictions": [
      {
        "id": "uuid-pred-1",
        "menu_item_id": "uuid-item-1",
        "item_name": "Chicken Biryani",
        "predicted_qty": 22,
        "owner_override": null,
        "confirmed": false,
        "manual_flag": null
      }
    ]
  }
}
```

---

### 6.2 Get Predictions by Date

```
GET /api/predictions
Auth: owner
```

**Query Parameters:**

| Param | Type | Required |
|---|---|---|
| `date` | date (YYYY-MM-DD) | yes |

Returns same structure as `GET /api/predictions/today` but for any date. Used for history view.

---

### 6.3 Confirm Predictions (Approve Prep Sheet)

```
POST /api/predictions/confirm
Auth: owner
```

**Purpose:** Sam approves today's prep sheet as-is. Called when she replies "1" to the bot's morning message. Also callable from the owner portal web UI.

**Request Body:**

```json
{
  "date": "2026-06-05"
}
```

**Internal Logic:**

```sql
UPDATE predictions
SET confirmed = true
WHERE date = $1 AND confirmed = false;
```

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "date": "2026-06-05",
    "confirmed_count": 8
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `NO_PREDICTIONS_FOUND` | No prediction rows exist for this date |
| 409 | `ALREADY_CONFIRMED` | All predictions for this date already confirmed |

---

### 6.4 Override Predictions

```
PATCH /api/predictions/override
Auth: owner
```

**Purpose:** Sam edits specific quantities in the prep sheet. Called when the bot parses her edit reply (`"biryani 25, skip fish curry"`). Can also be called from owner portal.

**Request Body:**

```json
{
  "date": "2026-06-05",
  "overrides": [
    { "menu_item_id": "uuid-item-1", "qty": 25 },
    { "menu_item_id": "uuid-item-2", "qty": 0 }
  ]
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `date` | date | yes | Must exist in `predictions` table |
| `overrides` | array | yes | Min 1 item |
| `overrides[].menu_item_id` | UUID | yes | Must have a prediction row for this date |
| `overrides[].qty` | integer | yes | ≥ 0. 0 means "skip this item today" |

**Internal Logic:**

For each override:

```sql
UPDATE predictions
SET owner_override = $1, confirmed = true
WHERE date = $2 AND menu_item_id = $3;
```

For items NOT in the overrides array: set `confirmed = true` without changing `predicted_qty`.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "date": "2026-06-05",
    "updated": 2,
    "predictions": [ ... ]
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing date, empty overrides, qty < 0 |
| 404 | `PREDICTION_NOT_FOUND` | A menu_item_id has no prediction row for this date |

---

### 6.5 Generate Next-Day Predictions (Internal / Cron)

```
POST /api/predictions/generate
Auth: owner (also called internally by cron job)
```

**Purpose:** Triggers the intelligence module to compute next-day predictions. Called by the 10pm cron job after wastage is logged. Also callable manually from owner portal ("Regenerate" button).

**Request Body:**

```json
{
  "date": "2026-06-06"
}
```

**Internal Logic:**

1. Fetch sales history for this item: last 28 days of `order_items` + `orders` (day-of-week weighted, EWMA).
2. Fetch today's `wastage_logs` (adjustment signal: if wastage > 20% of predicted, reduce tomorrow's qty).
3. Fetch today's `checkins` parsed signals (stockouts: push qty up; demand spike: note as `manual_flag`).
4. Fetch weather for target date from Open-Meteo (Vasco da Gama: lat 15.3961, lon 73.8173).
5. Check `festival_calendar` for active flags within 5 days of target date.
6. Apply multipliers in this order: base EWMA → day-of-week → wastage feedback → weather → festival → owner check-in signals.
7. `INSERT INTO predictions ... ON CONFLICT (date, menu_item_id) DO UPDATE SET predicted_qty = EXCLUDED.predicted_qty`.
8. Return generated predictions.

> **Note:** If no sales data exists (< 7 days of history), fall back to `menu_items.seed_qty`. If weather API is unreachable, use neutral multipliers (1.0).

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "date": "2026-06-06",
    "generated": 8,
    "predictions": [
      {
        "item_name": "Chicken Biryani",
        "predicted_qty": 22,
        "signals_applied": ["ewma", "rainy_weather", "tuesday_pattern"]
      }
    ]
  }
}
```

---

## 7. Vendor Order Management Endpoints

### 7.1 Create Vendor Order (Procurement)

```
POST /api/vendor/orders
Auth: owner
```

**Purpose:** Log a procurement order. Called when Sam sends an `order [items] → [vendor]` WhatsApp command OR manually from owner portal.

**Request Body:**

```json
{
  "vendor_name": "Rice Vendor",
  "items": [
    { "name": "Rice", "qty": 5, "unit": "kg", "price_per_unit": 45 },
    { "name": "Dal", "qty": 3, "unit": "kg", "price_per_unit": null }
  ],
  "delivery_date": "2026-06-06",
  "notes": "Early morning delivery preferred"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `vendor_name` | string | yes | Non-empty |
| `items` | array | yes | Min 1 item |
| `items[].name` | string | yes | Ingredient name |
| `items[].qty` | number | yes | > 0 |
| `items[].unit` | string | yes | e.g. "kg", "litre", "piece" |
| `items[].price_per_unit` | number | no | null if price not discussed |
| `delivery_date` | date | no | Defaults to tomorrow (IST) |
| `notes` | string | no | Optional free-text note |

**Internal Logic:**

1. Validate fields.
2. Compute `total_cost = SUM(item.qty × item.price_per_unit)` — `null` if any price is missing.
3. Insert into `procurement`:
   ```json
   {
     "vendor_name": "Rice Vendor",
     "items_json": [...],
     "total_cost": 225.00,
     "delivery_date": "2026-06-06",
     "status": "pending_delivery"
   }
   ```
4. If `vendor_name` is not in `vendor_contacts`, create a new contact with `whatsapp_number = ""` and `notes = "Created via order command — add number in Owner Portal"`.
5. Generate the forward-ready message string:
   ```
   "Rice 5kg, Dal 3kg — please deliver tomorrow morning."
   ```
6. Return the procurement record + formatted message.

**Success Response (201):**

```json
{
  "success": true,
  "data": {
    "procurement": {
      "id": "uuid-proc-1",
      "vendor_name": "Rice Vendor",
      "items_json": [...],
      "total_cost": 225.00,
      "delivery_date": "2026-06-06",
      "status": "pending_delivery",
      "timestamp": "2026-06-05T16:30:00Z"
    },
    "forward_message": "Rice 5kg, Dal 3kg — please deliver tomorrow morning."
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing vendor_name, empty items, qty ≤ 0 |
| 403 | `FORBIDDEN` | Staff token |

---

### 7.2 Get Procurement Orders

```
GET /api/vendor/orders
Auth: owner
```

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | string | — | Filter: `pending_delivery`, `delivered`, `cancelled` |
| `vendor_name` | string | — | Filter by vendor |
| `from` | date | 7 days ago | Start date |
| `to` | date | today | End date |

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "id": "uuid-proc-1",
        "vendor_name": "Rice Vendor",
        "items_json": [...],
        "total_cost": 225.00,
        "delivery_date": "2026-06-06",
        "status": "pending_delivery",
        "timestamp": "2026-06-05T16:30:00Z"
      }
    ]
  }
}
```

---

### 7.3 Update Procurement Status

```
PATCH /api/vendor/orders/:id/status
Auth: owner
```

**Purpose:** Mark a procurement order as delivered or cancelled. Called from owner portal when goods arrive.

**Request Body:**

```json
{
  "status": "delivered"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `status` | string | yes | `"delivered"` or `"cancelled"` |

**Internal Logic:**

1. Fetch procurement record. If not found: 404.
2. If current status is already `"delivered"` or `"cancelled"`: return 409.
3. Update status.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "id": "uuid-proc-1",
    "status": "delivered"
  }
}
```

---

### 7.4 Get Vendor Contacts

```
GET /api/vendor/contacts
Auth: owner
```

**Purpose:** List all vendor contacts for owner portal management.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "vendors": [
      {
        "id": "uuid-vendor-1",
        "name": "Rice Vendor",
        "whatsapp_number": "+919876543210",
        "notes": "Delivers 7-9am",
        "active": true
      }
    ]
  }
}
```

---

### 7.5 Create / Update Vendor Contact

```
POST /api/vendor/contacts
PUT  /api/vendor/contacts/:id
Auth: owner
```

**Request Body:**

```json
{
  "name": "Rice Vendor",
  "whatsapp_number": "+919876543210",
  "notes": "Delivers 7-9am"
}
```

| Field | Type | Required |
|---|---|---|
| `name` | string | yes |
| `whatsapp_number` | string | yes (POST), no (PUT) |
| `notes` | string | no |

**Error Responses for POST:**

| Status | Code | Condition |
|---|---|---|
| 409 | `DUPLICATE_VENDOR_NAME` | Vendor with same name already exists |

---

## 8. Attendance Endpoints

### 8.1 Staff Check-In

```
POST /api/attendance/checkin
Auth: staff
```

**Purpose:** Log a staff member's arrival for the day. The check-in button on the staff home screen calls this.

**Request Body:**

```json
{
  "note": "Traffic on highway"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `note` | string | no | Optional reason for late arrival |

**Internal Logic:**

1. Extract `staff_id` from JWT.
2. Compute today's IST date.
3. Check if attendance record already exists for this `staff_id` + today: if yes, return 409.
4. Compute `late`: `late = (current_IST_time > 10:00 AM)`.
5. If late AND no `note` provided: still insert, note can be null (it's optional per PRD).
6. Insert into `attendance`:
   ```json
   { "staff_id": "...", "date": "2026-06-05", "check_in_time": "...", "late": true, "note": "Traffic on highway" }
   ```

**Success Response (201):**

```json
{
  "success": true,
  "data": {
    "attendance": {
      "id": "uuid-att-1",
      "staff_id": "uuid-staff-1",
      "staff_name": "Raju",
      "date": "2026-06-05",
      "check_in_time": "2026-06-05T04:45:00Z",
      "check_in_time_ist": "10:15 AM",
      "late": true,
      "note": "Traffic on highway"
    }
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 401 | `UNAUTHORIZED` | No token |
| 409 | `ALREADY_CHECKED_IN` | Attendance already logged for this staff today |

---

### 8.2 Get Attendance

```
GET /api/attendance
Auth: owner
```

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `staff_id` | UUID | — | Filter by specific staff member |
| `from` | date | 30 days ago | Start date |
| `to` | date | today | End date |
| `late_only` | boolean | false | Show only late arrivals |

**Internal Logic:**

Join `attendance` with `staff` for names. Left-join to identify absent days (present in date range but no attendance record for a staff member that day).

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "records": [
      {
        "date": "2026-06-05",
        "staff_id": "uuid-staff-1",
        "staff_name": "Raju",
        "check_in_time_ist": "09:45 AM",
        "late": false,
        "note": null
      }
    ]
  }
}
```

---

### 8.3 Get Staff List

```
GET /api/staff
Auth: owner
```

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "staff": [
      {
        "id": "uuid-staff-1",
        "name": "Raju",
        "role": "Counter Staff",
        "daily_wage": 450.00,
        "active": true,
        "created_at": "2026-06-01T05:30:00Z"
      }
    ]
  }
}
```

---

### 8.4 Create Staff Member

```
POST /api/staff
Auth: owner
```

**Request Body:**

```json
{
  "name": "Meena",
  "pin": "5678",
  "role": "Kitchen",
  "daily_wage": 400.00
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | string | yes | Non-empty, max 100 chars |
| `pin` | string | yes | Exactly 4 numeric digits |
| `role` | string | no | Free text |
| `daily_wage` | number | no | > 0 |

**Internal Logic:**

1. Validate PIN format.
2. Hash PIN: `pin_hash = await bcrypt.hash(pin, 10)`.
3. Insert into `staff`. Return new staff record (no pin or pin_hash in response).

**Success Response (201):**

```json
{
  "success": true,
  "data": {
    "staff": {
      "id": "uuid-staff-2",
      "name": "Meena",
      "role": "Kitchen",
      "daily_wage": 400.00,
      "active": true
    }
  }
}
```

---

### 8.5 Update Staff Member

```
PUT /api/staff/:id
Auth: owner
```

**Request Body (all optional):**

```json
{
  "name": "Meena Fernandes",
  "pin": "9012",
  "role": "Senior Counter",
  "daily_wage": 500.00,
  "active": true
}
```

**Internal Logic:**

If `pin` is provided: hash it. Build partial UPDATE. Return updated record.

---

## 9. Wastage Logging Endpoints

### 9.1 Log Wastage

```
POST /api/wastage
Auth: owner
```

**Purpose:** Record end-of-day leftovers. Called by the bot flow handler when Sam responds to the 10pm wastage prompt. Also callable from owner portal.

**Request Body:**

```json
{
  "date": "2026-06-05",
  "items": [
    { "item_name": "Fish Curry", "qty_left": 6, "menu_item_id": "uuid-item-3" },
    { "item_name": "Chicken Biryani", "qty_left": 3, "menu_item_id": "uuid-item-1" }
  ]
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `date` | date | no | Defaults to today (IST). Cannot be a future date. |
| `items` | array | yes | Min 1 |
| `items[].item_name` | string | yes | As parsed from Sam's message |
| `items[].qty_left` | integer | yes | ≥ 0 |
| `items[].menu_item_id` | UUID | no | null if item not in menu (specials, etc.) |

**Internal Logic:**

1. Validate items array.
2. For each item, upsert into `wastage_logs` using `ON CONFLICT (menu_item_id, logged_at)` if `menu_item_id` is provided, otherwise plain insert.
3. After write completes, trigger prediction recalculation for tomorrow (calls the same logic as `POST /api/predictions/generate`).
4. Return logged items + updated predictions for tomorrow.

**Success Response (201):**

```json
{
  "success": true,
  "data": {
    "logged": [
      { "item_name": "Fish Curry", "qty_left": 6, "logged_at": "2026-06-05" }
    ],
    "updated_predictions_tomorrow": [
      { "item_name": "Fish Curry", "predicted_qty": 8 },
      { "item_name": "Chicken Biryani", "predicted_qty": 18 }
    ]
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Future date, negative qty, empty items |
| 403 | `FORBIDDEN` | Staff token |

---

### 9.2 Get Wastage Logs

```
GET /api/wastage
Auth: owner
```

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `from` | date | 7 days ago | Start date |
| `to` | date | today | End date |
| `menu_item_id` | UUID | — | Filter by item |

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "date": "2026-06-05",
        "item_name": "Fish Curry",
        "qty_left": 6,
        "estimated_waste_cost": 660.00
      }
    ]
  }
}
```

`estimated_waste_cost` = `qty_left × menu_items.price` (joined). Null if item not in menu.

---

## 10. Credit Ledger Endpoints

### 10.1 Log Credit or Payment

```
POST /api/credit
Auth: owner
```

**Purpose:** Add an entry to the vendor credit ledger — either a credit (vendor extended credit to Sam) or a payment (Sam paid the vendor).

**Request Body:**

```json
{
  "vendor_name": "Rice Vendor",
  "type": "credit",
  "amount": 4500.00,
  "item_description": "Rice 50kg",
  "reference_procurement_id": "uuid-proc-1"
}
```

| Field | Type | Required | Validation |
|---|---|---|---|
| `vendor_name` | string | yes | Non-empty |
| `type` | string | yes | `"credit"` or `"payment"` |
| `amount` | number | yes | > 0 |
| `item_description` | string | no | Free text |
| `reference_procurement_id` | UUID | no | FK to `procurement.id` |

**Internal Logic:**

1. Validate fields.
2. Insert into `vendor_credit`.
3. Compute new outstanding balance:
   ```sql
   SELECT
     COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0)
     - COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END), 0)
     AS outstanding_balance
   FROM vendor_credit
   WHERE vendor_name = $1;
   ```
4. If `outstanding_balance <= 0`: update all unsettled rows for this vendor to `settled = true`.
5. Return the new entry + outstanding balance.

**Success Response (201):**

```json
{
  "success": true,
  "data": {
    "entry": {
      "id": "uuid-credit-1",
      "vendor_name": "Rice Vendor",
      "type": "credit",
      "amount": 4500.00,
      "item_description": "Rice 50kg",
      "settled": false,
      "timestamp": "2026-06-05T16:00:00Z"
    },
    "balance": {
      "vendor_name": "Rice Vendor",
      "outstanding": 4500.00,
      "is_settled": false
    }
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing vendor_name/type/amount, amount ≤ 0 |
| 400 | `INVALID_TYPE` | type not "credit" or "payment" |
| 403 | `FORBIDDEN` | Staff token |

---

### 10.2 Get Vendor Balance

```
GET /api/credit/balance/:vendor_name
Auth: owner
```

**Purpose:** Returns the current outstanding balance for a specific vendor.

**URL Params:**

| Param | Type | Description |
|---|---|---|
| `vendor_name` | string | URL-encoded vendor name, e.g. `Rice%20Vendor` |

**Internal Logic:**

Run the balance query from 10.1.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "vendor_name": "Rice Vendor",
    "outstanding": 2100.00,
    "is_settled": false,
    "last_transaction": "2026-06-05T16:00:00Z"
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 404 | `VENDOR_NOT_FOUND` | No credit entries for this vendor name |

---

### 10.3 Get Credit Ledger History

```
GET /api/credit
Auth: owner
```

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `vendor_name` | string | — | Filter by vendor (URL-encoded) |
| `type` | string | — | `"credit"` or `"payment"` |
| `settled` | boolean | — | Filter by settled status |
| `from` | date | 30 days ago | Start date |
| `to` | date | today | End date |
| `page` | integer | 1 | Pagination |
| `limit` | integer | 50 | Max 200 |

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "entries": [
      {
        "id": "uuid-credit-1",
        "vendor_name": "Rice Vendor",
        "type": "credit",
        "amount": 4500.00,
        "item_description": "Rice 50kg",
        "settled": false,
        "timestamp": "2026-06-05T16:00:00Z"
      }
    ],
    "pagination": { "page": 1, "limit": 50, "total": 12 }
  }
}
```

---

### 10.4 Get All Vendor Balances

```
GET /api/credit/balances
Auth: owner
```

**Purpose:** Returns outstanding balance for all vendors. Owner portal "Vendor Credit" summary screen.

**Internal Logic:**

```sql
SELECT
  vendor_name,
  COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END), 0) AS outstanding,
  MAX(timestamp) AS last_transaction,
  BOOL_AND(settled) AS is_settled
FROM vendor_credit
GROUP BY vendor_name
ORDER BY outstanding DESC;
```

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "vendors": [
      {
        "vendor_name": "Rice Vendor",
        "outstanding": 2100.00,
        "is_settled": false,
        "last_transaction": "2026-06-05T16:00:00Z"
      },
      {
        "vendor_name": "Meat Vendor",
        "outstanding": 0.00,
        "is_settled": true,
        "last_transaction": "2026-06-03T09:00:00Z"
      }
    ]
  }
}
```

---

### 10.5 Log Check-In Note

```
POST /api/checkins
Auth: owner
```

**Purpose:** Save Sam's evening voice note or text check-in after the bot parses it. Called by the bot flow handler after Claude API returns the structured signals.

**Request Body:**

```json
{
  "date": "2026-06-05",
  "raw_text": "biryani ran out at lunch, big office group came in, power cut around 6pm for 2 hours",
  "parsed_signals": {
    "stockouts": [{ "item": "biryani", "time": "12:30" }],
    "demand_spike": "large office group, possibly recurring",
    "power_disruption": { "time": "18:00", "duration_hours": 2 },
    "weather_impact": null,
    "other_notes": null
  }
}
```

| Field | Type | Required |
|---|---|---|
| `date` | date | no (defaults to today) |
| `raw_text` | string | yes |
| `parsed_signals` | object | no (null if Claude API failed) |

**Internal Logic:**

Upsert into `checkins` table (one record per date — `ON CONFLICT (date) DO UPDATE`).

**Success Response (201):**

```json
{
  "success": true,
  "data": {
    "checkin": {
      "id": "uuid-checkin-1",
      "date": "2026-06-05",
      "raw_text": "...",
      "parsed_signals": { ... }
    }
  }
}
```

---

## 11. WhatsApp Webhook Endpoint

### 11.1 Twilio Webhook Receiver

```
POST /webhook/whatsapp
Auth: Twilio HMAC-SHA1 signature validation (not JWT)
```

**Purpose:** The only entry point Twilio calls when Sam sends any message (text or voice note) to the bot number. All bot logic flows through this one endpoint.

---

#### What Twilio POSTs (Request Body)

Twilio sends `application/x-www-form-urlencoded`, not JSON. Express must parse it with `express.urlencoded({ extended: false })`.

| Field | Type | Always Present | Description |
|---|---|---|---|
| `MessageSid` | string | yes | Unique Twilio message ID, e.g. `SMxxx`. Use for deduplication. |
| `Body` | string | yes | Text content of Sam's message. Empty string if voice note only. |
| `From` | string | yes | Sam's WhatsApp number in E.164 format: `whatsapp:+91XXXXXXXXXX` |
| `To` | string | yes | Bot's Twilio number: `whatsapp:+14155238886` |
| `NumMedia` | string | yes | `"0"` for text, `"1"` for voice note |
| `MediaUrl0` | string | only if NumMedia="1" | Public URL to the `.ogg` voice note file |
| `MediaContentType0` | string | only if NumMedia="1" | Always `audio/ogg` for WhatsApp voice notes |
| `ProfileName` | string | yes | WhatsApp display name — not reliable, don't use for auth |
| `AccountSid` | string | yes | Your Twilio account SID — verify matches env var |
| `WaId` | string | yes | Sam's phone number without country code formatting |

---

#### Webhook Middleware (runs before router)

```javascript
// Step 1: Validate Twilio signature
function validateTwilioSignature(req, res, next) {
  const signature = req.headers['x-twilio-signature']
  const url = `https://cafeos-backend.onrender.com/webhook/whatsapp`

  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    req.body  // must be the raw urlencoded params object, not parsed JSON
  )

  if (!isValid) {
    console.warn('Invalid Twilio signature — possible spoofed request')
    return res.status(403).send('Forbidden')
  }
  next()
}

// Step 2: Deduplication
async function deduplicateWebhook(req, res, next) {
  const { MessageSid } = req.body

  const { data: existing } = await supabase
    .from('processed_webhooks')
    .select('id')
    .eq('message_sid', MessageSid)
    .maybeSingle()

  if (existing) {
    // Already processed — Twilio is re-delivering. Acknowledge and stop.
    return res.status(200).send('<Response></Response>')
  }

  // Mark as processed (insert before handling — prevents race condition on slow handlers)
  await supabase.from('processed_webhooks').insert({ message_sid: MessageSid })
  next()
}
```

---

#### Bot Router Logic

```javascript
// POST /webhook/whatsapp
async function handleWhatsAppWebhook(req, res) {
  // Always respond to Twilio within 5 seconds or it retries.
  // For slow operations (Claude API calls), respond immediately and process async.
  res.status(200).send('<Response></Response>')

  const { Body, From, NumMedia, MediaUrl0 } = req.body
  const phoneNumber = From  // e.g. "whatsapp:+91XXXXXXXXXX"
  const messageText = Body.trim()

  // 1. Verify sender is Sam
  if (phoneNumber !== process.env.SAM_WHATSAPP_TO) {
    // Unknown number — ignore silently. Do not reply.
    return
  }

  // 2. Load Sam's current bot state
  const { data: botState } = await supabase
    .from('bot_state')
    .select('*')
    .eq('phone_number', phoneNumber)
    .maybeSingle()

  const currentState = botState?.current_state ?? 'idle'
  const context = botState?.context_json ?? {}

  // 3. Detect if this is a voice note
  const isVoiceNote = NumMedia === '1' && MediaUrl0

  // 4. Route based on state and content
  if (isVoiceNote && currentState === 'awaiting_checkin') {
    await handleEveningCheckinVoiceNote(phoneNumber, MediaUrl0, context)
    return
  }

  // Stateful routing — state takes priority
  if (currentState === 'awaiting_prep_confirm') {
    await handlePrepConfirmReply(phoneNumber, messageText, context)
    return
  }

  if (currentState === 'awaiting_vendor_edit') {
    await handleVendorEditReply(phoneNumber, messageText, context)
    return
  }

  if (currentState === 'awaiting_wastage') {
    await handleWastageReply(phoneNumber, messageText, context)
    return
  }

  if (currentState === 'awaiting_vendor_order_confirm') {
    await handleVendorOrderConfirmReply(phoneNumber, messageText, context)
    return
  }

  // Stateless intent routing — keyword matching
  const lowerText = messageText.toLowerCase()

  if (lowerText.startsWith('order ') && lowerText.includes('→')) {
    await handleVendorOrderCommand(phoneNumber, messageText)
    return
  }

  if (lowerText.startsWith('paid ')) {
    await handleVendorPayment(phoneNumber, messageText)
    return
  }

  if (lowerText.startsWith('credit ')) {
    await handleVendorCredit(phoneNumber, messageText)
    return
  }

  if (lowerText === 'summary' || lowerText === 'today') {
    await handleDailySummaryRequest(phoneNumber)
    return
  }

  if (lowerText === 'stock' || lowerText === 'inventory') {
    await handleStockRequest(phoneNumber)
    return
  }

  if (lowerText.startsWith('event ')) {
    await handleManualEventFlag(phoneNumber, messageText)
    return
  }

  // Evening check-in response (state-based, text)
  if (currentState === 'awaiting_checkin') {
    await handleEveningCheckinText(phoneNumber, messageText)
    return
  }

  // Fallback — unrecognised message
  await sendToSam("Sorry Sam, I didn't understand that. You can send me:\n• order [items] → [vendor]\n• paid [vendor] ₹[amount]\n• summary\n• stock")
}
```

---

#### Bot Handler Specifications

Each handler below is called from the webhook router. They are async functions in `/src/bot/handlers/`.

---

##### `handlePrepConfirmReply(phoneNumber, messageText, context)`

| Sam replies | Action |
|---|---|
| `"1"` | Call `POST /api/predictions/confirm` for today's date. Update `bot_state → idle`. Reply: `"Got it! Today's prep locked in ✓"` |
| `"2"` | Update `bot_state → awaiting_prep_edit`. Reply: `"What would you like to change? (e.g. biryani 25, skip fish curry)"` |
| Any other text | Treat as free-form edit. Call Claude API to parse → call `PATCH /api/predictions/override`. Update `bot_state → idle`. Reply with confirmation of changes made. |

---

##### `handleVendorOrderCommand(phoneNumber, messageText)`

1. Call Claude API to parse `"order rice 5kg, dal 3kg, oil 2kg → Rice Vendor"` into structured JSON.
2. Call `POST /api/vendor/orders` with parsed data.
3. Store procurement ID in `bot_state.context_json`.
4. Update `bot_state → awaiting_vendor_order_confirm`.
5. Reply with forward-ready message.

---

##### `handleVendorOrderConfirmReply(phoneNumber, messageText, context)`

| Sam replies | Action |
|---|---|
| `"1"` | Confirm order logged. Update `bot_state → idle`. Reply: `"Order confirmed ✓ Forward the message above to [vendor]."` |
| `"2"` | Update `bot_state → awaiting_vendor_edit`. Reply: `"What changes? (e.g. rice 6kg, skip oil)"` |

---

##### `handleWastageReply(phoneNumber, messageText, context)`

1. Call Claude API to parse wastage text into `[{item, qty_left}]`.
2. Call `POST /api/wastage` with parsed data.
3. Receive updated tomorrow predictions from response.
4. Format tomorrow's predicted vendor order grouped by vendor.
5. Update `bot_state → awaiting_vendor_order_confirm`.
6. Reply with wastage confirmation + updated predictions + vendor order preview.

---

##### `handleEveningCheckinVoiceNote(phoneNumber, mediaUrl, context)`

1. Download voice note from Twilio `MediaUrl0` using authenticated HTTP request (Twilio requires Basic Auth: `TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN`).
2. If file is `.ogg` and Claude API accepts audio directly: send base64 to Claude. Otherwise transcode to `.mp3` using `fluent-ffmpeg` first.
3. Call Claude API with system prompt: `"Transcribe this voice note and extract structured signals. Return JSON only: { stockouts, demand_spike, power_disruption, weather_impact, other_notes }"`.
4. Call `POST /api/checkins` with raw transcription + parsed signals.
5. Format and send reply listing what was understood.

> **Claude API audio input:** Check Anthropic docs for accepted audio MIME types. As of June 2026, Claude Sonnet 4 accepts audio files. If format issues arise, transcode to `audio/mp3` with `ffmpeg-static`.

---

##### `handleVendorPayment(phoneNumber, messageText)`

Parses `"paid Rice Vendor ₹2400"` via Claude API or regex:

```javascript
// Regex fallback (more reliable than LLM for this fixed pattern)
const match = messageText.match(/paid (.+?) ₹(\d+(?:\.\d{1,2})?)/i)
if (match) {
  const vendor_name = match[1].trim()
  const amount = parseFloat(match[2])
  // Call POST /api/credit with type: "payment"
}
```

If regex fails, call Claude API to parse.

---

##### `handleDailySummaryRequest(phoneNumber)`

1. Call `GET /api/billing/summary?date=today`.
2. Format into WhatsApp message:
   ```
   Today's Summary 📊
   Orders: 28
   Revenue: ₹5,240
   Cash: ₹2,800 | UPI: ₹2,190 | Pending: ₹250
   
   Top items:
   • Biryani: 34 portions (₹4,080)
   • Chai: 61 cups (₹915)
   ```
3. Send to Sam.

---

#### Twilio Reply Format

Always reply using TwiML or direct Twilio client API. For the webhook endpoint, the response `<Response></Response>` (empty TwiML) is the immediate acknowledgement to Twilio. The actual message to Sam is sent asynchronously via `client.messages.create()`. This is critical — if bot logic is slow (Claude API takes 3s), the immediate 200 response prevents Twilio from retrying.

```javascript
// Immediate ACK to Twilio (in route handler)
res.status(200).send('<Response></Response>')

// Async reply to Sam (after processing)
async function sendToSam(body) {
  return twilioClient.messages.create({
    body,
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: process.env.SAM_WHATSAPP_TO
  })
}
```

Keep replies under 1600 characters. If content is longer, split into multiple `sendToSam()` calls with a 500ms delay between them.

---

## 12. Utility Endpoints

### 12.1 Health Check

```
GET /health
Auth: none
```

**Purpose:** Used by cron-job.org to wake the Render free-tier server before scheduled jobs fire.

**Success Response (200):**

```json
{
  "status": "ok",
  "timestamp": "2026-06-05T10:30:00Z",
  "uptime_seconds": 3600
}
```

---

### 12.2 Trigger Weekly Summary (Manual)

```
POST /api/reports/weekly-summary
Auth: owner
```

**Purpose:** Manually trigger the weekly summary generation (normally runs on Sunday 9pm cron). Useful for testing or if the cron missed a week.

**Request Body:**

```json
{
  "week_start": "2026-05-27"
}
```

`week_start` must be a Tuesday (Monday is closed, so the cafe week runs Tue–Sun).

**Internal Logic:**

1. Check if at least 4 days of order data exist in the specified week. If not: return 422.
2. Compute all 5 metrics (best seller, most wastage, revenue comparison, biggest day, margin).
3. Call Claude API for the one-sentence suggestion.
4. Format the WhatsApp message.
5. Send to Sam via Twilio.
6. Return the message text.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "message_sent": true,
    "message_text": "This week at Sam's Cafe..."
  }
}
```

**Error Responses:**

| Status | Code | Condition |
|---|---|---|
| 422 | `INSUFFICIENT_DATA` | Fewer than 4 days of data in the week |
| 400 | `INVALID_WEEK_START` | Date is not a Tuesday or invalid format |

---

### 12.3 Trigger Google Sheets Sync (Manual)

```
POST /api/reports/sync-sheets
Auth: owner
```

**Purpose:** Manually trigger the nightly Google Sheets sync (normally runs at 11pm cron).

**No request body.**

**Internal Logic:**

Runs all 4 sheet sync queries (Orders, Menu Sales, Wastage, Procurement) and appends rows via Sheets API v4.

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "rows_written": {
      "orders": 28,
      "menu_sales": 12,
      "wastage": 8,
      "procurement": 3
    }
  }
}
```

---

## 13. Error Code Reference

| Code | HTTP Status | Description |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body failed validation (missing fields, wrong types, out-of-range values) |
| `INVALID_TYPE` | 400 | A field's value is not in the allowed enum |
| `UNAUTHORIZED` | 401 | No Authorization header, token missing, or JWT signature invalid |
| `INVALID_CREDENTIALS` | 401 | Supabase auth rejected email/password |
| `INVALID_PIN` | 401 | No staff member's PIN hash matches the provided PIN |
| `INVALID_REFRESH_TOKEN` | 401 | Supabase refresh token expired or invalid |
| `FORBIDDEN` | 403 | Token is valid but the role is wrong (e.g. staff on owner-only route) |
| `NOT_OWNER` | 403 | Supabase auth succeeded but email is not the owner email |
| `MENU_ITEM_NOT_FOUND` | 404 | No active menu item with the given ID |
| `ORDER_NOT_FOUND` | 404 | No order with the given ID |
| `STAFF_NOT_FOUND` | 404 | No staff member with the given ID |
| `VENDOR_NOT_FOUND` | 404 | No vendor credit entries for the given vendor name |
| `NO_PREDICTIONS_FOUND` | 404 | No prediction rows for the given date |
| `PREDICTION_NOT_FOUND` | 404 | A specific menu_item_id has no prediction row for the given date |
| `DUPLICATE_NAME` | 409 | Menu item name already exists (case-insensitive) |
| `DUPLICATE_VENDOR_NAME` | 409 | Vendor contact with same name already exists |
| `ALREADY_CHECKED_IN` | 409 | Attendance already logged for this staff + date |
| `ALREADY_CONFIRMED` | 409 | All predictions for this date are already confirmed |
| `MENU_ITEM_INACTIVE` | 422 | One or more ordered items are inactive or not found |
| `INSUFFICIENT_DATA` | 422 | Not enough data to perform the requested computation |
| `INVALID_WEEK_START` | 400 | Week start date is not a valid Tuesday |
| `RATE_LIMITED` | 429 | Too many failed PIN attempts |
| `INTERNAL_ERROR` | 500 | Unhandled exception — check server logs |

---

## 14. Auth Middleware Implementation Notes

### File: `/src/middleware/auth.js`

```javascript
const jwt = require('jsonwebtoken')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // bypasses RLS — intentional
)

// Verifies a staff JWT signed by this backend
function staffAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } })
  }

  let payload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET)
  } catch (err) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } })
  }

  if (payload.role !== 'staff') {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Staff token required' } })
  }

  req.staffId = payload.staff_id
  req.staffName = payload.name
  next()
}

// Verifies a Supabase JWT from the owner
async function ownerAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } })
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid Supabase token' } })
  }

  if (data.user.email !== process.env.OWNER_EMAIL) {
    return res.status(403).json({ success: false, error: { code: 'NOT_OWNER', message: 'Owner access required' } })
  }

  req.owner = data.user
  next()
}

// Either staff or owner — used for read-only routes
function anyAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } })
  }

  // Try staff JWT first (synchronous, cheaper)
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    if (payload.role === 'staff') {
      req.staffId = payload.staff_id
      req.role = 'staff'
      return next()
    }
  } catch {}

  // Try Supabase owner JWT
  supabase.auth.getUser(token).then(({ data, error }) => {
    if (error || !data?.user) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } })
    }
    req.owner = data.user
    req.role = 'owner'
    next()
  })
}

module.exports = { staffAuth, ownerAuth, anyAuth }
```

### Route Registration Pattern

```javascript
const { staffAuth, ownerAuth, anyAuth } = require('./middleware/auth')

// Staff only
router.post('/api/orders', staffAuth, createOrder)
router.post('/api/attendance/checkin', staffAuth, checkIn)

// Owner only
router.post('/api/menu', ownerAuth, createMenuItem)
router.put('/api/menu/:id', ownerAuth, updateMenuItem)
router.get('/api/orders', ownerAuth, getOrders)
router.post('/api/vendor/orders', ownerAuth, createVendorOrder)
router.post('/api/wastage', ownerAuth, logWastage)
router.get('/api/staff', ownerAuth, getStaff)
router.post('/api/staff', ownerAuth, createStaff)
router.post('/api/credit', ownerAuth, logCredit)

// Either role
router.get('/api/menu', anyAuth, getMenu)
router.get('/api/orders/:id', anyAuth, getOrderById)
router.get('/api/orders/:id/bill', anyAuth, generateBill)

// No auth
router.post('/webhook/whatsapp', validateTwilioSignature, deduplicateWebhook, handleWebhook)
router.get('/health', healthCheck)
```

---

*End of CafeOS API Specification v1.0*  
*Next document to generate: Bot State Machine flowchart + Scheduled Job specifications*
