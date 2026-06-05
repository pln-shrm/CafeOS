# CafeOS PWA — Screen Flow Document

**Version:** 1.0  
**Date:** June 2026  
**Scope:** Phase I — All screens across Staff Portal and Owner Portal  
**Status:** Reference for frontend development

---

## Table of Contents

1. [Global Rules and Conventions](#1-global-rules-and-conventions)
2. [Offline Queue UI — System-wide Behaviour](#2-offline-queue-ui--system-wide-behaviour)
3. [Screen: Login](#3-screen-login)
4. [Screen: Staff Home](#4-screen-staff-home)
5. [Screen: Order Builder](#5-screen-order-builder)
6. [Screen: Bill Preview + Payment Selection](#6-screen-bill-preview--payment-selection)
7. [Screen: E-Bill (Shareable View)](#7-screen-e-bill-shareable-view)
8. [Screen: Owner Home (Dashboard)](#8-screen-owner-home-dashboard)
9. [Screen: Menu Management](#9-screen-menu-management)
10. [Screen: Staff Profile Management](#10-screen-staff-profile-management)
11. [Screen: Inventory View](#11-screen-inventory-view)
12. [Screen: Attendance Marking](#12-screen-attendance-marking)
13. [Screen: Reports View](#13-screen-reports-view)
14. [Screen: Vendor Credit Ledger](#14-screen-vendor-credit-ledger)
15. [Navigation Architecture Summary](#15-navigation-architecture-summary)
16. [Open Decisions](#16-open-decisions)

---

## 1. Global Rules and Conventions

These apply to every screen unless explicitly overridden.

### Auth States

| State | What it means | Behaviour |
|---|---|---|
| No session | No JWT in localStorage | Redirect to `/login` |
| Staff session | Valid staff JWT, not yet expired | Access only to staff routes |
| Owner session | Valid Supabase JWT | Access to all routes |
| Staff session expired | Login timestamp in localStorage is past midnight IST | Treat as no session, redirect to `/login` |

### Route Structure

```
/login                  → Login screen
/staff/home             → Staff Home
/staff/order/new        → Order Builder
/staff/order/:id/bill   → Bill Preview + Payment Selection
/staff/order/:id/ebill  → E-Bill (shareable)
/staff/attendance       → Attendance Marking
/owner/home             → Owner Home / Dashboard
/owner/menu             → Menu Management
/owner/menu/new         → Add Menu Item
/owner/menu/:id/edit    → Edit Menu Item
/owner/staff            → Staff Profile Management
/owner/staff/new        → Add Staff Member
/owner/staff/:id/edit   → Edit Staff Member
/owner/inventory        → Inventory View
/owner/attendance       → Attendance Log (owner view)
/owner/reports          → Reports View
/owner/credit           → Vendor Credit Ledger
```

### Role-Based Access

| Route prefix | Staff session | Owner session |
|---|---|---|
| `/staff/*` | ✅ Allowed | ✅ Allowed (owner can use staff functions) |
| `/owner/*` | ❌ Redirect to `/staff/home` | ✅ Allowed |

### Global Header

Every screen after login shows a minimal top bar with:
- App name: **CafeOS**
- Current logged-in name (staff: first name only; owner: "Sam")
- Logout button (icon, top-right)
- Offline banner slot (renders above everything when offline — see Section 2)

### Session Expiry on Staff Accounts

On every app load and every route transition:
1. Read `staff_login_timestamp` from `localStorage`.
2. If current IST time is past midnight (00:00 IST), clear the JWT and `staff_login_timestamp`, redirect to `/login`.
3. Owner sessions are not midnight-expired — they use Supabase's 7-day JWT.

---

## 2. Offline Queue UI — System-wide Behaviour

This section defines the offline indicator that runs across all screens. It is not a separate route — it is a persistent component rendered at the top of the app shell.

### The Problem It Solves

Staff must know whether their completed orders have actually reached the server or are sitting in IndexedDB. Without this, they could hand a customer a bill for an order that hasn't been saved yet, and a network failure could mean lost revenue.

### Connectivity Detection

```
window.addEventListener('online', handleOnline)
window.addEventListener('offline', handleOffline)
navigator.onLine → initial state on app load
```

Both events are registered once at the app root level. State is stored in React context so all screens can read it.

### Visual States

**State 1 — Online, all orders synced (normal)**
```
[No indicator shown]
```
Nothing. Do not show a "connected" banner. It adds noise.

**State 2 — Offline (internet lost)**
```
┌─────────────────────────────────────────────────────┐
│  📶  Offline — X orders pending sync                │
└─────────────────────────────────────────────────────┘
```
- Amber/yellow background banner
- Pinned to the very top of the screen, above the app header
- `X` is a live count from IndexedDB (`synced: false` records)
- If `X = 0` (went offline before any orders were taken): shows "📶 Offline"
- The rest of the app functions normally below this banner

**State 3 — Back online, syncing**
```
┌─────────────────────────────────────────────────────┐
│  🔄  Syncing — X orders remaining...               │
└─────────────────────────────────────────────────────┘
```
- Blue background
- Count decrements as each order syncs successfully
- Staff does not need to do anything — this is automatic

**State 4 — Sync complete**
```
┌─────────────────────────────────────────────────────┐
│  ✅  All orders synced                              │
└─────────────────────────────────────────────────────┘
```
- Green background
- Auto-dismisses after 3 seconds
- Returns to State 1 (no indicator)

**State 5 — Sync failed (after 5 retries)**
```
┌─────────────────────────────────────────────────────┐
│  ⚠️  Sync failed — X orders saved on this device.  │
│      Will retry when connection improves.           │
└─────────────────────────────────────────────────────┘
```
- Red background
- Does not auto-dismiss
- Orders remain in IndexedDB and will retry on next app open

### Per-Order Sync Status (visible on Order History if built)

Each IndexedDB order record has a `synced` boolean. If an order history screen is added in future, each row shows:
- ✅ Green dot = synced to server
- 🟡 Yellow dot = pending sync
- 🔴 Red dot = sync failed (after retries)

### What Staff Need to Know

Tell staff exactly one thing: **"If the yellow bar is showing, don't close the app — it's saving your orders."** Nothing else.

---

## 3. Screen: Login

**Route:** `/login`  
**Visible to:** Anyone (pre-auth)  
**Purpose:** Entry point for both staff and owner. Two distinct login modes on one screen.

### Layout and Content

**Header area:**
- App logo / name: "CafeOS"
- Tagline: "Sam's Cafe, Vasco"

**Section A — Staff Login (default visible)**
- Label: "Staff Login"
- Input: 4-digit PIN pad (numeric keypad, large buttons — designed for one-handed use on small Android phone)
- Staff name selector: a horizontal scroll list or dropdown of active staff names fetched from the server. Staff selects their name first, then enters their PIN.
- "Login" button (disabled until name selected and 4 digits entered)
- Error state: "Wrong PIN. Try again." (inline, no page reload)

**Section B — Owner Login (collapsed by default)**
- A small text link: "Owner? Login here" — tapping expands a second login form below
- Email input
- Password input
- "Owner Login" button
- Error state: "Wrong email or password." (inline)
- Forgot password link: "Reset password" → opens Supabase's default email reset flow in a new browser tab

**No "Create Account" flow.** Owner account is provisioned at setup. Staff accounts are created by the owner in the owner portal.

### Actions and Navigation

| Action | Result |
|---|---|
| Staff selects name | Name highlighted, PIN pad activates |
| Staff enters correct PIN + taps Login | JWT stored in `localStorage` with `staff_login_timestamp`. Redirect to `/staff/home` |
| Staff enters wrong PIN | Inline error: "Wrong PIN. Try again." PIN pad clears. Name remains selected. |
| Owner enters correct email + password | Supabase JWT stored. Redirect to `/owner/home` |
| Owner enters wrong credentials | Inline error: "Wrong email or password." |
| "Reset password" tapped | Opens `https://[supabase-project].supabase.co/auth/v1/recover` in new tab |

### Data Loaded

| Data | API Endpoint | Purpose |
|---|---|---|
| Active staff names + IDs | `GET /api/staff` (public, no auth, returns only `id` and `name` for active staff) | Populate name selector |

**Note:** `GET /api/staff` for the login screen should return a minimal public payload — only `id` and `name` of active staff. No roles, no wages, no sensitive data. This is the only unauthenticated endpoint in the system.

### Offline Behaviour

- Staff name list: served from service worker cache (last known active staff list). If never loaded before, show an error: "Can't load staff list — no internet connection."
- PIN authentication: **cannot work offline** — JWT must be issued by the server. If offline, show: "No internet connection. Please connect to log in."
- Exception: if a valid session already exists in `localStorage` (not yet midnight-expired), the app skips the login screen entirely and routes to the appropriate home screen. Staff can continue working mid-shift even if connection drops.

---

## 4. Screen: Staff Home

**Route:** `/staff/home`  
**Visible to:** Staff, Owner  
**Purpose:** Central hub for staff during service. Two primary actions — check in, and take an order.

### Layout and Content

**Top section — Attendance Status**

*If not yet checked in today:*
- Prominent "Check In" button (large, full-width or near-full)
- Text: "You haven't checked in yet."

*If already checked in:*
- Text: "Checked in at [time] ✓"
- If late: "Checked in at [time] — Late ✓"
- The check-in button is gone (replaced by the confirmation text)

**Middle section — Today's Summary (read-only, lightweight)**
- Text: "Today, [Day], [Date]"
- Orders taken today by this staff member: "X orders taken by you today"
- This is a lightweight self-reference — staff does not see revenue figures

**Bottom / Primary Action**
- Large prominent button: **"New Order"** → navigates to `/staff/order/new`

**Footer nav (minimal)**
- Only two items for staff: "Home" and "My Orders" (order history for this staff member — Phase I can show a simple list of today's orders by this staff, no revenue shown)

### Actions and Navigation

| Action | Result |
|---|---|
| Tap "Check In" | `POST /api/attendance/checkin` → if after 10 AM, shows optional late-reason modal → then shows "Checked in at [time] ✓" |
| Tap "New Order" | Navigate to `/staff/order/new` |
| Tap Logout | Clear `localStorage` (JWT + timestamp) → redirect to `/login` |

**Late Reason Modal (triggered if check-in time > 10:00 AM IST):**
- Title: "You're a bit late today"
- Text input: "Note a reason? (optional)"
- Two buttons: "Skip" and "Submit"
- Both "Skip" and "Submit" complete the check-in — the note is just optional metadata
- Modal must not block or guilt-trip — the reason is for Sam's reference, not enforcement

### Data Loaded

| Data | API Endpoint | Purpose |
|---|---|---|
| Today's attendance record for this staff | `GET /api/attendance?staff_id={id}&from={today}&to={today}` | Check if already checked in |
| Today's order count for this staff | `GET /api/orders?staff_id={id}&from={today}&to={today}` | Display "X orders today" |

### Offline Behaviour

- If `localStorage` has a check-in record for today (stored after a successful check-in), show "Checked in at [time] ✓" — no need to re-fetch.
- If offline and not yet checked in: show "Check In" button but on tap show: "Can't check in right now — no internet. Your check-in will be logged when you reconnect." Do not fake the check-in; attendance must be server-confirmed.
- Order count: show last known count from cache, or "–" if no cache available.
- "New Order" button: always enabled offline. Orders queue locally.

---

## 5. Screen: Order Builder

**Route:** `/staff/order/new`  
**Visible to:** Staff, Owner  
**Purpose:** The core order-taking interface. Staff taps items to build a customer's order. Designed for speed — no typing, no search needed for a small fixed menu.

### Layout and Content

**Top bar (within this screen)**
- Back arrow → `/staff/home` (with confirmation if items are in the cart: "Discard this order?")
- Title: "New Order"
- Cart summary (top-right): item count badge + running total (e.g. "3 items · ₹285")

**Order Type Toggle (below top bar)**
- Two toggle buttons: **Dine In** | **Takeaway**
- Default: Dine In
- Selection is visually distinct (filled/active vs outline)
- This selection is required — cannot proceed without choosing one

**Menu Section**
- Menu items grouped by category (e.g. "Mains", "Drinks", "Snacks")
- Each category is a section with a label heading
- Categories scroll vertically
- Each menu item is a tappable card with:
  - Item name (large, readable)
  - Price (e.g. "₹120")
  - Quantity control: `[ − ]  [count]  [ + ]`
    - Count starts at 0
    - `+` increments count; `−` decrements (disabled at 0)
    - When count > 0, the card highlights (visually distinct from zero-quantity cards)
- Only **active** menu items are shown

**Cart Summary Panel (bottom of screen, sticky)**
- Visible only when at least one item has quantity > 0
- Shows: "X items · ₹[total]"
- "Review Bill" button (full-width, prominent)
- The panel is sticky at the bottom — it stays visible as the user scrolls the menu

### Actions and Navigation

| Action | Result |
|---|---|
| Tap `+` on a menu item | Increment quantity; update running total |
| Tap `−` on a menu item | Decrement quantity (min 0); update running total |
| Toggle "Dine In" / "Takeaway" | Updates `order_type` in local state |
| Tap back arrow with items in cart | Show confirmation modal: "Discard this order?" → "Yes, Discard" or "Keep Editing" |
| Tap back arrow with empty cart | Navigate directly to `/staff/home` |
| Tap "Review Bill" | Navigate to `/staff/order/new/bill` (bill preview, order not yet submitted) |

### Data Loaded

| Data | API Endpoint | Purpose |
|---|---|---|
| Active menu items | `GET /api/menu` (staff token — returns only active items) | Populate menu grid |

**Menu caching strategy:** The menu is fetched fresh on each visit to this screen (NetworkFirst). If offline, the service worker returns the cached version. Stale menu is acceptable for one shift — prices and items rarely change mid-day, and no mid-day price changes are allowed by staff anyway.

### Local State (not yet persisted to server)

```
currentOrder = {
  local_uuid: crypto.randomUUID(),   // generated on screen mount
  order_type: "dine_in" | "takeaway",
  items: [
    { menu_item_id, name, unit_price, quantity }
  ],
  total: 0,
  staff_id: [from JWT],
  created_at: [timestamp on screen mount]
}
```

### Offline Behaviour

- **Menu:** Served from service worker cache. If no cache, show: "Menu couldn't load. Check your connection." with a retry button.
- **Order building:** Works fully offline. All quantity taps and total calculations are local.
- **"Review Bill" tap:** Always works offline — navigates to Bill Preview which renders from local state.

---

## 6. Screen: Bill Preview + Payment Selection

**Route:** `/staff/order/new/bill`  
**Visible to:** Staff, Owner  
**Purpose:** Show the complete bill before confirming, capture payment method, then submit the order to the server.

### Layout and Content

**Header**
- Back arrow → `/staff/order/new` (returns to Order Builder with the current cart preserved)
- Title: "Bill Preview"

**Bill Content Block**
- Cafe name: "Sam's Cafe"
- Cafe address: "Vasco da Gama, Goa"
- Order type badge: "Dine In" or "Takeaway" (from previous screen)
- Date and time (current, auto)
- Itemised list:
  - Each row: Item name | Qty | Unit price | Subtotal
  - Example: `Chicken Biryani    2 × ₹120 = ₹240`
- Divider line
- **Total: ₹[amount]** (large, prominent)
- No GST/tax line (Sam's is unregistered composition scheme — no tax to show)

**Payment Method Selection**
- Label: "How is the customer paying?"
- Three buttons (mutually exclusive selection, large touch targets):
  - **Cash**
  - **UPI**
  - **Pending** (customer will pay later / credit)
- Default: none selected. "Confirm Order" button is disabled until one is selected.

**Confirm Button**
- "Confirm Order" — full-width, prominent
- Disabled until payment method selected
- Enabled state: solid, tappable

### Actions and Navigation

| Action | Result |
|---|---|
| Tap back arrow | Return to `/staff/order/new` with cart preserved |
| Select Cash / UPI / Pending | Highlights selected option; enables "Confirm Order" button |
| Tap "Confirm Order" (online) | `POST /api/orders` with full order payload → on 201 success: navigate to `/staff/order/:id/ebill` |
| Tap "Confirm Order" (offline) | Write complete order to IndexedDB with `synced: false`. Navigate to `/staff/order/local_uuid/ebill` — the E-Bill is generated from local data. Offline banner updates count. |
| Tap "Confirm Order" (online, server error) | Show inline error: "Couldn't save order — try again." Retry button. Do not clear the cart. |

### Order Submission Payload

```json
POST /api/orders
{
  "local_uuid": "uuid-generated-on-order-builder-mount",
  "order_type": "dine_in",
  "payment_method": "cash",
  "items": [
    { "menu_item_id": "uuid-item-1", "quantity": 2, "unit_price": 120.00 },
    { "menu_item_id": "uuid-item-2", "quantity": 3, "unit_price": 15.00 }
  ]
}
```

`staff_id` is extracted server-side from the JWT. `total` is computed server-side and cross-checked against client total.

### Data Loaded

No new data loaded on this screen. All data is from local state passed from Order Builder.

### Offline Behaviour

The screen renders fully from local state — no network needed to display the bill. Confirmation writes to IndexedDB with all fields intact. The E-Bill shown after confirmation is generated from local data. **The customer can always see their bill and get a copy, even offline.**

---

## 7. Screen: E-Bill (Shareable View)

**Route:** `/staff/order/:id/ebill` (online) or `/staff/order/local_uuid/ebill` (offline)  
**Visible to:** Staff, Owner  
**Purpose:** A clean, printable/shareable receipt for the customer. This is what the customer sees.

### Layout and Content

This screen is designed to look like a receipt. Clean, no navigation chrome, no app UI elements.

**Top of receipt:**
- Cafe name: **Sam's Cafe** (large)
- Address: Vasco da Gama, Goa
- Bill #: [order bill_number from server, or "–" if offline]
- Date: [DD/MM/YYYY]
- Time: [HH:MM AM/PM IST]

**Order details:**
- Order type: Dine In / Takeaway
- Payment: Cash / UPI / Pending

**Itemised table:**
```
Item               Qty    Price    Subtotal
────────────────────────────────────────────
Chicken Biryani     2    ₹120     ₹240
Masala Chai         3     ₹15      ₹45
────────────────────────────────────────────
                          TOTAL   ₹285
```

**Footer:**
- "Thank you for visiting Sam's Cafe! 🙏"

**Action buttons (below the receipt block, NOT part of the printable receipt):**
- **"Share via WhatsApp"** — uses Web Share API (`navigator.share`) with a text-formatted version of the bill. Falls back to copying to clipboard if Web Share not available.
- **"New Order"** — navigates to `/staff/order/new` (starts a fresh order)
- **"Home"** — navigates to `/staff/home`

### WhatsApp Share Format

When "Share via WhatsApp" is tapped, the text shared is:

```
Sam's Cafe, Vasco da Gama, Goa
Bill #14 | 05/06/2026 | 1:00 PM

Dine In | Cash

Chicken Biryani  x2 = ₹240
Masala Chai       x3 = ₹45
─────────────────────────────
TOTAL: ₹285

Thank you! 🙏
```

Staff opens WhatsApp, selects the customer's contact, and pastes. No automation — the share sheet opens and staff forwards manually. This is by design (simple, no API needed).

### Data Loaded

| Source | Condition | Data |
|---|---|---|
| `GET /api/orders/:id/bill` | Online, order submitted successfully | Full bill object from server |
| Local IndexedDB state | Offline or order not yet synced | Reconstruct bill from locally stored order |

For offline bills: bill_number shows as "–" (assigned by server on sync). All other fields are available locally.

### Offline Behaviour

Fully functional offline. Bill is rendered from local data. Share function uses locally constructed text. Bill number will be "–" until the order syncs and the server assigns one — this is acceptable and expected.

---

## 8. Screen: Owner Home (Dashboard)

**Route:** `/owner/home`  
**Visible to:** Owner only  
**Purpose:** At-a-glance view of today's business. Quick access to all owner functions.

### Layout and Content

**Greeting header:**
- "Good morning, Sam" / "Good afternoon, Sam" (time-contextual)
- Today's date

**Today's Summary Card (prominent, top of page)**
- Total Orders: [count]
- Total Revenue: ₹[amount]
- Cash: ₹[amount] | UPI: ₹[amount] | Pending: ₹[amount]
- A small note if pending > 0: "[X] orders pending payment"

**Quick Stats Row**
- Dine In today: [count] orders
- Takeaway today: [count] orders

**Top Items Today (mini table)**
- Up to 5 items, each row: item name | units sold
- Tapping this section navigates to `/owner/reports`

**Navigation Grid (quick access to all owner functions)**
Large tappable cards, 2×3 grid:

| Card | Icon | Route |
|---|---|---|
| Menu | 🍽️ | `/owner/menu` |
| Staff | 👤 | `/owner/staff` |
| Inventory | 📦 | `/owner/inventory` |
| Attendance | 🗓️ | `/owner/attendance` |
| Reports | 📊 | `/owner/reports` |
| Vendor Credit | 💰 | `/owner/credit` |

**Logout button** in top-right of header.

### Actions and Navigation

| Action | Result |
|---|---|
| Tap any nav card | Navigate to that section |
| Tap "Top Items" section | Navigate to `/owner/reports` |
| Tap Logout | Clear Supabase session → redirect to `/login` |

### Data Loaded

| Data | API Endpoint | Purpose |
|---|---|---|
| Today's revenue summary | `GET /api/billing/summary?date={today}` | All summary figures |

### Offline Behaviour

- If cached: show last known summary with a note: "Last synced at [time]. Connect to see latest."
- If no cache: show "–" for all figures with: "No internet — revenue figures unavailable."
- Navigation grid always available (all routes are accessible offline for cached screens).

---

## 9. Screen: Menu Management

**Route:** `/owner/menu`  
**Visible to:** Owner only  
**Purpose:** Owner adds, edits, and deactivates menu items. This is where pricing lives.

### Layout and Content

**Top bar**
- Title: "Menu"
- "Add Item" button (top-right, or full-width button at bottom)

**Filter tabs (horizontal, scrollable)**
- "All" | "Active" | "Inactive" | [per category, e.g. "Mains", "Drinks"]
- Default: "Active"

**Menu item list**
Each item row shows:
- Item name
- Category (if set)
- Price: ₹[amount]
- Status toggle: Active / Inactive (toggle switch — tapping immediately calls the API to update status)
- "Edit" button → navigates to `/owner/menu/:id/edit`

Inactive items are visually dimmed but still listed (under "All" or "Inactive" tab).

**Empty state (if no items):**
- "No menu items yet. Add your first item."

### Add Item Screen (`/owner/menu/new`)

**Form fields:**
- Item Name (text input, required, max 100 chars)
- Price in ₹ (numeric input, required, > 0)
- Category (text input, optional, e.g. "Mains", "Drinks") — free text, not a dropdown
- Prep Quantity Estimate / `seed_qty` (numeric, optional, default 10) — labelled as "How many do you usually make?" — this seeds the prediction model before real data exists
- Active (toggle, default: on)

**Buttons:**
- "Save Item" (primary)
- "Cancel" → back to `/owner/menu`

**Validation (inline, before submit):**
- Name empty → "Item name is required"
- Price invalid → "Enter a valid price"
- Duplicate name → "An item with this name already exists" (API returns 409)

### Edit Item Screen (`/owner/menu/:id/edit`)

Identical to Add Item form, pre-filled with current values.

Additional option: "Deactivate Item" button (if currently active) or "Reactivate Item" (if inactive). This is separate from the Save button — a distinct destructive/restorative action with a confirmation: "Deactivate [Item Name]? It will stop showing on the staff menu." → Confirm / Cancel.

**No delete.** Items are never deleted. Deactivate only.

### Actions and Navigation

| Action | Result |
|---|---|
| Toggle active status on list | `PATCH /api/menu/:id` with `{ active: true/false }` — immediate update |
| Tap "Edit" | Navigate to `/owner/menu/:id/edit` |
| Tap "Add Item" | Navigate to `/owner/menu/new` |
| Save new item | `POST /api/menu` → on success: navigate back to `/owner/menu` |
| Save edited item | `PUT /api/menu/:id` → on success: navigate back to `/owner/menu` |
| Deactivate item | `PATCH /api/menu/:id` with `{ active: false }` → item disappears from active list |

### Data Loaded

| Data | API Endpoint | Purpose |
|---|---|---|
| All menu items (active + inactive) | `GET /api/menu?include_inactive=true` | Populate list |

### Offline Behaviour

- Menu list: show cached version from service worker. Show banner: "Menu loaded from cache — connect to see latest changes."
- Add/Edit actions: **blocked offline.** If owner tries to save while offline, show: "Can't save changes without internet. Please connect and try again." Menu management is not queued offline — it's too risky (price changes, new items need to be live immediately).

---

## 10. Screen: Staff Profile Management

**Route:** `/owner/staff`  
**Visible to:** Owner only  
**Purpose:** Owner manages staff accounts — adds staff, sets PINs, adjusts daily wage.

### Layout and Content

**Top bar**
- Title: "Staff"
- "Add Staff" button (top-right)

**Staff list**
Each staff member row shows:
- Name
- Role (if set)
- Daily Wage: ₹[amount] (if set)
- Status badge: Active / Inactive
- "Edit" button → `/owner/staff/:id/edit`

**Empty state:**
- "No staff added yet. Add your first staff member."

### Add Staff Screen (`/owner/staff/new`)

**Form fields:**
- Name (text input, required)
- 4-digit PIN (numeric input, required) — shown as password field with a "show" toggle
- Role (text input, optional, e.g. "Counter Staff", "Kitchen")
- Daily Wage in ₹ (numeric input, optional)

**Note shown below PIN field:** "Staff will enter this PIN to log in. Make sure they know it."

**Buttons:**
- "Save Staff" (primary)
- "Cancel"

**Validation:**
- Name empty → "Name is required"
- PIN not 4 digits → "PIN must be exactly 4 digits"
- Duplicate PIN on the same staff list → "This PIN is already in use — choose a different one" (API returns 409)

### Edit Staff Screen (`/owner/staff/:id/edit`)

Same as Add Staff form, pre-filled. PIN field is empty by default — if owner leaves it empty, PIN is unchanged. If owner enters a new 4-digit PIN, it's updated.

Additional option: "Deactivate Staff" button (confirmation: "Remove [Name] from the app? They won't be able to log in.") — sets `active: false`.

**No delete.** All historical order data linked to that staff_id must remain intact.

### Actions and Navigation

| Action | Result |
|---|---|
| Tap "Add Staff" | Navigate to `/owner/staff/new` |
| Tap "Edit" on a staff member | Navigate to `/owner/staff/:id/edit` |
| Save new staff | `POST /api/staff` → on success: navigate back to `/owner/staff` |
| Save edited staff | `PUT /api/staff/:id` → on success: navigate back to `/owner/staff` |
| Deactivate staff | `PATCH /api/staff/:id` with `{ active: false }` |

### Data Loaded

| Data | API Endpoint | Purpose |
|---|---|---|
| All staff (active + inactive) | `GET /api/staff` (owner token — returns full data including wages) | Populate list |

### Offline Behaviour

- Staff list: show cached version.
- Add/Edit: **blocked offline.** Show: "Can't save without internet. Please connect." Staff management changes must go through the server (PIN changes need to be live immediately).

---

## 11. Screen: Inventory View

**Route:** `/owner/inventory`  
**Visible to:** Owner only  
**Purpose:** Shows today's prep predictions (what the system thinks Sam should make) and the last logged wastage per item. This is a read-only view — predictions are acted on through WhatsApp, not the app.

### Layout and Content

**Top bar**
- Title: "Inventory & Prep"
- Date: "For today, [date]"

**Prediction Status Banner**
- If Sam has confirmed today's prep via WhatsApp: ✅ "Today's prep confirmed"
- If not yet confirmed: 🟡 "Awaiting confirmation — check WhatsApp"
- This is informational only. Action is always on WhatsApp.

**Prep Predictions Table**
Each row:
- Item name
- Predicted qty: [number] portions
- Yesterday's wastage: [number] portions (or "–" if no wastage logged)
- Confirmed qty: [number] (what Sam approved, if she edited the prediction)

**Columns:** Item | Predicted | Yesterday's Wastage | Confirmed

**Last Wastage Log Section**
- Date of last wastage log
- List of items with qty_left values from that log
- If no wastage logged yet: "No wastage logged yet."

**Bottom note:**
"To change tomorrow's prep amounts, reply to the morning WhatsApp message."

### Data Loaded

| Data | API Endpoint | Purpose |
|---|---|---|
| Today's predictions | `GET /api/predictions/today` | Prediction table |
| Recent wastage | `GET /api/wastage?from={7_days_ago}&to={today}` | Last wastage per item |

### Offline Behaviour

- Show cached predictions and wastage from last fetch.
- Banner: "Loaded from cache — [last synced time]. Connect to see latest."
- No actions on this screen, so offline read-only is fully usable.

---

## 12. Screen: Attendance Marking

**Two views:** Staff-facing check-in (embedded in Staff Home — see Section 4) and Owner's attendance log.

### 12A. Staff Check-In (embedded in Staff Home — covered in Section 4)

Not a separate screen. The check-in CTA and confirmation state are part of `/staff/home`. Refer to Section 4.

### 12B. Owner Attendance Log

**Route:** `/owner/attendance`  
**Visible to:** Owner only  
**Purpose:** Sam reviews attendance across all staff. Monthly view by default.

### Layout and Content

**Top bar**
- Title: "Attendance"
- Month/date range picker: defaults to current calendar month. Owner can change to any range.

**Summary row (below date picker)**
- Total working days in range: [count]
- Per staff: days present / days in range (quick overview)

**Attendance Table**
- Rows: one per day in the selected range
- Columns: Date | [Staff Name 1] | [Staff Name 2] | ... (one column per active staff)
- Cell values:
  - ✅ On time (check-in ≤ 10:00 AM)
  - ⏰ Late (with check-in time shown, e.g. "Late 10:23")
  - — Absent (no record for that day)
- Table scrolls horizontally if there are many staff

**Per-Staff Summary (below table)**
Card per staff member:
- Name
- Days Present: [count]
- Days Late: [count]
- Days Absent: [count]
- Estimated Earnings: ₹[daily_wage × days_present] (labelled clearly as "Estimated")

**Note:** "Attendance is recorded from check-ins on the staff app. Absences show automatically for days with no check-in."

### Actions and Navigation

| Action | Result |
|---|---|
| Change date range | Re-fetches attendance for new range |
| Tap a "Late" cell | Shows popover/modal with: staff name, date, check-in time, late reason (if provided) |

### Data Loaded

| Data | API Endpoint | Purpose |
|---|---|---|
| Attendance records | `GET /api/attendance?from={from}&to={to}` | Full table |
| Staff list | `GET /api/staff` | Column headers |

### Offline Behaviour

- Show cached data for the currently loaded range.
- Clearly label: "Loaded from cache — connect to see latest."
- Date range changes require a network request — if offline, show: "Connect to load a different date range."

---

## 13. Screen: Reports View

**Route:** `/owner/reports`  
**Visible to:** Owner only  
**Purpose:** Owner views revenue, order counts, and item sales for any date range.

### Layout and Content

**Top bar**
- Title: "Reports"
- "Export to Sheets" button (top-right)

**Date Range Picker**
- Default: today
- Quick options: Today | Yesterday | This Week | This Month | Custom
- Custom opens a date range picker with from/to date inputs

**Summary Cards (4 cards in a 2×2 grid)**
- Total Orders: [count]
- Total Revenue: ₹[amount]
- Cash: ₹[amount]
- UPI: ₹[amount]

**Pending Payments Note** (if any pending in range):
- "₹[amount] in [X] orders marked as pending payment"

**Revenue Breakdown Table**
- Columns: Date | Orders | Revenue | Cash | UPI | Pending | Dine In | Takeaway
- One row per day in the selected range
- Sorted newest first

**Item Sales Table**
- Columns: Item Name | Category | Units Sold | Revenue
- Sorted by units sold descending
- Shows all items sold in the selected range

**Filters (below date picker)**
- Payment method: All | Cash | UPI | Pending
- Order type: All | Dine In | Takeaway
- Applying a filter refreshes both tables

### Actions and Navigation

| Action | Result |
|---|---|
| Change date range | `GET /api/orders?from={from}&to={to}` + `GET /api/billing/summary?date={date}` |
| Apply payment/order-type filter | Re-filters data in-memory (no new API call for basic filters) |
| Tap "Export to Sheets" | `POST /api/sheets/sync` → show "Exporting..." → on success: "Exported to Google Sheets ✓" → on failure: "Export failed — try again" |

### Data Loaded

| Data | API Endpoint | Purpose |
|---|---|---|
| Revenue summary | `GET /api/billing/summary?date={date}` | Summary cards |
| Order list | `GET /api/orders?from={from}&to={to}&limit=200` | Revenue breakdown table, item sales table |

**Note for devs:** For "Item Sales Table", aggregate `order_items` quantities grouped by `menu_item_id` on the frontend from the orders payload. Don't add a separate endpoint for this — the order list response includes items.

### Offline Behaviour

- Show cached data for the last-loaded range with: "Loaded from cache — [last sync time]."
- Date range change blocked offline: "Connect to load a different date range."
- Export to Sheets requires internet: "Connect to export to Google Sheets."

---

## 14. Screen: Vendor Credit Ledger

**Route:** `/owner/credit`  
**Visible to:** Owner only  
**Purpose:** Sam tracks what she owes each vendor. Primary use is reading the current balance and logging a payment when she pays a vendor.

### Layout and Content

**Top bar**
- Title: "Vendor Credit"

**Vendor Balances Summary (top section)**
Card per vendor with any outstanding balance:
- Vendor name
- Outstanding amount: ₹[amount] in red if > 0, or "Settled ✓" in green
- "Log Payment" button (inline, per vendor)

**If all vendors settled:**
- "All vendor accounts are settled ✓"

**Full Ledger Section (below summary)**
- Collapsible per vendor
- Each vendor section shows a chronological list of entries:
  - Date | Type (Credit / Payment) | Amount | Description | Status
  - Credit rows: red/negative visual
  - Payment rows: green/positive visual
- Filter: All | Unsettled only

**Note:** Credit entries are created automatically via the WhatsApp bot when Sam logs a vendor order. Payments are logged here in the app (or via the WhatsApp `paid [vendor] ₹[amount]` command).

### Add Payment Modal

Triggered by "Log Payment" button on a vendor's card.

**Fields:**
- Vendor (pre-filled from which card was tapped, but can be changed)
- Amount: ₹ (numeric input)
- Note: (optional text, e.g. "partial payment for rice")

**Buttons:**
- "Log Payment" (primary) → `POST /api/credit` with `{ type: "payment", ... }`
- "Cancel"

On success: balance updates immediately in the UI.

### Actions and Navigation

| Action | Result |
|---|---|
| Tap "Log Payment" on vendor card | Opens Add Payment modal |
| Submit payment | `POST /api/credit` → modal closes, balances refresh |
| Expand vendor section | Shows full ledger entries for that vendor |
| Filter "Unsettled only" | Hides settled entries |

### Data Loaded

| Data | API Endpoint | Purpose |
|---|---|---|
| All vendor balances | `GET /api/credit/balances` | Vendor balance cards |
| Ledger entries | `GET /api/credit?from={30_days_ago}` | Ledger table |

### Offline Behaviour

- Show cached ledger from last fetch.
- "Log Payment" blocked offline: "Connect to log a payment." Payments must be server-confirmed to update the balance correctly.

---

## 15. Navigation Architecture Summary

### Staff App — Screen Flow Diagram (text)

```
/login
  └── (staff login) → /staff/home
                          ├── (tap "New Order") → /staff/order/new
                          │                           └── (tap "Review Bill") → /staff/order/new/bill
                          │                                                          └── (confirm) → /staff/order/:id/ebill
                          │                                                                               ├── (New Order) → /staff/order/new
                          │                                                                               └── (Home) → /staff/home
                          └── (tap "Check In") → [modal] → /staff/home (updated state)
```

### Owner App — Screen Flow Diagram (text)

```
/login
  └── (owner login) → /owner/home
                          ├── Menu ──────────────────── /owner/menu
                          │                                  ├── Add Item → /owner/menu/new → (save) → /owner/menu
                          │                                  └── Edit Item → /owner/menu/:id/edit → (save) → /owner/menu
                          ├── Staff ─────────────────── /owner/staff
                          │                                  ├── Add Staff → /owner/staff/new → (save) → /owner/staff
                          │                                  └── Edit Staff → /owner/staff/:id/edit → (save) → /owner/staff
                          ├── Inventory ─────────────── /owner/inventory  (read-only)
                          ├── Attendance ────────────── /owner/attendance (read-only)
                          ├── Reports ────────────────── /owner/reports
                          └── Vendor Credit ──────────── /owner/credit
```

### Back Navigation Rules

| From | Back goes to |
|---|---|
| `/staff/order/new` (empty cart) | `/staff/home` |
| `/staff/order/new` (items in cart) | Confirm modal → `/staff/home` or stay |
| `/staff/order/new/bill` | `/staff/order/new` (cart preserved) |
| `/staff/order/:id/ebill` | No back. Only "New Order" or "Home" |
| `/owner/menu/new` | `/owner/menu` |
| `/owner/menu/:id/edit` | `/owner/menu` |
| `/owner/staff/new` | `/owner/staff` |
| `/owner/staff/:id/edit` | `/owner/staff` |
| All other owner screens | `/owner/home` |

---

## 16. Open Decisions

These are questions that arose during screen flow design that are **not yet answered** in the project documents. Flag these before starting frontend development.

| # | Decision | Impact | Who Decides |
|---|---|---|---|
| 1 | **Staff "My Orders" history screen** — Phase I includes an order count on Staff Home, but is there a full list of today's orders for that staff member? If yes, what do they see — items, total, time, payment method? | Adds one screen and one API call to scope | Team + Sam |
| 2 | **E-bill bill_number for offline orders** — When offline, bill_number shows as "–". Is this acceptable to Sam, or should the app generate a temporary local number (e.g. "L-4" for local order 4)? | UX and receipt legibility | Team |
| 3 | **"Pending" payment follow-up** — There is no screen to search for pending orders and mark them as paid later. Owner portal Reports shows pending totals. Is there a dedicated "Pending Payments" list in Phase I? | One new screen + `PATCH /api/orders/:id/payment` (endpoint exists) | Team |
| 4 | **Category management for menu** — Categories are free-text fields on menu items. Is there a separate category management screen, or does Sam type them in the item form? Risk: typos create duplicate categories ("Drinks" vs "drinks"). | Filtering UX on menu screen | Team |
| 5 | **Owner using the staff order-taking flow** — The owner has access to staff routes. If Sam wants to take an order herself (e.g. if staff is absent), can she? What `staff_id` gets assigned to orders taken on owner token? | Backend order schema assumption | Team |
| 6 | **Late arrival threshold (10 AM) configurability** — PRD says it's configurable by owner. Is there a Settings screen for this, or is 10 AM hardcoded for Phase I? | Adds a Settings screen to scope | Team |
| 7 | **Attendance screen — check-out** — Phase I only logs check-in. Should the attendance screen show an end-of-day "Check Out" button even if it's not tracked? If shown and tapped, it should either do something or not be there. | Avoids staff confusion | Team |
| 8 | **WhatsApp share on E-Bill** — "Share via WhatsApp" uses Web Share API. On desktop (owner testing on laptop), Web Share API is not available. Should there be a "Copy bill text" fallback? | Developer experience during testing | Team |

---

*End of Screen Flow Document*  
*Next document to generate: Component Specification (React component tree per screen)*
