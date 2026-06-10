const cron = require('node-cron')
const axios = require('axios')
const supabase = require('../services/supabaseClient')
const { whatsappReply } = require('../services/whatsappClient')
const { callGemini } = require('../services/geminiService')
const { setBotState, todayIST } = require('../bot/handlers/helpers')
const { generatePredictions } = require('../intelligence/predictions')

const IST = { timezone: 'Asia/Kolkata' }

const SYSTEM_PROMPT_C = `You are CafeOS, a friendly assistant for Sam's Cafe in Vasco da Gama, Goa.
Generate the morning prep sheet WhatsApp message for Sam.
Use warm, plain English. Short sentences. No jargon.
Format rupee amounts as ₹X,XXX. Portions as whole numbers.
Return ONLY the message text — no JSON, no preamble, no explanation, no markdown, no backticks.

Rules:
- Open exactly with: "Good morning Sam! Here's today's prep 🍽️"
- List each menu item on its own line with a relevant emoji and predicted quantity.
  Format: [emoji] [Item Name] → [quantity] portions
  Example: 🍚 Biryani → 20 portions
- Include a weather line ONLY if weather is meaningfully relevant: heavy rain, temperature above 35°C, or a storm warning.
  Format: "Heavy rain expected today — [brief relevant note]."
  DO NOT include on normal or mildly cloudy days.
- Include a festival line ONLY if festivalFlag is not "none".
  Format: "[Festival name] is active — I've bumped today's suggestions."
  DO NOT include if festivalFlag is null or "none".
- End the message with exactly these two lines:
  "Reply 1 to go with this"
  "Or tell me what you're changing (e.g. 'biryani 25, fish curry 10')"
- Total message must be under 1,500 characters.
- Never add commentary about predictions, confidence, or data. Just the numbers and context.`

async function fetchWeatherNote() {
  try {
    const weatherRes = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: 15.3961,
        longitude: 73.8173,
        daily: 'precipitation_sum,temperature_2m_max',
        timezone: 'Asia/Kolkata',
        forecast_days: 1
      }
    })
    const precipitation = weatherRes.data?.daily?.precipitation_sum?.[0] || 0
    const maxTemp = weatherRes.data?.daily?.temperature_2m_max?.[0] || 0
    if (precipitation > 5) return { note: `Heavy rain expected — ${Math.round(precipitation)}mm, max ${Math.round(maxTemp)}°C`, precipitation, maxTemp }
    if (maxTemp > 35) return { note: `Very hot today — max ${Math.round(maxTemp)}°C`, precipitation, maxTemp }
    return { note: null, precipitation, maxTemp }
  } catch (err) {
    console.warn('[CRON] Weather fetch failed', err.message)
    return { note: null, precipitation: 0, maxTemp: 0 }
  }
}

async function getFestivalFlag(date) {
  const { data } = await supabase
    .from('festival_calendar')
    .select('name, start_date, warning_days_before')
    .gte('end_date', date)
    .order('start_date', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  // Show warning if within warning_days_before
  const start = new Date(data.start_date + 'T12:00:00Z')
  const today = new Date(date + 'T12:00:00Z')
  const diffDays = Math.round((start - today) / 86400000)
  if (diffDays <= data.warning_days_before) return data.name
  return null
}

async function runMorningPrepJob() {
  const today = todayIST()

  // Step 1: Generate predictions for today (handles weather + festival + signals)
  let predictionResult
  try {
    predictionResult = await generatePredictions(today)
  } catch (err) {
    console.error('[CRON] generatePredictions failed, falling back to seed_qty', err)
    predictionResult = null
  }

  // Step 2: Fetch menu items + predictions (post-generate, may already exist)
  const { data: menuItems, error: menuErr } = await supabase
    .from('menu_items')
    .select('id, name, seed_qty')
    .eq('active', true)
    .order('name')
  if (menuErr) throw menuErr

  const { data: predictions, error: predErr } = await supabase
    .from('predictions')
    .select('menu_item_id, predicted_qty, owner_override')
    .eq('date', today)
  if (predErr) throw predErr

  const existingMap = new Map()
  for (const p of predictions || []) {
    existingMap.set(p.menu_item_id, p)
  }

  // Insert seed rows for any items still missing (e.g. generatePredictions errored)
  const missingRows = []
  for (const item of menuItems || []) {
    if (!existingMap.has(item.id)) {
      missingRows.push({
        date: today,
        menu_item_id: item.id,
        predicted_qty: item.seed_qty || 10,
        confirmed: false
      })
    }
  }
  if (missingRows.length > 0) {
    await supabase.from('predictions').insert(missingRows)
    for (const r of missingRows) existingMap.set(r.menu_item_id, r)
  }

  // Build prediction list for Gemini + context
  const contextPredictions = (menuItems || []).map(item => {
    const found = existingMap.get(item.id)
    const qty = found?.owner_override ?? found?.predicted_qty ?? item.seed_qty ?? 10
    return { menu_item_id: item.id, item_name: item.name, predicted_qty: qty }
  })

  // Step 3: Weather + festival for Prompt C
  const { note: weatherNote, precipitation, maxTemp } = await fetchWeatherNote()
  const festivalFlag = await getFestivalFlag(today)
  const dayOfWeek = new Date(today + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' })
  const formattedDate = new Date(today + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

  const weatherSummary = weatherNote || `Clear — max ${Math.round(maxTemp)}°C, precipitation ${Math.round(precipitation)}mm`
  const userMessage = `Today's predictions:
${contextPredictions.map(p => `- ${p.item_name}: ${p.predicted_qty} portions`).join('\n')}

Weather: ${weatherSummary}
Festival flag: ${festivalFlag || 'none'}
Day of week: ${dayOfWeek}
Date: ${formattedDate}`

  // Step 4: Call Prompt C for formatted message
  let messageText = await callGemini(SYSTEM_PROMPT_C, userMessage, 600, 0.7)

  if (!messageText) {
    // Deterministic fallback
    const itemsList = contextPredictions.map(p => `• ${p.item_name} — ${p.predicted_qty}`)
    const weatherBlock = weatherNote ? `\n\n${weatherNote}` : ''
    messageText = `Good morning Sam! Here's today's prep 🍽️\n\n${itemsList.join('\n')}${weatherBlock}\n\nReply 1 to go with this\nOr tell me what you're changing (e.g. 'biryani 25, fish curry 10')`
  }

  // Enforce character limit
  if (messageText.length > 1500) messageText = messageText.slice(0, 1480) + '...'

  await whatsappReply(process.env.SAM_WHATSAPP_TO, messageText)
  await setBotState(process.env.SAM_WHATSAPP_TO, 'awaiting_prep_confirm', {
    date: today,
    predictions: contextPredictions
  })
}

async function runPrepFollowupJob() {
  const state = await supabase
    .from('bot_state')
    .select('current_state')
    .eq('phone_number', process.env.SAM_WHATSAPP_TO)
    .maybeSingle()

  if (state.data?.current_state === 'awaiting_prep_confirm') {
    await whatsappReply(
      process.env.SAM_WHATSAPP_TO,
      "Hi Sam! Just checking — did you see today's prep sheet?\nReply 1 to confirm or tell me your changes."
    )
  }
}

async function runPrepAutoConfirmJob() {
  const today = todayIST()
  const { data: state } = await supabase
    .from('bot_state')
    .select('current_state')
    .eq('phone_number', process.env.SAM_WHATSAPP_TO)
    .maybeSingle()

  if (state?.current_state === 'awaiting_prep_confirm') {
    await supabase
      .from('predictions')
      .update({ confirmed: true })
      .eq('date', today)

    await setBotState(process.env.SAM_WHATSAPP_TO, 'idle', null)
    await whatsappReply(
      process.env.SAM_WHATSAPP_TO,
      "No worries — I've locked in today's prep as suggested ✓"
    )
  }
}

async function runEveningCheckinJob() {
  await setBotState(process.env.SAM_WHATSAPP_TO, 'awaiting_evening_checkin', null)
  await whatsappReply(
    process.env.SAM_WHATSAPP_TO,
    'Hi Sam! How did today go? 🌇\n\nAnything to flag — stockouts, big groups, equipment trouble, or power cuts?\n\n(Voice note or text, whichever is easier)'
  )
}

async function runWastagePromptJob() {
  const today = todayIST()
  const { data: predictions, error } = await supabase
    .from('predictions')
    .select('menu_items(name)')
    .eq('date', today)

  if (error) throw error

  const examples = (predictions || []).map(p => p.menu_items?.name || 'Item')
  const exampleText = examples.length > 0 ? examples.join(', ') : 'biryani, fish curry'

  // Only set state if Sam isn't mid-flow in something else
  const { data: currentState } = await supabase
    .from('bot_state')
    .select('current_state')
    .eq('phone_number', process.env.SAM_WHATSAPP_TO)
    .maybeSingle()

  const safeToOverwrite = !currentState?.current_state
    || currentState.current_state === 'idle'
    || currentState.current_state === 'awaiting_evening_checkin'

  if (!safeToOverwrite) {
    console.warn(`[CRON] Wastage prompt skipped — bot is in state: ${currentState.current_state}`)
    return
  }

  await setBotState(process.env.SAM_WHATSAPP_TO, 'awaiting_wastage', { date: today })
  await whatsappReply(
    process.env.SAM_WHATSAPP_TO,
    `Hi Sam! What's left over tonight? 🗑️\n\n${exampleText}\n\n(e.g. 'biryani 3, fish curry 0, chai all sold')`
  )
}

// 8:00 AM Tue–Sun
cron.schedule('0 8 * * 2-7', () => {
  console.log(`[CRON] MORNING_PREP_SHEET fired at ${new Date().toISOString()}`)
  runMorningPrepJob().catch(err => console.error('[CRON] MORNING_PREP_SHEET failed', err))
}, IST)

// 9:15 AM Tue–Sun
cron.schedule('15 9 * * 2-7', () => {
  console.log(`[CRON] PREP_SHEET_FOLLOWUP fired at ${new Date().toISOString()}`)
  runPrepFollowupJob().catch(err => console.error('[CRON] PREP_SHEET_FOLLOWUP failed', err))
}, IST)

// 9:30 AM Tue–Sun
cron.schedule('30 9 * * 2-7', () => {
  console.log(`[CRON] PREP_SHEET_AUTOCONFIRM fired at ${new Date().toISOString()}`)
  runPrepAutoConfirmJob().catch(err => console.error('[CRON] PREP_SHEET_AUTOCONFIRM failed', err))
}, IST)

// 7:00 PM Tue–Sun
cron.schedule('0 19 * * 2-7', () => {
  console.log(`[CRON] EVENING_CHECKIN_PROMPT fired at ${new Date().toISOString()}`)
  runEveningCheckinJob().catch(err => console.error('[CRON] EVENING_CHECKIN_PROMPT failed', err))
}, IST)

// 10:00 PM Tue–Sun + Sunday
cron.schedule('0 22 * * 0,2-7', () => {
  console.log(`[CRON] WASTAGE_PROMPT fired at ${new Date().toISOString()}`)
  runWastagePromptJob().catch(err => console.error('[CRON] WASTAGE_PROMPT failed', err))
}, IST)

// 10:15 PM Tue–Sun + Sunday
cron.schedule('15 22 * * 0,2-7', () => {
  console.log(`[CRON] WASTAGE_AUTOPROCEED fired at ${new Date().toISOString()}`)
}, IST)

// 9:00 PM Sunday
cron.schedule('0 21 * * 0', () => {
  console.log(`[CRON] WEEKLY_SUMMARY fired at ${new Date().toISOString()}`)
}, IST)

// 11:00 PM Daily
cron.schedule('0 23 * * *', () => {
  console.log(`[CRON] SHEETS_SYNC fired at ${new Date().toISOString()}`)
}, IST)

console.log('[CRON] All jobs scheduled (Asia/Kolkata)')

module.exports = {
  runMorningPrepJob,
  runPrepFollowupJob,
  runPrepAutoConfirmJob,
  runEveningCheckinJob,
  runWastagePromptJob
}
