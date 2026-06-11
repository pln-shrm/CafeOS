const cron = require('node-cron')
const axios = require('axios')
const supabase = require('../services/supabaseClient')
const { whatsappReply, whatsappButtons } = require('../services/whatsappClient')
const { callGemini } = require('../services/geminiService')
const { formatInTimeZone } = require('date-fns-tz')
const { setBotState, todayIST, formatRupees } = require('../bot/handlers/helpers')
const { generatePredictions, confirmPredictions } = require('../intelligence/predictions')
const { resumePostWastageFlow } = require('../bot/handlers/handleWastageReply')

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
- Do NOT include any reply instructions, numbered options, or questions at the end — the app shows tap buttons separately.
- Total message must be under 950 characters.
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
    messageText = `Good morning Sam! Here's today's prep 🍽️\n\n${itemsList.join('\n')}${weatherBlock}`
  }

  // Enforce character limit (interactive body max is 1024)
  if (messageText.length > 1000) messageText = messageText.slice(0, 980) + '...'

  await whatsappButtons(process.env.SAM_WHATSAPP_TO, messageText, [
    { id: '1', title: 'Go with this ✅' },
    { id: '2', title: 'Make changes ✏️' }
  ])
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
    await whatsappButtons(
      process.env.SAM_WHATSAPP_TO,
      "Hi Sam! Just checking — did you see today's prep sheet?\nYou can also just type your changes (e.g. 'biryani 25').",
      [
        { id: '1', title: 'Go with it ✅' },
        { id: '2', title: 'Make changes ✏️' }
      ]
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

// If Sam never replied to the 10pm wastage prompt, proceed anyway:
// confirm today's predictions from sales alone (leftover unknown = 0),
// deduct today's ingredient usage, and continue the stock/vendor-order flow.
async function runWastageAutoProceedJob() {
  const today = todayIST()
  const { data: state } = await supabase
    .from('bot_state')
    .select('current_state')
    .eq('phone_number', process.env.SAM_WHATSAPP_TO)
    .maybeSingle()

  if (state?.current_state !== 'awaiting_wastage') return

  try {
    await confirmPredictions(today)
  } catch (err) {
    console.warn('[CRON] Auto-proceed confirmPredictions failed:', err.message)
  }

  await resumePostWastageFlow(
    process.env.SAM_WHATSAPP_TO,
    "No wastage reply — I'll assume everything sold today ✓"
  )
}

function daysAgoIST(n) {
  return formatInTimeZone(new Date(Date.now() - n * 86400000), 'Asia/Kolkata', 'yyyy-MM-dd')
}

const SYSTEM_PROMPT_WEEKLY = `You are CafeOS, a friendly assistant for Sam's Cafe in Goa.
Turn the facts below into Sam's weekly summary WhatsApp message.
Warm, plain English. Short lines. Format rupees as ₹X,XXX.
Open exactly with: "Hi Sam! Here's your week 📊"
Keep it under 1,000 characters. No markdown, no backticks, no commentary — just the summary.
Do not invent numbers not present in the facts.`

async function runWeeklySummaryJob() {
  const today = todayIST()
  const weekStart = daysAgoIST(6)

  const { data: orders } = await supabase
    .from('orders')
    .select('id, total, payment_method')
    .gte('bill_date', weekStart)
    .lte('bill_date', today)

  if (!orders || orders.length === 0) {
    await whatsappReply(process.env.SAM_WHATSAPP_TO, 'Hi Sam! No orders were logged this week — nothing to summarise 📊')
    return
  }

  const revenue = orders.reduce((s, o) => s + Number(o.total || 0), 0)

  // Top-selling items
  const orderIds = orders.map(o => o.id)
  const { data: orderItems } = await supabase
    .from('order_items')
    .select('menu_item_id, quantity')
    .in('order_id', orderIds)

  const soldMap = new Map()
  for (const row of orderItems || []) {
    soldMap.set(row.menu_item_id, (soldMap.get(row.menu_item_id) || 0) + Number(row.quantity))
  }
  const { data: menuItems } = await supabase.from('menu_items').select('id, name')
  const nameMap = new Map((menuItems || []).map(i => [i.id, i.name]))
  const topItems = [...soldMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, qty]) => `${nameMap.get(id) || 'Item'} (${qty} sold)`)

  // Wastage this week
  const { data: wastage } = await supabase
    .from('wastage_logs')
    .select('quantity_left')
    .gte('logged_at', weekStart)
    .lte('logged_at', today)
  const totalWaste = (wastage || []).reduce((s, w) => s + Number(w.quantity_left || 0), 0)

  // Outstanding vendor balances
  const { data: credits } = await supabase
    .from('vendor_credit')
    .select('vendor_name, amount, type')
  const balances = new Map()
  for (const c of credits || []) {
    const delta = c.type === 'credit' ? Number(c.amount) : -Number(c.amount)
    balances.set(c.vendor_name, (balances.get(c.vendor_name) || 0) + delta)
  }
  const owed = [...balances.entries()].filter(([, amt]) => amt > 0)
  const owedTotal = owed.reduce((s, [, amt]) => s + amt, 0)

  const facts = `Week: ${weekStart} to ${today}
Orders: ${orders.length}
Revenue: ${formatRupees(revenue)}
Top sellers: ${topItems.join(', ') || 'none'}
Total portions wasted: ${totalWaste}
Outstanding vendor credit: ${formatRupees(owedTotal)}${owed.length ? ` (${owed.map(([v, a]) => `${v} ${formatRupees(a)}`).join(', ')})` : ''}`

  let messageText = await callGemini(SYSTEM_PROMPT_WEEKLY, facts, 500, 0.5)
  if (!messageText) {
    messageText = `Hi Sam! Here's your week 📊\n\n${facts}`
  }

  await whatsappReply(process.env.SAM_WHATSAPP_TO, messageText)
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

// 10:45 PM Tue–Sun + Sunday — proceed if Sam didn't reply to the wastage prompt
cron.schedule('45 22 * * 0,2-7', () => {
  console.log(`[CRON] WASTAGE_AUTOPROCEED fired at ${new Date().toISOString()}`)
  runWastageAutoProceedJob().catch(err => console.error('[CRON] WASTAGE_AUTOPROCEED failed', err))
}, IST)

// 9:00 PM Sunday
cron.schedule('0 21 * * 0', () => {
  console.log(`[CRON] WEEKLY_SUMMARY fired at ${new Date().toISOString()}`)
  runWeeklySummaryJob().catch(err => console.error('[CRON] WEEKLY_SUMMARY failed', err))
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
  runWastagePromptJob,
  runWastageAutoProceedJob,
  runWeeklySummaryJob
}
