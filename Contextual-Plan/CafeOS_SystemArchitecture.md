# CafeOS — System Architecture Document

**Version:** 1.0  
**Date:** June 2026  
**Authors:** Yashita Loya + Co-developer  
**Status:** Authoritative reference for development

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [How the Bot and Web App Share One Backend](#2-how-the-bot-and-web-app-share-one-backend)
3. [Data Flows — Major User Actions](#3-data-flows--major-user-actions)
   - 3A. Staff logs a customer order
   - 3B. Owner receives and approves morning prep sheet
   - 3C. Owner sends evening voice note check-in
   - 3D. Offline order syncs when connection returns
   - 3E. Bot generates and sends vendor order message
4. [Offline Queue Architecture](#4-offline-queue-architecture)
5. [Claude API — When, What, Why](#5-claude-api--when-what-why)
6. [Open-Meteo — When and How](#6-open-meteo--when-and-how)
7. [Security — Owner vs Staff Role Enforcement](#7-security--owner-vs-staff-role-enforcement)
8. [Failure Modes — What Happens When Each Service Goes Down](#8-failure-modes--what-happens-when-each-service-goes-down)

---

## 1. High-Level Architecture

### Layer Map

```
╔══════════════════════════════════════════════════════════════════════╗
║  CLIENT LAYER                                                        ║
║                                                                      ║
║  ┌──────────────────────────┐    ┌───────────────────────────────┐   ║
║  │  WhatsApp (Sam's phone)  │    │  React PWA (Browser)          │   ║
║  │  Android — no install    │    │  Deployed on Vercel           │   ║
║  │                          │    │  ┌─────────┐  ┌────────────┐  │   ║
║  │  Sam types / speaks      │    │  │  Staff  │  │  Owner     │  │   ║
║  │  into existing app       │    │  │  Portal │  │  Portal    │  │   ║
║  └────────────┬─────────────┘    └──┴────┬────┴──┴─────┬──────┘   ║
║               │ Meta Cloud API           │ HTTPS REST   │          ║
╚═══════════════╪══════════════════════════╪══════════════╪══════════╝
                │                          │              │
╔═══════════════╪══════════════════════════╪══════════════╪══════════╗
║  BACKEND LAYER (Render — Node.js + Express)                         ║
║               │                          │              │           ║
║  ┌────────────▼──────────┐   ┌───────────▼──────────────▼───────┐  ║
║  │  Meta Cloud API       │   │  REST API                         │  ║
║  │  Webhook Handler      │   │  /orders, /menu, /staff,          │  ║
║  │  POST /webhook/       │   │  /attendance, /auth, /sync        │  ║
║  │  whatsapp             │   │  /reports, /vendor, /predictions  │  ║
║  └────────────┬──────────┘   └──────────────────┬────────────────┘  ║
║               │                                 │                   ║
║  ┌────────────▼─────────────────────────────────▼────────────────┐  ║
║  │  Shared Services                                               │  ║
║  │  ┌──────────────────┐  ┌─────────────────┐  ┌─────────────┐  │  ║
║  │  │  Bot State       │  │  Intelligence   │  │  Scheduled  │  │  ║
║  │  │  Machine         │  │  Module         │  │  Jobs       │  │  ║
║  │  │  (bot_state DB)  │  │  (predictions,  │  │  (node-cron)│  │  ║
║  │  │                  │  │   multipliers)  │  │             │  │  ║
║  │  └──────────────────┘  └─────────────────┘  └─────────────┘  │  ║
║  └────────────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════════╝
                │                    │
╔══════════════╪════════════════════╪═══════════════════════════════════╗
║  EXTERNAL SERVICES                                                    ║
║              │                    │                                   ║
║  ┌───────────▼──┐  ┌───────────┐  ┌───────────┐  ┌───────────────┐  ║
║  │  Supabase    │  │ Gemini    │  │Open-Meteo │  │ Google Sheets │  ║
║  │  PostgreSQL  │  │ API       │  │(weather)  │  │ (owner view)  │  ║
║  │  + Auth      │  │ (NLP/     │  │           │  │               │  ║
║  │  + RLS       │  │  voice)   │  │           │  │               │  ║
║  └──────────────┘  └───────────┘  └───────────┘  └───────────────┘  ║
╚═══════════════════════════════════════════════════════════════════════╝
```

### Component Responsibilities

| Component | Technology | Responsibility |
|---|---|---|
| WhatsApp Client | Sam's existing app | Input/output channel for the owner. No install required. |
| React PWA | Vite + React + TailwindCSS | Staff order-taking, owner menu management, offline queue UI. |
| Express Backend | Node.js 20 + Express 4 | All business logic, webhook handling, scheduled jobs, DB writes, external API calls. |
| Bot State Machine | `bot_state` Supabase table | Tracks which conversation step Sam is in (e.g., "awaiting_prep_confirm") across server restarts. Also detects stale states (>6 hours) and routes into a recovery flow. |
| Intelligence Module | Pure Node.js (`/src/intelligence/`) | Statistical prediction: day-of-week baseline + EWMA + contextual multipliers. No ML framework. |
| Supabase | PostgreSQL 15 + Auth + RLS | Single source of truth for all data. Auth handles both staff PIN sessions and owner JWT sessions. |
| Meta Cloud API | WhatsApp Business API (direct) | Receives Sam's messages via webhook (HMAC-SHA256 validated), sends bot replies, sends interactive button messages, delivers audio file IDs. |
| Gemini API | `gemini-2.0-flash` (`@google/genai`) | Morning prep formatting, voice note transcription + signal extraction, free-text command parsing, vendor message generation, weekly summary formatting. |
| Open-Meteo | Free REST API | Daily rainfall and temperature forecast for Vasco da Gama coordinates. |
| Google Sheets | Sheets API v4 + Service Account | Owner-readable business data view. Nightly append-only sync from Supabase. |
| Vercel | Static hosting + CDN | Hosts the React PWA. HTTPS included. Auto-deploy on push to `main`. |
| Render | Node.js web service | Hosts the Express backend. Auto-deploy on push to `main`. |
| cron-job.org | External HTTP pinger | Wakes the Render free-tier instance before each scheduled job fires. |

---

## 2. How the Bot and Web App Share One Backend

Both the WhatsApp bot and the web app are served by the **same Express server** on Render. They share:

- The same database (Supabase)
- The same business logic in `/src/controllers/`
- The same intelligence module
- The same scheduled jobs

They differ only in their **entry points**:

```
WhatsApp (Sam)  →  POST /webhook/whatsapp  →  Bot handler  ─┐
                                                              ├→  Shared controllers + DB
Staff/Owner     →  POST/GET /api/*         →  REST routes  ─┘
```

### Request routing in `server.js`

```
server.js
│
├── /webhook/whatsapp         ← Meta Cloud API posts here (HMAC-SHA256 signature validated)
│     └── bot/webhook.js      ← Deduplicates (processed_webhooks), extracts button taps,
│           │                    resolves audio media IDs, dispatches to routeMessage()
│           └── routeMessage() ← State machine router + intent detection
│                 ├── State-based handlers (read bot_state.current_state first):
│                 │     awaiting_prep_confirm      → handlePrepConfirmReply
│                 │     awaiting_prep_edit         → handlePrepEditReply
│                 │     awaiting_vendor_confirm    → handleVendorConfirmReply
│                 │     awaiting_vendor_edit       → handleVendorEditReply
│                 │     awaiting_vendor_name       → handleVendorNameReply
│                 │     awaiting_evening_checkin   → handleEveningCheckinReply
│                 │     awaiting_wastage           → handleWastageReply
│                 │     awaiting_receiving_confirm → handleReceivingConfirmReply
│                 │     awaiting_receiving_edit    → handleReceivingEditReply
│                 │     awaiting_anomaly_resolution→ handleAnomalyResolutionReply
│                 │     awaiting_stock_confirm     → handleStockConfirmReply
│                 │     awaiting_recovery          → handleRecoveryReply
│                 │
│                 └── Intent-based handlers (idle state keyword matching):
│                       "order all"/"order tomorrow" → handleBulkOrderCommand
│                       "order ..."                  → handleVendorOrderCommand
│                       "received"/"arrived"/"delivery" → handleReceivingCommand
│                       "credit"/"paid"              → handleCreditCommand
│                       "owe"/"balance"              → handleBalanceQuery
│                       "summary"/"aaj"/"today"      → handleSummaryQuery
│                       "stock"/"inventory"          → handleStockQuery
│                       "event ..."                  → handleEventFlag
│                       (anything else)              → handleFallback
│
├── /api/orders               ← Web app staff portal
├── /api/menu                 ← Web app (staff reads, owner writes)
├── /api/staff                ← Owner portal
├── /api/attendance           ← Staff check-in
├── /api/vendor               ← Owner portal
├── /api/reports              ← Owner portal
├── /api/predictions          ← Owner portal + bot
└── /health                   ← cron-job.org wake ping
```

The bot handler and the REST routes call the **same controller functions**. For example, when the bot receives a wastage log, it calls `wastageController.logWastage()` — the same function that would be called if wastage were submitted via a hypothetical web form. This ensures the intelligence module always has consistent data regardless of which interface submitted it.

### Shared state: Bot conversation tracking

The WhatsApp bot is stateful. "Reply 1 to approve" only makes sense if Sam has just been shown a prep sheet. This state lives in the `bot_state` table in Supabase (not in-memory), so it survives server restarts:

```sql
CREATE TABLE bot_state (
  phone_number   TEXT PRIMARY KEY,
  current_state  TEXT NOT NULL DEFAULT 'idle',
  context_json   JSONB,
  updated_at     TIMESTAMPTZ DEFAULT now()
);
```

The bot state machine reads and writes this table on every incoming message. `context_json` holds whatever the bot needs to remember mid-conversation (e.g., the pending vendor order waiting for approval).

---

## 3. Data Flows — Major User Actions

---

### 3A. Staff Logs a Customer Order

**Preconditions:** Staff is authenticated (valid PIN session). Menu items are loaded (from Supabase or PWA cache). Device may or may not have internet.

```
[Staff on Android Phone]
         │
         │  1. Tap "New Order" in PWA
         │
         ▼
[PWA: Item Selection Screen]
         │
         │  2. Tap menu items, adjust quantities
         │     Menu data: loaded from Supabase on app open
         │     or served from PWA service worker cache (offline)
         │
         ▼
[PWA: Review + Payment Screen]
         │
         │  3. Select: Dine In / Takeaway
         │     Select: Cash / UPI / Pending
         │     Tap "Confirm Order"
         │
         ▼
[PWA: Check connectivity]
         │
         ├── ONLINE ──────────────────────────────────────────────┐
         │                                                         │
         │  4a. POST /api/orders  (JWT from staff session)         │
         │      Body: { items[], order_type, payment_method,       │
         │              staff_id, local_uuid, timestamp }          │
         │                                                         │
         │                                          ┌──────────────▼───────────┐
         │                                          │  Express Backend          │
         │                                          │  authMiddleware validates │
         │                                          │  staff JWT               │
         │                                          │                           │
         │                                          │  ordersController         │
         │                                          │  .createOrder()           │
         │                                          │  ┌───────────────────┐   │
         │                                          │  │  Supabase          │   │
         │                                          │  │  BEGIN TRANSACTION │   │
         │                                          │  │  INSERT orders     │   │
         │                                          │  │  INSERT order_items│   │
         │                                          │  │  (for each item)   │   │
         │                                          │  │  COMMIT            │   │
         │                                          │  └───────────────────┘   │
         │                                          │                           │
         │                                          │  Returns:                 │
         │                                          │  { order_id,             │
         │                                          │    bill_number,           │
         │                                          │    timestamp }            │
         │                                          └──────────────┬───────────┘
         │                                                         │
         │  5a. Response received  ◄──────────────────────────────┘
         │
         └── OFFLINE ─────────────────────────────────────────────┐
                                                                   │
             4b. Order written to IndexedDB                        │
                 { ...orderData, synced: false, local_uuid: v4() } │
                                                                   │
             5b. Response: bill generated from local data          │
                                                                   │
             [Sync happens later — see Flow 3D]  ◄────────────────┘
         │
         ▼
[PWA: Bill Screen]
         │
         │  6. Display bill:
         │     - Sam's Cafe / Date / Bill #N
         │     - Itemised list with prices
         │     - Total / Payment method
         │
         │  7. Optional: "Share via WhatsApp"
         │     Opens: whatsapp://send?text=[bill text]
         │     (native share — no API call)
         │
         ▼
[PWA: Ready for next order]
```

**Key implementation note:** The `bill_number` is a daily sequential integer. The backend generates this on the server using `SELECT MAX(bill_number) FROM orders WHERE DATE(timestamp) = CURRENT_DATE` inside the transaction. In offline mode, the PWA displays a placeholder (`#-`) and fills in the real bill number on sync.

---

### 3B. Owner Receives and Approves Morning Prep Sheet

**Trigger:** `node-cron` fires at 08:00 AM IST, Tuesday–Sunday (uses `{ timezone: 'Asia/Kolkata' }` option — no manual UTC conversion).

```
[node-cron: 02:30 UTC, Tue–Sun]
         │
         │  1. jobs/cron.js → runMorningPrepJob() fires
         │
         ▼
[Intelligence Module: generatePredictions(date)]
         │
         │  2. For each active menu_item:
         │     a. Get day-of-week baseline from predictions table
         │     b. Apply EWMA (α=0.3) from recent actuals
         │     c. Fetch today's weather from Open-Meteo
         │        GET api.open-meteo.com/v1/forecast
         │        ?latitude=15.3961&longitude=73.8173
         │        &daily=precipitation_sum,temperature_2m_max
         │        &timezone=Asia/Kolkata&forecast_days=1
         │     d. Apply contextual multipliers:
         │        - Rain >5mm  → walkIn ×0.85, chai ×1.20
         │        - Rain >20mm → walkIn ×0.70, chai ×1.30
         │        - Festival window active → all items × festival_multiplier
         │        - Power cut risk → perishables ×0.75
         │     e. Round to nearest integer, minimum 1
         │
         ▼
[Compose prep sheet message]
         │
         │  3. Format message string
         │     Include weather line only if rainfall > 5mm or temp > 35°C
         │     Include festival line only if flag active within 5 days
         │
         ▼
[Write to Supabase: predictions table]
         │
         │  4. INSERT one row per menu_item:
         │     { date, menu_item_id, predicted_qty, confirmed: false }
         │
         ▼
[Gemini API: format prep sheet message]
         │
         │  5. callGemini(SYSTEM_PROMPT_C, predictionsContext, 600)
         │     Returns formatted WhatsApp message string
         │     Fallback: deterministic bullet list if Gemini fails
         │
         ▼
[Meta Cloud API: send interactive buttons to Sam]
         │
         │  6. POST graph.facebook.com/v17.0/{phoneNumberId}/messages
         │     type: 'interactive', buttons: ['Go with this ✅', 'Make changes ✏️']
         │     Sam sees tappable buttons, not "Reply 1/2" text
         │
         ▼
[Update bot_state]
         │
         │  7. UPDATE bot_state SET
         │       current_state = 'awaiting_prep_confirm',
         │       context_json = { date, predictions: [...] }
         │     WHERE phone_number = SAM_NUMBER
         │
         │  Now waiting for Sam's reply...
         │
╔════════╧═══════════════════════════════════════════════════════╗
║  SAM RECEIVES MESSAGE AND REPLIES (taps a button or types)     ║
╚════════╤═══════════════════════════════════════════════════════╝
         │
         ▼
[Meta webhook: POST /webhook/whatsapp]
         │
         │  8. Validate Meta HMAC-SHA256 signature
         │     Deduplicate on message_sid (processed_webhooks table)
         │     Extract button_reply.id as message body if interactive tap
         │     Read bot_state for Sam's number
         │     current_state = 'awaiting_prep_confirm'
         │
         ├── Sam taps "Go with this ✅" (button id '1') ──────────┐
         │                                                        │
         │   9a. UPDATE predictions SET confirmed = true          │
         │       for all rows with today's date                   │
         │                                                        │
         │   10a. UPDATE bot_state SET current_state = 'idle'     │
         │                                                        │
         │   11a. Meta reply: "Got it! Today's prep locked in ✓"  │
         │                                                  ◄─────┘
         │
         ├── Sam taps "Make changes ✏️" or types edits ──────────┐
         │                                                        │
         │   9b. Gemini callGeminiJSON():                         │
         │       parseText("biryani 25, skip fish curry")         │
         │       Returns: [{item: "biryani", qty: 25},            │
         │                 {item: "fish_curry", qty: 0}]          │
         │                                                        │
         │   10b. UPDATE predictions SET                          │
         │          owner_override = [parsed qty],                │
         │          confirmed = true                              │
         │        for each edited item                            │
         │                                                        │
         │   11b. Meta reply: lists updated quantities            │
         │                                                  ◄─────┘
         │
         └── No reply by 9:30 AM ──────────────────────────────┐
                                                               │
             9:15 AM follow-up job fires (node-cron)           │
             Sends buttons again: "Did you see today's prep?"  │
                                                               │
             If still no reply by 9:30 AM:                    │
             UPDATE predictions SET confirmed = true           │
             (auto-confirm all at predicted_qty)               │
             UPDATE bot_state SET current_state = 'idle'       │
                                                         ◄─────┘
```

---

### 3C. Owner Sends Evening Voice Note Check-In

**Trigger:** `node-cron` fires at 07:00 PM IST, Tuesday–Sunday.

```
[node-cron: 7:00 PM IST]
         │
         │  1. Send evening prompt via Meta Cloud API:
         │     "Hi Sam! How did today go? 🌇
         │      Anything to flag — stockouts, big groups,
         │      power cuts, or anything worth remembering?"
         │
         ▼
[Update bot_state]
         │
         │  2. current_state = 'awaiting_evening_checkin'
         │
         │  Now waiting for Sam's reply...
         │
╔════════╧═══════════════════════════════════════════════════════╗
║  SAM SENDS A VOICE NOTE (or text)                              ║
╚════════╤═══════════════════════════════════════════════════════╝
         │
         ▼
[Meta webhook: POST /webhook/whatsapp]
         │
         │  3. Incoming message:
         │     type = 'audio'
         │     audio.id = media-id   ← Meta media ID, not a URL
         │
         ▼
[Backend: resolve audio URL then download]
         │
         │  4a. GET graph.facebook.com/v17.0/{audio.id}
         │      Headers: Authorization: Bearer META_ACCESS_TOKEN
         │      Response: { url: "https://lookaside.fbsbx.com/..." }
         │
         │  4b. GET the resolved URL (also requires Bearer auth)
         │      Buffer → base64 string
         │      Content-Type → mimeType (typically audio/ogg)
         │
         ▼
[Reply immediately to Sam]
         │
         │  5. Meta API reply: "Got it, listening... 🎧"
         │     (avoids Sam thinking bot is broken during Gemini latency)
         │
         ▼
[Gemini API call — multimodal audio + text]
         │
         │  6. callGeminiJSON(SYSTEM_PROMPT_B, [text_part, audio_part], 800, signalSchema)
         │     audio_part: { inlineData: { mimeType: 'audio/ogg', data: base64 } }
         │     Schema enforces: transcription + stockouts + demand_spike +
         │                      power_disruption + weather_impact + other_notes
         │     No separate transcription step — Gemini handles both in one call
         │
         ▼
[Gemini returns JSON]
         │
         │  7. Response: {
         │       "transcription": "Biryani ran out around 12:30...",
         │       "stockouts": [{"item": "biryani", "time": "12:30"}],
         │       "demand_spike": "large office group, possibly recurring",
         │       "power_disruption": {"time": "18:00", "duration_hours": 2},
         │       "weather_impact": null,
         │       "other_notes": null
         │     }
         │
         ▼
[Write to Supabase: checkins table]
         │
         │  8. INSERT INTO checkins:
         │     { raw_text, parsed_signals_json, date }
         │     UNIQUE constraint on date — upsert if re-submitted
         │
         ▼
[Update intelligence: next-day adjustments]
         │
         │  9. For each stockout in parsed_signals_json:
         │     Flag: item gets ×1.20 multiplier tomorrow
         │
         │  10. If power_disruption present:
         │      Flag: power_cut_risk = true for tomorrow's predictions
         │
         ▼
[Twilio: send confirmation to Sam]
         │
         │  11. Format summary from parsed signals:
         │      "Got it, noted for tomorrow ✓
         │       • Biryani ran out ~12:30 — I'll suggest more tomorrow
         │       • Power cut logged ~6pm, 2 hours
         │       • Office group noted — watching for pattern"
         │
         │  12. Send via Meta Cloud API
         │
         ▼
[Update bot_state]
         │
         │  13. current_state = 'idle'
```

**Fallback if Sam sends text (not voice note):** Skip steps 4–5 (no audio download). Go directly to Claude API text parsing with the same system prompt minus the transcription instruction.

---

### 3D. Offline Order Syncs When Connection Returns

**Precondition:** Staff took orders while device was offline. Orders are in IndexedDB with `synced: false`.

```
[PWA: device regains internet]
         │
         │  1. Browser fires: window.addEventListener('online', ...)
         │
         ▼
[PWA: verify real connectivity]
         │
         │  2. Ping GET /health on backend
         │     (navigator.onLine can lie — captive portals, etc.)
         │
         ├── /health unreachable ──────────────────────────────┐
         │                                                      │
         │   Retry with exponential backoff:                   │
         │   1s → 2s → 4s → 8s → 16s                          │
         │   (max 5 attempts, then wait for next 'online' event)│
         │                                               ◄──────┘
         │
         └── /health returns 200 ────────────────────────────┐
                                                             │
             3. Read IndexedDB 'pending_orders' store        │
                Filter: synced === false                     │
                                                             │
             4. For each pending order:                      │
                                                             │
             ┌──────────────────────────────────────────┐   │
             │  POST /api/orders/sync                    │   │
             │  Headers: Authorization: Bearer [JWT]     │   │
             │  Body: { ...fullOrderObject,              │   │
             │          local_uuid: [client-generated],  │   │
             │          timestamp: [original time] }     │   │
             └──────────────────────────────────────────┘   │
                         │                                   │
                         ▼                                   │
             ┌──────────────────────────────────────────┐   │
             │  Express Backend: /api/orders/sync        │   │
             │                                           │   │
             │  1. Validate JWT (staff session)          │   │
             │  2. Supabase upsert:                      │   │
             │     INSERT INTO orders (...)              │   │
             │     ON CONFLICT (local_uuid)              │   │
             │     DO NOTHING                            │   │
             │     ← idempotent: safe to retry           │   │
             │  3. INSERT order_items (...)              │   │
             │  4. Assign real bill_number               │   │
             │  5. Return { success: true, bill_number } │   │
             └──────────────────────────────────────────┘   │
                         │                                   │
             5. On success response:                         │
                Mark order synced: true in IndexedDB         │
                Update bill number display if user is        │
                still on bill screen                         │
                                                             │
             6. On failure (network drops mid-sync):         │
                Order stays synced: false in IndexedDB       │
                Retried on next 'online' event                │
                                                             │
             7. PWA banner: "2 orders pending sync"          │
                Banner clears when all pending = 0     ◄─────┘

[Banner clears — staff sees no sign anything was offline]
```

**Important:** Orders are sent one by one, not in a batch. This reduces the damage if the connection drops mid-sync — already-synced orders are marked safe; only remaining ones retry.

---

### 3E. Bot Generates and Sends Vendor Order Message

**Trigger:** Sam sends a message: `order rice 5kg, dal 3kg, oil 2kg → Rice Vendor`

```
[Sam's WhatsApp]
         │
         │  Message text: "order rice 5kg, dal 3kg, oil 2kg → Rice Vendor"
         │
         ▼
[Meta webhook: POST /webhook/whatsapp]
         │
         │  1. Validate Meta signature (HMAC-SHA256)
         │     Check message_id against processed_webhooks
         │     (dedup — Meta occasionally re-delivers)
         │
         ▼
[Bot router: detect intent]
         │
         │  2. Read bot_state for Sam's number
         │     current_state could be 'idle' or mid-flow
         │
         │  3. Message starts with "order" keyword
         │     → route to handleVendorOrder()
         │
         ▼
[Gemini API: parse vendor order]
         │
         │  4. callGeminiJSON(SYSTEM_PROMPT_VENDOR, message, 500, vendorSchema)
         │     Schema enforced by Gemini:
         │     { items: [{name, qty, unit, price_per_unit}], vendor_name, delivery_date }
         │
         │  Gemini returns:
         │  {
         │    "items": [
         │      {"name": "rice", "qty": 5, "unit": "kg", "price_per_unit": null},
         │      {"name": "dal", "qty": 3, "unit": "kg", "price_per_unit": null},
         │      {"name": "oil", "qty": 2, "unit": "litres", "price_per_unit": null}
         │    ],
         │    "vendor_name": "Rice Vendor",
         │    "delivery_date": null
         │  }
         │
         ▼
[Vendor name check]
         │
         │  5. Look up "Rice Vendor" in vendor_contacts table
         │     (case-insensitive match)
         │
         ├── Not found ──────────────────────────────────────┐
         │                                                    │
         │   Update bot_state:                               │
         │   current_state = 'awaiting_vendor_name'          │
         │   context_json = { items: [...] }                 │
         │                                                    │
         │   Reply: "I don't have Rice Vendor in my list.    │
         │           Is this a new vendor? Reply with their  │
         │           WhatsApp number to add them, or just    │
         │           confirm the name."                      │
         │                                             ◄──────┘
         │
         └── Found ──────────────────────────────────────────┐
                                                             │
             6. Format forward-ready message:               │
                "Rice 5kg, Dal 3kg, Oil 2kg —               │
                 please deliver tomorrow morning."           │
                                                            │
             7. Write to Supabase: procurement table        │
                { vendor_name: "Rice Vendor",               │
                  items_json: [...],                         │
                  total_cost: null,  ← no prices given      │
                  delivery_date: tomorrow,                   │
                  status: "pending_delivery" }               │
                                                            │
             8. Meta API reply to Sam:                      │
                "Logged ✓                                   │
                                                            │
                 Ready to send to Rice Vendor:              │
                                                            │
                 Rice 5kg, Dal 3kg, Oil 2kg —               │
                 please deliver tomorrow morning.           │
                                                            │
                 Forward this message to place the order."  │
                 (vendor message text generated by Gemini   │
                  to sound like Sam wrote it personally)    │
                                                            │
             9. Update bot_state: current_state = 'idle'   │
                                                      ◄─────┘

[Sam copies and forwards the vendor message to Rice Vendor in WhatsApp manually]
```

---

## 4. Offline Queue Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│  PWA (Browser)                                           │
│                                                          │
│  ┌────────────────────┐    ┌────────────────────────┐   │
│  │  React App State   │    │  IndexedDB             │   │
│  │                    │    │  (via idb library)     │   │
│  │  - connectivity    │    │                        │   │
│  │    status          │    │  pending_orders store  │   │
│  │  - pending count   │◄──►│  { local_uuid (PK),   │   │
│  │  - sync status     │    │    order data,         │   │
│  │                    │    │    synced: bool,       │   │
│  └────────────────────┘    │    timestamp }         │   │
│                             └────────────────────────┘   │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Connectivity Layer                                │  │
│  │                                                    │  │
│  │  window.addEventListener('online', onReconnect)    │  │
│  │  window.addEventListener('offline', onDisconnect)  │  │
│  │  + real /health ping to verify actual connectivity │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Sync Manager (syncPendingOrders.js)               │  │
│  │                                                    │  │
│  │  Triggered by: 'online' event                      │  │
│  │  Triggered by: app open (in case missed event)     │  │
│  │                                                    │  │
│  │  For each unsynced order:                          │  │
│  │    1. POST /api/orders/sync                        │  │
│  │    2. On 200: mark synced in IndexedDB             │  │
│  │    3. On fail: exponential backoff (max 5 retries) │  │
│  │    4. On 5 failures: leave as unsynced,            │  │
│  │       retry on next app open                       │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Local UUID — idempotency key

Every order created on the client (online or offline) gets a `local_uuid` generated with `crypto.randomUUID()` before it touches the network. This serves as the idempotency key.

On the backend, the `orders` table has:
```sql
local_uuid UUID UNIQUE
```

The sync endpoint uses upsert:
```sql
INSERT INTO orders (..., local_uuid)
VALUES (...)
ON CONFLICT (local_uuid) DO NOTHING
```

This means even if the network drops after the backend writes but before the client receives the 200 response, and the client retries, no duplicate row is created.

### What is cached by the service worker

The PWA's service worker (via `vite-plugin-pwa` + Workbox) caches:

| Cache target | Strategy | Reason |
|---|---|---|
| App JS/CSS/HTML bundles | CacheFirst | Core app must load offline |
| Menu items | NetworkFirst | Need latest prices; stale menu is acceptable fallback |
| Auth session | localStorage | Persists across offline periods |
| Supabase API calls | NetworkFirst (fallback to cache) | Order submission needs live network |

### Offline UI state

```
Normal:  [no indicator shown]

Offline: [amber banner at top of all screens]
         📶 Offline — 3 orders pending sync
         [clears when all synced]
```

---

## 5. Gemini API — When, What, Why

Gemini is called in exactly five situations. It is never called for anything that can be done with deterministic logic.

### Call 1: Morning Prep Sheet — Message Formatting

| Attribute | Value |
|---|---|
| Trigger | Morning prep job at 8:00 AM IST |
| Input | Prediction data, weather note, festival flag, day of week |
| Goal | Format predictions into a warm, natural WhatsApp message |
| Output | Plain text, under 1,000 characters |
| Max tokens | 600, temperature 0.7 |
| Fallback | Deterministic bullet list if Gemini fails — prep sheet still sends |

### Call 2: Evening Check-In — Voice Note Parsing (multimodal)

| Attribute | Value |
|---|---|
| Trigger | Sam sends a voice note to the evening check-in prompt |
| Input | base64-encoded `.ogg` audio (inlineData) + text instruction |
| Goal | Transcribe voice note + extract structured operational signals in one call |
| Output | JSON: `{ transcription, stockouts, demand_spike, power_disruption, weather_impact, other_notes }` |
| Max tokens | 800 |
| Latency tolerance | 3–5 seconds (bot replies "Got it, listening..." first) |
| Fallback | API failure → store raw mediaUrl in checkins; bot replies "Got it Sam, I saved your note ✓" |

### Call 3: Evening Check-In — Text Parsing

| Attribute | Value |
|---|---|
| Trigger | Sam sends text to the evening check-in prompt |
| Input | Raw text (English/Hindi/Konkani) |
| Goal | Extract same signals as Call 2 without transcription |
| Output | Same JSON schema minus `transcription` field |
| Max tokens | 500 |

### Call 4: Free-Text Command Parsing (vendor orders, prep edits, wastage log)

| Attribute | Value |
|---|---|
| Trigger | Vendor order message, prep sheet edit, wastage log response |
| Input | Sam's raw message text |
| Goal | Extract structured data: items + quantities + units + optional vendor/prices |
| Output | Task-specific JSON schema enforced via `responseSchema` |
| Max tokens | 500 |
| Fallback | `null` returned → bot replies "I didn't quite get that — try: order [items] → [vendor name]" |

### Call 5: Vendor Message Generation and Weekly Summary

| Attribute | Value |
|---|---|
| Trigger | Vendor order confirmed; Sunday 9 PM summary job |
| Input | Structured order/stats data |
| Goal | Generate natural-language WhatsApp message that sounds like Sam wrote it |
| Output | Plain text |
| Max tokens | 300–500, temperature 0.5–0.7 |
| Fallback | Deterministic plaintext fallback for both |

### Gemini — Implementation Pattern

```javascript
// services/geminiService.js
const { GoogleGenAI } = require('@google/genai')
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

// For JSON extraction with schema enforcement
async function callGeminiJSON(systemPrompt, userMessage, maxTokens, schema) {
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      config: { systemInstruction: systemPrompt, maxOutputTokens: maxTokens,
                responseMimeType: 'application/json', responseSchema: schema },
      contents: typeof userMessage === 'string'
        ? [{ role: 'user', parts: [{ text: userMessage }] }]
        : [{ role: 'user', parts: userMessage }]
    })
    return JSON.parse(result.text)
  } catch (err) {
    console.error('[Gemini JSON Error]', err.message)
    return null
  }
}

// For plain text generation (prep sheet, vendor messages, weekly summary)
async function callGemini(systemPrompt, userMessage, maxTokens, temperature = 0.5) {
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      config: { systemInstruction: systemPrompt, maxOutputTokens: maxTokens, temperature },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }]
    })
    return result.text?.trim() || null
  } catch (err) {
    console.error('[Gemini Error]', err.message)
    return null
  }
}
```

Every call site checks for `null` return and handles gracefully. Gemini failures must never block the bot from responding to Sam.

---

## 6. Open-Meteo — When and How

### When it's called

Open-Meteo is called **once per day**, during the morning prep sheet job (07:55 AM IST, before the prep sheet is sent at 08:00 AM).

It is NOT called on-demand or mid-day. The result is used for:
1. Deciding whether to include a weather context line in the prep sheet message
2. Applying rain/heat multipliers to item predictions

### API call

```
GET https://api.open-meteo.com/v1/forecast
    ?latitude=15.3961
    &longitude=73.8173
    &daily=precipitation_sum,temperature_2m_max,weathercode
    &timezone=Asia/Kolkata
    &forecast_days=2
```

No API key required. Response is cached in a module-level variable for the day — no repeated calls.

### How the result feeds into predictions

```javascript
// intelligence/multipliers.js

function getWeatherMultipliers(weatherData) {
  const rain = weatherData.today.rainfall_mm

  if (rain > 20) return { walkIn: 0.70, chai: 1.30, label: 'heavy rain' }
  if (rain > 5)  return { walkIn: 0.85, chai: 1.20, label: 'rain' }
  return           { walkIn: 1.00, chai: 1.00, label: null }
}

function shouldShowWeatherLine(weatherData) {
  return (
    weatherData.today.rainfall_mm > 5 ||
    weatherData.today.max_temp > 35 ||
    [95, 96, 99].includes(weatherData.today.weather_code)  // storm codes
  )
}
```

The `label` field is used in the prep sheet message: "Heavy rain expected today — chai usually spikes on rainy days."

### Failure handling

If Open-Meteo is unreachable or returns a malformed response:
- Log the error
- Set all weather multipliers to `1.0` (neutral — no adjustment)
- Omit the weather line from the prep sheet message
- The prep sheet still sends on time

---

## 7. Security — Owner vs Staff Role Enforcement

CafeOS has two user types with fundamentally different permissions. Security is enforced at three layers: the PWA, the Express backend, and Supabase RLS.

### Authentication methods

| User | Method | Token type | Expiry |
|---|---|---|---|
| Staff | 4-digit PIN → backend verifies bcrypt hash → issues JWT | Short-lived JWT (staff role claim) | Midnight daily (enforced by client) |
| Owner | Email + password via Supabase Auth | Supabase JWT (owner role claim) | 7 days |
| Bot (Sam via WhatsApp) | Meta webhook signature (HMAC-SHA256, `x-hub-signature-256`) | N/A — server-to-server | Per request |

### Layer 1: PWA routing

```
React Router
├── /staff/*    → Requires valid staff session token in localStorage
│                 Redirects to /login if absent or expired
│
├── /owner/*    → Requires valid owner session token (Supabase Auth)
│                 Redirects to /owner/login if absent
│
└── /login      → Staff PIN entry
    /owner/login → Supabase Auth email/password
```

The PWA checks session validity on every route change and on every app open. The midnight expiry for staff sessions is enforced client-side: on app load, if `loginTimestamp < today's midnight`, clear the session and redirect to login.

### Layer 2: Express middleware

```javascript
// middleware/auth.js

function staffAuthMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'No token' })

  const payload = verifyJWT(token, process.env.JWT_SECRET)
  if (!payload || payload.role !== 'staff') {
    return res.status(403).json({ error: 'Staff token required' })
  }

  req.staffId = payload.staff_id
  next()
}

function ownerAuthMiddleware(req, res, next) {
  // Uses Supabase JWT verification
  const token = req.headers.authorization?.split(' ')[1]
  const { data, error } = await supabase.auth.getUser(token)

  if (error || data.user.email !== process.env.OWNER_EMAIL) {
    return res.status(403).json({ error: 'Owner access required' })
  }

  req.owner = data.user
  next()
}
```

Route protection:

```javascript
// Staff routes
router.post('/api/orders', staffAuthMiddleware, createOrder)
router.post('/api/attendance/checkin', staffAuthMiddleware, checkIn)
router.get('/api/menu', staffAuthMiddleware, getMenu)      // read only

// Owner routes
router.post('/api/menu', ownerAuthMiddleware, createMenuItem)
router.put('/api/menu/:id', ownerAuthMiddleware, updateMenuItem)
router.get('/api/reports', ownerAuthMiddleware, getReports)
router.get('/api/staff', ownerAuthMiddleware, getStaff)
router.post('/api/staff', ownerAuthMiddleware, createStaff)
```

**Staff can never access owner routes** even with a valid staff JWT. The `ownerAuthMiddleware` checks both the Supabase session AND the email against `OWNER_EMAIL` env var.

### Layer 3: Supabase RLS (safety net)

RLS is the last line of defence if a bug in the Express layer accidentally uses the wrong credentials. The backend uses the `service_role` key (bypasses RLS) for all DB operations and enforces access in Express middleware. RLS policies protect against hypothetical direct Supabase API access with stolen tokens:

```sql
-- Staff can read menu but not write
CREATE POLICY "staff_read_menu" ON menu_items
  FOR SELECT USING (auth.role() = 'authenticated');

-- Staff cannot read other staff profiles
CREATE POLICY "staff_own_record" ON staff
  FOR SELECT USING (id = auth.uid());

-- Owner can do everything on all tables
CREATE POLICY "owner_full_access" ON orders
  FOR ALL USING (
    auth.jwt() ->> 'email' = current_setting('app.owner_email', true)
  );
```

### What staff cannot do

| Action | Enforced by |
|---|---|
| Change menu item prices | Route protected by `ownerAuthMiddleware` |
| View other staff profiles or PINs | RLS + no route exposed to staff |
| View financial reports or vendor ledger | No route exposed to staff |
| Access owner WhatsApp bot data | No route exposed; bot state only written server-side |
| Void or edit a confirmed order | No edit endpoint exists; void requires owner session |

### WhatsApp bot security

- All incoming Meta webhooks are validated with HMAC-SHA256 (`x-hub-signature-256` header) using `META_APP_SECRET` before any processing. Requires raw body preservation in Express.
- Unknown phone numbers (not `SAM_WHATSAPP_TO`) receive no response. The bot simply ignores them after deduplication.
- Message ID (`message_sid`) deduplication via `processed_webhooks` table (unique constraint) prevents replay attacks or double-processing. Uses atomic insert — a duplicate insert throws `23505`, which is the bail-out signal.

---

## 8. Failure Modes — What Happens When Each Service Goes Down

Design principle: **Sam must never see a broken experience.** Every external dependency has a defined fallback. The bot always replies; the app always loads.

### Supabase (database)

| Scenario | Impact | Fallback |
|---|---|---|
| Supabase temporarily unreachable | Orders cannot be written | PWA: order saved to IndexedDB, syncs on reconnect. Bot: error logged; Sam receives "Something went wrong, try again in a minute." |
| Supabase down during morning prep sheet | Predictions cannot be saved | Job retries once after 60s. If still failing, prep sheet is skipped for the day and error is logged to Render logs. |
| Supabase down during sync endpoint | Offline orders queue | IndexedDB order stays as `synced: false`. Retried on next app open or online event. No order is lost. |

### Meta Cloud API (WhatsApp delivery)

| Scenario | Impact | Fallback |
|---|---|---|
| Meta API down (send fails) | Sam doesn't receive the scheduled message | Error logged. No retry for scheduled messages (next day's job fires normally). For bot replies mid-conversation: error logged; bot_state remains in current state so Sam can resend and bot will pick up where it left off. |
| Meta webhook unreachable | Incoming messages from Sam are not processed | Meta retries webhook delivery. Once Render recovers, queued webhooks are delivered. |
| Access token expires | All outgoing messages fail | Error logged. Developers must refresh token in Meta Business Manager. Use a permanent System User token to avoid this. |
| Meta temporary dev token (24h expiry) | Same as above | Replace with permanent system user token before demo week. |

### Gemini API

| Scenario | Impact | Fallback |
|---|---|---|
| Voice note transcription fails | Signals not extracted | Store raw mediaUrl in `checkins.raw_text` only. Bot replies: "Got it Sam, I saved your note ✓". No signals used for that day's predictions. |
| Vendor order parsing fails | Order not logged | Bot replies: "I didn't quite get that — try: order [items] → [vendor name]". Nothing written to DB. |
| Prep sheet edit parsing fails | Sam's override not applied | Bot replies gracefully. Original predictions remain. |
| Prep sheet message formatting fails | Raw data list sent instead | Deterministic bullet-list fallback always ready. Prep sheet sends regardless. |
| Weekly summary formatting fails | Raw stats summary sent instead | Deterministic plaintext fallback. All metrics still present. |

### Open-Meteo (weather)

| Scenario | Impact | Fallback |
|---|---|---|
| API unreachable at 7:55 AM | No weather data | All weather multipliers set to 1.0 (neutral). Weather line omitted from prep sheet. Prep sheet still sends on time. |
| API returns unexpected format | Same as above | `try/catch` around the entire weather fetch. Graceful degradation to neutral multipliers. |

### Google Sheets sync

| Scenario | Impact | Fallback |
|---|---|---|
| Nightly sync fails | That day's data not in spreadsheet | Error logged to Render logs. No retry. Next night's sync continues normally (data is in Supabase; Sheets is a read-only view). No alert to Sam. |
| Service account credentials expire | All syncs fail | Error logged. Developers must regenerate credentials in GCP. Sam unaffected — all real data is in Supabase. |
| Spreadsheet deleted by Sam | Sync throws 404 | Error logged. Developers recreate and re-share the sheet. |

### Render (backend)

| Scenario | Impact | Fallback |
|---|---|---|
| Server cold-start (free tier spin-down) | Slow first response after 15 min inactivity | cron-job.org pings `/health` 5 minutes before each scheduled job to wake server. Web app requests may take 10–15s on cold start — acceptable during development. |
| Server crash mid-request | Request fails | Express error handler returns 500. PWA shows generic error. Bot state machine re-evaluates on Sam's next message. |
| Deploy causes brief downtime | Scheduled jobs may miss their window | Render deploys take ~30s. Jobs scheduled within that window are missed for the day. Acceptable for a finternship scope. |

### Goa Electricity scraper

| Scenario | Impact | Fallback |
|---|---|---|
| Government site unreachable | No power cut signal | `power_cut_risk = false` for the day. Perishable multiplier not applied. Error logged. |
| Site HTML structure changes | Scraper returns incorrect data | Scraper defaults to `false` on any parsing error. Monitored manually. |
| Site blocks scraping | Scraper returns 403/429 | Same fallback as unreachable. Feature descoped to Phase II if persistent. |

### Vercel (frontend hosting)

| Scenario | Impact | Fallback |
|---|---|---|
| Vercel down | Staff cannot load new app session | PWA service worker serves cached app bundles offline. Staff who already have the app loaded can continue taking orders (offline queue). New devices cannot load the app. |

---

## Appendix: Scheduled Jobs Summary

All jobs run inside the Render Node.js process via `node-cron`. The cron-job.org pinger wakes Render 5 minutes before each firing time.

| Job | Cron Expression (IST) | What it does |
|---|---|---|
| Morning prep sheet | `0 8 * * 2-7` | Generate predictions, call Open-Meteo, call Gemini for message, send interactive buttons to Sam via Meta |
| Prep sheet follow-up | `15 9 * * 2-7` | Resend buttons if Sam hasn't replied |
| Prep sheet auto-confirm | `30 9 * * 2-7` | Auto-confirm predictions if still no response |
| Evening check-in prompt | `0 19 * * 2-7` | Send check-in prompt to Sam |
| Nightly wastage prompt | `0 22 * * 0,2-7` | Send wastage log request (includes Sunday for Monday closure) |
| Wastage auto-proceed | `45 22 * * 0,2-7` | Proceed with post-wastage flow if Sam didn't reply by 10:45 PM |
| Google Sheets sync | `0 23 * * *` | Append day's data to 4 spreadsheet tabs |
| Weekly Sunday summary | `0 21 * * 0` | Send weekly digest with stats + prediction accuracy % |

*All expressions use `node-cron` v4 with `{ timezone: 'Asia/Kolkata' }` option — do not manually convert to UTC.*

---

*This document reflects Phase I scope only.*  
*Phase II and Phase III features (attendance log, recipe cards, Instagram signal, monsoon mode) are excluded.*  
*Update version number and date when any architectural decision changes.*
