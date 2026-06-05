# CafeOS — Product Requirements Document

**Version:** 1.0  
**Date:** June 2026  
**Client:** Sam's Cafe, Vasco da Gama, Goa  
**Authors:** Yashita Loya + [Co-developer]  
**Submission Context:** OkCredit Future Founders Finternship 2025  
**Status:** Ready for development

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [User Personas](#2-user-personas)
3. [System Overview](#3-system-overview)
4. [Feature Specifications with Acceptance Criteria](#4-feature-specifications)
   - 4A. WhatsApp Bot (Owner-Facing)
   - 4B. Web App — Staff Portal
   - 4C. Web App — Owner Portal
   - 4D. Intelligence Layer
5. [Out of Scope](#5-out-of-scope)
6. [Success Metrics](#6-success-metrics)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Open Questions — Decisions Still Unmade](#8-open-questions)

---

## 1. Problem Statement

Sam runs a small cafe in Vasco da Gama, Goa — alone, by memory, on paper. She has no system for tracking what she sells, what she spends, or how much she wastes. Every business decision — how much biryani to cook, whether to call a vendor, whether today was profitable — is made from instinct.

The consequences are direct and documented:

**No order tracking.** Every customer order is written by hand. There is no end-of-day count, no weekly report, no visibility into which items sell and which don't. Revenue is estimated, not known.

**Monthly margin blindness.** Cash outflow is totalled once a month, sometimes later. Sam does not know, in real time, whether today's cafe made money. The only signal is how much cash is in the box.

**Festival blind spots.** Goa has a dense local calendar — Carnival, Sao Joao, Christmas, Diwali — each of which drives measurable demand spikes. Sam has no advance warning system. She finds out Carnival is busy because she runs out of food.

**Spot procurement premium.** When Sam runs out of an ingredient mid-week, she calls her vendor for emergency delivery. This always costs more. It happens because there is no inventory prediction, so reorder decisions are reactive, not planned.

**Electricity and spoilage.** Vasco experiences frequent power cuts, especially in the pre-monsoon period (April–June). When Sam hasn't been warned, she preps full perishables anyway. When power goes, they spoil.

**No vendor credit.** Sam buys from vendors on credit informally, but the record-keeping is unreliable. Vendor books and Sam's memory rarely match. This makes it impossible to settle credit cleanly or build a trusted credit history with suppliers.

**Memory-dependent operations.** Every piece of institutional knowledge — which dishes work on rainy days, which vendor delivers late, which items to reduce before Monday closure — lives in Sam's head alone. If she is absent or incapacitated, operations stop.

**Staff instability.** Sam's cafe has high staff turnover. Any system that requires training, installation, or learning time will not survive a staff change. The system must work the day a new person joins.

**The result:** Sam is working harder than she needs to, losing money she shouldn't be losing, and has no accurate picture of her own business.

CafeOS is the answer to this. It does not ask Sam to change how she works. It meets her exactly where she is — on WhatsApp — and wraps a complete operations layer around her existing behaviour.

---

## 2. User Personas

### Sam — The Owner

Sam is a woman in her 40s running a small, self-operated cafe in Vasco da Gama. She is not technical. She owns an Android phone and uses WhatsApp every day, but she does not install new apps, does not trust complex software, and has no patience for things that break or require explanation. She manages vendors, staff, procurement, and cooking herself. Her workday starts before 8am and ends after 10pm. She is the decision-maker, the buyer, the chef, and the manager simultaneously. She communicates in a mix of English, Hindi, and Konkani — sometimes in the same sentence. She is sharp about her business but has no formal tools to support her instincts. CafeOS must fit inside her existing WhatsApp habits. She should never need to log into a separate dashboard, open a new app, or remember a password. If something requires explanation, it has failed the design test.

### Staff — The Order-Taker

Sam's staff is typically one or two people helping during service hours. They take orders from customers, manage the counter, and handle cash and UPI payments. Staff turnover is high — a new person might join with no notice. They own Android phones with basic internet access. They are comfortable with apps at a consumer level (WhatsApp, Paytm, Swiggy), but they cannot be expected to remember complex flows, multi-step processes, or admin logic. The staff app must be learnable in under five minutes without any formal training. Staff should not be able to change prices, view financial data, or access owner-level settings. Their job in the app is: open it, take an order, mark how it was paid, generate a bill. That is all.

### Vendor — The Supplier

Vendors are the people Sam orders raw materials from — rice, dal, vegetables, meat, oil. They receive orders via WhatsApp forward. They are not users of CafeOS. They do not interact with the system directly. The system needs to produce messages that look like they came from Sam personally — natural, conversational, in plain language. The vendor should not know or care that a system generated the message. Sam needs to be able to forward a pre-written message to a vendor in two taps. The vendor's side of the transaction is: receive a WhatsApp message, deliver the goods, eventually get paid. CafeOS tracks the credit ledger on Sam's side; the vendor only ever sees WhatsApp messages.

---

## 3. System Overview

CafeOS is two user-facing systems sharing one backend.

```
[OWNER] ←→ [WHATSAPP BOT] ←──────────────────┐
                                               │
                                    [NODE.JS + EXPRESS BACKEND]
                                    [SUPABASE (PostgreSQL)]
                                               │
[STAFF]  ←→ [REACT PWA WEB APP] ←─────────────┘
[OWNER]  ←→ [REACT PWA WEB APP — OWNER PORTAL]
```

**WhatsApp Bot:** Owner-only. Runs on Twilio WhatsApp API. Handles all of Sam's interactions — morning prep, vendor ordering, mid-day summaries, evening check-in, nightly wastage logging, and weekly digest. Owner never downloads anything.

**React PWA Web App:** Staff and owner-facing. Two portals behind different auth. Staff portal: take orders, mark attendance. Owner portal: manage menu, manage staff, view reports. Works offline; queues orders in IndexedDB and syncs to Supabase when internet returns.

**Shared Backend:** Node.js + Express. Single API server. Handles webhooks from Twilio, requests from the web app, and all database operations. Calls Claude API for NLP on voice notes. Calls Open-Meteo for weather. Runs scheduled jobs for morning prep sheet and evening prompts.

**Intelligence Layer:** Not a separate service — a module inside the backend. Runs predictions using sales history, wastage logs, weather data, power cut alerts, and Goa festival calendar. No external ML service. Pure statistical logic in Node.js.

**Google Sheets Sync:** A Supabase → Google Sheets pipeline gives Sam a read-only spreadsheet view of her business data in a format she already understands.

---

## 4. Feature Specifications

---

### 4A. WhatsApp Bot (Owner-Facing)

All bot interactions happen on a single dedicated Twilio WhatsApp number. Sam has this number saved as "CafeOS" or "My Cafe Bot" in her contacts. She never calls it. All interaction is message-based. The bot speaks in plain, warm English — short sentences, no jargon. Numbers and rupee amounts are always formatted clearly (₹1,500 not 1500).

---

#### FEATURE B-01: Morning Prep Sheet

**Description:** Every morning at 8:00 AM, the bot automatically sends Sam a recommended prep list for the day — how many portions of each menu item to prepare. This is driven by the intelligence layer (see Section 4D).

**Trigger:** Scheduled job runs at 7:55 AM IST daily, except Mondays (Sam's cafe is closed). Generates predictions for all active menu items. Sends to Sam's WhatsApp at 8:00 AM sharp.

**Message format:**
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

**Weather line:** Only included if weather is meaningfully relevant (rain, unusual heat, predicted storm). Not included on neutral weather days. Weather pulled from Open-Meteo API at prep sheet generation time using Vasco da Gama coordinates (lat: 15.3961, lon: 73.8173).

**Festival/event line:** If a festival flag is active (see Feature B-08), append one line: "Sao Joao this week — expect higher footfall than usual."

**Owner Response — Approve (Reply "1"):**
- System logs confirmation. Prediction record for the day is marked "confirmed."
- Bot replies: "Got it! Today's prep locked in ✓"
- No further action needed from Sam.

**Owner Response — Edit (free text):**
- Sam can type natural language: "biryani 25, skip fish curry today" or "make biryani 25 and fish curry 10"
- Claude API parses this. System prompt instructs Claude to extract: item name → adjusted quantity. Claude returns structured JSON: `[{"item": "biryani", "qty": 25}, {"item": "fish_curry", "qty": 0}]`
- Backend updates the day's prediction record with Sam's overrides.
- Bot replies with a confirmation listing the updated quantities.
- These overrides are stored as feedback signals in the `predictions` table and inform future predictions.

**Owner Response — No reply:**
- If Sam does not reply by 9:30 AM, system auto-confirms the prep sheet as-is.
- Bot sends one gentle follow-up at 9:15 AM: "Hi Sam! Just checking — did you see today's prep sheet? Reply 1 to confirm or tell me your changes."

**Acceptance Criteria:**
- [ ] Message arrives at 8:00 AM IST ±2 minutes, every day except Monday.
- [ ] All active menu items are listed with a predicted quantity ≥ 1.
- [ ] Weather line appears if and only if it is raining, unusually hot (>35°C), or a storm warning exists.
- [ ] Festival line appears if and only if a festival flag is active within the next 5 days.
- [ ] Reply "1" confirms and logs correctly.
- [ ] Free-text edits are parsed by Claude, quantities updated, confirmation sent.
- [ ] If no response by 9:30 AM, prediction auto-confirmed and logged.
- [ ] On Mondays, no message is sent.
- [ ] Failed API calls (Open-Meteo down, Claude API error) do not prevent the prep sheet from sending — system falls back to prediction without weather/NLP.

---

#### FEATURE B-02: Vendor Order Logging

**Description:** Sam can log a vendor order via WhatsApp. The bot parses the order, formats it as a ready-to-forward message, and saves it to the procurement table. Sam then forwards the formatted message to her vendor via WhatsApp herself.

**Command format Sam uses:**
```
order rice 5kg, dal 3kg, oil 2kg → Rice Vendor
```
OR (without vendor name, which triggers a prompt):
```
order rice 5kg, dal 3kg
```

**Parsing:** Claude API parses Sam's message to extract:
- List of items with quantities and units
- Vendor name (if present after `→`)
- If vendor name absent, bot responds: "Who should this go to? Reply with the vendor name."

**Bot response — order confirmed:**
```
Logged ✓

Ready to send to Rice Vendor:

"Rice 5kg, Dal 3kg, Oil 2kg — please deliver tomorrow morning."

Forward this message to place the order.
```

The quoted message is a clean, copy-paste-ready natural language message. It says "tomorrow morning" unless Sam specifies a different delivery date in her original message (e.g. "order rice 5kg for Thursday" → the message says "please deliver by Thursday").

**Optional price input:** Sam can optionally add prices inline:
```
order rice 5kg @₹45/kg, dal 3kg @₹90/kg → Rice Vendor
```
If prices are included, they are logged in the procurement record for financial tracking. If absent, price fields remain null in the database.

**Database write:** One record written to `procurement` table with: vendor_name, items_json, total_cost (if prices given, else null), delivery_date, timestamp.

**Acceptance Criteria:**
- [ ] Sam can place an order in one message including items, quantities, units, and vendor name.
- [ ] Bot produces a formatted, natural-language message ready to forward.
- [ ] Formatted message is in quotes so Sam can copy it cleanly.
- [ ] If vendor name is missing, bot prompts for it before confirming.
- [ ] Optional prices: if included, logged; if absent, order still logs successfully.
- [ ] Procurement record written to database with correct data.
- [ ] Works for orders with 1 to 10 items in a single message.
- [ ] If Claude API fails to parse, bot responds: "I didn't quite get that — try: order [items] → [vendor name]" and does not write a broken record.

---

#### FEATURE B-03: Mid-Day Summary (On-Demand)

**Description:** Sam can request a real-time business snapshot at any point during the day by sending a single word.

**Trigger:** Sam sends `summary` (case-insensitive, works with "Summary", "SUMMARY").

**Bot response format:**
```
Today so far ☕

Sales: ₹2,400
Expenses logged: ₹890
Net: ₹1,510

Orders: 34
Top item: Biryani (18 sold)

Last updated: 2:14 PM
```

**Sales figure:** Sum of all orders in `orders` table for today (by timestamp, IST). Includes both cash and UPI.

**Expenses figure:** Sum of all procurement records for today with prices logged.

**Net:** Sales minus Expenses. If expenses are null (no prices logged today), net is not shown; instead: "Net: — (no expenses logged today)"

**Orders count:** Count of all orders today.

**Top item:** The `menu_item_id` with the highest total `quantity` sold across `order_items` for today.

**Acceptance Criteria:**
- [ ] Responds within 5 seconds of receiving `summary`.
- [ ] Figures are accurate to the last completed order.
- [ ] If no orders have been placed today, bot responds: "No orders logged yet today."
- [ ] Net is suppressed (not shown as ₹0) if no expenses are recorded.
- [ ] Works at any time of day.

---

#### FEATURE B-04: Evening Check-In

**Description:** At 7:00 PM, the bot sends Sam an automated prompt asking how the day went. Sam can respond with text or a voice note. The response is parsed by Claude API to extract structured operational signals.

**Trigger:** Scheduled job at 7:00 PM IST, daily except Monday.

**Bot message:**
```
Hi Sam! How did today go? 🌇

Anything to flag — stockouts, big groups, equipment trouble, 
power cuts, or anything else worth remembering for tomorrow?
```

**Owner response types:**

*Text response:* Free-form text, any language (English, Hindi, Konkani).

*Voice note:* Twilio provides the audio file URL. Backend downloads the audio. Sends to Claude API with transcription instruction. Claude transcribes and extracts signals in one call.

**Claude API call for check-in parsing:**

System prompt instructs Claude to extract the following structured signals from the transcription or text:
- `stockouts`: list of items that ran out, approximate time if mentioned
- `demand_spike`: description of unusual high-volume events (large group, office order, event nearby)
- `power_disruption`: duration and approximate time if mentioned
- `weather_impact`: whether weather was noted as affecting footfall
- `other_notes`: freeform field for anything that doesn't fit above categories

Claude returns JSON. Example:
```json
{
  "stockouts": [{"item": "biryani", "time": "12:30"}],
  "demand_spike": "large office group, possibly recurring",
  "power_disruption": {"time": "18:00", "duration_hours": 2},
  "weather_impact": null,
  "other_notes": null
}
```

**Database write:** One record written to `checkins` table: raw_text (transcription or direct text), parsed_signals_json, date.

**Bot reply after parsing:**
```
Got it, noted for tomorrow ✓

• Biryani ran out around 12:30 — I'll suggest more tomorrow
• Power cut logged for ~6pm, 2 hours
• Office group noted — watching for pattern
```

Bot lists back only what it understood, so Sam can catch parsing errors.

**If Sam doesn't respond to the evening check-in:** Bot does not follow up. Check-in record is logged as null for that day.

**Acceptance Criteria:**
- [ ] Evening prompt sent at 7:00 PM IST daily, except Monday.
- [ ] Both text and voice note responses are handled.
- [ ] Voice note transcription via Claude API produces correct text (test with English, Hindi, Konkani samples).
- [ ] Structured signals extracted correctly for: stockouts, demand spikes, power cuts, weather impact.
- [ ] All extracted signals are stored in `checkins.parsed_signals_json`.
- [ ] Bot's summary reply accurately reflects what was parsed.
- [ ] If Sam sends gibberish or an unrelated message, bot replies graciously: "Thanks Sam! I'll note today as normal. Anything else?"
- [ ] Claude API failure: fallback stores raw text only; bot replies "Got it Sam, I saved your note."

---

#### FEATURE B-05: Nightly Wastage Log

**Description:** After closing time, at 10:00 PM, bot asks Sam for leftover quantities. Sam types what's left. System logs wastage and updates the prediction model for the next day.

**Trigger:** Scheduled job at 10:00 PM IST daily, except Monday.

**Bot message:**
```
Day's done! What's left over? 🧹

Just tell me what's remaining, e.g.:
"biryani 3, fish curry 6, chai fine, dal nil"
```

**Sam's response format (flexible):**
- `biryani 3, fish curry 6` — explicit quantities
- `biryani nil, chai fine` — nil means 0; "fine" or "ok" means negligible/none
- `everything fine except fish curry 8` — Claude parses natural language
- Numbers in Hindi/Konkani (e.g. "teen" for 3) — Claude API handles multilingual

**Parsing:** Claude API extracts structured list: `[{"item": "biryani", "qty_left": 3}, {"item": "fish_curry", "qty_left": 6}]`

Items not mentioned are treated as: not logged (null), not zero.

**Database write:** Records written to `wastage` table: item_name, quantity_left, logged_at (date).

**Bot response:**
```
Wastage logged ✓

Adjusting tomorrow's suggestions:
• Fish Curry: suggesting 8 tomorrow (was 14, 6 left today)
• Biryani: small adjustment, suggesting 18 tomorrow

Ready for tomorrow's vendor order?
Rice 4kg, Vegetables 2kg, Chicken 800g

Reply 1 to approve and I'll generate the message
Reply 2 to edit quantities
```

The vendor order suggested here is based on the prediction model's recommendation for the next day's procurement. Approval flow follows Feature B-06.

**Acceptance Criteria:**
- [ ] Wastage prompt sent at 10:00 PM IST, daily except Monday.
- [ ] Sam can respond in free-form text or multilingual.
- [ ] Claude API parses quantities correctly.
- [ ] Wastage records written per item to `wastage` table.
- [ ] Prediction model recalculates next-day quantities immediately after wastage is logged.
- [ ] Bot shows updated predictions clearly, item by item.
- [ ] Bot transitions directly to vendor order approval (Feature B-06).
- [ ] If Sam doesn't respond, system logs no wastage for that day (null entries, not zero).

---

#### FEATURE B-06: Next-Day Vendor Order Approval

**Description:** After the wastage log (Feature B-05), the bot presents the predicted procurement order for the next day. Sam approves or edits it. Approved orders are formatted for forwarding.

**This feature is triggered by:** Completion of wastage log flow (Feature B-05).

**Bot message (continuation of wastage log flow):**
```
Ready for tomorrow's vendor order?

📦 Rice Vendor:
Rice 4kg, Dal 2kg, Oil 1.5L

🥩 Meat Vendor:
Chicken 800g, Fish 1kg

Reply 1 to approve
Reply 2 to edit
```

Orders are grouped by vendor name (from `vendor_contacts` table). Each group becomes a separate forwardable message.

**Reply "1" — Approve:**
Bot sends one formatted message per vendor group:
```
Ready to forward to Rice Vendor:

"Rice 4kg, Dal 2kg, Oil 1.5L — please deliver tomorrow morning."

---

Ready to forward to Meat Vendor:

"Chicken 800g, Fish 1kg — please deliver tomorrow morning."
```

Sam manually forwards each quoted message to the respective vendor on WhatsApp. System marks procurement records as "generated" (not yet confirmed delivered).

**Reply "2" — Edit:**
Bot enters edit mode:
```
What would you like to change?
(e.g. "rice 5kg, skip oil" or "no meat order today")
```
Sam types edits. Claude parses. Bot shows updated order. Sam replies "1" to confirm.

**Database write:** One record per vendor written to `procurement` table with items_json, vendor_name, status: "pending_delivery".

**Acceptance Criteria:**
- [ ] Vendor order is grouped by vendor name, one group per vendor.
- [ ] Each vendor group produces one independent forwardable message.
- [ ] Reply "1" confirms all groups and produces formatted messages.
- [ ] Reply "2" opens edit mode; edits parsed by Claude; confirmation required before writing.
- [ ] Procurement records written with correct vendor grouping.
- [ ] Items not needing reorder (sufficient stock) are not included unless Sam adds them.
- [ ] System handles "no order today" gracefully: bot replies "Got it, no vendor order tonight ✓"

---

#### FEATURE B-07: Vendor Payment and Credit Logging

**Description:** Sam can log vendor payments and credit entries via WhatsApp. This maintains a real-time vendor credit ledger.

**Commands:**

`paid Rice Vendor ₹2400`
→ Logs a payment of ₹2400 to Rice Vendor.

`credit Rice Vendor rice 50kg ₹4500`
→ Logs that Rice Vendor has extended credit: 50kg rice worth ₹4500, outstanding.

**Bot response for payment:**
```
Payment logged ✓
Rice Vendor: ₹2,400 paid on [date]

Outstanding balance with Rice Vendor: ₹800
```

**Bot response for credit:**
```
Credit logged ✓
Rice Vendor: ₹4,500 credit for rice (50kg)

Total outstanding with Rice Vendor: ₹5,300
```

**Balance calculation:** Outstanding = sum of all credit entries minus sum of all payment entries for that vendor, since the beginning of records.

**Database writes:** Records written to `vendor_credit` table: vendor_name, amount, type (credit/payment), item_description, timestamp, settled (boolean, false by default).

**Acceptance Criteria:**
- [ ] `paid [vendor] ₹[amount]` correctly logs a payment and returns updated outstanding.
- [ ] `credit [vendor] [item] ₹[amount]` correctly logs credit and returns updated outstanding.
- [ ] Outstanding balance is always shown after any ledger operation.
- [ ] If vendor name is not in `vendor_contacts`, system creates a new vendor entry.
- [ ] If balance reaches ₹0, bot confirms: "Rice Vendor balance is settled ✓"

---

#### FEATURE B-08: Festival and Event Flags

**Description:** The system maintains a hardcoded Goa festival calendar. In the 5 days before a major festival, the system adds a flag to the morning prep sheet and adjusts prediction multipliers.

**Hardcoded festival list (initial, expandable):**

| Festival | Typical Date Window | Demand Multiplier |
|---|---|---|
| New Year | Dec 31 – Jan 2 | +35% |
| Carnival | Feb (varies, 3 days before Lent) | +30% |
| Holi | March (varies) | +20% |
| Sao Joao | June 24 | +25% (local surge) |
| Independence Day | Aug 15 | +15% |
| Ganesh Chaturthi | Aug–Sep (varies) | +20% |
| Diwali | Oct–Nov (varies) | +20% |
| Christmas | Dec 25 | +40% |

Festival dates that vary year-to-year (Carnival, Holi, Ganesh Chaturthi, Diwali) must be hardcoded per year in a config file, not auto-calculated. This is an acceptable maintenance overhead given the 8-week scope.

**5-day early warning:** When today's date falls within 5 days of a festival start date, festival flag is set to `active` for that festival.

**Morning prep sheet integration:** When flag is active, the prep sheet appends: "Christmas is in 3 days — expect higher footfall. I've increased today's suggestions by 35%."

**Acceptance Criteria:**
- [ ] All 8 festivals are in the config with date ranges and multipliers.
- [ ] 5-day early warning activates correctly.
- [ ] Multiplier is applied to all item predictions during the active window.
- [ ] Warning line in prep sheet accurately states the festival name and days remaining.
- [ ] Sam can manually flag an event: `event tomorrow big football match` → bot adds a one-time multiplier for that date. Stored in `predictions` table as manual_flag.

---

#### FEATURE B-09: Weekly Sunday Summary

**Description:** Every Sunday at 9:00 PM, the bot sends Sam a 5-point weekly digest.

**Trigger:** Sunday, 9:00 PM IST. Only sends if at least 4 days of data exist for that week.

**Message format:**
```
This week at Sam's Cafe 🍽️

Best seller: Biryani (142 portions)
Most wastage: Fish Curry (avg 5 left/day)
Revenue vs last week: +12% ✓
Biggest day: Saturday (₹4,200)
This week's margin: ~34%

One suggestion: Making 4 fewer Fish Curry on weekdays 
could save ~₹560/week in wastage.

Well done this week! 🙌
```

**Computation:**
- Best seller: item with highest total quantity sold (from `order_items` + `orders`, this week)
- Most wastage: item with highest average `quantity_left` from `wastage` table this week
- Revenue comparison: this week's total sales vs previous week's total sales, percentage change
- Biggest day: day of week with highest single-day revenue
- Margin: (total sales - total procurement cost) / total sales × 100. Only calculated if procurement prices are logged for ≥3 days. If not enough data: "Margin: Not enough price data this week"
- Suggestion: One actionable suggestion generated by Claude API from this week's data

**Acceptance Criteria:**
- [ ] Message sent every Sunday at 9:00 PM IST.
- [ ] Not sent if fewer than 4 days of order data exist for the week.
- [ ] All 5 metrics calculated correctly from database.
- [ ] Margin displayed as approximate (~xx%) because procurement data may be incomplete.
- [ ] Margin line not shown if procurement prices are missing for more than 2 days.
- [ ] Revenue comparison shows positive/negative correctly.
- [ ] Claude API generates one suggestion; if API fails, suggestion line is omitted.

---

### 4B. Web App — Staff Portal

The staff portal is a mobile-first React PWA. Accessible at a fixed URL (e.g. `cafeos.app` or `sams.cafeos.app`). No installation required — staff bookmarks the URL or adds to home screen. Staff authenticates with a 4-digit PIN.

---

#### FEATURE S-01: Staff Authentication (PIN Login)

**Description:** Staff logs in using a 4-digit PIN assigned by the owner via the Owner Portal.

**Flow:**
1. Staff opens the app URL.
2. App shows a single screen: "Enter your PIN" with 4 digit boxes.
3. Staff enters 4-digit PIN.
4. On correct PIN: authenticated, redirected to staff home screen.
5. On incorrect PIN (3 attempts): 5-minute lockout. Message: "Too many attempts. Try again in 5 minutes."

**Session:** Session token stored in `localStorage`. Session expires at midnight every day (staff must re-enter PIN each day). This is intentional — it prevents a lost phone from staying logged in indefinitely.

**No username.** PIN is the only credential. Multiple staff can share the same PIN if the owner assigns the same PIN to multiple staff members — however the owner can also assign unique PINs per staff to distinguish who logged what order.

**Acceptance Criteria:**
- [ ] PIN entry works on mobile keyboard (numeric input).
- [ ] 3 failed attempts triggers 5-minute lockout with visible countdown.
- [ ] Valid PIN creates session and redirects to home.
- [ ] Session expires at midnight.
- [ ] Staff cannot access any owner portal routes regardless of session state.

---

#### FEATURE S-02: New Order — Item Selection

**Description:** Staff creates a new customer order by tapping items from the current menu.

**Flow:**
1. Staff taps "New Order" on home screen.
2. Menu items displayed as a grid of tap targets. Each item shows: name, price.
3. Staff taps an item to add it. A quantity counter appears (+/−).
4. Staff can tap multiple items and adjust quantities.
5. Current order total shown at the bottom, updating live.
6. Staff taps "Review Order" when done.

**Menu data:** Pulled from `menu_items` table, filtered `active = true`. Displayed as-is. Staff cannot modify prices.

**Categories:** If menu items have a `category` field set, they are grouped by category (e.g. "Mains", "Drinks", "Snacks") with a horizontal scroll tab or visible grouping. If no categories are set, items are displayed in a flat list sorted alphabetically.

**Search:** A text search field at the top of the menu screen filters items by name in real time. For a menu of up to 30 items this is sufficient.

**Acceptance Criteria:**
- [ ] All active menu items displayed correctly with name and price.
- [ ] Tapping an item adds 1 quantity; tapping again increments.
- [ ] − button decrements; when quantity reaches 0, item is removed from order.
- [ ] Order total calculates correctly (sum of unit_price × quantity for all selected items).
- [ ] Category grouping displayed if categories exist.
- [ ] Search filters items in real time, case-insensitive.
- [ ] Staff cannot add inactive (deactivated) menu items.

---

#### FEATURE S-03: New Order — Order Type and Payment

**Description:** After item selection, staff confirms order type (Dine In / Takeaway) and payment method (Cash / UPI / Pending).

**Screen:** Review screen showing:
- Itemised list: item name, quantity, subtotal per item
- Order total
- Two toggle buttons: "Dine In" / "Takeaway" (one must be selected, Dine In is default)
- Three toggle buttons: "Cash" / "UPI" / "Pending" (one must be selected, Cash is default)
- "Confirm Order" button

**"Pending" payment:** For credit/tab cases where customer hasn't paid yet. Logged as pending in `orders.payment_method`. Owner can view pending orders in the owner portal. Staff app does not handle reconciliation of pending payments.

**Acceptance Criteria:**
- [ ] Review screen shows full order summary before confirmation.
- [ ] Order type defaults to Dine In; staff can change to Takeaway.
- [ ] Payment method defaults to Cash; staff can change to UPI or Pending.
- [ ] "Confirm Order" not tappable until both order type and payment method are set.
- [ ] Tapping "Confirm Order" writes the order to database and triggers bill generation.

---

#### FEATURE S-04: Bill Generation and Display

**Description:** After confirming an order, the bill is displayed on screen. Staff can share it via WhatsApp if the customer wants a copy.

**Bill screen contains:**
- Cafe name: "Sam's Cafe"
- Date and time
- Order number (auto-incremented daily, e.g. #34)
- Itemised list: item name, quantity, unit price, subtotal
- Order type: Dine In / Takeaway
- Total amount
- Payment method
- "Share via WhatsApp" button
- "New Order" button (returns to order screen)

**WhatsApp share:** Tapping "Share via WhatsApp" opens WhatsApp with a pre-filled text message containing the bill details formatted as plain text. Staff hands phone to customer or reads the number from Sam's device. This uses the native `window.open('whatsapp://send?text=...')` or `https://wa.me/?text=...` approach — no API call needed.

**Bill number:** Increments from 1 each day. If it's a new day, counter resets. Format: `#001`, `#002`, etc.

**Acceptance Criteria:**
- [ ] Bill displays immediately after order confirmation with no loading delay.
- [ ] Bill contains all required fields (see above).
- [ ] Order number increments correctly within the day.
- [ ] "Share via WhatsApp" opens WhatsApp with pre-filled text bill.
- [ ] "New Order" returns to blank order screen, ready for next customer.
- [ ] Bill is readable on a small mobile screen (min 320px width).

---

#### FEATURE S-05: Offline Order Queueing

**Description:** If the device loses internet connectivity mid-order, orders are saved locally in IndexedDB and synced to Supabase when connectivity returns.

**Detection:** App uses `navigator.onLine` and a `window.addEventListener('online'/'offline')` to detect connectivity state.

**Offline behaviour:**
- Staff can complete and confirm orders as normal.
- Order is written to IndexedDB with a local UUID and `synced: false` flag.
- Bill is generated from local data and displayed as normal.
- A persistent banner appears at top of app: "📶 Offline — 2 orders pending sync"

**Sync on reconnect:**
- When `online` event fires, app iterates IndexedDB for all records with `synced: false`.
- Each record is POSTed to the backend sync endpoint.
- On success: record marked `synced: true` in IndexedDB.
- Banner clears when all pending records are synced.
- If backend is not reachable despite `navigator.onLine = true` (e.g. DNS failure), retry with exponential backoff up to 5 attempts.

**Conflict handling:** Each offline order has a local UUID. Backend checks for duplicate UUIDs on sync to prevent double-write.

**Acceptance Criteria:**
- [ ] App detects offline status and shows banner immediately.
- [ ] Staff can complete and confirm orders with no error messages when offline.
- [ ] Offline orders generate correct bills from local data.
- [ ] On reconnect, all queued orders sync automatically without staff action.
- [ ] Banner shows accurate count of pending orders.
- [ ] Banner clears when sync completes.
- [ ] Duplicate sync protection: same order cannot be written to Supabase twice.
- [ ] Orders synced correctly include all fields: items, quantities, prices, order type, payment method, staff_id, timestamp.

---

#### FEATURE S-06: Staff Attendance Check-In

**Description:** Staff taps "Check In" when they arrive. System logs their arrival time.

**Flow:**
1. Staff opens app.
2. Home screen shows: "Check In" button (if not yet checked in today).
3. Staff taps "Check In" → timestamp logged.
4. If check-in is after 10:00 AM, app shows: "Note a reason? (optional)" with a text field.
5. Staff can enter a reason or skip.
6. Home screen updates to show: "Checked in at 9:22 AM ✓"

**Late threshold:** 10:00 AM. This is configurable by the owner via Owner Portal settings.

**No check-out:** Check-out is not tracked in Phase I. Only arrival is logged.

**Acceptance Criteria:**
- [ ] Check-in button visible on home screen before check-in each day.
- [ ] Tapping logs timestamp accurately.
- [ ] Late reason prompt triggered for arrivals after 10:00 AM.
- [ ] Late reason is optional — staff can skip.
- [ ] Home screen confirms check-in with time.
- [ ] Staff cannot check in twice in the same day (button disappears after check-in).

---

### 4C. Web App — Owner Portal

The owner portal is a separate section of the same React PWA, protected by email + password authentication (Supabase Auth). The owner accesses it at the same URL, choosing "Owner Login" on the login screen.

---

#### FEATURE O-01: Owner Authentication

**Description:** Owner logs in with email and password via Supabase Auth.

**Flow:**
1. Owner opens app URL.
2. Taps "Owner Login" (separate from staff PIN entry).
3. Email and password fields.
4. On success: redirected to Owner Dashboard.
5. Session persists for 7 days (Supabase JWT default).

**Only one owner account.** There is no "create account" flow in the app — the owner account is provisioned manually at setup by the developers. Password reset is available via Supabase's default email reset flow.

**Acceptance Criteria:**
- [ ] Owner can log in with correct email/password.
- [ ] Incorrect credentials show error message: "Wrong email or password."
- [ ] Owner session persists for 7 days.
- [ ] Owner portal routes are completely inaccessible to staff sessions.
- [ ] Supabase Row Level Security enforces that owner-only data is not accessible via staff session tokens.

---

#### FEATURE O-02: Menu Management

**Description:** Owner can add, edit, deactivate, and reactivate menu items and their prices. Changes take effect immediately on the staff app.

**Menu management screen shows:**
- List of all menu items (active and inactive) with: name, price, category, status toggle
- "Add Item" button
- Each item has an "Edit" button

**Add Item flow:**
- Form with: Item name (required), Price in ₹ (required), Category (optional text field, e.g. "Mains", "Drinks"), Active toggle (default: active)
- Save → written to `menu_items` table → visible on staff app immediately

**Edit Item flow:**
- Same form pre-filled with current values.
- Owner can change name, price, category, or active status.
- Save → updates `menu_items` record.

**Deactivate vs Delete:** Items are never hard-deleted (they appear in historical orders). "Deactivate" sets `active = false` — item disappears from staff menu but all historical order data is preserved.

**Price changes:** Effective immediately for new orders. Historical orders retain the `unit_price` stored at order time in `order_items.unit_price` — prices are snapshotted per order, not referenced dynamically.

**Acceptance Criteria:**
- [ ] Owner can add a new menu item with name, price, and optional category.
- [ ] New item appears on staff menu within 30 seconds (next menu load).
- [ ] Owner can edit price; new price applies to all new orders immediately.
- [ ] Owner can deactivate an item; it disappears from staff menu.
- [ ] Owner can reactivate a deactivated item; it reappears on staff menu.
- [ ] Deactivated items still appear in historical reports.
- [ ] Price field only accepts positive numbers. Name field is required.

---

#### FEATURE O-03: Staff Profile Management

**Description:** Owner can add staff members, assign PINs, and deactivate staff profiles.

**Staff management screen shows:**
- List of all staff with: name, PIN, status (active/inactive), last check-in date
- "Add Staff" button
- Each staff member has an "Edit" and "Deactivate" button

**Add Staff flow:**
- Form with: First name (required), PIN (4 digits, required, must be unique), Role (optional text, e.g. "Counter Staff")
- PIN uniqueness checked on save.
- Save → written to `staff` table with bcrypt-hashed PIN.

**PIN storage:** PINs are stored as bcrypt hashes. The owner sees the PIN in plaintext only at creation time. There is no "view PIN" feature after creation. If a staff member forgets their PIN, the owner must set a new one.

**Deactivate:** Sets `active = false`. Staff member can no longer log in. Historical orders logged by that staff member are preserved.

**Acceptance Criteria:**
- [ ] Owner can add staff with name and PIN.
- [ ] Duplicate PINs rejected with message: "This PIN is already in use. Choose another."
- [ ] PINs stored as bcrypt hashes, never in plaintext in database.
- [ ] Owner can deactivate a staff member; their PIN no longer grants access.
- [ ] Owner can edit a staff member's PIN.
- [ ] Deactivated staff orders preserved in historical records.

---

#### FEATURE O-04: Sales Reports and History

**Description:** Owner can view sales reports across any time period from the owner portal.

**Report screen:**
- Date range picker (default: today)
- Summary row: total orders, total revenue, total expenses (if prices logged), net margin
- Breakdown table: revenue by day
- Breakdown table: units sold by menu item
- Filter by: payment method (Cash / UPI / Pending)
- Filter by: order type (Dine In / Takeaway)

**Data source:** All data from `orders` + `order_items` + `procurement`.

**Export:** Owner can tap "Export to Sheets" to manually trigger a Supabase → Google Sheets sync. This pushes the current date range's data to a pre-configured Google Sheet. (Automated sync also runs nightly — see Feature O-05.)

**Acceptance Criteria:**
- [ ] Default view shows today's data.
- [ ] Date range picker allows selecting any custom range.
- [ ] Revenue totals are accurate (match sum of order totals).
- [ ] Per-item units sold is accurate.
- [ ] Payment method and order type filters work correctly.
- [ ] "Export to Sheets" triggers sync and shows confirmation.

---

#### FEATURE O-05: Google Sheets Sync

**Description:** A nightly automated job syncs the day's data to a pre-configured Google Sheets spreadsheet. This gives Sam a familiar, readable view of her business.

**Sync schedule:** 11:00 PM IST, daily.

**What is synced:**
- Sheet 1 "Daily Summary": date, total_orders, total_revenue, total_expenses, net_margin (one row per day, appended)
- Sheet 2 "Item Sales": date, item_name, total_qty_sold (one row per item per day, appended)
- Sheet 3 "Wastage": date, item_name, quantity_left (from `wastage` table)
- Sheet 4 "Procurement": date, vendor_name, items, total_cost (from `procurement` table)

**Authentication:** Uses Google Sheets API with a service account. Service account credentials stored as environment variables on Render backend. The spreadsheet is pre-created and shared with the service account email.

**On sync failure:** Error logged to backend logs. No retry — next nightly sync will include the following day's data. Missing days are noted as "sync failed" in a backend log. No alert to Sam.

**Acceptance Criteria:**
- [ ] Sync runs at 11:00 PM IST nightly.
- [ ] All 4 sheets receive correct data.
- [ ] New rows are appended (not overwritten) each day.
- [ ] Manual "Export to Sheets" from owner portal triggers the same sync function on demand.
- [ ] Sync failure is logged but does not crash the backend.

---

#### FEATURE O-06: Vendor Contacts Management

**Description:** Owner manages the list of vendors and their WhatsApp numbers. This is used to correctly group vendor order messages.

**Vendor management screen:**
- List of vendors with: name, WhatsApp number, active status
- "Add Vendor" button

**Add Vendor form:** Name (required), WhatsApp number (required, with country code — default +91), Notes (optional, e.g. "delivers Mon/Wed/Fri only").

**Acceptance Criteria:**
- [ ] Owner can add a vendor with name and WhatsApp number.
- [ ] Vendor name in `vendor_contacts` must match exactly what Sam types in the bot (case-insensitive matching used in bot parsing).
- [ ] Owner can deactivate a vendor (they won't appear in procurement suggestions).
- [ ] WhatsApp number validated for format (10-digit Indian number or with +91 prefix).

---

#### FEATURE O-07: Attendance Log (Phase II)

**Description:** Owner can view staff attendance records by month.

**Screen:**
- Staff selector dropdown
- Month/year picker
- Calendar view showing: Present (green), Late (yellow), Absent (grey)
- Monthly summary: X days present, Y days late, Z days absent
- "Export" button — generates CSV

**Late threshold setting:** Owner can set the late threshold time (default 10:00 AM) from a settings screen.

**Salary computation (basic):** If owner has set a daily wage per staff member, the attendance log shows an estimated monthly salary = (days present × daily wage). This is advisory only, not integrated with any payment system.

**Acceptance Criteria (Phase II):**
- [ ] Attendance log accurate based on `attendance` table.
- [ ] Calendar correctly marks Present, Late, Absent.
- [ ] Late determined by threshold set in settings.
- [ ] CSV export works.
- [ ] Salary estimate shown if daily wage is set for the staff member.

---

### 4D. Intelligence Layer

The intelligence layer is a Node.js module (`/src/intelligence/`) called by the backend. It is not a separate service. It is not an ML model. It is deterministic statistical logic.

---

#### FEATURE I-01: Day-of-Week Baseline

**Description:** For each menu item, the system maintains a per-day-of-week average quantity sold. This is the foundation of all predictions.

**Calculation:**
- For each menu item + day-of-week combination: compute the mean of `actual_qty` from the `predictions` table for all matching records.
- Minimum data requirement: 2 data points for a given item + day combination. Below this, use overall item average.
- If no historical data at all: use a seeded default quantity (set by the owner when adding a menu item, default: 10 portions).

**Update frequency:** Recalculated nightly after wastage log is processed.

**Acceptance Criteria:**
- [ ] Per-item, per-day averages computed correctly from `predictions` table.
- [ ] If fewer than 2 data points: falls back to overall average.
- [ ] If no data: uses seed default.
- [ ] Calculations run in under 2 seconds for up to 30 menu items.

---

#### FEATURE I-02: Exponential Smoothing

**Description:** Recent data is weighted more than older data in the prediction model.

**Formula:** Exponential Weighted Moving Average (EWMA) with α = 0.3.

```
Prediction_today = α × actual_yesterday + (1 - α) × prediction_yesterday
```

Where:
- α = 0.3 (smoothing factor — recent data has 30% weight, prior trend has 70%)
- `actual_yesterday` = actual_qty from `predictions` table for the most recent matching day-of-week
- `prediction_yesterday` = the previous prediction for that item on the same day-of-week

**Initialisation:** First prediction uses seed default as both `actual` and `prediction`.

**Acceptance Criteria:**
- [ ] EWMA applied correctly with α = 0.3.
- [ ] Recent weeks' data has higher influence than older data.
- [ ] Calculation per item takes < 50ms.

---

#### FEATURE I-03: Contextual Multipliers

**Description:** The baseline prediction is adjusted by multipliers based on contextual signals. Multipliers compound multiplicatively.

**Multiplier table:**

| Condition | Signal Source | Multiplier Applied |
|---|---|---|
| Rain (>5mm expected) | Open-Meteo API | Walk-ins: × 0.85; Chai specifically: × 1.20 |
| Heavy rain (>20mm) | Open-Meteo API | Walk-ins: × 0.70; Chai: × 1.30 |
| Festival window (5 days out) | Festival calendar | All items: × festival multiplier (see B-08) |
| Power cut risk flagged | Goa Electricity scraper | Perishable items: × 0.75 |
| Owner stockout signal (from check-in) | parsed_signals_json | That item: × 1.20 next day |
| Owner surplus signal (wastage log) | wastage table | That item: × 0.70 next day |
| Monday closure — Sunday | Day of week check | All items Sunday: standard; vendor order reduced |
| Large group noted (check-in) | parsed_signals_json | All items: × 1.15 next day |

**Rainfall data:** From Open-Meteo `daily` forecast for Vasco coordinates. Field: `precipitation_sum` for tomorrow. Fetched as part of morning prep sheet job.

**Power cut data:** Goa Electricity Department website scraper (`goaelectricity.gov.in` outage section). Checks for Vasco area scheduled outages. Scraper runs daily at 7:00 AM. If scraper fails (site structure changes), power_cut flag defaults to `false` for that day.

**Multiplier combination:** All applicable multipliers are applied as a chain.

Example: baseline = 14, rain multiplier = 0.85, festival multiplier = 1.30 → prediction = 14 × 0.85 × 1.30 = 15.47 → rounded to 15.

**Rounding:** All final predictions rounded to nearest integer. Minimum prediction: 1 (never predict 0 for an active item unless it is on the "skip" list from wastage).

**Acceptance Criteria:**
- [ ] Rain multiplier correctly fetched from Open-Meteo and applied.
- [ ] Chai multiplier differs from general walk-in multiplier on rainy days.
- [ ] Festival multiplier applied during window.
- [ ] Power cut flag reduces perishable predictions.
- [ ] Stockout signal from check-in increases next-day prediction.
- [ ] Wastage surplus decreases next-day prediction.
- [ ] All multipliers chain multiplicatively, not additively.
- [ ] Final value always a positive integer.
- [ ] If any signal source fails (API down, scraper blocked): that multiplier is skipped (not assumed), and backend logs the failure.

---

#### FEATURE I-04: Owner Feedback as Training Signal

**Description:** Every time Sam overrides a prep sheet prediction (Reply "2"), the override is stored and influences future predictions.

**Mechanism:**
- Sam's override quantity is stored as `actual_qty` in `predictions` table for that item + date.
- EWMA recalculation (Feature I-02) incorporates this on next run.
- Over time, consistent overrides shift the baseline toward Sam's real pattern.

**Example:** If Sam consistently bumps biryani from 20 to 25 on Saturdays, within 4 weeks the system will predict 24–25 on Saturdays without her needing to edit.

**No ML required.** This is the EWMA naturally adapting. No separate training process.

**Acceptance Criteria:**
- [ ] Every override stored as `actual_qty` in `predictions` table.
- [ ] EWMA recalculation uses this value in future cycles.
- [ ] No override is lost, even if it contradicts the prediction direction.

---

#### FEATURE I-05: Procurement Quantity Calculation

**Description:** After wastage is logged, the system calculates the vendor order quantities for tomorrow.

**Logic:**
- For each menu item, get tomorrow's predicted portion count.
- Convert portions to raw ingredient quantities using a recipe mapping table.
- The recipe mapping is owner-configured: e.g. "1 portion biryani requires 150g rice, 50g chicken, 5g spice mix."
- Aggregate raw ingredients across all menu items.
- Group by vendor (from `vendor_contacts` and a vendor-ingredient mapping).

**Recipe mapping:** Owner sets this up via Owner Portal (Phase II). In Phase I, this mapping is manually configured by developers in a config file based on Sam's recipes. It is not user-editable in Phase I.

**Vendor-ingredient mapping:** Also manually configured in Phase I. E.g. "rice → Rice Vendor", "chicken → Meat Vendor".

**Safety buffer:** Add 10% buffer to all quantities. Round up to nearest purchasable unit (e.g. rice comes in 1kg bags → round up to nearest kg).

**Acceptance Criteria:**
- [ ] Procurement quantities derived correctly from portion predictions + recipe mapping.
- [ ] 10% buffer applied before rounding.
- [ ] Quantities rounded up to nearest vendor unit.
- [ ] Ingredients grouped by vendor correctly.
- [ ] If recipe mapping is missing for a menu item, that item is skipped in procurement (not an error).

---

## 5. Out of Scope

The following are explicitly NOT being built in the 8-week sprint:

**Customer-facing features.** No online ordering, no digital menu for customers, no QR code table ordering. Customers interact with staff in person. CafeOS does not touch the customer directly.

**Point of Sale (POS) hardware integration.** No thermal printers, no barcode scanners, no payment terminal integration. The app generates a digital bill. Physical printing is out of scope.

**UPI payment processing.** The app logs whether a payment was made via UPI, but it does not initiate, verify, or confirm UPI transactions. Sam's existing UPI flow (customer scans her QR code, she receives notification separately) is untouched.

**Multi-location support.** This is built for one cafe, one location. There is no concept of multiple branches, locations, or franchises.

**Customer loyalty or CRM.** No customer profiles, repeat customer tracking, loyalty points, or marketing campaigns.

**Accounting integration.** No integration with Tally, Zoho Books, QuickBooks, or any accounting software. Google Sheets is the only external data export.

**Inventory tracking by weight/stock level.** The system predicts procurement quantities and logs wastage by portion count. It does not maintain a real-time physical inventory count (e.g. "4.2kg of rice currently in store"). Inventory management in that sense is out of scope.

**Staff payroll processing.** The system tracks attendance and provides an estimated monthly earnings figure based on daily wage × days present. It does not process payroll, generate payslips, or integrate with any payment system. Salary computation is advisory.

**Recipe card generation (Phase II).** The ability for Sam to dictate a recipe via voice note and have the system generate a structured, shareable recipe card is a Phase II feature and not built in Phase I.

**Vendor reliability tracker (Phase II).** Tracking vendor response times, delivery windows, and price changes over time is Phase II.

**Instagram demand signal (Phase III).** Detecting Instagram posts featuring a menu item and using this as a demand signal is Phase III.

**Monsoon Mode toggle (Phase III).** A dedicated UI toggle for monsoon-season adjusted predictions is Phase III. (Weather API handles rain multipliers in Phase I, but the full monsoon mode with adjusted vendor lead times and footfall models is Phase III.)

**Multi-language UI.** The web app is in English only. The WhatsApp bot handles English, Hindi, and Konkani in free-text fields via Claude API, but the bot's own outgoing messages are in English only in Phase I.

**Analytics dashboard.** A rich visual dashboard with charts, trends, and graphs is not built. Reports are tabular. The Google Sheets sync is the analytics output in Phase I.

**WhatsApp Business API full verification.** The system runs on Twilio's WhatsApp sandbox or a basic Twilio-verified sender. Full Meta WhatsApp Business Account verification (required for production at scale) is outside the 8-week scope.

---

## 6. Success Metrics

These are the concrete, measurable outcomes that define whether CafeOS has worked for Sam's Cafe.

### Adoption Metrics (Is Sam using it?)

| Metric | Target by Week 8 |
|---|---|
| Morning prep sheet confirmed by owner (Reply 1 or edit) | ≥ 5 of last 7 days |
| Evening check-in responses received | ≥ 4 of last 7 days |
| Wastage log entries received | ≥ 4 of last 7 days |
| Customer orders logged through staff app per day | ≥ 15 orders/day (Sam's typical daily volume) |
| Days of continuous data in the database | ≥ 14 consecutive days by Week 8 |

### Accuracy Metrics (Is the intelligence working?)

| Metric | Target |
|---|---|
| Prep sheet prediction accuracy (within ±20% of actual) | ≥ 60% of items after Day 14 |
| Prep sheet prediction accuracy | ≥ 75% of items after Day 30 |
| Reduction in prep sheet overrides week-over-week | Measurable downward trend from Week 2–8 |
| Zero predictions causing a critical stockout (ran out before noon) | 0 incidents after Day 14 |

### Operational Metrics (Is it saving time or money?)

| Metric | Before CafeOS | Target by Week 8 |
|---|---|---|
| Spot vendor calls per week (emergency procurement) | Documented baseline from Sam | Reduction of ≥ 50% |
| Weekly wastage per top-3-wasted items (in ₹) | Documented baseline from Sam | Reduction of ≥ 20% |
| Time for end-of-day cash reconciliation | ~30 min (Sam's estimate) | < 5 min (bot does it) |
| Owner's weekly revenue awareness | Monthly only | Real-time via `summary` command |

### Technical Reliability Metrics

| Metric | Target |
|---|---|
| Morning prep sheet delivery success rate | 100% (excluding Mondays) |
| Order sync success rate (offline → online) | 100% of queued orders |
| API error rate (Claude, Open-Meteo, Supabase) | < 1% of requests result in user-visible error |
| App load time on low-end Android, 4G | < 3 seconds |
| App load time, offline (from cache) | < 1 second |

---

## 7. Non-Functional Requirements

**Mobile-first, always.** Every UI screen must be tested on a 360px-wide screen. No horizontal scroll on any primary screen. Tap targets minimum 44px × 44px. Text minimum 16px.

**Low bandwidth tolerance.** The app must function usably on a 2G/3G connection. Initial load must be ≤ 200KB of transferred data (gzipped). Images: none in the core app. All data fetched incrementally.

**Android priority.** Sam and her staff use Android phones. The app must be tested primarily on Chrome for Android. iOS is secondary. No iOS-specific features or Safari-only workarounds.

**Session security.** Staff sessions expire daily (midnight). Owner sessions expire after 7 days of inactivity. All API endpoints require a valid session token. Supabase Row Level Security enforces data access at the database layer.

**Data integrity over speed.** Order writes must be atomic (all fields written or none). A partial order write (e.g. `orders` row written but `order_items` rows not) is a data integrity failure and must be avoided via database transactions.

**No data loss on sync.** Offline orders must never be silently dropped. If a sync fails after 5 retries, the item remains in the queue and is retried on the next session open.

**WhatsApp bot idempotency.** If Twilio delivers the same webhook twice (rare but documented behaviour), the bot must not process it twice (no duplicate orders, duplicate logs, or duplicate messages to Sam). Implement webhook deduplication using Twilio's `MessageSid`.

**Secrets management.** All API keys (Twilio, Claude, Supabase service role key, Google Sheets service account) stored as environment variables on Render. Never committed to git. `.env.example` file documents required variables without values.

**Error messaging for Sam.** If the bot encounters an error, it replies with a friendly, plain-language message, not an error code. E.g. "Sorry Sam, something went wrong. Try again in a minute." The technical error is logged to the backend, not exposed to the user.

**Logging.** All backend errors logged with: timestamp, endpoint, input (sanitised), error message. Logs stored in Render's native log viewer. No personal data (Sam's messages, voice notes) stored in logs.

---

## 8. Open Questions — Decisions Still Unmade

These require a decision before or during development. They are flagged, not assumed.

| # | Question | Why It Matters | Decision Needed By |
|---|---|---|---|
| OQ-01 | What is Sam's expected daily order volume? | Determines Supabase tier needed, and whether free tier is sufficient for Phase I. Free tier: 50,000 rows/month. At 50 orders/day × 30 days = 1,500 order rows + line items. Well within free tier. | Week 1 — confirm with Sam |
| OQ-02 | Does Sam want outgoing bot messages in English only, or also in Hindi/Konkani? | Affects all bot message templates. English is the current assumption. If she wants Hindi, all templates must be rewritten and tested. | Before Week 1 |
| OQ-03 | What is the exact recipe-to-ingredient mapping for Sam's menu items? | Required for procurement quantity calculation (Feature I-05). Without this, vendor order suggestions will be generic, not ingredient-based. | Week 1 — collect from Sam |
| OQ-04 | What are Sam's vendor WhatsApp numbers and vendor-to-ingredient mapping? | Required for vendor order grouping (Feature B-06). Bot cannot group orders without knowing which vendor supplies which ingredient. | Week 1 — collect from Sam |
| OQ-05 | What is the late check-in threshold? Is 10:00 AM correct? | Currently hardcoded as 10:00 AM. Sam may want a different cutoff. | Week 3 — confirm before building attendance |
| OQ-06 | Does Sam want pending orders (customer credit tabs) flagged separately? | "Pending" payment method is tracked. Does Sam want a daily WhatsApp alert listing pending orders? Or is the owner portal view sufficient? | Week 2 — before building billing |
| OQ-07 | Does the Goa Electricity Department website have a parseable outage page? | Scraper for power cut risk (Feature I-03) depends on this. Site may require scraping HTML, or may have no structured data at all. If not scrapeable, power cut flag is removed from Phase I. | Week 4 — technical check before intelligence layer |
| OQ-08 | What seed default quantity should be used for new menu items before data exists? | Currently set to 10 portions. Sam should confirm whether 10 is a reasonable default for her menu, or if per-item defaults should be set at item creation time. | Week 1 — when building menu management |
| OQ-09 | How should the bot handle messages from unknown numbers? | If someone other than Sam texts the bot number, what happens? Currently: no response. Should it reply "This bot is for Sam's Cafe operations only"? | Week 1 — security decision |
| OQ-10 | What is the vendor order delivery timing assumption? | The generated vendor message currently says "please deliver tomorrow morning." Is this always correct? Or does Sam want to specify delivery timing per order? | Week 2 — before building vendor order flow |
| OQ-11 | Should the Google Sheet be pre-built or auto-created? | A pre-built sheet with formatted headers and named tabs is safer. Auto-creation is possible via Sheets API but fragile. Recommendation: pre-build the sheet manually and share with the service account. | Week 3 — before Google Sheets sync |
| OQ-12 | What is the fallback if Twilio WhatsApp sandbox expires mid-project? | Twilio sandbox sessions expire after 24 hours without reconnection. For the production demo, a verified Twilio number is required. Budget and timeline for Twilio verification needed. | Week 1 — Twilio account setup |
| OQ-13 | Partial order edits — can staff remove an item from an in-progress order? | Currently unspecified. Staff app has + / − buttons, which handles this before confirmation. But can a confirmed order be voided or edited? Decision: allow void (full cancellation) only, no partial edit of confirmed orders. This needs owner agreement. | Week 2 — before finalising order flow |
| OQ-14 | Monday closure — does the system still send the Sunday wastage prompt? | On Sunday nights, Sam needs to log what's left before Monday closure to prevent spoilage. The standard wastage prompt should still go out Sunday at 10 PM. Confirm this is correct. | Week 5 — before wastage flow |

---

*This document is the definitive specification for CafeOS Phase I development.*  
*All features marked Phase II or Phase III are out of scope for the 8-week sprint.*  
*Open questions must be resolved before the relevant development week begins.*  
*Version updates to this document should be logged with date and author.*

---

**Built for Sam. Designed for every cafe like hers.**
