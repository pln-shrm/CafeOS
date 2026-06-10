# CafeOS — AI Prompts & Claude API Specification

**Version:** 1.0  
**Date:** June 2026  
**Status:** Authoritative reference for all Claude API integrations  
**Scope:** All LLM calls across Phase I, Phase II, and Phase III  
**Model:** `claude-sonnet-4-20250514` (all calls)

---

## Table of Contents

1. [Shared Infrastructure](#1-shared-infrastructure)
2. [Prompt A — Evening Check-In: Text Parser](#2-prompt-a--evening-check-in-text-parser)
3. [Prompt B — Evening Check-In: Voice Note Parser](#3-prompt-b--evening-check-in-voice-note-parser)
4. [Prompt C — Morning Prep Sheet: Message Generator](#4-prompt-c--morning-prep-sheet-message-generator)
5. [Prompt D — Prep Sheet Edit Parser](#5-prompt-d--prep-sheet-edit-parser)
6. [Prompt E — Vendor Order Parser](#6-prompt-e--vendor-order-parser)
7. [Prompt F — Vendor Order Formatter](#7-prompt-f--vendor-order-formatter)
8. [Prompt G — Wastage Log Parser](#8-prompt-g--wastage-log-parser)
9. [Prompt H — Credit/Payment Parser](#9-prompt-h--creditpayment-parser)
10. [Prompt I — Weekly Sunday Summary Generator](#10-prompt-i--weekly-sunday-summary-generator)
11. [Prompt J — Recipe Card Structurer (Phase II)](#11-prompt-j--recipe-card-structurer-phase-ii)
12. [Prompt K — Ad Hoc Query Handler](#12-prompt-k--ad-hoc-query-handler)
13. [Prompt L — Event Flag Parser](#13-prompt-l--event-flag-parser)
14. [Prompt Summary Table](#14-prompt-summary-table)
15. [Decisions Still Open](#15-decisions-still-open)

---

## 1. Shared Infrastructure

### Base API Call Wrapper

Every Claude call in CafeOS goes through a single shared function. This keeps retry logic, error handling, and logging in one place. Never call the Claude API directly from a handler — always go through `callClaude()`.

```javascript
// src/services/claudeService.js

const axios = require('axios')

/**
 * @param {string} systemPrompt   - The system-level instruction
 * @param {string|Array} userContent - String for text; Array of content blocks for multimodal
 * @param {number} maxTokens      - Hard cap on output tokens
 * @param {number} temperature    - 0.0–1.0. Use 0 for JSON extraction, 0.7 for generation
 * @returns {object|string|null}  - Parsed JSON object, raw string, or null on failure
 */
async function callClaude(systemPrompt, userContent, maxTokens = 500, temperature = 0) {
  const messages = [{
    role: 'user',
    content: userContent  // string or array of content blocks
  }]

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages
      },
      {
        headers: {
          'x-api-key': process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        timeout: 12000  // 12s hard timeout. Meta WhatsApp API needs ACK within 5s — call Claude async.
      }
    )

    const rawText = response.data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()

    return rawText

  } catch (err) {
    console.error('[Claude API Error]', {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
      promptId: systemPrompt.slice(0, 60)  // first 60 chars for log identification
    })
    return null
  }
}

/**
 * JSON-specific wrapper. Strips fences, parses, retries once on parse failure.
 */
async function callClaudeJSON(systemPrompt, userContent, maxTokens = 500) {
  const raw = await callClaude(systemPrompt, userContent, maxTokens, 0)
  if (raw === null) return null

  const clean = raw.replace(/```json\s*|```/g, '').trim()
  try {
    return JSON.parse(clean)
  } catch (firstErr) {
    // Single retry: ask Claude to fix its own output
    console.warn('[Claude JSON Parse Fail] Retrying once...', clean.slice(0, 100))
    const fixPrompt = `The following text is supposed to be valid JSON but failed to parse. 
Return ONLY the corrected JSON, no explanation:\n${clean}`
    const fixed = await callClaude('You are a JSON repair assistant.', fixPrompt, maxTokens, 0)
    if (!fixed) return null
    try {
      return JSON.parse(fixed.replace(/```json\s*|```/g, '').trim())
    } catch (secondErr) {
      console.error('[Claude JSON Parse Fail] Both attempts failed.', secondErr.message)
      return null
    }
  }
}

module.exports = { callClaude, callClaudeJSON }
```

### Critical Constraint: Never Block the Meta WhatsApp API ACK

Meta WhatsApp API requires a response within 5 seconds or it retries the webhook. Claude calls take 2–8 seconds. The pattern is:

```
1. Meta WhatsApp API POST → res.status(200).send('<Response></Response>') immediately
2. Process Claude call asynchronously (setImmediate or detached async)
3. Send Meta WhatsApp API reply via client.messages.create() after Claude returns
```

Every handler must follow this pattern. If Claude is being awaited, the Meta WhatsApp API ACK has already been sent.

### Temperature Settings

| Use Case | Temperature | Reason |
|---|---|---|
| JSON extraction (all parser prompts) | `0.0` | Determinism — same input must produce same output |
| Message generation (prep sheet, vendor formatter, weekly summary) | `0.7` | Slight variation keeps messages from feeling robotic |
| Recipe card structuring | `0.3` | Low variance but some flexibility for formatting |
| Ad hoc queries | `0.5` | Natural tone without hallucination risk on structured data |

### Universal Failure Rule

Every call site checks for `null` and has a concrete fallback defined. Claude failures must **never** block Sam from receiving a response or prevent a bot flow from completing. The fallback is always defined before the Claude call is written.

---

## 2. Prompt A — Evening Check-In: Text Parser

### When It's Triggered

Sam sends a **text message** in response to the 7:00 PM evening check-in prompt. The bot has detected the message is not a voice note (`NumMedia === '0'` or `NumMedia` absent). Bot state is `awaiting_evening_checkin`.

Also triggered if Sam sends text unprompted during the `idle` state and the message contains operational signal words (stockout, power cut, event mention) — i.e., Sam is voluntarily reporting something.

### System Prompt

```
You are an assistant for a small cafe in Goa, India.
The cafe owner, Sam, has sent a text message describing how today went.
Extract structured signals from her message.
Sam may write in English, Hindi, Konkani, or a mix of all three.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "stockouts": [{ "item": string, "time": string|null }] | null,
  "demand_spike": string|null,
  "power_disruption": { "time": string|null, "duration_hours": number|null } | null,
  "weather_impact": string|null,
  "other_notes": string|null
}

Rules:
- "stockouts": list of items that ran out. Include approximate time if mentioned. null if none mentioned.
- "demand_spike": describe any unusually large or unexpected group or event that drove higher sales. null if none.
- "power_disruption": log if a power cut was mentioned. Estimate duration if mentioned. null if none.
- "weather_impact": note if Sam said weather affected footfall positively or negatively. null if not mentioned.
- "other_notes": anything important that does not fit the above — equipment issues, staff problems, unusual incidents. null if none.
- If Sam said everything was normal or fine, return all fields as null.
- Never invent information not present in the message.
- Konkani number words: ek=1, don=2, teen=3, char=4, panch=5, saa=6, saat=7, aath=8, nav=9, dha=10.
- Hindi number words: ek=1, do=2, teen=3, char=4, panch=5, chhe=6, saat=7, aath=8, nau=9, das=10.
```

### Dynamic Data Injected

```javascript
const userMessage = `Sam's message: "${rawText}"`
// rawText: the exact WhatsApp message body from Meta WhatsApp API webhook Body field
```

No additional context is needed. The system prompt is self-contained.

### Expected Output Format

```json
{
  "stockouts": [
    { "item": "biryani", "time": "12:30" },
    { "item": "fish curry", "time": null }
  ],
  "demand_spike": "office group of about 20 people came in for lunch, may be recurring",
  "power_disruption": { "time": "18:00", "duration_hours": 2 },
  "weather_impact": "heavy rain in the evening reduced footfall",
  "other_notes": null
}
```

All-clear example (everything was fine):
```json
{
  "stockouts": null,
  "demand_spike": null,
  "power_disruption": null,
  "weather_impact": null,
  "other_notes": null
}
```

### How Output Is Parsed and Used

```javascript
const parsed = await callClaudeJSON(systemPrompt, userMessage, 500)

if (parsed === null) {
  // Fallback: store raw text only
  await supabase.from('checkins').upsert({
    date: today,
    raw_text: rawText,
    parsed_signals: null,
    parse_failed: true
  }, { onConflict: 'date' })
  await whatsappReply("Got it Sam, I saved your note ✓")
  return
}

// Write to checkins table
await supabase.from('checkins').upsert({
  date: today,
  raw_text: rawText,
  parsed_signals: parsed,
  parse_failed: false
}, { onConflict: 'date' })

// Apply intelligence signals for next-day predictions
if (parsed.stockouts) {
  for (const stockout of parsed.stockouts) {
    await applyStockoutMultiplier(stockout.item, 1.20)
  }
}
if (parsed.power_disruption) {
  await setPowerCutFlag(today, parsed.power_disruption)
}

// Build confirmation reply listing what was understood
const lines = []
if (parsed.stockouts?.length) {
  lines.push(...parsed.stockouts.map(s => `• ${s.item} ran out${s.time ? ` ~${s.time}` : ''} — I'll suggest more tomorrow`))
}
if (parsed.demand_spike) lines.push(`• ${parsed.demand_spike} — noted`)
if (parsed.power_disruption) lines.push(`• Power cut logged${parsed.power_disruption.time ? ` ~${parsed.power_disruption.time}` : ''}`)
if (parsed.weather_impact) lines.push(`• Weather impact noted`)
if (parsed.other_notes) lines.push(`• ${parsed.other_notes}`)

const reply = lines.length
  ? `Got it, noted for tomorrow ✓\n${lines.join('\n')}`
  : `Got it Sam ✓ All noted.`

await whatsappReply(reply)
```

### Settings

| Parameter | Value |
|---|---|
| `max_tokens` | `500` |
| `temperature` | `0.0` |
| Timeout | `12s` |

### On Failure

1. `callClaudeJSON` returns `null` (API error, timeout, or two consecutive parse failures).
2. Store raw text in `checkins` table with `parse_failed: true`.
3. Set `bot_state → idle`.
4. Reply to Sam: `"Got it Sam, I saved your note ✓"` — she does not know parsing failed.
5. No intelligence signals are applied for that day. Log the failure.

---

## 3. Prompt B — Evening Check-In: Voice Note Parser

### When It's Triggered

Sam sends a **voice note** in response to the 7:00 PM check-in prompt. Detected via `NumMedia === '1'` and `MediaContentType0` starting with `audio/`. Bot state is `awaiting_evening_checkin`.

### Pre-Processing (Before Claude Call)

```javascript
// 1. Download the audio file from Meta WhatsApp API's MediaUrl0
//    Meta WhatsApp API requires HTTP Basic Auth: AccountSid:AuthToken
const audioResponse = await axios.get(mediaUrl, {
  responseType: 'arraybuffer',
  auth: {
    username: process.env.whatsapp_ACCOUNT_SID,
    password: process.env.whatsapp_AUTH_TOKEN
  },
  timeout: 10000
})

// 2. Convert buffer to base64
const base64Audio = Buffer.from(audioResponse.data).toString('base64')
const mediaType = audioResponse.headers['content-type'] || 'audio/ogg'
// WhatsApp voice notes arrive as audio/ogg (Opus codec)

// IMPORTANT: Verify Claude Sonnet 4 accepts audio/ogg directly.
// If not, transcode to audio/mp3 using fluent-ffmpeg + ffmpeg-static before encoding.
// See fallback note at end of this section.
```

### System Prompt

```
You are an assistant for a small cafe in Goa, India.
You will receive an audio file — a voice note from the cafe owner, Sam.
Sam may speak in English, Hindi, Konkani, or a mix of all three.

Step 1: Transcribe the voice note accurately.
Step 2: Extract structured operational signals from the transcription.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "transcription": string,
  "stockouts": [{ "item": string, "time": string|null }] | null,
  "demand_spike": string|null,
  "power_disruption": { "time": string|null, "duration_hours": number|null } | null,
  "weather_impact": string|null,
  "other_notes": string|null
}

Rules:
- "transcription": full verbatim transcription of the audio. Preserve all languages spoken. 
  Do not summarise — transcribe exactly what was said.
- "stockouts": list of items that ran out. Include approximate time if mentioned. null if none mentioned.
- "demand_spike": describe any unusually large or unexpected group or event. null if none.
- "power_disruption": log if a power cut was mentioned. Estimate duration if mentioned. null if none.
- "weather_impact": note if Sam said weather affected footfall. null if not mentioned.
- "other_notes": anything important that does not fit above fields. null if none.
- If audio is unclear or unintelligible, set transcription to "unclear audio" and all signal fields to null.
- Konkani number words: ek=1, don=2, teen=3, char=4, panch=5, saa=6, saat=7, aath=8, nav=9, dha=10.
- Hindi number words: ek=1, do=2, teen=3, char=4, panch=5, chhe=6, saat=7, aath=8, nau=9, das=10.
```

### Dynamic Data Injected

```javascript
// Multimodal message content — array of content blocks
const userContent = [
  {
    type: 'text',
    text: "This is Sam's voice note from this evening. Please transcribe and extract signals."
  },
  {
    type: 'document',  // or 'image' — check current Claude API audio input spec
    source: {
      type: 'base64',
      media_type: mediaType,  // e.g. 'audio/ogg' or 'audio/mp3'
      data: base64Audio
    }
  }
]
```

> **⚠️ Audio API Verification Required:** As of mid-2026, verify the exact content block `type` Claude Sonnet 4 uses for audio input (`'document'` vs a dedicated `'audio'` type). Check `https://docs.anthropic.com/en/api/messages` before implementing. If Claude does not accept audio directly, use the two-step fallback below.

**Two-step fallback if audio input is unsupported:**
```javascript
// Step 1: Transcribe with OpenAI Whisper (or any ASR API)
const transcription = await transcribeWithWhisper(base64Audio)
// Step 2: Pass transcription text to Prompt A (text parser) — same schema, minus audio
const parsed = await callClaudeJSON(promptA_systemPrompt, `Sam's message: "${transcription}"`, 500)
// Note: transcription field will be missing from output; populate it manually from Whisper result
parsed.transcription = transcription
```

### Expected Output Format

```json
{
  "transcription": "Haan, aaj biryani baarah baje tak khatam ho gaya. Ek bada group aaya tha, office wale lagte hain. Power cut bhi tha sham ko, karib do ghante. Baaki sab theek tha.",
  "stockouts": [
    { "item": "biryani", "time": "12:00" }
  ],
  "demand_spike": "large office group at lunch, possibly recurring",
  "power_disruption": { "time": "evening", "duration_hours": 2 },
  "weather_impact": null,
  "other_notes": null
}
```

### How Output Is Parsed and Used

Same as Prompt A, with one addition:

```javascript
// Store transcription alongside parsed signals for audit trail
await supabase.from('checkins').upsert({
  date: today,
  raw_text: parsed.transcription,   // use transcription as the raw text
  parsed_signals: {                  // store rest of parsed signals without transcription key
    stockouts: parsed.stockouts,
    demand_spike: parsed.demand_spike,
    power_disruption: parsed.power_disruption,
    weather_impact: parsed.weather_impact,
    other_notes: parsed.other_notes
  },
  voice_note_url: mediaUrl,          // store original Meta WhatsApp API URL for reference
  parse_failed: false
}, { onConflict: 'date' })
```

Downstream intelligence signal application is identical to Prompt A.

### Settings

| Parameter | Value |
|---|---|
| `max_tokens` | `800` |
| `temperature` | `0.0` |
| Timeout | `15s` (audio processing takes longer) |

### On Failure

1. Audio download fails → Reply: `"Couldn't download your voice note. Try sending again or just type it out."`
2. Claude returns `null` → Reply: `"Got it Sam, I saved your note ✓"` (store raw mediaUrl only in `checkins`).
3. Parse fails twice → Same as #2. Do not block.

---

## 4. Prompt C — Morning Prep Sheet: Message Generator

### When It's Triggered

**Scheduled job** at 8:00 AM IST (Tuesday–Sunday). The intelligence layer has already computed `predicted_qty` for each active menu item. This prompt takes those numbers and formats a warm, readable WhatsApp message for Sam.

This prompt generates **plain text output**, not JSON.

### System Prompt

```
You are CafeOS, a friendly assistant for Sam's Cafe in Vasco da Gama, Goa.
Generate the morning prep sheet WhatsApp message for Sam.
Use warm, plain English. Short sentences. No jargon.
Format rupee amounts as ₹X,XXX. Portions as whole numbers.
Return ONLY the message text — no JSON, no preamble, no explanation, no markdown.

Rules:
- Open exactly with: "Good morning Sam! Here's today's prep 🍽️"
- List each menu item on its own line with a relevant emoji and predicted quantity.
  Format: [emoji] [Item Name] → [quantity] [unit]
  Example: 🍚 Biryani → 20 portions
- Include a weather line ONLY if weather is meaningfully relevant: heavy rain, temperature 
  above 35°C, or a storm warning. Format: "Heavy rain expected today — [brief relevant note]."
  DO NOT include on normal or mildly cloudy days.
- Include a festival line ONLY if a festival is within 5 days.
  Format: "[Festival name] is in [N] days — I've bumped today's suggestions by [X]%."
  DO NOT include if festivalFlag is null or "none".
- End the message with exactly these two lines:
  "Reply 1 to go with this"
  "Or tell me what you're changing (e.g. 'biryani 25, fish curry 10')"
- Total message must be under 1,500 characters.
- Never add commentary about predictions, confidence, or data. Just the numbers and context.
```

### Dynamic Data Injected

```javascript
const weatherSummary = buildWeatherSummary(weatherData)
// e.g. "Heavy rain expected — precipitation_sum 18mm, max temp 29°C"
// e.g. "Clear skies — max temp 34°C"

const festivalFlag = await getFestivalFlag(today)
// e.g. "Sao Joao" if within 5 days, or null

const userMessage = `Today's predictions:
${predictions.map(p => `- ${p.item_name}: ${p.predicted_qty} ${p.unit || 'portions'}`).join('\n')}

Weather: ${weatherSummary}
Festival flag: ${festivalFlag || 'none'}
Day of week: ${dayOfWeek}
Date: ${formattedDate}`
```

**Example injected user message:**
```
Today's predictions:
- Biryani: 20 portions
- Fish Curry: 14 portions
- Chai: 60 cups
- Egg Bhurji: 10 portions
- Paneer Masala: 6 portions

Weather: Heavy rain expected — precipitation_sum 22mm, max temp 28°C
Festival flag: none
Day of week: Wednesday
Date: 4 Jun 2025
```

### Expected Output Format

Plain text WhatsApp message:
```
Good morning Sam! Here's today's prep 🍽️

🍚 Biryani → 20 portions
🐟 Fish Curry → 14 portions
☕ Chai → 60 cups
🥚 Egg Bhurji → 10 portions
🧀 Paneer Masala → 6 portions

Heavy rain expected today — chai usually spikes on rainy days.

Reply 1 to go with this
Or tell me what you're changing (e.g. 'biryani 25, fish curry 10')
```

### How Output Is Parsed and Used

```javascript
const messageText = await callClaude(systemPrompt, userMessage, 600, 0.7)

if (messageText === null) {
  // Fallback: build prep message deterministically without Claude
  const fallbackLines = predictions.map(p => `${p.item_name}: ${p.predicted_qty}`)
  const fallbackMessage = `Good morning Sam! Here's today's prep:\n\n${fallbackLines.join('\n')}\n\nReply 1 to confirm or tell me changes.`
  await whatsappSend(fallbackMessage)
} else {
  // Enforce character limit before sending
  const truncated = messageText.length > 1500 
    ? messageText.slice(0, 1480) + '...' 
    : messageText
  await whatsappSend(truncated)
}

await supabase.from('bot_state').update({
  current_state: 'awaiting_prep_confirm',
  context_json: { date: today, predictions }
}).eq('phone_number', SAM_PHONE)
```

### Settings

| Parameter | Value |
|---|---|
| `max_tokens` | `600` |
| `temperature` | `0.7` |
| Timeout | `12s` |

### On Failure

The deterministic fallback (plain list format) is always used if `callClaude` returns `null`. The morning prep sheet **must** be sent regardless of Claude availability. The fallback is not logged as an error visible to Sam — she just receives a slightly plainer message.

---

## 5. Prompt D — Prep Sheet Edit Parser

### When It's Triggered

Sam sends a **free-text reply** to the morning prep sheet that is not `"1"` (confirm) or `"2"` (generic edit request). Bot state is `awaiting_prep_confirm`. This prompt extracts which items she wants to change and to what quantity.

### System Prompt

```
You are an assistant for a small cafe in Goa, India.
Sam has replied to her morning prep sheet with changes.
Extract the item quantity overrides she wants.
Sam may write in English, Hindi, Konkani, or a mix.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "overrides": [
    { "item_name": string, "qty": number }
  ],
  "unclear": boolean
}

Rules:
- "item_name": use the item name as Sam used it. Match loosely (e.g. "fish" matches "Fish Curry", 
  "chai" matches "Masala Chai", "biriyani" matches "Biryani"). Never invent an item not in the known list.
- "qty": the quantity Sam wants as an integer. 
  Use 0 for: "skip", "nahi", "nil", "none", "band karo", "mat banao", "zero".
  Use 0 for "thoda kam" only if combined with context suggesting skip — otherwise omit the item.
- Only include items Sam explicitly mentioned. Do not include items she did not change.
- If Sam said "everything same except biryani 25", return only the biryani override.
- If Sam said "sab same" or "sab theek hai" or "all fine", return overrides as [] and unclear as false.
- "unclear": set to true ONLY if the message contains no recognisable item names or quantities at all.
  Set to false if even one override is extractable.
```

### Dynamic Data Injected

```javascript
const userMessage = `Current prep sheet items: ${currentItems.map(i => i.item_name).join(', ')}

Sam's edit message: "${editMessage}"`
```

**Example:**
```
Current prep sheet items: Biryani, Fish Curry, Chai, Egg Bhurji, Paneer Masala

Sam's edit message: "biryani 25, skip fish curry today"
```

### Expected Output Format

```json
{
  "overrides": [
    { "item_name": "biryani", "qty": 25 },
    { "item_name": "fish curry", "qty": 0 }
  ],
  "unclear": false
}
```

Unclear message example:
```json
{
  "overrides": [],
  "unclear": true
}
```

### How Output Is Parsed and Used

```javascript
const parsed = await callClaudeJSON(systemPrompt, userMessage, 400)

if (parsed === null || parsed.unclear) {
  await whatsappReply(`Sorry Sam, I didn't catch that clearly. Can you say it like:\n"biryani 25, fish curry 10"?`)
  // State stays awaiting_prep_confirm — Sam can try again
  return
}

if (parsed.overrides.length === 0) {
  // Sam confirmed with no changes ("sab same")
  await confirmPrepSheet(today)
  await whatsappReply("Got it! Today's prep locked in ✓")
  return
}

// Apply overrides
for (const override of parsed.overrides) {
  const menuItem = fuzzyMatchMenuItem(override.item_name, currentItems)
  if (!menuItem) continue  // skip unrecognised items silently
  await supabase.from('predictions').update({
    confirmed_qty: override.qty,
    override_source: 'owner'
  }).eq('date', today).eq('menu_item_id', menuItem.id)
}

// Build confirmation reply
const changedLines = parsed.overrides.map(o => `${o.item_name}: ${o.qty === 0 ? 'skipped' : o.qty}`)
await whatsappReply(`Updated ✓\n${changedLines.join('\n')}\n\nAll other items unchanged.`)
await supabase.from('bot_state').update({ current_state: 'idle' })
```

### Settings

| Parameter | Value |
|---|---|
| `max_tokens` | `400` |
| `temperature` | `0.0` |
| Timeout | `10s` |

### On Failure

Reply: `"Sorry Sam, I didn't catch that clearly. Can you say it like: 'biryani 25, fish curry 10'?"` State remains `awaiting_prep_confirm`. Sam retries manually.

---

## 6. Prompt E — Vendor Order Parser

### When It's Triggered

Sam sends a message starting with `order` (or natural language variations like `order karo`, `place order`) in the `idle` bot state. Also triggered in `awaiting_vendor_edit` state when Sam sends changes to a pending order.

### System Prompt

```
You are an assistant for a small cafe in Goa, India.
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
      "price_per_unit": number | null
    }
  ],
  "vendor_name": string | null,
  "delivery_date": "tomorrow" | "today" | "YYYY-MM-DD" | null,
  "notes": string | null
}

Rules:
- "name": the raw ingredient name in lowercase (e.g. "rice", "chicken", "refined oil").
- "qty": numeric quantity only. No units in this field.
- "unit": the unit string in lowercase (e.g. "kg", "l", "g", "ml", "pieces", "dozen"). 
  Default to "pieces" if no unit is stated.
- "price_per_unit": numeric value only, no ₹ symbol. Only populate if Sam explicitly stated a price 
  (e.g. "@₹45/kg" → 45). null if not mentioned.
- "vendor_name": extract from after "→", "for", "ko", or "ke liye". null if not present.
- "delivery_date": "tomorrow" if not specified (this is the default for cafe ordering).
  Parse relative dates: "thursday" → compute YYYY-MM-DD for next Thursday.
  Parse "aaj" → "today", "kal" → "tomorrow".
  null only if explicitly unclear.
- "notes": any additional instruction Sam included (e.g. "early delivery please", "call before coming").
  null if none.
- If this is an edit of an existing order (original_items provided), merge the changes:
  update matching items (match by name), add new items, set qty=0 for items Sam said to remove or skip.
```

### Dynamic Data Injected

```javascript
// New order
const userMessage = `${message}`

// Edit of existing order
const userMessage = `Original order: ${JSON.stringify(originalItems)}

Sam's edit: "${message}"`
```

**Example user messages:**
```
order rice 5kg, dal 3kg, oil 2L → Rice Vendor
```
```
Original order: [{"name":"rice","qty":5,"unit":"kg"},{"name":"dal","qty":3,"unit":"kg"}]

Sam's edit: "rice 6kg, add mustard oil 1L, skip dal"
```

### Expected Output Format

```json
{
  "items": [
    { "name": "rice", "qty": 5, "unit": "kg", "price_per_unit": null },
    { "name": "dal", "qty": 3, "unit": "kg", "price_per_unit": null },
    { "name": "refined oil", "qty": 2, "unit": "l", "price_per_unit": null }
  ],
  "vendor_name": "Rice Vendor",
  "delivery_date": "tomorrow",
  "notes": null
}
```

### How Output Is Parsed and Used

```javascript
const parsed = await callClaudeJSON(systemPrompt, userMessage, 500)

if (parsed === null) {
  await whatsappReply(`Sorry Sam, I didn't catch that order. Try:\n"order rice 5kg, dal 3kg → Rice Vendor"`)
  return
}

// If vendor not detected, prompt for it
if (!parsed.vendor_name) {
  await supabase.from('bot_state').update({
    current_state: 'awaiting_vendor_name',
    context_json: { pendingOrder: parsed }
  })
  await whatsappReply("Got the items ✓ Who should this go to? (Reply with vendor name)")
  return
}

// Write to procurement table
const { data: procurement } = await supabase.from('procurement').insert({
  vendor_name: parsed.vendor_name,
  items_json: parsed.items,
  delivery_date: resolveDeliveryDate(parsed.delivery_date),
  notes: parsed.notes,
  status: 'pending_confirm'
}).select().single()

// Move to Prompt F (vendor order formatter) to build the forwardable message
await generateAndConfirmVendorMessage(procurement)
```

### Settings

| Parameter | Value |
|---|---|
| `max_tokens` | `500` |
| `temperature` | `0.0` |
| Timeout | `10s` |

### On Failure

Reply: `"Sorry Sam, I didn't catch that order. Try: 'order rice 5kg, dal 3kg → Rice Vendor'"`. State stays `idle`.

---

## 7. Prompt F — Vendor Order Formatter

### When It's Triggered

After Prompt E successfully parses a vendor order, this prompt generates the **forwardable WhatsApp message** that Sam will forward to her vendor. Also triggered during the `awaiting_vendor_order_confirm` flow when Sam approves the auto-generated next-day order after wastage logging.

This produces **plain text output** (the forwardable message), not JSON.

### System Prompt

```
You are CafeOS, generating a WhatsApp vendor order message on behalf of Sam's Cafe in Goa.
The message must sound like Sam wrote it herself — natural, conversational, direct.
The vendor should not know a system generated this.
Return ONLY the message text — no quotes, no preamble, no label, no explanation.

Rules:
- Write in simple, warm Hindi-English mix OR plain English depending on vendor name context.
  Default to plain English unless vendor name suggests a local contact.
- List items clearly: item + quantity + unit per line or as a comma-separated list.
  Both formats are acceptable. Use whichever reads more naturally for the quantity.
- Include delivery date naturally: "please send tomorrow morning" or "please deliver by [day]".
  Never use ISO dates — convert to natural language.
- If a price was specified, do not include it in the vendor message (prices are for internal logging only).
- Do not include Sam's name or the cafe name in the message.
- Keep it under 200 characters if possible. Never exceed 350 characters.
- If notes were specified by Sam, include them at the end naturally.
- Sound like a regular WhatsApp message between two people who know each other.
```

### Dynamic Data Injected

```javascript
const deliveryDateNatural = toNaturalDate(parsed.delivery_date)
// e.g. "2025-06-05" → "tomorrow morning" or "Thursday"

const itemList = parsed.items
  .filter(i => i.qty > 0)
  .map(i => `${i.name} ${i.qty}${i.unit}`)
  .join(', ')

const userMessage = `Items: ${itemList}
Delivery: ${deliveryDateNatural}
Notes: ${parsed.notes || 'none'}`
```

**Example:**
```
Items: rice 5kg, dal 3kg, refined oil 2l
Delivery: tomorrow morning
Notes: none
```

### Expected Output Format

Plain text, ready to forward:
```
Rice 5kg, Dal 3kg, Oil 2L — please send tomorrow morning. Thanks
```

Or a more conversational variant:
```
Bhai, rice 5kg, dal 3kg aur oil 2L bhej do kal subah. Thanks!
```

### How Output Is Parsed and Used

```javascript
const vendorMessage = await callClaude(systemPrompt, userMessage, 300, 0.7)

const fallbackMessage = parsed.items
  .filter(i => i.qty > 0)
  .map(i => `${i.name} ${i.qty}${i.unit}`)
  .join(', ') + ` — please deliver ${deliveryDateNatural}`

const finalMessage = vendorMessage || fallbackMessage

// Update procurement record with the formatted message
await supabase.from('procurement').update({
  formatted_message: finalMessage
}).eq('id', procurement.id)

// Set state and send confirmation to Sam
await supabase.from('bot_state').update({
  current_state: 'awaiting_vendor_confirm',
  context_json: { 
    procurement_id: procurement.id,
    vendor_name: parsed.vendor_name,
    formatted_message: finalMessage 
  }
})

await whatsappReply(
  `Logged ✓\n\nReady to send to ${parsed.vendor_name}:\n\n"${finalMessage}"\n\nForward this message to place the order.\nReply 2 to edit.`
)
```

### Settings

| Parameter | Value |
|---|---|
| `max_tokens` | `300` |
| `temperature` | `0.7` |
| Timeout | `10s` |

### On Failure

Use the deterministic fallback (item list joined as plain text). The vendor order flow **must not block** on Claude availability. Fallback message is stored and sent exactly as the parsed items formatted mechanically.

---

## 8. Prompt G — Wastage Log Parser

### When It's Triggered

Sam sends a message in response to the 10:00 PM nightly wastage prompt. Bot state is `awaiting_wastage`.

### System Prompt

```
You are an assistant for a small cafe in Goa, India.
Sam has just sent her nightly wastage log — what portions are left over from today.
Extract structured leftover quantities per item.
Sam may write in English, Hindi, Konkani, or a mix.
Number words are valid: teen=3, char=4, panch=5, don/do=2, ek=1, chhe/saa=6.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "items": [
    { "item": string, "qty_left": number }
  ],
  "all_clear": boolean,
  "unclear": boolean
}

Rules:
- "item": item name as Sam stated it. Match loosely to known menu items.
- "qty_left": integer number of portions or units remaining.
- Treat "nil", "zero", "nahi", "khatam", "sold out" as 0.
- Treat "fine", "ok", "thoda", "negligible", "bahut kam" as 0 — negligible remainder.
- "all_clear": set to true if Sam said everything sold (e.g. "sab bik gaya", "nothing left", 
  "all clear", "sab khatam", "zero wastage"). When true, set items to [].
- "unclear": set to true only if the message is completely unintelligible and no items/quantities 
  can be extracted at all. Set to false even if only partial data is extracted.
- Never invent items Sam did not mention.
- Sam does not need to mention every item — only report what she explicitly stated.
```

### Dynamic Data Injected

```javascript
const userMessage = `Known menu items today: ${menuItems.map(i => i.name).join(', ')}

Sam's wastage message: "${message}"`
```

**Example:**
```
Known menu items today: Biryani, Fish Curry, Chai, Egg Bhurji, Paneer Masala

Sam's wastage message: "biryani 3 bachi, fish curry khatam, chai sab bik gaya"
```

### Expected Output Format

```json
{
  "items": [
    { "item": "biryani", "qty_left": 3 },
    { "item": "fish curry", "qty_left": 0 }
  ],
  "all_clear": false,
  "unclear": false
}
```

All-clear:
```json
{
  "items": [],
  "all_clear": true,
  "unclear": false
}
```

### How Output Is Parsed and Used

```javascript
const parsed = await callClaudeJSON(systemPrompt, userMessage, 400)

if (parsed === null || parsed.unclear) {
  await whatsappReply(
    `Sorry Sam, I didn't catch that. Try:\n"biryani 3 left, fish curry zero, chai all sold"`
  )
  return  // State stays awaiting_wastage
}

// Build wastage records
const wastageRecords = parsed.all_clear
  ? menuItems.map(item => ({ menu_item_id: item.id, date: today, qty_left: 0 }))
  : parsed.items.map(item => {
      const match = fuzzyMatchMenuItem(item.item, menuItems)
      if (!match) return null
      return { menu_item_id: match.id, date: today, qty_left: item.qty_left }
    }).filter(Boolean)

await supabase.from('wastage').upsert(wastageRecords, { onConflict: 'menu_item_id,date' })

// Trigger tomorrow's procurement calculation (Feature I-05)
const tomorrowPredictions = await recalculatePredictionsWithWastage(today, wastageRecords)

// Build and send next-day vendor order preview (Prompt F)
await buildVendorOrderFromPredictions(tomorrowPredictions)
```

### Settings

| Parameter | Value |
|---|---|
| `max_tokens` | `400` |
| `temperature` | `0.0` |
| Timeout | `10s` |

### On Failure

Reply: `"Sorry Sam, couldn't read that. Try: 'biryani 3 left, fish curry zero'"`. State remains `awaiting_wastage`. If Sam still doesn't respond by 10:15 PM (auto-proceed cron), system moves forward using prediction-only data, no wastage adjustment.

---

## 9. Prompt H — Credit/Payment Parser

### When It's Triggered

Sam sends a credit or payment message that **fails regex detection**. Regex is always tried first. Claude is the fallback for ambiguous or mixed-language statements.

Regex patterns tried first:
```javascript
const CREDIT_REGEX = /credit\s+(?:rice vendor|meat vendor|[\w\s]+)\s+₹?\s*(\d+)/i
const PAYMENT_REGEX = /paid\s+(?:rice vendor|meat vendor|[\w\s]+)\s+₹?\s*(\d+)/i
```

If neither matches, call this prompt.

### System Prompt

```
You are an assistant for a small cafe in Goa, India.
Extract a vendor credit or payment entry from Sam's WhatsApp message.
Sam may write in English, Hindi, Konkani, or a mix.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "type": "credit" | "payment",
  "vendor_name": string,
  "amount": number,
  "item_description": string | null
}

Rules:
- "type": use "credit" if a vendor delivered goods and Sam owes them money.
  Use "payment" if Sam paid a vendor cash or UPI.
  If ambiguous: "credit" if an item description is present, "payment" if not.
- "vendor_name": the vendor name as Sam stated it. Normalise capitalisation.
- "amount": the ₹ amount as a number only, no currency symbol. 
  Handle Indian number words: "do hazaar" = 2000, "paanch sau" = 500, "ek hazaar teen sau" = 1300.
- "item_description": what the credit was for (e.g. "rice 50kg", "chicken delivery"). 
  null for payment entries.
- If vendor name is unclear, use "unknown vendor" as a placeholder.
```

### Dynamic Data Injected

```javascript
const userMessage = `Known vendor names: ${vendorNames.join(', ')}

Sam's message: "${message}"`
```

### Expected Output Format

Credit:
```json
{
  "type": "credit",
  "vendor_name": "Rice Vendor",
  "amount": 4500,
  "item_description": "rice 50kg, dal 10kg"
}
```

Payment:
```json
{
  "type": "payment",
  "vendor_name": "Meat Vendor",
  "amount": 2400,
  "item_description": null
}
```

### How Output Is Parsed and Used

```javascript
const parsed = await callClaudeJSON(systemPrompt, userMessage, 300)

if (parsed === null) {
  await whatsappReply(
    `Sorry Sam, I didn't catch that. Try:\n"credit Rice Vendor ₹4500" or "paid Meat Vendor ₹2400"`
  )
  return
}

if (parsed.type === 'credit') {
  await supabase.from('credit_ledger').insert({
    vendor_name: parsed.vendor_name,
    amount: parsed.amount,
    item_description: parsed.item_description,
    type: 'credit',
    date: today
  })
  const balance = await getVendorBalance(parsed.vendor_name)
  await whatsappReply(`Credit logged ✓\n${parsed.vendor_name}: ₹${parsed.amount.toLocaleString('en-IN')} added\nOutstanding: ₹${balance.toLocaleString('en-IN')}`)
} else {
  await logPaymentAndUpdateBalance(parsed)
}
```

### Settings

| Parameter | Value |
|---|---|
| `max_tokens` | `300` |
| `temperature` | `0.0` |
| Timeout | `10s` |

### On Failure

Reply: `"Sorry Sam, I didn't catch that. Try: 'credit Rice Vendor ₹4500' or 'paid Meat Vendor ₹2400'"`. No state change.

---

## 10. Prompt I — Weekly Sunday Summary Generator

### When It's Triggered

**Scheduled job** at 9:00 PM IST every Sunday. The backend has already aggregated all weekly metrics into a data object. This prompt formats them into a warm, readable WhatsApp message.

Precondition check: if fewer than 4 days of order data exist for the week, skip this prompt and send: `"Hi Sam! Not enough data this week to generate a full summary. See you next Sunday!"`

This produces **plain text output**, not JSON.

### System Prompt

```
You are CafeOS, a friendly assistant for Sam's Cafe in Vasco da Gama, Goa.
Generate the weekly summary WhatsApp message for Sam.
Use warm, plain English. Be encouraging but honest. No jargon. No filler.
Return ONLY the message text — no JSON, no preamble, no explanation, no markdown.

Rules:
- Open with: "This week at Sam's Cafe 🍽️" followed by the date range on the same or next line.
- Include exactly 5 data points. Each on its own line with a relevant emoji.
  Use the data provided. Do not invent figures. 
  If margin data is unavailable, replace with another meaningful data point (e.g. payment method split).
- End with ONE concrete, specific, actionable suggestion based on the data.
  The suggestion must cite a specific item, amount, or day — no vague advice.
  Good: "Making 4 fewer Fish Curry on weekdays could save ~₹560/week in wastage."
  Bad: "Consider reducing wastage by making fewer items."
- End with a short warm closing line (one sentence, no exclamation overload).
- Total message must be under 1,500 characters.
- Never include advice about things Sam has no control over (e.g. weather, holidays).
```

### Dynamic Data Injected

```javascript
const userMessage = `Weekly data:
- Week: ${weekStart} to ${weekEnd}
- Total orders: ${totalOrders}
- Total revenue: ₹${totalRevenue.toLocaleString('en-IN')}
- Last week revenue: ₹${lastWeekRevenue.toLocaleString('en-IN')}
- Revenue change: ${revenueChange > 0 ? '+' : ''}${revenueChange}%
- Best selling item: ${bestSeller.name} (${bestSeller.units} portions, ₹${bestSeller.revenue.toLocaleString('en-IN')})
- Most wasted item: ${mostWasted.name} (avg ${mostWasted.avgLeft} left/day, estimated ₹${mostWasted.wasteCost.toLocaleString('en-IN')} loss)
- Highest revenue day: ${highestDay.name} (₹${highestDay.revenue.toLocaleString('en-IN')})
- Estimated margin: ${margin !== null ? margin + '%' : 'not available — procurement costs not fully logged'}
- Total wastage cost this week: ₹${totalWastageCost.toLocaleString('en-IN')}
- Payment split: Cash ₹${cashRevenue.toLocaleString('en-IN')} | UPI ₹${upiRevenue.toLocaleString('en-IN')} | Pending ₹${pendingRevenue.toLocaleString('en-IN')}

Generate the weekly summary message.`
```

### Expected Output Format

```
This week at Sam's Cafe 🍽️
(Tue 27 May – Sun 1 Jun)

🏆 Best seller: Biryani (142 portions, ₹17,040)
🗑️ Most wastage: Fish Curry (avg 5 left/day — ₹2,200 loss)
📈 Revenue vs last week: +12% (₹31,200 this week)
📅 Biggest day: Saturday (₹6,200)
💰 This week's margin: ~34%

One thing to try: Making 4 fewer Fish Curry on weekdays could save ~₹560/week in wastage.

Well done this week Sam!
```

### How Output Is Parsed and Used

```javascript
const summaryText = await callClaude(systemPrompt, userMessage, 500, 0.7)

if (summaryText === null) {
  // Deterministic fallback — build a plain summary without the suggestion line
  const fallbackLines = [
    `This week at Sam's Cafe (${weekStart} – ${weekEnd})`,
    ``,
    `Best seller: ${bestSeller.name} (${bestSeller.units} portions)`,
    `Revenue: ₹${totalRevenue.toLocaleString('en-IN')} (${revenueChange > 0 ? '+' : ''}${revenueChange}% vs last week)`,
    `Biggest day: ${highestDay.name}`,
    `Most wastage: ${mostWasted.name}`
  ]
  await whatsappSend(fallbackLines.join('\n'))
} else {
  const truncated = summaryText.length > 1500 
    ? summaryText.slice(0, 1480) + '...' 
    : summaryText
  await whatsappSend(truncated)
}
```

### Settings

| Parameter | Value |
|---|---|
| `max_tokens` | `500` |
| `temperature` | `0.7` |
| Timeout | `12s` |

### On Failure

Deterministic fallback sends a plain-text summary without the suggestion line. The weekly summary is delivered regardless of Claude availability.

---

## 11. Prompt J — Recipe Card Structurer (Phase II)

### When It's Triggered

**Phase II feature.** Sam sends a voice note or text describing a recipe using the command `recipe [dish name]` followed by a description. The system structures this into a formatted recipe card stored in the `recipe_cards` table and optionally sharable as a PDF.

### System Prompt

```
You are an assistant for a small cafe in Goa, India.
Sam is describing a recipe. Extract and structure it into a clean recipe card.
Sam may speak/write in English, Hindi, Konkani, or a mix.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "dish_name": string,
  "serves": number | null,
  "prep_time_minutes": number | null,
  "cook_time_minutes": number | null,
  "ingredients": [
    {
      "item": string,
      "qty": number | null,
      "unit": string | null,
      "notes": string | null
    }
  ],
  "steps": [string],
  "tips": [string] | null,
  "category": "main" | "beverage" | "snack" | "dessert" | "side"
}

Rules:
- "dish_name": the name of the dish. Capitalise properly (e.g. "Fish Curry", "Masala Chai").
- "serves": number of portions this recipe makes. null if not mentioned.
- "prep_time_minutes" and "cook_time_minutes": integer minutes. null if not stated.
- "ingredients": extract all ingredients mentioned. 
  "item": ingredient name in English, lowercase.
  "qty": numeric quantity. null if vague (e.g. "some", "a bit").
  "unit": unit string lowercase (e.g. "g", "kg", "ml", "tsp", "tbsp", "cups"). 
         "to taste" for salt/spices if Sam said that. null if uncountable.
  "notes": any qualifier (e.g. "finely chopped", "bone-in", "fresh"). null if none.
- "steps": ordered list of cooking steps. Each step is one action. 
  Write in simple English even if Sam described in another language.
  Do not combine two actions in one step.
- "tips": any tips Sam mentioned (e.g. "marinate overnight for best results"). 
  null if none mentioned.
- "category": best guess based on the dish name and description.
- If Sam's description is very incomplete (fewer than 3 ingredients), 
  return what you have and add "incomplete": true to the JSON.
```

### Dynamic Data Injected

For text input:
```javascript
const userMessage = `Dish name: ${dishName}
Sam's recipe description: "${recipeText}"`
```

For voice note: use same multimodal content array pattern as Prompt B, but with recipe-specific system prompt.

### Expected Output Format

```json
{
  "dish_name": "Fish Curry",
  "serves": 4,
  "prep_time_minutes": 15,
  "cook_time_minutes": 25,
  "ingredients": [
    { "item": "pomfret", "qty": 500, "unit": "g", "notes": "cleaned and cut into pieces" },
    { "item": "onion", "qty": 2, "unit": null, "notes": "finely chopped" },
    { "item": "coconut milk", "qty": 200, "unit": "ml", "notes": null },
    { "item": "goa fish curry masala", "qty": 2, "unit": "tbsp", "notes": null },
    { "item": "salt", "qty": null, "unit": "to taste", "notes": null }
  ],
  "steps": [
    "Heat oil in a pan over medium flame.",
    "Add chopped onions and fry until golden.",
    "Add fish curry masala and stir for 2 minutes.",
    "Add coconut milk and bring to a gentle simmer.",
    "Add fish pieces and cook for 10–12 minutes until done.",
    "Season with salt and serve hot."
  ],
  "tips": ["Use fresh coconut milk for best flavour."],
  "category": "main"
}
```

### How Output Is Parsed and Used

```javascript
const parsed = await callClaudeJSON(systemPrompt, userMessage, 800)

if (parsed === null) {
  await whatsappReply("Sorry Sam, I couldn't structure that recipe. Try describing it again or type it out.")
  return
}

await supabase.from('recipe_cards').upsert({
  dish_name: parsed.dish_name,
  menu_item_id: linkedMenuItemId || null,  // linked if dish matches a menu item
  recipe_json: parsed,
  created_at: new Date().toISOString()
}, { onConflict: 'dish_name' })

const ingredientCount = parsed.ingredients.length
const stepCount = parsed.steps.length
await whatsappReply(
  `Recipe saved ✓\n${parsed.dish_name} — ${ingredientCount} ingredients, ${stepCount} steps${parsed.incomplete ? '\n(Looks incomplete — feel free to add more)' : ''}`
)
```

### Settings

| Parameter | Value |
|---|---|
| `max_tokens` | `800` |
| `temperature` | `0.3` |
| Timeout | `15s` (allows for longer recipe descriptions) |

### On Failure

Reply: `"Sorry Sam, I couldn't structure that recipe. Try describing it again."` No state change.

---

## 12. Prompt K — Ad Hoc Query Handler

### When It's Triggered

Sam sends a **freeform question about her cafe data** that does not match any known command keyword and does not fit a specific structured flow. Detected after all keyword matching and state-based routing fails. Examples:

```
which day do I make the most money?
is biryani more profitable than fish curry?
when did I last order from Rice Vendor?
how many orders did we do last Tuesday?
kya last week revenue zyada tha ya is week?
```

This prompt receives structured data from the database and generates a **plain text answer**.

### System Prompt

```
You are CafeOS, a data assistant for Sam's Cafe in Vasco da Gama, Goa.
Sam has asked a question about her cafe's data. Answer it accurately using only the data provided.
Use warm, plain English. Short sentences. No jargon.
Return ONLY the answer — no JSON, no preamble, no markdown, no explanation of your process.

Rules:
- Answer the question directly. Lead with the number or fact, then context.
- If the data provided is insufficient to answer the question, say so plainly:
  "I don't have enough data for that yet — try again after a few more days of orders."
- Never invent numbers or make assumptions not grounded in the data provided.
- Round rupee figures to nearest ₹10 for readability.
- For comparisons, always give both values and the difference or percentage change.
- If the question has multiple parts, answer each part briefly.
- Total response under 300 characters where possible. Never exceed 800 characters.
```

### Dynamic Data Injected

This is the most data-heavy call in the system. The backend fetches the most plausible data slices for Sam's question and injects them.

```javascript
// Determine what data to fetch based on keyword detection in Sam's question
const dataContext = await buildQueryContext(message)
// buildQueryContext does keyword matching:
// "best day" / "most money" → weekly revenue by day
// "biryani" / item name → item-specific sales data
// "last week" / "this week" → week comparison
// "vendor" + vendor name → last procurement for that vendor
// "how many orders" → order count for specified period

const userMessage = `Sam's question: "${message}"

Available data:
${JSON.stringify(dataContext, null, 2)}`
```

**Example injected data for "which day do I make the most money?":**
```json
{
  "revenue_by_day_this_week": {
    "Tuesday": 4200,
    "Wednesday": 3800,
    "Thursday": 5100,
    "Friday": 5800,
    "Saturday": 6200,
    "Sunday": 4900
  },
  "revenue_by_day_last_week": {
    "Tuesday": 3900,
    "Wednesday": 4100,
    "Thursday": 4800,
    "Friday": 5500,
    "Saturday": 6000,
    "Sunday": 4700
  },
  "data_range": "last 14 days"
}
```

### Expected Output Format

Plain text answer:
```
Saturday is your strongest day — ₹6,200 this week and ₹6,000 last week.
Friday is a close second at ₹5,800.
Weekdays average around ₹4,500.
```

### How Output Is Parsed and Used

```javascript
const answer = await callClaude(systemPrompt, userMessage, 400, 0.5)

if (answer === null) {
  await whatsappReply("Sorry Sam, I couldn't pull that up right now. Try again in a minute.")
  return
}

// Truncate if over 800 chars
const truncated = answer.length > 800 ? answer.slice(0, 780) + '...' : answer
await whatsappReply(truncated)
// No state change — stays idle
```

### Settings

| Parameter | Value |
|---|---|
| `max_tokens` | `400` |
| `temperature` | `0.5` |
| Timeout | `12s` |

### On Failure

Reply: `"Sorry Sam, I couldn't pull that up right now. Try again in a minute."` No state change. Sam can retry or rephrase.

---

## 13. Prompt L — Event Flag Parser

### When It's Triggered

Sam sends a message containing `event` keyword with a date and description. The regex patterns for common formats are tried first:

```javascript
const EVENT_REGEX = /event\s+(tomorrow|today|aaj|kal|\d{1,2}\s+\w+|\w+day)\s+(.+)/i
```

If regex fails to extract a clear date + description, this prompt is called.

### System Prompt

```
You are an assistant for a small cafe in Goa, India.
Sam is flagging an upcoming event that will bring extra customers.
Extract the event date and description.
Sam may write in English, Hindi, Konkani, or a mix.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "event_date": "today" | "tomorrow" | "YYYY-MM-DD" | null,
  "description": string,
  "multiplier_override": number | null
}

Rules:
- "event_date": 
  "today" or "tomorrow" for relative references.
  Convert day names ("saturday", "shaniwar") to YYYY-MM-DD (today is ${todayISO}).
  null if date is completely unclear.
- "description": short description of the event in English. Translate if needed.
- "multiplier_override": if Sam specifies a percentage boost (e.g. "event tomorrow 40%"),
  convert to decimal multiplier (40% → 1.4). null if no percentage stated.
```

### Dynamic Data Injected

```javascript
const userMessage = `Today's date: ${todayISO} (${dayOfWeek})

Sam's message: "${message}"`
```

### Expected Output Format

```json
{
  "event_date": "2025-06-07",
  "description": "big football match at stadium — high footfall expected",
  "multiplier_override": null
}
```

### How Output Is Parsed and Used

```javascript
const parsed = await callClaudeJSON(systemPrompt, userMessage, 200)

if (parsed === null || parsed.event_date === null) {
  await whatsappReply(
    "Got it, I noted an event but couldn't figure out the date.\nDid you mean today or tomorrow?"
  )
  return
}

const resolvedDate = resolveRelativeDate(parsed.event_date)
const multiplier = parsed.multiplier_override || 1.20  // default 20% boost

await supabase.from('predictions').update({
  manual_flag: parsed.description,
  manual_multiplier: multiplier
}).eq('date', resolvedDate)

// If predictions already exist for that date, re-run them with the flag
await recalculatePredictionsForDate(resolvedDate)

const dateDisplay = toNaturalDate(resolvedDate)
await whatsappReply(
  `Event flagged ✓\n${dateDisplay}: "${parsed.description}"\n\nI've bumped ${dateDisplay}'s prep suggestions by ${Math.round((multiplier - 1) * 100)}%.\nYou'll see updated numbers in tomorrow's morning prep sheet.`
)
```

### Settings

| Parameter | Value |
|---|---|
| `max_tokens` | `200` |
| `temperature` | `0.0` |
| Timeout | `8s` |

### On Failure

Reply: `"Got it, I noted an event but couldn't figure out the date. Did you mean today or tomorrow?"` No state change.

---

## 14. Prompt Summary Table

| Prompt | Phase | Output Type | Trigger | Max Tokens | Temp | Fallback |
|--------|-------|-------------|---------|-----------|------|----------|
| A — Evening Check-In Text | I | JSON | Evening check-in text reply | 500 | 0.0 | Store raw text, reply "Got it ✓" |
| B — Evening Check-In Voice | I | JSON | Evening check-in voice note | 800 | 0.0 | Store mediaUrl only, reply "Got it ✓" |
| C — Prep Sheet Generator | I | Plain text | 8am cron job | 600 | 0.7 | Deterministic list format |
| D — Prep Sheet Edit Parser | I | JSON | Free-text edit reply to prep sheet | 400 | 0.0 | Ask Sam to rephrase |
| E — Vendor Order Parser | I | JSON | `order` command / vendor edit | 500 | 0.0 | Ask Sam to rephrase |
| F — Vendor Order Formatter | I | Plain text | After order parsed | 300 | 0.7 | Deterministic item list |
| G — Wastage Log Parser | I | JSON | 10pm wastage prompt reply | 400 | 0.0 | Ask Sam to rephrase |
| H — Credit/Payment Parser | I | JSON | Credit/payment command (regex fallback) | 300 | 0.0 | Ask Sam to rephrase |
| I — Weekly Summary | III (optional I) | Plain text | Sunday 9pm cron | 500 | 0.7 | Deterministic summary, no suggestion |
| J — Recipe Card | II | JSON | `recipe` command | 800 | 0.3 | Ask Sam to describe again |
| K — Ad Hoc Query | I | Plain text | Unmatched message with data question | 400 | 0.5 | "Can't pull that up right now" |
| L — Event Flag Parser | I | JSON | `event` command (regex fallback) | 200 | 0.0 | Ask for date clarification |

**Total maximum Claude calls per day (typical active day):**

| Time | Call(s) |
|------|---------|
| 8:00 AM | Prompt C (1 call) |
| ~7:00 PM | Prompt A or B (1 call) |
| ~10:00 PM | Prompt G (1 call) + Prompt F (1 call) |
| Ad hoc | Prompts D, E, H, K, L (0–3 calls) |
| **Max per day** | **~7 calls** |
| **Sunday only** | +Prompt I (1 additional call) |

At ~$0.003 per call (Sonnet 4 average for these token counts), maximum daily cost is under $0.025/day.

---

## 15. Decisions Still Open

The following decisions affect how these prompts are implemented. They need to be resolved before coding begins.

### Decision 1: Claude Audio Input Format

**Question:** Does `claude-sonnet-4-20250514` accept `audio/ogg` directly as a content block? What is the correct `type` field — `"document"`, `"audio"`, or something else?

**Why it matters:** Prompt B implementation path depends entirely on this. If unsupported, Whisper or another ASR must be added to the stack.

**Action:** Check `https://docs.anthropic.com/en/api/messages` before writing Prompt B. Add `fluent-ffmpeg` + `ffmpeg-static` to `package.json` as a precaution.

**Fallback if unsupported:**
1. Add `openai` package for Whisper API, or use a free Whisper endpoint.
2. Transcribe first, then pass transcript to Prompt A.
3. Store transcription in `checkins.raw_text`, with `input_type: 'voice_transcribed'`.

---

### Decision 2: Ad Hoc Query Context Builder

**Question:** For Prompt K, how much data is fetched and in what shape? There is a risk of injecting so much JSON that the context becomes expensive and noisy.

**Recommendation:**
- Cap data context at ~800 tokens of JSON.
- Use keyword detection to fetch only the most relevant data slice, not everything.
- If question is too vague to determine what data to fetch, reply with a clarifying question rather than calling Claude with empty context.

**Still needs:** A `buildQueryContext(message)` function that maps question keywords to database queries. This function should be built and tested independently of Claude.

---

### Decision 3: Fuzzy Item Name Matching

**Question:** Multiple prompts return item names in Sam's phrasing (e.g. "fish", "biriyani", "chai"). How is fuzzy matching to `menu_items.name` implemented?

**Recommendation:** Use a simple Levenshtein distance function or a pre-built mapping:
```javascript
const ITEM_ALIASES = {
  'fish': 'Fish Curry',
  'biriyani': 'Biryani',
  'biryani': 'Biryani',
  'chai': 'Masala Chai',
  'paneer': 'Paneer Masala',
  'egg': 'Egg Bhurji'
}
```
Seed this from Sam's actual menu during onboarding. Update when menu changes.

---

### Decision 4: Weekly Summary Phase Placement

**Question:** The PRD lists Weekly Summary as Phase III, but the Bot Spec includes it as FLOW 11 with a full implementation. Is it built in Phase I or Phase III?

**Recommendation:** Build the data aggregation logic (revenue, wastage, best seller computation) in Phase I — it's needed for ad hoc queries anyway. Gate the Sunday cron job behind a feature flag. Enable it in Phase III or whenever data quality is sufficient (≥ 14 days of consistent data).

---

### Decision 5: Konkani Language Coverage

**Question:** How much Konkani does Sam actually use? The prompts include Konkani number words but the coverage is minimal.

**Action needed:** Ask Sam directly: does she speak in Konkani or mostly Hindi-English? If Konkani is significant, add a more comprehensive Konkani vocabulary list to Prompts A, B, D, G (the extraction prompts).

---

*End of CafeOS AI Prompts Document*  
*Next document: CafeOS_Implementation_Checklist.md*
