const supabase = require('../../services/supabaseClient')
const { callGeminiJSON } = require('../../services/geminiService')
const { todayIST, tomorrowIST, whatsappReply } = require('./helpers')

const schemaEvent = {
  type: "object",
  properties: {
    date: { type: "string", nullable: true },
    description: { type: "string", nullable: true },
    demand_multiplier: { type: "number", nullable: true }
  }
}

const SYSTEM_PROMPT_EVENT = `You are an assistant for a small cafe in Goa, India.
Sam (the owner) is flagging an upcoming event that may affect demand at the cafe.
You are given today's date (IST). Extract:

- "date": the event date as YYYY-MM-DD. Resolve relative terms ("tomorrow", "day after", "this Saturday") against today's date. If no date is stated, use tomorrow.
- "description": a short (under 15 words) description of the event.
- "demand_multiplier": your estimate of the demand impact.
  More customers expected (big group, festival crowd, college fest nearby): 1.2–2.0, default 1.3.
  Fewer customers expected (road closed, bandh, heavy storm warning): 0.5–0.9.
Sam may write in English, Hindi, Konkani, or a mix.`

async function handleEventFlag(phoneNumber, message = '') {
  const today = todayIST()
  const fallbackDate = tomorrowIST()

  const parsed = await callGeminiJSON(
    SYSTEM_PROMPT_EVENT,
    `Today's date: ${today}\nSam's message: "${message}"`,
    200,
    schemaEvent
  )

  const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed?.date || '') ? parsed.date : fallbackDate
  const rawMult = Number(parsed?.demand_multiplier)
  const multiplier = rawMult > 0 ? Math.min(Math.max(rawMult, 0.5), 2.5) : 1.3
  const description = (parsed?.description || message || 'Owner-flagged event').slice(0, 200)

  const { error } = await supabase.from('event_flags').insert({
    date,
    description,
    demand_multiplier: multiplier
  })

  if (error) {
    console.error('[EventFlag] Insert failed:', error.message)
    await whatsappReply(phoneNumber, "Noted — I'll keep that in mind for prep planning.")
    return
  }

  const pct = Math.round((multiplier - 1) * 100)
  const direction = pct >= 0 ? `up ~${pct}%` : `down ~${Math.abs(pct)}%`
  await whatsappReply(
    phoneNumber,
    `Noted ✓ ${description} on ${date}.\nI'll adjust that day's prep ${direction}.`
  )
}

module.exports = handleEventFlag
