# CafeOS — Tech Stack Document

**Version:** 1.0  
**Date:** June 2026  
**Status:** Authoritative reference for all development decisions  
**Scope:** Phase I (8-week sprint)

---

## Table of Contents

1. [Layer Map](#1-layer-map)
2. [Frontend — React PWA](#2-frontend--react-pwa)
3. [Backend — Node.js + Express](#3-backend--nodejs--express)
4. [Database — Supabase (PostgreSQL)](#4-database--supabase-postgresql)
5. [WhatsApp — Twilio API](#5-whatsapp--twilio-api)
6. [AI / NLP — Claude API](#6-ai--nlp--claude-api)
7. [Weather — Open-Meteo API](#7-weather--open-meteo-api)
8. [Owner Data View — Google Sheets](#8-owner-data-view--google-sheets)
9. [Hosting — Vercel + Render](#9-hosting--vercel--render)
10. [Power Cut Signal — Goa Electricity Scraper](#10-power-cut-signal--goa-electricity-scraper)
11. [Offline Sync — IndexedDB + idb](#11-offline-sync--indexeddb--idb)
12. [Dependency Graph and Setup Order](#12-dependency-graph-and-setup-order)
13. [Full Package List](#13-full-package-list)

---

## 1. Layer Map

```
┌──────────────────────────────────────────────────────────────────┐
│  VERCEL                                                           │
│  React PWA (Vite + React + TailwindCSS)                          │
│  Staff Portal ──── Owner Portal                                   │
│  IndexedDB (idb) for offline queue                                │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS REST
┌────────────────────────────▼─────────────────────────────────────┐
│  RENDER                                                           │
│  Node.js + Express API                                            │
│  ├── Twilio Webhook Handler (WhatsApp bot logic)                  │
│  ├── REST API (web app → DB operations)                           │
│  ├── Intelligence Module (predictions, multipliers)               │
│  ├── Scheduled Jobs (node-cron: 8am, 7pm, 10pm, 11pm, Sun 9pm)   │
│  └── Google Sheets Sync (nightly + on-demand)                     │
└────────┬──────────────┬──────────────┬──────────────┬────────────┘
         │              │              │              │
   Supabase        Twilio API    Claude API     Open-Meteo
  (PostgreSQL)    (WhatsApp)   (NLP + voice)  (Weather API)
```

---

## 2. Frontend — React PWA

### What it's used for in this project

The staff-facing order-taking interface and owner-facing management portal. Runs entirely in the browser — no app store install. Offline-capable: queues orders in IndexedDB when connection drops and syncs when it returns. Two portals at the same URL with different auth: staff login (PIN) and owner login (email/password via Supabase Auth).

### Why React over alternatives

Vite + React gives the fastest local development experience for a two-person student team; the ecosystem for PWA tooling, offline sync, and Supabase client is mature and well-documented.

### Version

```
node: 20.x LTS (use this exactly — Render and Vercel both default to 20)
react: 18.3.x
vite: 5.x
```

### Key packages

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.24.0",
    "@supabase/supabase-js": "^2.44.0",
    "idb": "^8.0.0",
    "tailwindcss": "^3.4.0",
    "vite-plugin-pwa": "^0.20.0",
    "workbox-window": "^7.1.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

### PWA configuration (vite.config.js addition)

```js
import { VitePWA } from 'vite-plugin-pwa'

VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['favicon.ico'],
  manifest: {
    name: "CafeOS",
    short_name: "CafeOS",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1a1a1a",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" }
    ]
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/.*\.supabase\.co\//,
        handler: 'NetworkFirst',
        options: { cacheName: 'supabase-cache' }
      }
    ]
  }
})
```

### Gotchas

- **PWA only installs over HTTPS.** Vercel gives you HTTPS by default — don't test PWA features on plain `http://localhost`. Use `vite --https` locally or just test on deployed preview URLs.
- **`vite-plugin-pwa` and hot reload conflict.** In development mode, service worker registration is disabled by default. Don't chase PWA bugs locally — test the built version (`vite build && vite preview`).
- **Supabase client in the browser exposes the `anon` key.** This is expected and safe ONLY if Supabase Row Level Security (RLS) is correctly set up. Do not use the `service_role` key anywhere in the frontend.
- **Session expiry.** Staff sessions expire at midnight (implemented as a manual check in app state — Supabase's own JWT expiry is longer, so you have to enforce this yourself by storing login timestamp in localStorage and comparing on app load).
- **TailwindCSS purging.** If you define class names dynamically (e.g. `className={`bg-${color}`}`), Tailwind will purge them. Use full class strings only.
- **IndexedDB on iOS Safari.** iOS Safari has a known bug where IndexedDB storage is wiped aggressively. Sam and staff are on Android — Chrome is the target. iOS is explicitly lower priority per the PRD. Don't waste time debugging Safari IndexedDB.

---

## 3. Backend — Node.js + Express

### What it's used for in this project

Single API server that handles everything: Twilio webhook callbacks (WhatsApp messages come in here), REST endpoints for the web app, scheduled jobs (morning prep sheet, evening check-in prompt, nightly wastage prompt, Google Sheets sync), and the intelligence module (prediction calculations).

### Why Express over alternatives (Fastify, Hono, etc.)

Express has the most Twilio and Supabase integration examples online; for a first-time Twilio user, following existing tutorials without translation overhead matters more than performance differences at this scale.

### Version

```
node: 20.x LTS
express: 4.19.x
```

### Key packages

```json
{
  "dependencies": {
    "express": "^4.19.0",
    "express-async-errors": "^3.1.0",
    "@supabase/supabase-js": "^2.44.0",
    "twilio": "^5.2.0",
    "node-cron": "^3.0.3",
    "axios": "^1.7.0",
    "dotenv": "^16.4.0",
    "bcrypt": "^5.1.1",
    "cors": "^2.8.5",
    "morgan": "^1.10.0",
    "googleapis": "^140.0.0",
    "cheerio": "^1.0.0",
    "xml2js": "^0.6.0"
  },
  "devDependencies": {
    "nodemon": "^3.1.0"
  }
}
```

### Folder structure

```
/backend
  /src
    /routes          # Express route files (orders, menu, staff, vendor, etc.)
    /controllers     # Business logic per route
    /middleware      # Auth checks, webhook validation, error handler
    /intelligence    # Prediction module (baseline, EWMA, multipliers)
    /jobs            # node-cron job definitions
    /services        # Twilio, Claude, Sheets, Open-Meteo wrappers
    /bot             # WhatsApp bot: message parser, state machine, reply builder
    server.js        # Entry point
  .env               # Never committed
  .env.example       # Template committed to git
```

### Scheduled jobs (node-cron)

```js
// All times IST = UTC+5:30
// 8:00 AM IST = 02:30 UTC
cron.schedule('30 2 * * 2-7', sendMorningPrepSheet)   // Tue–Sun (Mon closed)

// 9:15 AM IST follow-up = 03:45 UTC
cron.schedule('45 3 * * 2-7', sendPrepSheetReminder)

// 7:00 PM IST = 13:30 UTC
cron.schedule('30 13 * * 2-7', sendEveningCheckin)

// 10:00 PM IST = 16:30 UTC
cron.schedule('30 16 * * 0,2-7', sendWastagePollAndSundayAlert)
// Note: Sunday (0) included for Sunday wastage before Monday closure

// 11:00 PM IST = 17:30 UTC
cron.schedule('30 17 * * *', runGoogleSheetsSync)

// Sunday 9:00 PM IST = Sunday 15:30 UTC
cron.schedule('30 15 * * 0', sendWeeklySummary)
```

> **Decision required before Week 4:** Render's free tier spins down after 15 minutes of inactivity. Scheduled jobs will not fire if the server is asleep. Either: (a) upgrade to Render Starter ($7/month), or (b) use a separate free cron service (cron-job.org) that pings the server 5 minutes before each job fires to wake it up. Recommendation: option (b) to keep costs at zero during the finternship.

### Gotchas

- **`express-async-errors`** must be required at the top of `server.js` before any routes. It patches Express to catch async errors without try/catch on every route.
- **Twilio webhook signature validation.** Twilio signs every webhook. Validate with `twilio.validateRequest()` in middleware — unauthenticated bots can spam the endpoint otherwise.
- **Bot state machine.** The WhatsApp bot is stateful — "Reply 1 to approve" only makes sense after the bot sent a specific message. You need a simple state tracker per phone number. Use Supabase (a `bot_state` table with phone number + current_state + context_json + updated_at) rather than in-memory state, which resets on server restart.
- **node-cron timezone.** `node-cron` v3 does support a timezone option: `cron.schedule('30 2 * * *', fn, { timezone: 'Asia/Kolkata' })`. Use this instead of manually converting to UTC — less error-prone.
- **bcrypt is slow by design.** PIN hashing will take ~200ms per operation. Do not hash on the hot path synchronously. Always use `bcrypt.hash()` and `bcrypt.compare()` (async versions).

---

## 4. Database — Supabase (PostgreSQL)

### What it's used for in this project

Primary data store for everything: orders, menu items, staff, predictions, wastage, vendor ledger, check-ins, attendance, bot state. Also provides: Auth (owner email/password login), real-time subscriptions (not used in Phase I but available), Row Level Security (data isolation between staff and owner sessions), and storage (not used in Phase I).

### Why Supabase over plain Postgres / Firebase / PlanetScale

Supabase's free tier includes Auth, RLS, and a managed Postgres instance with zero config; the `@supabase/supabase-js` client works identically in both browser and Node, so one library serves both the web app and the backend.

### Version

```
@supabase/supabase-js: ^2.44.0  (use same version in both frontend and backend)
PostgreSQL: 15.x (managed by Supabase, you don't control this)
```

### Complete schema

```sql
-- =============================================
-- CORE OPERATIONAL TABLES
-- =============================================

-- Menu items
CREATE TABLE menu_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  price         NUMERIC(8,2) NOT NULL CHECK (price > 0),
  category      TEXT,
  active        BOOLEAN DEFAULT true,
  seed_qty      INTEGER DEFAULT 10,  -- default prediction before data exists
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Staff
CREATE TABLE staff (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  pin_hash      TEXT NOT NULL,          -- bcrypt hash, never plaintext
  role          TEXT DEFAULT 'counter', -- free text, e.g. "Counter Staff"
  daily_wage    NUMERIC(8,2),           -- optional, for salary estimate in Phase II
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Customer orders (header)
CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_uuid      UUID UNIQUE,          -- set by offline client to prevent double-write on sync
  staff_id        UUID REFERENCES staff(id),
  order_type      TEXT NOT NULL CHECK (order_type IN ('dine_in', 'takeaway')),
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('cash', 'upi', 'pending')),
  total           NUMERIC(8,2) NOT NULL,
  bill_number     INTEGER,              -- daily sequential, e.g. 1, 2, 3... resets each day
  timestamp       TIMESTAMPTZ DEFAULT now(),
  synced          BOOLEAN DEFAULT true  -- false only if inserted via offline sync endpoint
);

-- Order line items
CREATE TABLE order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id    UUID NOT NULL REFERENCES menu_items(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_price      NUMERIC(8,2) NOT NULL  -- snapshot at time of order, not FK
);

-- =============================================
-- VENDOR / PROCUREMENT
-- =============================================

-- Vendor contact list
CREATE TABLE vendor_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  whatsapp_number TEXT NOT NULL,
  notes           TEXT,
  active          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Vendor-to-ingredient mapping (Phase I: seeded manually by devs)
CREATE TABLE vendor_ingredient_map (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_name TEXT NOT NULL,        -- e.g. "rice", "chicken"
  vendor_id       UUID REFERENCES vendor_contacts(id),
  unit            TEXT NOT NULL,        -- e.g. "kg", "litre", "piece"
  min_order_unit  NUMERIC(8,3)          -- e.g. 1.0 for rice (comes in 1kg bags)
);

-- Procurement orders
CREATE TABLE procurement (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name     TEXT NOT NULL,
  items_json      JSONB NOT NULL,       -- [{"name":"rice","qty":5,"unit":"kg","price_per_unit":45}]
  total_cost      NUMERIC(8,2),         -- null if prices not provided
  delivery_date   DATE,
  status          TEXT DEFAULT 'pending_delivery', -- pending_delivery | delivered | cancelled
  timestamp       TIMESTAMPTZ DEFAULT now()
);

-- Vendor credit ledger
CREATE TABLE vendor_credit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name     TEXT NOT NULL,
  amount          NUMERIC(8,2) NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('credit', 'payment')),
  item_description TEXT,
  settled         BOOLEAN DEFAULT false,
  timestamp       TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- INTELLIGENCE / PREDICTIONS
-- =============================================

-- Daily predictions + actuals (feedback loop lives here)
CREATE TABLE predictions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date            DATE NOT NULL,
  menu_item_id    UUID NOT NULL REFERENCES menu_items(id),
  predicted_qty   INTEGER NOT NULL,
  actual_qty      INTEGER,              -- filled after day closes (from wastage + orders)
  owner_override  INTEGER,             -- if Sam replied "2" and changed a qty
  confirmed       BOOLEAN DEFAULT false, -- true when Sam replies "1" or auto-confirms
  manual_flag     TEXT,                -- e.g. "big football match" (from owner one-time event)
  UNIQUE (date, menu_item_id)
);

-- Wastage log
CREATE TABLE wastage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id    UUID REFERENCES menu_items(id),
  item_name       TEXT,                -- kept as text too, for items not in menu
  quantity_left   INTEGER NOT NULL,
  logged_at       DATE NOT NULL DEFAULT CURRENT_DATE
);

-- Owner check-in notes
CREATE TABLE checkins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text        TEXT,
  parsed_signals_json JSONB,
  -- parsed_signals shape:
  -- {
  --   "stockouts": [{"item": "biryani", "time": "12:30"}],
  --   "demand_spike": "large office group",
  --   "power_disruption": {"time": "18:00", "duration_hours": 2},
  --   "weather_impact": null,
  --   "other_notes": null
  -- }
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (date)
);

-- =============================================
-- STAFF OPS
-- =============================================

-- Staff attendance
CREATE TABLE attendance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id        UUID NOT NULL REFERENCES staff(id),
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  check_in_time   TIMESTAMPTZ NOT NULL DEFAULT now(),
  late            BOOLEAN DEFAULT false,
  note            TEXT,
  UNIQUE (staff_id, date)
);

-- =============================================
-- BOT STATE (stateful conversation tracking)
-- =============================================

CREATE TABLE bot_state (
  phone_number    TEXT PRIMARY KEY,     -- Sam's WhatsApp number (E.164 format)
  current_state   TEXT NOT NULL DEFAULT 'idle',
  -- States: idle | awaiting_prep_confirm | awaiting_vendor_edit |
  --         awaiting_vendor_name | awaiting_wastage | awaiting_order_edit
  context_json    JSONB,               -- stores pending order/prep data mid-flow
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- INDEXES (add after table creation)
-- =============================================

CREATE INDEX idx_orders_timestamp ON orders (timestamp);
CREATE INDEX idx_orders_date ON orders (DATE(timestamp));
CREATE INDEX idx_order_items_order_id ON order_items (order_id);
CREATE INDEX idx_order_items_menu_item ON order_items (menu_item_id);
CREATE INDEX idx_predictions_date ON predictions (date);
CREATE INDEX idx_wastage_logged_at ON wastage (logged_at);
CREATE INDEX idx_vendor_credit_vendor ON vendor_credit (vendor_name);
CREATE INDEX idx_checkins_date ON checkins (date);
CREATE INDEX idx_attendance_staff_date ON attendance (staff_id, date);
```

### Row Level Security (RLS) — critical setup

```sql
-- Enable RLS on all tables
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
-- (repeat for every table)

-- Staff can read menu_items (to display menu) but not write
CREATE POLICY "staff_read_menu" ON menu_items
  FOR SELECT USING (auth.role() = 'authenticated');

-- Staff can insert orders but only read their own
CREATE POLICY "staff_insert_orders" ON orders
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Owner can do everything (owner account has a specific email,
-- identified via auth.jwt() claim set in Supabase dashboard)
CREATE POLICY "owner_all" ON orders
  FOR ALL USING (auth.jwt() ->> 'email' = current_setting('app.owner_email'));
```

> **Note:** Full RLS policies need to be designed carefully when the backend's service role key bypasses RLS entirely. The backend API (Node.js) should use the service role key for all DB operations and enforce access control in Express middleware — RLS is the safety net, not the primary gate for server-side operations.

### Gotchas

- **`gen_random_uuid()` requires PostgreSQL 13+.** Supabase uses Postgres 15, so you're fine. But don't use `uuid_generate_v4()` (needs the pgcrypto extension — annoying to enable).
- **`TIMESTAMPTZ` vs `TIMESTAMP`.** Always use `TIMESTAMPTZ`. Plain `TIMESTAMP` has no timezone, which will bite you when comparing IST timestamps from the Node backend with UTC storage. Supabase stores in UTC; your app logic must consistently convert to IST when displaying to Sam.
- **Free tier row limits.** Supabase free tier: 500MB database, 50,000 rows (across all tables). At 50 orders/day × 3 line items avg = 150 order_item rows + 50 order rows/day = ~200 rows/day. Even at 8 weeks = 56 days × 200 = ~11,200 rows. Well within limits. Don't stress.
- **Supabase client in Node.js.** Import from `@supabase/supabase-js`. Use `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` in the backend (bypasses RLS — intentional). Use `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` in the frontend (subject to RLS — intentional).
- **Real-time subscriptions (not used in Phase I).** If you later add real-time (e.g. live order updates in owner portal), Supabase free tier limits this to 2 concurrent connections. Plan accordingly.
- **Offline sync deduplication.** The `local_uuid` column on `orders` is your idempotency key. On sync, do an `upsert` with `onConflict: 'local_uuid'` rather than a plain insert. This prevents duplicate rows if the client retries.

---

## 5. WhatsApp — Twilio API

### What it's used for in this project

The entire owner-facing interface. Sam sends messages to a Twilio WhatsApp number; Twilio POSTs them as webhooks to the Express backend. The backend processes the message, runs logic, and sends a reply via Twilio's API. All bot flows (morning prep, vendor orders, check-ins, wastage, weekly summary) route through this.

### Why Twilio over alternatives (Meta Cloud API, WATI, Interakt)

Twilio has the clearest documentation for first-time API users, an easy sandbox for testing without Meta business verification, and a Node.js SDK that handles signature validation out of the box.

### Version

```
twilio: ^5.2.0  (Node.js SDK)
```

### Account setup sequence (do this in Week 1)

```
1. Create Twilio account → https://console.twilio.com
2. Go to Messaging → Try it out → Send a WhatsApp message
3. Follow sandbox join flow (Sam texts "join [word]" to the sandbox number)
4. In sandbox settings, set the webhook URL:
   https://your-render-app.onrender.com/webhook/whatsapp
5. Set HTTP method: POST
6. Copy your Account SID and Auth Token to .env
```

### Environment variables needed

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886  # sandbox number (changes when you go production)
SAM_WHATSAPP_TO=whatsapp:+91XXXXXXXXXX      # Sam's number in E.164 format
```

### Sending a message (the core pattern)

```js
const twilio = require('twilio')
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

async function sendToSam(body) {
  return client.messages.create({
    body,
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: process.env.TWILIO_WHATSAPP_TO
  })
}
```

### Incoming message structure (what Twilio POSTs to your webhook)

```
Body           = text of Sam's message
From           = whatsapp:+91XXXXXXXXXX
To             = whatsapp:+14155238886
MessageSid     = SM... (unique per message — use for deduplication)
MediaUrl0      = URL to voice note file (if Sam sends audio)
MediaContentType0 = audio/ogg (WhatsApp voice notes are .ogg Opus codec)
```

### Webhook validation middleware

```js
const twilio = require('twilio')

function validateTwilioWebhook(req, res, next) {
  const twilioSignature = req.headers['x-twilio-signature']
  const url = `https://your-render-app.onrender.com${req.originalUrl}`
  const params = req.body

  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    twilioSignature,
    url,
    params
  )

  if (!isValid) return res.status(403).send('Forbidden')
  next()
}
```

### Gotchas

- **Sandbox 24-hour session window.** The Twilio sandbox requires Sam to re-send "join [word]" every 24 hours to stay connected. This is fine for development but must be replaced before demo week with a proper Twilio WhatsApp sender. Budget ~$20–30 for the approved Twilio WhatsApp number (one-time setup). Do this in Week 6–7.
- **Voice note format.** WhatsApp sends voice notes as `.ogg` files with the Opus codec. Claude's API accepts audio, but check the exact format accepted (see Section 6). You may need to transcode with `ffmpeg` if Claude requires a different format. Install `fluent-ffmpeg` and `ffmpeg-static` packages if needed.
- **Twilio free trial credit.** Twilio gives ~$15 trial credit. WhatsApp messages cost ~$0.005 each. At 20 messages/day × 56 days = ~1,120 messages = ~$5.60. You won't run out in the 8 weeks.
- **Webhook must be HTTPS.** Render gives you HTTPS automatically. Local development requires a tunnel — use `ngrok` (free tier) to expose localhost: `ngrok http 3000`. Update the Twilio webhook URL every time you restart ngrok (or pay for a fixed ngrok domain — $8/month). Alternative: use the Twilio CLI which has a built-in tunnel: `twilio phone-numbers:update ... --sms-url=...`.
- **Message idempotency.** Twilio occasionally delivers the same webhook twice. Store `MessageSid` in a `processed_webhooks` table (or a simple in-memory Set with TTL) and skip duplicates. This prevents double-logging the same order or wastage entry.
- **Reply format.** When replying to an incoming message, you do NOT need to quote the original. Just `client.messages.create({ body, from, to })`. Keep replies under 1600 characters — Twilio splits longer messages automatically, which can arrive out of order.

---

## 6. AI / NLP — Claude API

### What it's used for in this project

Three specific tasks:

1. **Voice note parsing (Evening Check-In):** Transcribes Sam's `.ogg` voice note and extracts structured signals (stockouts, demand spikes, power cuts) as JSON.
2. **Free-text command parsing:** Parses Sam's natural language vendor orders (`order rice 5kg, dal 3kg → Rice Vendor`) and prep sheet edits (`biryani 25, skip fish curry`) into structured JSON.
3. **Weekly summary suggestion (Phase III / optional Phase I):** Generates one-sentence actionable suggestion from the week's sales data.

### Why Claude over OpenAI GPT / Gemini

Claude's instruction-following on JSON-only outputs is more reliable for structured extraction tasks, and the team is building on Anthropic's platform already.

### Version

```
Model: claude-sonnet-4-20250514
SDK: Direct fetch (no official Node SDK needed — use axios or native fetch)
```

### API call pattern (vendor order parsing)

```js
const axios = require('axios')

async function parseVendorOrder(rawMessage) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: `You are a JSON extraction assistant for a cafe management system.
Extract vendor order details from Sam's WhatsApp message.
Return ONLY valid JSON, no preamble, no markdown fences.
Schema: { "items": [{"name": string, "qty": number, "unit": string, "price_per_unit": number|null}], "vendor_name": string|null, "delivery_date": string|null }
If vendor name is absent, set vendor_name to null.
If price is absent, set price_per_unit to null.`,
      messages: [{ role: 'user', content: rawMessage }]
    },
    {
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    }
  )

  const text = response.data.content[0].text
  return JSON.parse(text)
}
```

### API call pattern (voice note transcription + signal extraction)

```js
async function parseVoiceNote(audioBase64, mimeType = 'audio/ogg') {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: `You are parsing a cafe owner's end-of-day voice note.
First transcribe the audio. Then extract structured operational signals.
The owner may speak in English, Hindi, or Konkani — handle all three.
Return ONLY valid JSON, no preamble, no markdown fences.
Schema:
{
  "transcription": string,
  "stockouts": [{"item": string, "time": string|null}],
  "demand_spike": string|null,
  "power_disruption": {"time": string|null, "duration_hours": number|null}|null,
  "weather_impact": string|null,
  "other_notes": string|null
}`,
      messages: [{
        role: 'user',
        content: [{
          type: 'document',
          source: {
            type: 'base64',
            media_type: mimeType,
            data: audioBase64
          }
        }, {
          type: 'text',
          text: 'Transcribe and extract signals from this voice note.'
        }]
      }]
    },
    { headers: { 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
  )

  return JSON.parse(response.data.content[0].text)
}
```

### Environment variable

```env
CLAUDE_API_KEY=sk-ant-...
```

### Gotchas

- **JSON parsing failures.** Even with explicit instructions, Claude occasionally wraps JSON in markdown code fences (` ```json ... ``` `). Always strip these before `JSON.parse()`:
  ```js
  const clean = text.replace(/```json\n?|```/g, '').trim()
  return JSON.parse(clean)
  ```
- **Audio format support.** Check the current Claude API docs for supported audio MIME types before sending `.ogg`. If `.ogg/opus` isn't supported, transcode to `.mp3` using `fluent-ffmpeg`. The voice note URL from Twilio is publicly accessible for ~4 hours — download it immediately in the webhook handler before processing.
- **API latency.** Expect 1–3 seconds per Claude API call. This is fine for evening check-in parsing (async) but add a timeout for synchronous bot reply flows. If Claude takes >5s, reply "Got it Sam, I saved your note ✓" immediately, then process in background.
- **Rate limits.** On the free tier: 5 requests/minute. At Sam's usage level (a few requests per day), this is not a concern. But if you run load tests, throttle them.
- **Fallback for all Claude calls.** Every Claude call must have a fallback: if the API fails or JSON parsing fails, log the raw text and continue with degraded functionality. Never let a Claude failure block the bot from responding to Sam.
- **Cost.** Claude Sonnet 4 is ~$3/million input tokens. Sam's usage: maybe 10 Claude calls/day × ~500 tokens avg = 5,000 tokens/day. 56 days = 280,000 tokens ≈ $0.84 for the entire 8 weeks. Negligible.

---

## 7. Weather — Open-Meteo API

### What it's used for in this project

Daily weather forecast for Vasco da Gama (lat: 15.3961, lon: 73.8173). Used in the morning prep sheet job to: (a) determine the weather context line in the message, and (b) apply rain/heat multipliers to item predictions.

### Why Open-Meteo over alternatives (OpenWeatherMap, WeatherAPI, Tomorrow.io)

Completely free with no API key required; hyperlocal forecasts using ERA5 reanalysis data; stable REST API that rarely changes structure.

### Version

```
No SDK — direct HTTP call. API version: v1 (stable)
```

### API call

```js
async function getVascoWeather() {
  const url = 'https://api.open-meteo.com/v1/forecast'
  const params = new URLSearchParams({
    latitude: '15.3961',
    longitude: '73.8173',
    daily: 'precipitation_sum,temperature_2m_max,weathercode',
    timezone: 'Asia/Kolkata',
    forecast_days: '2'     // today + tomorrow
  })

  const { data } = await axios.get(`${url}?${params}`)

  // Returns:
  // data.daily.time[0] = today's date string
  // data.daily.precipitation_sum[0] = today's expected rainfall in mm
  // data.daily.temperature_2m_max[0] = today's max temp in °C
  // data.daily.weathercode[0] = WMO weather code (80-82 = rain showers, 95-99 = storm)
  // Index [1] = tomorrow

  return {
    today: {
      rainfall_mm: data.daily.precipitation_sum[0],
      max_temp: data.daily.temperature_2m_max[0],
      weather_code: data.daily.weathercode[0]
    },
    tomorrow: {
      rainfall_mm: data.daily.precipitation_sum[1],
      max_temp: data.daily.temperature_2m_max[1],
      weather_code: data.daily.weathercode[1]
    }
  }
}
```

### Multiplier logic based on rainfall

```js
function getRainMultiplier(rainfall_mm) {
  if (rainfall_mm > 20) return { walkIn: 0.70, chai: 1.30 }
  if (rainfall_mm > 5)  return { walkIn: 0.85, chai: 1.20 }
  return { walkIn: 1.0, chai: 1.0 }
}
```

### Gotchas

- **No API key = no auth = no reliability guarantees.** Open-Meteo is free but unguaranteed. Always wrap in try/catch. If it fails, skip the weather multiplier for that day and log the failure — the prep sheet still sends without the weather line.
- **Units.** Precipitation is in mm. Temperature is in °C. Both are returned by default — no unit conversion needed.
- **WMO weather codes.** Code 0 = clear sky. Codes 61–67 = rain. Codes 80–82 = rain showers. Codes 95–99 = thunderstorm. You only need to distinguish "raining vs not" and "heavy vs light" — `precipitation_sum` in mm is simpler and more reliable than the code for this purpose. Use the code only if you want to display a weather emoji in the prep sheet message.
- **Goa monsoon season (June–September).** During monsoon, rainfall_mm will regularly exceed 50mm/day. The heavy rain multiplier (×0.70 walk-ins) will fire almost every day. This is expected and correct. Sam should see noticeably lower biryani predictions and higher chai predictions during monsoon.

---

## 8. Owner Data View — Google Sheets

### What it's used for in this project

A nightly automated sync (11 PM IST) pushes the day's data to a pre-configured Google Spreadsheet. Sam gets a readable, familiar view of her business without needing to log into the web app. Four sheets: Daily Summary, Item Sales, Wastage, Procurement.

### Why Google Sheets over a custom dashboard

Sam already knows how to read a spreadsheet; building a custom charts dashboard takes weeks and adds no value over what a spreadsheet gives her for free.

### Version

```
googleapis: ^140.0.0  (Google's official Node.js client)
Sheets API: v4
```

### Setup (one-time, Week 3)

```
1. Go to Google Cloud Console → APIs & Services → Enable Google Sheets API
2. Create a Service Account (IAM & Admin → Service Accounts)
3. Download the JSON key file
4. Create the Google Spreadsheet manually with 4 sheets named exactly:
   "Daily Summary", "Item Sales", "Wastage", "Procurement"
5. Add headers to each sheet manually (see below)
6. Share the spreadsheet with the service account email (Editor access)
7. Copy the Spreadsheet ID from the URL and add to .env
```

### Environment variables

```env
GOOGLE_SPREADSHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
GOOGLE_SERVICE_ACCOUNT_EMAIL=cafeos@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

### Sheets structure (set headers manually before first sync)

**Sheet 1: Daily Summary**
`Date | Total Orders | Total Revenue | Total Expenses | Net Margin | Margin %`

**Sheet 2: Item Sales**
`Date | Item Name | Category | Total Qty Sold | Revenue from Item`

**Sheet 3: Wastage**
`Date | Item Name | Qty Left | Predicted Qty | Waste Rate`

**Sheet 4: Procurement**
`Date | Vendor Name | Items | Total Cost | Status`

### Sync function pattern

```js
const { google } = require('googleapis')

async function appendToSheet(sheetName, rows) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  })

  const sheets = google.sheets({ version: 'v4', auth })

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows }
  })
}
```

### Gotchas

- **Private key newlines.** When you paste a private key into `.env`, the `\n` characters in the key become literal backslash-n strings. Always do `.replace(/\\n/g, '\n')` when reading the key. This is the #1 cause of Google Auth failures.
- **`USER_ENTERED` vs `RAW`.** Use `USER_ENTERED` — it lets Sheets interpret dates and numbers correctly (date strings become actual date cells, numbers become numbers). `RAW` treats everything as text.
- **Append vs Overwrite.** Using `values.append` with `INSERT_ROWS` adds new rows below existing data — this is what you want. Using `values.update` overwrites. Never use update for the nightly sync.
- **Rate limits.** Sheets API free quota: 300 requests/minute per project. The nightly sync makes ~4 append calls. Zero concern.
- **Pre-build the sheet manually.** Do not auto-create the spreadsheet from code. Create it by hand, add the headers, share it with the service account. This takes 10 minutes and avoids a week of debugging API sheet creation.

---

## 9. Hosting — Vercel + Render

### Vercel (Frontend)

**What it hosts:** The React PWA.

**Why Vercel:** Zero-config Vite deployment; free tier includes HTTPS, CDN, preview deployments per branch; `vercel.json` can configure SPA routing with one line.

```json
// vercel.json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**Environment variables:** Set in Vercel dashboard under Project → Settings → Environment Variables. The only secret the frontend needs is `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (both are safe to expose — RLS protects the data).

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_API_BASE_URL=https://your-render-app.onrender.com
```

**Gotchas:**
- **`VITE_` prefix is required.** Vite only exposes env variables prefixed with `VITE_` to the browser bundle. Plain `SUPABASE_URL` will be `undefined` at runtime.
- **Preview deployments.** Every git push creates a preview URL. Use these for testing before merging to main.

---

### Render (Backend)

**What it hosts:** The Node.js + Express API server.

**Why Render:** Free tier supports persistent Node.js web services with HTTPS and auto-deploy from GitHub; simpler than Railway for first-time users.

**Service type:** Web Service (not Background Worker — cron jobs run inside the same process using `node-cron`).

**Build command:** `npm install`  
**Start command:** `node src/server.js`

**Environment variables:** Set in Render dashboard under Environment. Never commit `.env` to git.

```env
NODE_ENV=production
PORT=3000
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
SAM_WHATSAPP_TO=whatsapp:+91XXXXXXXXXX
CLAUDE_API_KEY=sk-ant-...
GOOGLE_SPREADSHEET_ID=xxxx
GOOGLE_SERVICE_ACCOUNT_EMAIL=cafeos@xxx.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

**Gotchas:**
- **Free tier spin-down.** Render free tier spins down after 15 minutes of no HTTP traffic. Scheduled cron jobs inside a sleeping server will not fire. Solution: use [cron-job.org](https://cron-job.org) (free) to send a GET ping to `https://your-render-app.onrender.com/health` 5 minutes before each scheduled job. Add a `/health` route that returns `200 OK`.
- **Deploy hooks.** Connect Render to your GitHub repo. Every push to `main` auto-deploys. Add a `main` branch protection rule so you don't accidentally deploy broken code.
- **Logs.** Render's log viewer is basic. For debugging cron jobs that fire at 2 AM, use Render's log streaming or export logs to a service. For the finternship scope, `console.log` to Render's native logs is sufficient.

---

## 10. Power Cut Signal — Goa Electricity Scraper

### What it's used for in this project

Checks the Goa Electricity Department website daily at 7 AM for scheduled outages in the Vasco area. If an outage is scheduled, sets `power_cut_risk = true` for that day, which reduces predictions for perishable items by ×0.75.

### Package

```
cheerio: ^1.0.0  (HTML parsing after fetching the outage page)
axios: (already in project — fetch the page)
```

### Implementation

```js
async function checkPowerCutRisk() {
  try {
    const { data: html } = await axios.get(
      'https://www.goaelectricity.gov.in/outage',
      { timeout: 8000 }
    )
    const $ = cheerio.load(html)

    // Inspect the page structure first to find the right selector
    // This is a placeholder — actual selector depends on the site's HTML
    const outageText = $('[class*="outage"], table').text().toLowerCase()

    const vascoKeywords = ['vasco', 'mormugao', 'marmagao', 'south goa']
    const hasVascoOutage = vascoKeywords.some(kw => outageText.includes(kw))

    return hasVascoOutage
  } catch (err) {
    console.error('Power cut scraper failed:', err.message)
    return false  // default to no risk if scraper fails
  }
}
```

### Gotchas

- **Site structure will change.** Government websites restructure HTML without notice. This scraper will break at some point. Write it defensively (try/catch, default to `false`). Add a weekly manual check that it's still working.
- **Decision point (OQ-07 from PRD).** Before building this in Week 4, check if `goaelectricity.gov.in` actually has a parseable outage page for Vasco. If the page doesn't exist or requires login, drop this feature from Phase I. The weather API rain multiplier is more reliably available and partially substitutes for the power cut signal (power cuts correlate with storms, which the rain data captures).
- **Robots.txt.** Check `goaelectricity.gov.in/robots.txt` before scraping. Government sites in India generally don't restrict scraping, but verify.

---

## 11. Offline Sync — IndexedDB + idb

### What it's used for in this project

When the staff app loses internet connection, completed orders are saved to the browser's IndexedDB database instead of being sent to the backend. When connectivity returns, queued orders are automatically POSTed to a sync endpoint.

### Package

```
idb: ^8.0.0  (thin Promise-based wrapper over the raw IndexedDB API)
```

### IndexedDB schema

```js
import { openDB } from 'idb'

const DB_NAME = 'cafeos-offline'
const DB_VERSION = 1

export async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Pending orders store
      const orderStore = db.createObjectStore('pending_orders', {
        keyPath: 'local_uuid'
      })
      orderStore.createIndex('synced', 'synced')

      // Pending attendance check-ins
      db.createObjectStore('pending_attendance', {
        keyPath: 'local_uuid'
      })
    }
  })
}
```

### Sync flow

```js
import { getDB } from './db'

// Called when navigator.onLine fires
export async function syncPendingOrders(apiBaseUrl) {
  const db = await getDB()
  const pending = await db.getAllFromIndex('pending_orders', 'synced', false)

  for (const order of pending) {
    let attempts = 0
    let synced = false

    while (attempts < 5 && !synced) {
      try {
        const res = await fetch(`${apiBaseUrl}/orders/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getSessionToken()}` },
          body: JSON.stringify(order)
        })

        if (res.ok) {
          await db.put('pending_orders', { ...order, synced: true })
          synced = true
        }
      } catch {
        attempts++
        await new Promise(r => setTimeout(r, 2 ** attempts * 1000)) // exponential backoff
      }
    }

    if (!synced) {
      console.error('Failed to sync order after 5 attempts:', order.local_uuid)
      // Order stays in IndexedDB with synced: false — retried next session
    }
  }
}
```

### Backend sync endpoint (deduplication)

```js
// POST /orders/sync
router.post('/sync', authMiddleware, async (req, res) => {
  const order = req.body

  const { error } = await supabase
    .from('orders')
    .upsert(order, { onConflict: 'local_uuid' })  // prevents double-write

  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})
```

### Gotchas

- **`navigator.onLine` is unreliable.** It can be `true` even when the server is unreachable (e.g. DNS failure, captive portal). Always verify connectivity by attempting an actual network request (a `/health` ping to your backend), not just checking `navigator.onLine`.
- **IndexedDB is not available in Service Workers in all browsers.** If you're doing sync from a service worker, test carefully. Easier approach: do sync from the app's main thread on the `online` event.
- **Bill numbers in offline mode.** Bill numbers are daily sequential integers. When offline, you cannot know what the last bill number was (another device may have submitted orders). Options: (a) use a local counter that may have gaps, (b) assign "pending" bill number locally and fill in the real number on sync. Simplest: generate the bill number server-side on sync and display a local placeholder (`#-` ) until synced. Confirm this UX decision with the team.

---

## 12. Dependency Graph and Setup Order

**This is the order to set things up.** Each layer depends on the ones above it.

```
Week 1, Day 1-2
└── Supabase project created
    ├── Schema applied (all tables from Section 4)
    ├── RLS enabled
    └── Anon key + Service Role key copied to .env files

Week 1, Day 3-4
└── Render web service created (connected to GitHub repo)
    ├── Backend .env set with Supabase keys
    ├── /health endpoint live
    └── Vercel project created
        └── Frontend .env set with Supabase anon key + Render URL

Week 1, Day 5-7
└── Twilio sandbox configured
    ├── Webhook URL pointed to Render backend
    └── SAM_WHATSAPP_TO set (Sam's number confirmed)

Week 2
└── React PWA skeleton deployed to Vercel
    ├── Staff PIN login working → Supabase Auth
    ├── Menu display working → reads menu_items from Supabase
    └── Order creation + bill generation working → writes to orders + order_items

Week 3
└── Owner portal live
    ├── Email/password login working → Supabase Auth
    ├── Menu management CRUD working
    └── Staff profile management working

Week 3, end
└── Google Sheets spreadsheet created manually
    ├── Service account created in GCP
    ├── Sheet shared with service account
    └── Google Sheets sync function tested

Week 4
└── Intelligence module built
    ├── Depends on: Supabase (predictions, wastage, orders tables populated)
    ├── Open-Meteo API call tested
    └── Power cut scraper tested (or descoped)

Week 5
└── WhatsApp bot flows complete
    ├── Depends on: Twilio (Week 1), Claude API key set, Intelligence module (Week 4)
    ├── Morning prep sheet → requires Intelligence module
    ├── Evening check-in → requires Claude API
    └── Wastage log → requires Intelligence module

Week 6
└── Vendor order flow complete
    ├── Depends on: Twilio, Claude API, vendor_contacts seeded in Supabase
    └── Vendor credit ledger working

Week 7
└── Offline sync complete
    ├── Depends on: IndexedDB (idb), working sync endpoint on backend
    └── Full edge case testing with real device

Week 8
└── Demo polish
    └── All above layers must be stable
```

### Hard dependencies (cannot build B without A)

```
Supabase schema  →  All backend routes (reads/writes)
Supabase schema  →  All frontend data display
Twilio webhook   →  Any WhatsApp bot flow
Claude API key   →  Voice note parsing, command parsing
Intelligence module  →  Morning prep sheet
Intelligence module  →  Wastage → next-day vendor order flow
Menu items seeded in DB  →  Staff order-taking app
vendor_contacts seeded  →  Vendor order grouping
Google Sheets spreadsheet created  →  Nightly sync
Render /health endpoint live  →  cron-job.org wake pings (scheduled jobs)
```

---

## 13. Full Package List

### Backend (`/backend/package.json`)

```json
{
  "name": "cafeos-backend",
  "version": "1.0.0",
  "engines": { "node": "20.x" },
  "dependencies": {
    "@supabase/supabase-js": "^2.44.0",
    "axios": "^1.7.0",
    "bcrypt": "^5.1.1",
    "cheerio": "^1.0.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "express": "^4.19.0",
    "express-async-errors": "^3.1.0",
    "googleapis": "^140.0.0",
    "morgan": "^1.10.0",
    "node-cron": "^3.0.3",
    "twilio": "^5.2.0"
  },
  "devDependencies": {
    "nodemon": "^3.1.0"
  },
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js"
  }
}
```

**Optional (add in Week 5 if voice note transcoding is needed):**
```json
"fluent-ffmpeg": "^2.1.3",
"ffmpeg-static": "^5.2.0"
```

### Frontend (`/frontend/package.json`)

```json
{
  "name": "cafeos-frontend",
  "version": "1.0.0",
  "dependencies": {
    "@supabase/supabase-js": "^2.44.0",
    "idb": "^8.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.24.0",
    "workbox-window": "^7.1.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "vite": "^5.3.0",
    "vite-plugin-pwa": "^0.20.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

### `.env.example` (commit this to git, never the real `.env`)

```env
# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=         # backend only — never expose to frontend
SUPABASE_ANON_KEY=                 # frontend only — safe to expose

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
SAM_WHATSAPP_TO=whatsapp:+91XXXXXXXXXX

# Claude
CLAUDE_API_KEY=

# Google Sheets
GOOGLE_SPREADSHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=

# App config
NODE_ENV=development
PORT=3000
OWNER_EMAIL=sam@samscafe.com    # used to identify owner session in RLS
```

---

*This document is the authoritative tech reference for all CafeOS Phase I development.*  
*Update version number and date when any technology decision changes.*  
*All open questions from the PRD (OQ-01 through OQ-14) must be resolved before their corresponding setup week.*
