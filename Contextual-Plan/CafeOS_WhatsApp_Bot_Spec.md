# CafeOS — WhatsApp Bot Command Specification

**Version:** 1.0  
**Date:** June 2026  
**Authors:** Yashita Loya + Co-developer  
**Status:** Authoritative reference for bot development  
**Scope:** All commands, flows, LLM prompts, and fallback behaviour for the CafeOS WhatsApp bot

---

## Table of Contents

1. [Bot Fundamentals](#1-bot-fundamentals)
2. [Permission Model](#2-permission-model)
3. [Bot State Machine](#3-bot-state-machine)
4. [FLOW 01 — Onboarding (First Message)](#4-flow-01--onboarding-first-message)
5. [FLOW 02 — Morning Prep Sheet (Automated)](#5-flow-02--morning-prep-sheet-automated)
6. [FLOW 03 — Inventory Check-In (Ad Hoc Query)](#6-flow-03--inventory-check-in-ad-hoc-query)
7. [FLOW 04 — Vendor Order (Manual Command)](#7-flow-04--vendor-order-manual-command)
8. [FLOW 05 — Evening Memory Check-In (Automated)](#8-flow-05--evening-memory-check-in-automated)
9. [FLOW 06 — Nightly Wastage Log (Automated)](#9-flow-06--nightly-wastage-log-automated)
10. [FLOW 07 — Next-Day Vendor Order Approval (Continuation of Wastage)](#10-flow-07--next-day-vendor-order-approval-continuation-of-wastage)
11. [FLOW 08 — Credit Logging](#11-flow-08--credit-logging)
12. [FLOW 09 — Payment Logging and Settlement](#12-flow-09--payment-logging-and-settlement)
13. [FLOW 10 — Ad Hoc Queries](#13-flow-10--ad-hoc-queries)
14. [FLOW 11 — Weekly Sunday Summary (Automated)](#14-flow-11--weekly-sunday-summary-automated)
15. [FLOW 12 — Manual Event Flag](#15-flow-12--manual-event-flag)
16. [LLM Prompt Library](#16-llm-prompt-library)
17. [Fallback Behaviour](#17-fallback-behaviour)
18. [Scheduled Job Summary](#18-scheduled-job-summary)
19. [Error State Reference](#19-error-state-reference)

---

## 1. Bot Fundamentals

### Identity
- The bot lives on a single dedicated Twilio WhatsApp number.
- Sam has this number saved in her contacts as **"My Cafe Bot"** or **"CafeOS"**.
- The bot speaks in warm, plain English. Short sentences. No jargon.
- Numbers are always formatted: ₹1,500 not 1500. Portions as whole numbers.
- Bot messages are under 1,600 characters. If longer, split into two messages with 500ms delay.

### Who Can Use the Bot
The bot is **owner-only**. It only responds to messages from `process.env.SAM_WHATSAPP_TO`. All other numbers are silently ignored — no reply, no log.

### Message Processing Architecture
```
Twilio POST /webhook/whatsapp
        │
        ├── 1. Validate Twilio signature (403 if invalid)
        ├── 2. Check MessageSid deduplication (200 empty TwiML if duplicate)
        ├── 3. Verify sender == SAM_WHATSAPP_TO (ignore silently if not)
        ├── 4. Respond immediately: res.status(200).send('<Response></Response>')
        ├── 5. Load bot_state from Supabase
        ├── 6. Check if voice note (NumMedia === '1')
        └── 7. Route to handler (state-based first, then intent-based)
```

**Critical:** Always ACK Twilio within 5 seconds or it retries. All slow operations (Claude API, DB writes) happen asynchronously after the 200 response.

### Language Handling
Sam may write in English, Hindi, or Konkani — or a mix. All free-text parsing uses Claude API which handles all three natively. The bot's outgoing messages are in **English only** in Phase I.

---

## 2. Permission Model

| Role | Access | Auth Method |
|------|--------|-------------|
| Owner (Sam) | All bot commands | Phone number match (`SAM_WHATSAPP_TO` env var) |
| Staff | None — bot ignores all non-Sam numbers | N/A |
| Unknown number | Silent ignore | N/A |

There is no PIN or password for the bot. Security is entirely based on Sam's WhatsApp account ownership. If Sam's phone is compromised, the attacker has full bot access — this is an accepted risk for Phase I given the target user's technical profile.

---

## 3. Bot State Machine

The bot is **stateful**. States persist in the `bot_state` Supabase table (not in-memory) so they survive Render free-tier restarts.

### Valid States

| State | Set When | Cleared When |
|-------|----------|--------------|
| `idle` | Default, after any flow completes | — |
| `awaiting_prep_confirm` | Prep sheet message sent at 8am | Sam replies "1", sends edit text, or 9:30am auto-confirm fires |
| `awaiting_prep_edit` | Sam replies "2" to prep sheet | Edit parsed and confirmed |
| `awaiting_vendor_confirm` | Vendor order summary sent | Sam replies "1" or "2" |
| `awaiting_vendor_edit` | Sam replies "2" to vendor order | Edit parsed and confirmed |
| `awaiting_vendor_name` | `order` command sent without vendor name | Sam provides vendor name |
| `awaiting_evening_checkin` | Evening check-in prompt sent at 7pm | Sam replies (any text or voice note) |
| `awaiting_wastage` | Wastage prompt sent at 10pm | Sam replies with wastage data |

### Stale State Handling
On every incoming message, **before routing**, check:
```javascript
if (botState.updated_at < Date.now() - 6 * 60 * 60 * 1000 && botState.current_state !== 'idle') {
  // State is more than 6 hours old — reset to idle
  await resetBotState(phoneNumber)
}
```
This prevents Sam being stuck if she abandoned a flow yesterday.

### Context JSON
`context_json` in `bot_state` stores temporary flow data. Examples:

| State | `context_json` contents |
|-------|------------------------|
| `awaiting_prep_confirm` | `{ date, predictions: [{item_name, predicted_qty, menu_item_id}] }` |
| `awaiting_vendor_confirm` | `{ orders: [{vendor_name, items, formatted_message}] }` |
| `awaiting_vendor_edit` | `{ original_orders: [...], vendor_name }` |
| `awaiting_wastage` | `{ date, prompted_at }` |

---

## 4. FLOW 01 — Onboarding (First Message)

### Trigger
Sam sends **any message** to the bot for the first time (no existing `bot_state` row for her number).

### Detection Logic
```javascript
const { data: existing } = await supabase
  .from('bot_state')
  .select('phone_number')
  .eq('phone_number', phoneNumber)
  .maybeSingle()

const isFirstMessage = !existing
```

### Internal Actions
1. Insert a new `bot_state` row: `current_state = 'idle'`
2. Check if `vendor_contacts` table has any rows (seeded = system is ready)
3. Check if `menu_items` table has any active items (seeded = ready)
4. Log the onboarding event to backend logs

### Bot Reply

```
Hi Sam! 👋 Welcome to CafeOS — your cafe assistant.

I'll help you with:
📋 Morning prep suggestions (every day at 8am)
📦 Vendor orders — just tell me what you need
🌙 Evening check-ins (7pm daily)
🗑️ Wastage logging (10pm daily)
💰 Vendor credit and payments
📊 Daily and weekly summaries

You can also ask me anytime:
• "summary" — today's sales
• "stock" — inventory status
• "owe rice vendor" — what you owe a vendor

I'll message you at 8am tomorrow with today's prep sheet. 
You're all set! ✓
```

### Error State
If database insert fails:
```
Hi Sam! Something went wrong getting started. Please message again in a minute.
```

### Permission
Owner only (enforced at webhook level — this flow is never reached for unknown numbers).

---

## 5. FLOW 02 — Morning Prep Sheet (Automated)

### Trigger
**Scheduled job** — `node-cron` fires at `00 02 * * 2-7` (UTC), which is **8:00 AM IST, Tuesday through Sunday**. Mondays are excluded — cafe is closed.

A second cron fires at `45 03 * * 2-7` (9:15 AM IST) for the follow-up reminder if Sam hasn't responded.

An auto-confirm cron fires at `00 04 * * 2-7` (9:30 AM IST).

### Internal Actions (8:00 AM job)
1. Call `POST /api/predictions/generate` for today's date (or ensure predictions already exist)
2. Fetch today's predictions: `GET /api/predictions/today`
3. Fetch weather from Open-Meteo API (lat: 15.3961, lon: 73.8173, Vasco da Gama)
4. Check `festival_calendar` for active flags within 5 days
5. Call **LLM Prompt #2** (Prep Sheet Message Generator) — see Section 16
6. Send formatted message to Sam via Twilio
7. Set `bot_state.current_state = 'awaiting_prep_confirm'`
8. Store predictions in `bot_state.context_json`

### Bot Message Format

```
Good morning Sam! Here's today's prep 🍽️

🍚 Biryani → 20 portions
🐟 Fish Curry → 14 portions
☕ Chai → 60 cups
🥚 Egg Bhurji → 10 portions
🧀 Paneer Masala → 6 portions

Heavy rain expected today — chai usually spikes on rainy days.

Reply 1 to go with this
Or tell me what you're changing (e.g. "biryani 25, fish curry 10")
```

**Weather line rules:**
- Included ONLY if: rain expected, temperature > 35°C, or storm warning active
- NOT included on neutral weather days
- Phrasing adapts to condition: rain → chai/hot food note; extreme heat → cold drink note

**Festival line rules:**
- Included ONLY if a festival is active within the next 5 days
- Format: `"[Festival] is in [N] days — I've increased today's suggestions by [X]%."`

---

### Response A — Sam replies "1" (Approve)

**Trigger phrases:** `1`, `ok`, `yes`, `fine`, `looks good`, `confirmed`

**Internal Actions:**
1. Call `POST /api/predictions/confirm` with today's date
2. Set `bot_state.current_state = 'idle'`

**Bot Reply:**
```
Got it! Today's prep locked in ✓

Good luck today Sam!
```

---

### Response B — Sam sends edit (free text)

**Trigger:** Any message in `awaiting_prep_confirm` state that is NOT "1" or a known approval phrase

**Examples of valid edit messages:**
- `biryani 25, fish curry 10`
- `make biryani 25 and skip fish curry today`
- `biryani 25 fish curry nahi`
- `sabhi same rakho, sirf chai 80`

**Internal Actions:**
1. Call **LLM Prompt #3** (Prep Sheet Edit Parser) — see Section 16
2. Parse Claude response: `[{menu_item_id, item_name, qty}]`
3. Call `PATCH /api/predictions/override` with parsed overrides
4. For items NOT mentioned in Sam's edit: confirm at `predicted_qty` (do not change)
5. Set `bot_state.current_state = 'idle'`

**Bot Reply:**
```
Updated ✓

Today's prep:
🍚 Biryani → 25 portions (you changed this)
🐟 Fish Curry → skipping today
☕ Chai → 60 portions
🥚 Egg Bhurji → 10 portions
🧀 Paneer Masala → 6 portions

Good luck today Sam!
```

**Error — Claude parse fails:**
```
Sorry Sam, I didn't catch that clearly. Can you say it like:
"biryani 25, fish curry 10" ?
```
State remains `awaiting_prep_confirm`. Sam can try again.

---

### Response C — No reply by 9:15 AM (Follow-Up)

**Trigger:** 9:15 AM cron, state is still `awaiting_prep_confirm`

**Bot Message:**
```
Hi Sam! Just checking — did you see today's prep sheet? 

Reply 1 to confirm or tell me your changes.
```

---

### Response D — No reply by 9:30 AM (Auto-Confirm)

**Trigger:** 9:30 AM cron, state is still `awaiting_prep_confirm`

**Internal Actions:**
1. Call `POST /api/predictions/confirm` for today's date
2. Set `bot_state.current_state = 'idle'`

**Bot Message:**
```
No worries — I've locked in today's prep as suggested ✓
```

---

## 6. FLOW 03 — Inventory Check-In (Ad Hoc Query)

### Trigger Phrases
| Exact | Natural variations |
|-------|--------------------|
| `stock` | `inventory`, `what's in stock`, `stock check`, `kya hai`, `stock dekho` |

**State requirement:** Works from `idle` state only. If Sam is mid-flow (e.g. `awaiting_wastage`), this is treated as a fallback — respond to the active flow first.

### Internal Actions
1. Call `GET /api/predictions/today` — fetch today's predicted vs confirmed quantities
2. Fetch recent wastage (last 3 days) via `GET /api/wastage?from=[3 days ago]`
3. Compute rough stock estimate: `predicted_qty - actual_sold_today` (from `order_items` aggregation)
4. No bot_state change (stays `idle`)

### Bot Reply
```
Stock check 📦

Estimated remaining today:
🍚 Biryani — ~8 portions left
🐟 Fish Curry — ~6 portions left
☕ Chai — ~30 cups left
🥚 Egg Bhurji — ~4 portions left
🧀 Paneer Masala — ~3 portions left

Based on today's prep and orders logged so far.
```

**If no sales data yet for today (early morning query):**
```
Stock check 📦

Today's prep plan:
🍚 Biryani — 20 portions planned
🐟 Fish Curry — 14 portions planned
☕ Chai — 60 cups planned

No orders logged yet today.
```

### Error State
```
Couldn't fetch stock right now. Try again in a minute.
```

---

## 7. FLOW 04 — Vendor Order (Manual Command)

### Trigger Format (Exact)
```
order [items] → [vendor name]
```

### Natural Language Variations Sam Might Use
```
order rice 5kg, dal 3kg → Rice Vendor
order karo rice 5kg dal 3kg rice vendor ke liye
order chicken 1kg fish 500g → Meat Vendor
order rice 5kg @₹45/kg, oil 2L @₹120/L → Rice Vendor
order rice 5kg → rice vendor (for thursday)
```

**Without vendor name (triggers prompt):**
```
order rice 5kg, dal 3kg
order karo rice 5kg
```

### Step 1: Parse the Order

**Internal Actions:**
1. Call **LLM Prompt #4** (Vendor Order Parser) — see Section 16
2. Claude returns structured JSON:
```json
{
  "items": [
    { "name": "rice", "qty": 5, "unit": "kg", "price_per_unit": null },
    { "name": "dal", "qty": 3, "unit": "kg", "price_per_unit": null }
  ],
  "vendor_name": "Rice Vendor",
  "delivery_date": "tomorrow",
  "notes": null
}
```

---

### Step 1A: Vendor Name Missing

If `vendor_name` is null after parsing:

**Internal Actions:**
1. Set `bot_state.current_state = 'awaiting_vendor_name'`
2. Store parsed items in `context_json`

**Bot Reply:**
```
Got the items. Who should this order go to?

(Reply with the vendor name, e.g. "Rice Vendor")
```

**Sam's reply:** Vendor name as plain text.

**Internal Actions:**
1. Retrieve items from `context_json`
2. Set vendor_name from Sam's reply
3. Continue to Step 2

---

### Step 2: Show Order Summary

**Internal Actions:**
1. Format vendor message
2. Set `bot_state.current_state = 'awaiting_vendor_confirm'`
3. Store formatted order in `context_json`

**Bot Reply:**
```
Logged ✓

Ready to send to Rice Vendor:

"Rice 5kg, Dal 3kg, Oil 2kg — please deliver tomorrow morning."

Reply 1 to confirm
Reply 2 to edit
```

**If delivery date was specified (e.g. "for Thursday"):**
```
"Rice 5kg, Dal 3kg — please deliver by Thursday."
```

---

### Step 3A: Sam replies "1" (Confirm)

**Internal Actions:**
1. Call `POST /api/vendor/orders` with parsed items, vendor_name, total_cost (if prices given, else null), delivery_date
2. Set `bot_state.current_state = 'idle'`

**Bot Reply:**
```
Done ✓ Forwarded message is above — just send it to Rice Vendor on WhatsApp.
```

---

### Step 3B: Sam replies "2" (Edit)

**Internal Actions:**
1. Set `bot_state.current_state = 'awaiting_vendor_edit'`

**Bot Reply:**
```
What would you like to change?
(e.g. "rice 6kg, skip dal" or "add oil 2L")
```

**Sam sends edit:** e.g. `rice 6kg, skip dal, add oil 2L`

**Internal Actions:**
1. Call **LLM Prompt #4** again with the edit + original items context
2. Produce updated item list
3. Show updated order summary (loop back to Step 2)

---

### Error States

**Claude parse fails entirely:**
```
Sorry Sam, I couldn't read that order. Can you try like this:
"order rice 5kg, dal 3kg → Rice Vendor"
```
State returns to `idle`.

**Vendor name not in `vendor_contacts`:**
- Do NOT block the order. Create a new vendor entry with the name.
- Add a note in the bot reply:
```
Note: "New Vendor" isn't in your contacts yet. I've added them — you can add their WhatsApp number in the app later.
```

---

## 8. FLOW 05 — Evening Memory Check-In (Automated)

### Trigger
**Scheduled job** — `node-cron` fires at `30 13 * * 2-0` (UTC) = **7:00 PM IST, Tuesday–Sunday**.

### Internal Actions (7:00 PM job)
1. Send check-in prompt via Twilio
2. Set `bot_state.current_state = 'awaiting_evening_checkin'`

### Bot Message
```
Hi Sam! How did today go? 🌇

Anything to flag — stockouts, big groups, equipment trouble, 
power cuts, or anything else worth remembering for tomorrow?

(Voice note or text, whichever is easier)
```

---

### Response A — Sam sends text

**Trigger:** Any text message when state is `awaiting_evening_checkin`

**Internal Actions:**
1. Call **LLM Prompt #1** (Evening Check-In Text Parser) — see Section 16
2. Write to `checkins` table: `raw_text`, `parsed_signals_json`, `date`, `input_type: 'text'`
3. Set `bot_state.current_state = 'idle'`

---

### Response B — Sam sends a voice note

**Trigger:** `NumMedia === '1'` and `MediaContentType0 === 'audio/ogg'` when state is `awaiting_evening_checkin`

**Internal Actions:**
1. Reply immediately: `"Got it, listening... 🎧"` (prevents Sam thinking bot is broken)
2. Download audio file from `MediaUrl0` using Twilio credentials (buffer to memory)
   - **Critical:** Twilio audio URLs expire in ~4 hours. Download immediately.
3. Convert buffer to base64
4. Check format — if not `audio/ogg` or `audio/mp3`, transcode with `fluent-ffmpeg`
5. Call **LLM Prompt #1B** (Evening Check-In Voice Note Parser) — see Section 16
6. Write to `checkins` table: `transcription`, `raw_text`, `parsed_signals_json`, `date`, `input_type: 'voice_note'`
7. Set `bot_state.current_state = 'idle'`

---

### Bot Reply (after parsing — both text and voice)

```
Got it, noted for tomorrow ✓

• Biryani ran out around 12:30 — I'll suggest more tomorrow
• Power cut logged for ~6pm, 2 hours
• Office group noted — watching for pattern
```

Bot lists back **only what it understood**. This lets Sam catch parsing errors.

**If nothing specific was extracted (e.g. Sam said "sab theek tha"):**
```
Got it, noted as a normal day ✓

See you tomorrow!
```

---

### No Response

If Sam does not respond to the evening check-in, the bot does **not** follow up. The checkin record for that day is logged as null (missing). No message is sent.

---

### Error States

**Claude API failure (voice note):**
1. Store raw transcription attempt or audio note in `checkins.raw_text`
2. Set `bot_state.current_state = 'idle'`

```
Got it Sam, I saved your note ✓
(Couldn't fully parse it — I'll still keep it for reference)
```

**Audio download failure:**
```
Hi Sam, I got your voice note but couldn't download it. Can you send it again, or type what you wanted to say?
```
State remains `awaiting_evening_checkin`.

---

## 9. FLOW 06 — Nightly Wastage Log (Automated)

### Trigger
**Scheduled job** — `node-cron` fires at `30 16 * * 2-0` (UTC) = **10:00 PM IST, Tuesday–Sunday**.

### Internal Actions (10:00 PM job)
1. Send wastage prompt via Twilio
2. Set `bot_state.current_state = 'awaiting_wastage'`
3. Store `{ date: today, prompted_at: now() }` in `context_json`

### Bot Message
```
Day's done! What's left over? 🧹

Just tell me what's remaining, e.g.:
"biryani 3, fish curry 6, chai fine, dal nil"

(Items you don't mention I'll leave as unknown — not zero)
```

---

### Sam's Response

**Sam can reply in any of these formats (Claude handles all):**
- `biryani 3, fish curry 6` — explicit quantities
- `biryani nil, chai fine` — nil = 0; fine/ok = negligible (log as 0)
- `everything fine except fish curry 8`
- `biryani teen, fish curry chhe` — Hindi numbers (Claude handles)
- `nothing left, sab bik gaya` — all sold out (log all as 0)
- Voice note (handled identically to text via **LLM Prompt #5**)

**Items not mentioned:** logged as `null` (not zero — don't penalise items Sam forgot to mention)

---

### Internal Actions (on Sam's reply)
1. Call **LLM Prompt #5** (Wastage Parser) — see Section 16
2. Claude returns: `[{ "item": "biryani", "qty_left": 3 }, { "item": "fish_curry", "qty_left": 6 }]`
3. Call `POST /api/wastage` with parsed items
4. Backend recalculates next-day predictions via intelligence module
5. Fetch updated next-day predictions: `GET /api/predictions?date=[tomorrow]`
6. Fetch procurement order recommendation (grouped by vendor from `vendor_contacts`)
7. Set `bot_state.current_state = 'awaiting_vendor_confirm'` (transition to FLOW 07)

### Bot Reply
```
Wastage logged ✓

Adjusting tomorrow's suggestions:
• Fish Curry: suggesting 8 tomorrow (was 14, 6 left today)
• Biryani: small adjustment, suggesting 18 tomorrow

Ready for tomorrow's vendor order?

📦 Rice Vendor:
Rice 4kg, Dal 2kg, Oil 1.5L

🥩 Meat Vendor:
Chicken 800g, Fish 1kg

Reply 1 to approve
Reply 2 to edit
```

### Error States

**Claude parse fails:**
```
Sorry Sam, I didn't catch those quantities. Can you try like:
"biryani 3, fish curry 6, chai 0"
```
State remains `awaiting_wastage`.

**No changes to next-day predictions (all wastage = 0):**
```
Wastage logged — great, everything sold! ✓

Tomorrow's suggestions stay the same.

Ready for tomorrow's vendor order?
[vendor order block as above]
```

**Sam replies "nothing" / "nil" / "sab bik gaya" (everything sold):**
- Log all items as `qty_left: 0`
- Continue to vendor order flow normally

**No response from Sam:** Wastage record for that day logged as null. No follow-up sent. Cron continues to FLOW 07 anyway (sends vendor order based on prediction only).

> **Decision needed:** Should the bot still trigger vendor order flow if wastage wasn't logged? Current recommendation: Yes — send vendor order at 10:15 PM regardless, based on prediction alone, without the wastage adjustment line.

---

## 10. FLOW 07 — Next-Day Vendor Order Approval (Continuation of Wastage)

This flow picks up directly after FLOW 06. Sam is in `awaiting_vendor_confirm` state with the vendor order summary already shown.

### Response A — Sam replies "1" (Approve All)

**Trigger phrases:** `1`, `ok`, `send`, `yes`, `theek hai`

**Internal Actions:**
1. For each vendor group in `context_json.orders`:
   - Write one `procurement` record: `vendor_name, items_json, status: 'pending_delivery', created_at: now()`
2. Set `bot_state.current_state = 'idle'`

**Bot Reply:**
```
Done! Here are your messages to forward 📤

─────────────────
To Rice Vendor:

"Rice 4kg, Dal 2kg, Oil 1.5L — please deliver tomorrow morning."

─────────────────
To Meat Vendor:

"Chicken 800g, Fish 1kg — please deliver tomorrow morning."
─────────────────

Just forward each message to the vendor on WhatsApp ✓
```

Each vendor block is a separate forwarding unit. Sam taps and holds on the quoted message, then forwards it.

---

### Response B — Sam replies "2" (Edit)

**Internal Actions:**
1. Set `bot_state.current_state = 'awaiting_vendor_edit'`

**Bot Reply:**
```
What would you like to change?
(e.g. "rice 5kg, skip oil" or "no meat order today")
```

**Sam sends edit:** Claude parses the edit against the original items in `context_json`

**Internal Actions:**
1. Call **LLM Prompt #4** with edit + original items context
2. Show updated vendor order (loop back to top of this flow with updated data)
3. Sam must confirm with "1" before procurement records are written

---

### Response C — "No order today"

**Trigger phrases:** `no order`, `not today`, `skip`, `aaj nahi`

**Internal Actions:**
1. Set `bot_state.current_state = 'idle'`
2. No procurement records written

**Bot Reply:**
```
Got it, no vendor order tonight ✓
```

---

## 11. FLOW 08 — Credit Logging

### Trigger Format (Exact)
```
credit [vendor name] [item description] ₹[amount]
```

### Natural Language Variations
```
credit Rice Vendor rice 50kg ₹4500
credit rice vendor ₹4500 for rice 50kg
rice vendor ne credit diya rice 50kg ₹4500
credit Meat Vendor ₹2000 chicken
```

**Permission:** Owner only

### Internal Actions
1. Parse message — try regex first, Claude as fallback:
   ```
   Regex: /credit (.+?) (?:.+? )?₹(\d+(?:\.\d{1,2})?)/i
   ```
2. If regex captures vendor and amount, extract item description from remaining text
3. If regex fails, call **LLM Prompt #6** (Credit/Payment Parser)
4. Call `POST /api/credit` with `{ vendor_name, type: 'credit', amount, item_description }`
5. Fetch updated balance: outstanding = credits - payments for this vendor

### Bot Reply
```
Credit logged ✓
Rice Vendor: ₹4,500 credit for rice (50kg)

Total outstanding with Rice Vendor: ₹5,300
```

**If this is the vendor's first entry (new vendor):**
```
Credit logged ✓
New vendor added: Rice Vendor

Credit: ₹4,500 for rice (50kg)
Total outstanding: ₹4,500
```

### Error States

**Amount missing:**
```
How much credit? Please include ₹ amount.
(e.g. "credit Rice Vendor rice 50kg ₹4500")
```

**Vendor name unclear:**
```
Which vendor is this for? 
(e.g. "credit Rice Vendor ₹4500")
```

---

## 12. FLOW 09 — Payment Logging and Settlement

### Trigger Format (Exact)
```
paid [vendor name] ₹[amount]
```

### Natural Language Variations
```
paid Rice Vendor ₹2400
rice vendor ko ₹2400 diya
paid ₹2400 to rice vendor
rice vendor 2400 paid
```

**Permission:** Owner only

### Internal Actions
1. Parse message — regex first, Claude fallback:
   ```javascript
   const match = messageText.match(/paid (.+?) ₹(\d+(?:\.\d{1,2})?)/i)
   // OR: /₹(\d+(?:\.\d{1,2})?) (?:to )?(.+)/i (reversed order)
   ```
2. Call `POST /api/credit` with `{ vendor_name, type: 'payment', amount }`
3. Backend computes new outstanding balance
4. If `outstanding_balance <= 0`: backend marks all entries for this vendor `settled = true`

### Bot Reply — Balance Remaining

```
Payment logged ✓
Rice Vendor: ₹2,400 paid on 5 Jun

Outstanding balance with Rice Vendor: ₹800
```

### Bot Reply — Balance Settled

```
Payment logged ✓
Rice Vendor: ₹2,400 paid on 5 Jun

🟢 Rice Vendor balance is fully settled ✓
```

### Bot Reply — Overpayment (balance goes negative)

```
Payment logged ✓
Rice Vendor: ₹2,400 paid on 5 Jun

Note: This is ₹200 more than what was recorded. 
Balance shows ₹0. Double-check with Rice Vendor if needed.
```

### Error States

**Amount missing:**
```
How much did you pay? Please include ₹ amount.
(e.g. "paid Rice Vendor ₹2400")
```

**Vendor not found (no prior credit entries):**
```
I don't have any credit entries for "[vendor name]". 
Want me to log this payment anyway? Reply "yes" to confirm.
```
State: set `awaiting_vendor_payment_confirm` (minor sub-state)

---

### Sub-command: Check Balance

**Trigger:**
```
owe [vendor name]
balance [vendor name]
rice vendor kitna bacha
what do i owe rice vendor
```

**Internal Actions:**
1. Parse vendor name via Claude or keyword extraction
2. Call `GET /api/credit/balance/:vendor_name`

**Bot Reply:**
```
Rice Vendor balance 💰

Outstanding: ₹3,100

Last transaction: ₹4,500 credit on 1 Jun
```

**If balance is zero/settled:**
```
Rice Vendor balance 💰

All settled ✓ (₹0 outstanding)
```

**All vendor balances:**

**Trigger:** `balances`, `all balances`, `sab vendors`, `vendor summary`

**Bot Reply:**
```
Vendor balances 💰

Rice Vendor — ₹3,100 outstanding
Meat Vendor — ₹1,800 outstanding
Vegetable Vendor — ✓ settled

Total outstanding: ₹4,900
```

---

## 13. FLOW 10 — Ad Hoc Queries

These commands work from `idle` state at any time. They do not change bot state.

---

### 13.1 Daily Summary

**Trigger phrases:**
```
summary
today
aaj ka hisaab
sales
aaj kitna hua
```

**Internal Actions:**
1. Call `GET /api/billing/summary?date=[today]`
2. Format response

**Bot Reply:**
```
Today's Summary 📊
(as of 3:42pm)

Orders: 28
Revenue: ₹5,240
Cash: ₹2,800 | UPI: ₹2,190 | Pending: ₹250

Top items today:
• Biryani: 34 portions (₹4,080)
• Chai: 61 cups (₹915)
• Fish Curry: 18 portions (₹1,440)
```

**If no orders logged yet today:**
```
No orders logged yet today.
(Did staff open the app? Check they're connected.)
```

---

### 13.2 Best Sellers Query

**Trigger phrases:**
```
best seller
what sold most
top items this week
kya zyada bika
most popular
```

**Internal Actions:**
1. Parse time range — default "this week" (last 7 days)
2. Query: `SELECT item_name, SUM(quantity) as units FROM order_items JOIN orders ... GROUP BY item_name ORDER BY units DESC LIMIT 5`

**Bot Reply:**
```
Best sellers this week 🏆

1. Biryani — 142 portions
2. Chai — 318 cups
3. Fish Curry — 89 portions
4. Egg Bhurji — 61 portions
5. Paneer Masala — 34 portions
```

---

### 13.3 Worst Sellers / Most Wastage

**Trigger phrases:**
```
what's wasted most
most wastage
least selling
what should i reduce
```

**Internal Actions:**
1. Query `wastage_logs` for last 7 days, aggregate by item, sort DESC

**Bot Reply:**
```
Most wastage this week 🗑️

1. Fish Curry — avg 5 portions left/day
2. Paneer Masala — avg 2 portions left/day

Fish Curry is consistently leftover. Consider reducing prep by 4–5 portions on weekdays.
```

---

### 13.4 Yesterday's Summary

**Trigger phrases:**
```
yesterday
kal ka hisaab
yesterday's sales
```

**Internal Actions:** Same as daily summary but `date = today - 1 day`

---

### 13.5 Specific Item Query

**Trigger phrases:**
```
how much biryani sold today
fish curry kitna bika
biryani sales this week
```

**Internal Actions:**
1. Extract item name from message (Claude parse or keyword match against `menu_items.name`)
2. Query `order_items` for that item, current day

**Bot Reply:**
```
Biryani today 🍚

Portions sold: 34
Revenue: ₹4,080
Predicted: 20 portions
(14 more than predicted — note this for tomorrow!)
```

---

### 13.6 Revenue vs Last Week

**Trigger phrases:**
```
how did we do vs last week
compare this week last week
is revenue up
```

**Internal Actions:**
1. Compute this week's total: `SUM(total_amount) WHERE bill_date BETWEEN [week_start] AND today`
2. Compute last week's total: same for prior week
3. Compute % change

**Bot Reply:**
```
Revenue comparison 📈

This week (so far): ₹28,400
Last week (same days): ₹25,350

Up 12% ✓
```

---

## 14. FLOW 11 — Weekly Sunday Summary (Automated)

### Trigger
**Scheduled job** — `node-cron` fires at `30 15 * * 0` (UTC) = **9:00 PM IST, every Sunday**.

Precondition: At least 4 days of order data must exist for the current week (Tue–Sun). If fewer than 4 days, bot sends:
```
Hi Sam! Not enough data this week to generate a full summary. See you next Sunday!
```

### Internal Actions
1. Compute week range: last Tuesday to today (Sunday)
2. Aggregate: total orders, total revenue, per-item totals, wastage totals, payment method breakdown
3. Compute week-over-week revenue change
4. Identify: best-selling item, most-wasted item, highest-revenue day
5. Compute rough margin: `(total_revenue - total_procurement_cost) / total_revenue * 100` (null if procurement costs not logged)
6. Call **LLM Prompt #7** (Weekly Summary Generator) — see Section 16
7. Send to Sam

### Bot Message
```
This week at Sam's Cafe 🍽️
(Tue 27 May – Sun 1 Jun)

Best seller: Biryani (142 portions, ₹17,040)
Most wastage: Fish Curry (avg 5 left/day — ₹2,200 estimate)
Revenue vs last week: +12% ✓  (₹31,200 this week)
Biggest day: Saturday (₹6,200)
This week's margin: ~34%

One suggestion: Making 4 fewer Fish Curry on weekdays 
could save ~₹560/week in wastage.

Well done this week Sam! 🌟
```

**Margin line:** Shown only if procurement costs were logged during the week. Otherwise omitted.

**Suggestion line:** Generated by Claude based on the week's data patterns. One concrete, actionable sentence.

---

## 15. FLOW 12 — Manual Event Flag

### Purpose
Sam can manually flag an upcoming event (football match, local function, school admission day, etc.) that will spike demand. This adds a one-time multiplier to that day's predictions.

### Trigger Format
```
event [date or "tomorrow"] [description]
```

### Examples
```
event tomorrow big football match at stadium
event saturday office party 30 people
event 15 june school prize day
aaj kal event hai bada — footfall zyada hoga
```

### Internal Actions
1. Parse date and description (Claude or regex)
2. Write to `predictions.manual_flag` for that date: `{ flag: description, multiplier: 1.2 }`
   - Default multiplier: 1.2 (20% boost). Sam can override: `event tomorrow football match 40%` → 1.4
3. If predictions already generated for that date: re-run prediction with flag applied
4. Confirm to Sam

### Bot Reply
```
Event flagged ✓
Saturday: "office party, 30 people"

I've bumped Saturday's prep suggestions by 20%.
You'll see updated numbers in tomorrow's morning prep sheet.
```

### Error State
```
Got it, I noted an event but couldn't figure out the date. 
Did you mean today or tomorrow?
```

---

## 16. LLM Prompt Library

All prompts use model `claude-sonnet-4-20250514`. All prompts instruct Claude to return **only valid JSON with no preamble, no markdown fences, no explanation**. Parse the response with `JSON.parse()`. If parse fails, strip any markdown fences (`\`\`\`json`, `\`\`\``) and retry once.

---

### Prompt #1A — Evening Check-In: Text Parser

**Used in:** FLOW 05 (Response A — Sam sends text)

**Max tokens:** 500

```javascript
const systemPrompt = `You are an assistant for a small cafe in Goa, India. 
The cafe owner, Sam, has sent a text message describing how today went.
Extract structured signals from her message. 
Sam may write in English, Hindi, Konkani, or a mix of all three.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "stockouts": [{ "item": string, "time": string|null }] | null,
  "demand_spike": string|null,
  "power_disruption": { "time": string|null, "duration_hours": number|null }|null,
  "weather_impact": string|null,
  "other_notes": string|null
}

Rules:
- "stockouts": list of items that ran out. Include approximate time if mentioned. null if none mentioned.
- "demand_spike": describe any unusually large or unexpected group/event that drove higher sales. null if none.
- "power_disruption": log if a power cut was mentioned. Estimate duration if mentioned. null if none.
- "weather_impact": note if Sam said weather affected footfall (positively or negatively). null if not mentioned.
- "other_notes": anything important that doesn't fit the above (equipment issues, staff problem, etc.). null if none.
- If Sam said everything was normal or fine, return all fields as null.
- Never invent information not present in the message.`

const userMessage = `Sam's message: "${rawText}"`
```

---

### Prompt #1B — Evening Check-In: Voice Note Parser

**Used in:** FLOW 05 (Response B — Sam sends voice note)

**Max tokens:** 800

```javascript
const systemPrompt = `You are an assistant for a small cafe in Goa, India.
You will receive an audio file — a voice note from the cafe owner, Sam.
Sam may speak in English, Hindi, Konkani, or a mix.

Step 1: Transcribe the voice note accurately.
Step 2: Extract structured operational signals.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "transcription": string,
  "stockouts": [{ "item": string, "time": string|null }] | null,
  "demand_spike": string|null,
  "power_disruption": { "time": string|null, "duration_hours": number|null }|null,
  "weather_impact": string|null,
  "other_notes": string|null
}

Rules:
- "transcription": full verbatim transcription of the audio. Include all languages spoken.
- All other fields: same rules as text parser (see above).
- If audio is unclear or unintelligible, set transcription to "unclear audio" and all signal fields to null.`

// Pass audio as base64 in message content
const messages = [{
  role: 'user',
  content: [
    {
      type: 'text',
      text: "This is Sam's voice note from this evening. Please transcribe and extract signals."
    },
    {
      type: 'image',  // Use audio type when Claude API supports it; fallback: transcribe separately
      source: {
        type: 'base64',
        media_type: 'audio/ogg',  // or audio/mp3 after transcoding
        data: base64AudioString
      }
    }
  ]
}]
```

> **Implementation note:** As of June 2026, verify Claude Sonnet 4's audio input support. If audio input is unavailable, use a two-step approach: first transcribe with a separate ASR service (e.g. Whisper via an open API), then pass the transcript to Prompt #1A. Document this fallback in the codebase.

---

### Prompt #2 — Morning Prep Sheet: Message Generator

**Used in:** FLOW 02 (generating the 8am message)

**Max tokens:** 600

```javascript
const systemPrompt = `You are CafeOS, a friendly assistant for Sam's Cafe in Vasco da Gama, Goa.
Generate the morning prep sheet WhatsApp message for Sam.
Use warm, plain English. Short sentences. No jargon.
Format numbers clearly. Use emoji sparingly (one per major section max).
Return ONLY the message text — no JSON, no preamble, no explanation.

Rules:
- Open with a warm greeting: "Good morning Sam! Here's today's prep 🍽️"
- List each menu item with its predicted quantity. Use emoji relevant to the item.
- Include a weather line ONLY if weather is meaningfully relevant: rain, temperature > 35°C, or storm.
  Format: "Heavy rain expected today — [relevant note about demand impact]."
  Do NOT include on neutral weather days.
- Include a festival line ONLY if a festival is within 5 days.
  Format: "[Festival name] is in [N] days — I've increased today's suggestions by [X]%."
- End with: "Reply 1 to go with this" on one line, then "Or tell me what you're changing (e.g. 'biryani 25, fish curry 10')"
- Total message must be under 1,500 characters.`

const userMessage = `Today's predictions:
${predictions.map(p => `- ${p.item_name}: ${p.predicted_qty} portions`).join('\n')}

Weather: ${weatherSummary}
Festival flag: ${festivalFlag || 'none'}
Day of week: ${dayOfWeek}`
```

---

### Prompt #3 — Prep Sheet Edit Parser

**Used in:** FLOW 02 (Response B — Sam sends edit)

**Max tokens:** 400

```javascript
const systemPrompt = `You are an assistant for a small cafe in Goa, India.
Sam has replied to her morning prep sheet with changes.
Extract the item quantity overrides she wants.
Sam may write in English, Hindi, Konkani, or a mix.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "overrides": [
    { "item_name": string, "qty": number }
  ]
}

Rules:
- "item_name": use the item name as Sam used it. Match loosely to known items (e.g. "fish" = "Fish Curry").
- "qty": the quantity Sam wants. Use 0 for "skip", "nahi", "nil", "none", "band karo".
- Only include items Sam explicitly mentioned. Do not include items she didn't change.
- If Sam said something like "everything same except biryani 25", return only the biryani override.
- If Sam's message is unclear or contains no actionable changes, return: { "overrides": [], "unclear": true }`

const userMessage = `Current prep sheet items: ${currentItems.map(i => i.item_name).join(', ')}

Sam's edit message: "${editMessage}"`
```

---

### Prompt #4 — Vendor Order Parser

**Used in:** FLOW 04 and FLOW 07 (edit mode)

**Max tokens:** 500

```javascript
const systemPrompt = `You are an assistant for a small cafe in Goa, India.
Extract a vendor order from Sam's WhatsApp message.
Sam may write in English, Hindi, Konkani, or a mix.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "items": [
    {
      "name": string,
      "qty": number,
      "unit": string,
      "price_per_unit": number|null
    }
  ],
  "vendor_name": string|null,
  "delivery_date": "tomorrow"|"today"|"YYYY-MM-DD"|null,
  "notes": string|null
}

Rules:
- "name": the item name (e.g. "rice", "chicken", "oil"). Lowercase.
- "qty": numeric quantity only. No units in this field.
- "unit": the unit (e.g. "kg", "L", "g", "pieces"). Lowercase. "pieces" if none stated.
- "price_per_unit": only if Sam included a price (e.g. "@₹45/kg"). null if not mentioned.
- "vendor_name": extract from after "→" or "for" or "ko". null if not present.
- "delivery_date": "tomorrow" if not specified (default). Parse relative dates (e.g. "Thursday" → ISO date).
- "notes": any other relevant note Sam included (e.g. "early delivery please").
- If message is an edit (original items provided), merge: update matching items, add new items, set qty=0 for "skip" items.`

const userMessage = `${originalItems ? `Original order: ${JSON.stringify(originalItems)}\n\nSam's edit: ` : ''}${message}`
```

---

### Prompt #5 — Wastage Log Parser

**Used in:** FLOW 06

**Max tokens:** 400

```javascript
const systemPrompt = `You are an assistant for a small cafe in Goa, India.
Sam has just sent her nightly wastage log — what's left over from today.
Extract structured leftover quantities.
Sam may write in English, Hindi, Konkani, or a mix.
Numbers may be in words (e.g. "teen" = 3, "chhe" = 6, "ek" = 1).
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "items": [
    { "item": string, "qty_left": number }
  ],
  "all_clear": boolean
}

Rules:
- "item": item name as Sam used it. Match loosely (e.g. "fish" = "fish curry").
- "qty_left": number of portions/units remaining.
- "nil", "zero", "nahi", "khatam" = 0.
- "fine", "ok", "thoda", "negligible" = 0 (treat as sold out / no meaningful remainder).
- "all_clear": true if Sam said everything sold (e.g. "sab bik gaya", "nothing left", "all clear").
  When true, return items as empty array — caller will treat all items as qty_left = 0.
- Do NOT invent items Sam didn't mention.
- If message is completely unclear, return: { "items": [], "all_clear": false, "unclear": true }`

const userMessage = `Known menu items: ${menuItems.map(i => i.name).join(', ')}

Sam's wastage message: "${message}"`
```

---

### Prompt #6 — Credit / Payment Parser

**Used in:** FLOW 08, FLOW 09 (when regex fails)

**Max tokens:** 300

```javascript
const systemPrompt = `You are an assistant for a small cafe in Goa, India.
Extract a vendor credit or payment entry from Sam's WhatsApp message.
Sam may write in English, Hindi, Konkani, or a mix.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "type": "credit"|"payment",
  "vendor_name": string,
  "amount": number,
  "item_description": string|null
}

Rules:
- "type": "credit" if a vendor gave Sam goods on credit. "payment" if Sam paid a vendor.
- "vendor_name": the vendor name as Sam stated.
- "amount": the ₹ amount as a number (no currency symbol).
- "item_description": what the credit was for (e.g. "rice 50kg"). null for payments.
- If type is ambiguous, default to "credit" if item description is present, "payment" if not.`

const userMessage = `Message: "${message}"`
```

---

### Prompt #7 — Weekly Sunday Summary Generator

**Used in:** FLOW 11

**Max tokens:** 500

```javascript
const systemPrompt = `You are CafeOS, a friendly assistant for Sam's Cafe in Vasco da Gama, Goa.
Generate the weekly summary WhatsApp message for Sam.
Use warm, plain English. Be encouraging but honest. No jargon. No fluff.
Return ONLY the message text — no JSON, no preamble, no explanation.

Rules:
- Open with: "This week at Sam's Cafe 🍽️" followed by the date range.
- Include exactly 5 data points, each on its own line with an emoji bullet.
- End with ONE concrete, specific, actionable suggestion based on the data.
- End with a short warm closing line.
- Total message must be under 1,500 characters.
- Never make up data. Use only what is provided.
- If margin data is unavailable, omit that line and replace with another data point (e.g. most popular day of week).`

const userMessage = `Weekly data:
- Week: ${weekStart} to ${weekEnd}
- Total orders: ${totalOrders}
- Total revenue: ₹${totalRevenue.toLocaleString('en-IN')}
- Last week revenue: ₹${lastWeekRevenue.toLocaleString('en-IN')}
- Revenue change: ${revenueChange > 0 ? '+' : ''}${revenueChange}%
- Best selling item: ${bestSeller.name} (${bestSeller.units} portions, ₹${bestSeller.revenue.toLocaleString('en-IN')})
- Most wasted item: ${mostWasted.name} (avg ${mostWasted.avgLeft} left/day, est. ₹${mostWasted.wasteCost} loss)
- Highest revenue day: ${highestDay.day} (₹${highestDay.revenue.toLocaleString('en-IN')})
- Estimated margin: ${margin !== null ? margin + '%' : 'not available (no procurement costs logged)'}
- Wastage cost this week: ₹${totalWastageCost.toLocaleString('en-IN')}

Generate the weekly summary message.`
```

---

## 17. Fallback Behaviour

### Primary Fallback — Unrecognised Message

**Trigger:** Any message that:
- Is NOT a voice note
- Does NOT match any known command keyword
- Is NOT a response to an active state

**Internal Actions:**
1. Log the unrecognised message to `backend logs` (for future intent coverage analysis)
2. Do NOT change bot_state
3. Send fallback reply

**Bot Reply:**
```
Sorry Sam, I didn't get that. Here's what I can help with:

📋 "summary" — today's sales
📦 "stock" — what's left
💰 "owe [vendor]" — credit balance
🛒 "order rice 5kg → Rice Vendor" — place an order
💸 "paid Rice Vendor ₹2400" — log a payment
💳 "credit Rice Vendor rice 50kg ₹4500" — log credit

Or just wait for my 8am prep sheet!
```

---

### Specific Fallback Cases

| Situation | Bot Behaviour |
|-----------|--------------|
| Message during active state that doesn't match expected reply | Bot re-prompts Sam with what it needs |
| Claude API timeout (>10 seconds) | Bot replies "Sorry, something went wrong. Try again in a minute." State unchanged. |
| Claude API returns non-JSON | Strip markdown fences, retry parse once. If still fails: fallback reply. |
| Supabase connection failure | Bot replies "Sorry, can't reach the database right now. Try in a minute." Log error. |
| Twilio message send failure | Retry once after 2 seconds. If still fails, log to backend. No further retry. |
| Sam sends image (not voice note) | "I can only read text and voice notes — images don't work here, sorry!" |
| Sam sends a sticker | Silently ignore (do not reply). |
| Sam sends a location | "Thanks, but I can't use location messages yet!" |
| Sam asks the bot a general question (e.g. "what's a good price for rice") | Use fallback — bot doesn't answer general knowledge questions |

---

### Re-Prompt Logic (Active State)

If Sam is in `awaiting_wastage` and sends something the bot can't parse as wastage:

```
I'm waiting for tonight's leftovers. 
Just tell me what's remaining, like:
"biryani 3, fish curry 6, chai nil"

Or say "nothing left" if everything sold.
```

Same pattern for other states — always re-state what the bot is waiting for in simple terms.

---

### Stale State Reset

If Sam's `bot_state.updated_at` is > 6 hours old and state is not `idle`:

```javascript
// Reset state, then process incoming message as if idle
await supabase.from('bot_state').update({ 
  current_state: 'idle', 
  context_json: null 
}).eq('phone_number', phoneNumber)
```

No message is sent to Sam about the state reset. The bot simply processes her new message fresh.

---

## 18. Scheduled Job Summary

All cron jobs use `node-cron`. Times in UTC to avoid IST drift issues.

| Job | node-cron expression | IST Time | Days | Action |
|-----|---------------------|----------|------|--------|
| Morning prep sheet | `0 2 * * 2-7` | 8:00 AM | Tue–Sun | Generate + send prep sheet, set state `awaiting_prep_confirm` |
| Prep sheet follow-up | `45 3 * * 2-7` | 9:15 AM | Tue–Sun | Send reminder IF state still `awaiting_prep_confirm` |
| Prep sheet auto-confirm | `0 4 * * 2-7` | 9:30 AM | Tue–Sun | Auto-confirm IF state still `awaiting_prep_confirm` |
| Evening check-in | `30 13 * * 2-0` | 7:00 PM | Tue–Sun | Send check-in prompt, set state `awaiting_evening_checkin` |
| Wastage prompt | `30 16 * * 2-0` | 10:00 PM | Tue–Sun | Send wastage prompt, set state `awaiting_wastage` |
| Wastage auto-proceed | `45 16 * * 2-0` | 10:15 PM | Tue–Sun | If no wastage logged, send vendor order anyway (prediction-only) |
| Weekly summary | `30 15 * * 0` | 9:00 PM | Sunday | Generate + send weekly summary |
| Google Sheets sync | `30 17 * * *` | 11:00 PM | Daily | Push daily data to Google Sheets |
| Server keep-alive ping | `*/14 * * * *` | Every 14 min | Daily | GET /health (prevents Render free-tier sleep) |

> **Cron external trigger:** Render free-tier spins down after 15 minutes of inactivity. Use [cron-job.org](https://cron-job.org) to ping `GET /health` every 14 minutes so the server is awake before scheduled jobs fire. The job itself uses `node-cron` (internal) not cron-job.org.

---

## 19. Error State Reference

| Error Code | When It Occurs | Bot Reply | Recovery |
|------------|---------------|-----------|----------|
| `CLAUDE_TIMEOUT` | Claude API >10s | "Something went wrong — try again in a minute." | State unchanged, Sam retries |
| `CLAUDE_PARSE_FAIL` | Claude returns non-JSON | Strip fences, retry once. If still fails: ask Sam to rephrase | State unchanged |
| `SUPABASE_WRITE_FAIL` | DB insert/update fails | "Can't save that right now — try in a minute." | Log error, state unchanged |
| `SUPABASE_READ_FAIL` | DB select fails | "Can't fetch that right now — try in a minute." | Log error |
| `TWILIO_SEND_FAIL` | Message send fails | Retry once after 2s. Log if still fails. | No further retry |
| `AUDIO_DOWNLOAD_FAIL` | MediaUrl0 fetch fails | "Couldn't download your voice note. Try sending again or type it out." | State remains `awaiting_evening_checkin` |
| `AUDIO_FORMAT_ERROR` | Unsupported audio format | Same as download fail | Same as download fail |
| `OPEN_METEO_FAIL` | Weather API unreachable | Proceed without weather line in prep sheet | Neutral multipliers used |
| `NO_PREDICTIONS` | Prediction generation fails | Prep sheet sent with `seed_qty` fallback values | Log error |
| `VENDOR_NOT_FOUND` | Vendor name not in contacts | Create new vendor entry, note in reply | Order continues normally |
| `DUPLICATE_WEBHOOK` | Twilio re-delivers same MessageSid | Return 200 empty TwiML, process nothing | Silently handled |
| `UNKNOWN_SENDER` | Non-Sam phone number | Silently ignore | No reply sent |

---

*End of CafeOS WhatsApp Bot Command Specification v1.0*
