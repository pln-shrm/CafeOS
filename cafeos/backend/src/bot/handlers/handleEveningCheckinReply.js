const axios = require('axios')
const supabase = require('../../services/supabaseClient')
const { callClaudeJSON } = require('../../services/claudeService')
const { setBotState, todayIST, whatsappReply } = require('./helpers')

const SYSTEM_PROMPT_A = `You are an assistant for a small cafe in Goa, India.
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
- Hindi number words: ek=1, do=2, teen=3, char=4, panch=5, chhe=6, saat=7, aath=8, nau=9, das=10.`

const SYSTEM_PROMPT_B = `You are an assistant for a small cafe in Goa, India.
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
- "stockouts": list of items that ran out. Include approximate time if mentioned. null if none mentioned.
- "demand_spike": describe any unusually large or unexpected group or event. null if none.
- "power_disruption": log if a power cut was mentioned. Estimate duration if mentioned. null if none.
- "weather_impact": note if Sam said weather affected footfall. null if not mentioned.
- "other_notes": anything important that does not fit above fields. null if none.
- If audio is unclear or unintelligible, set transcription to "unclear audio" and all signal fields to null.
- Konkani number words: ek=1, don=2, teen=3, char=4, panch=5, saa=6, saat=7, aath=8, nav=9, dha=10.
- Hindi number words: ek=1, do=2, teen=3, char=4, panch=5, chhe=6, saat=7, aath=8, nau=9, das=10.`

function buildReply(parsed) {
  const lines = []
  if (parsed.stockouts?.length) {
    for (const s of parsed.stockouts) {
      lines.push(`• ${s.item} ran out${s.time ? ` ~${s.time}` : ''} — I'll suggest more tomorrow`)
    }
  }
  if (parsed.demand_spike) lines.push(`• ${parsed.demand_spike} — noted`)
  if (parsed.power_disruption) {
    lines.push(`• Power cut logged${parsed.power_disruption.time ? ` ~${parsed.power_disruption.time}` : ''}`)
  }
  if (parsed.weather_impact) lines.push(`• Weather impact noted`)
  if (parsed.other_notes) lines.push(`• ${parsed.other_notes}`)

  return lines.length
    ? `Got it, noted for tomorrow ✓\n${lines.join('\n')}`
    : 'Got it Sam ✓ All noted.'
}

async function handleTextCheckin(phoneNumber, rawText, today) {
  const userMessage = `Sam's message: "${rawText}"`
  const parsed = await callClaudeJSON(SYSTEM_PROMPT_A, userMessage, 500)

  if (parsed === null) {
    await supabase.from('checkins').upsert({
      date: today,
      raw_text: rawText,
      parsed_signals_json: null,
      input_type: 'text',
      claude_parse_success: false
    }, { onConflict: 'date' })
    await setBotState(phoneNumber, 'idle', null)
    await whatsappReply(phoneNumber, 'Got it Sam, I saved your note ✓')
    return
  }

  await supabase.from('checkins').upsert({
    date: today,
    raw_text: rawText,
    parsed_signals_json: parsed,
    input_type: 'text',
    claude_parse_success: true
  }, { onConflict: 'date' })

  await setBotState(phoneNumber, 'idle', null)
  await whatsappReply(phoneNumber, buildReply(parsed))
}

async function handleVoiceCheckin(phoneNumber, mediaUrl, today) {
  await whatsappReply(phoneNumber, 'Got it, listening... 🎧')

  let parsed = null

  if (mediaUrl) {
    try {
      const audioRes = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        auth: {
          username: process.env.TWILIO_ACCOUNT_SID,
          password: process.env.TWILIO_AUTH_TOKEN
        },
        timeout: 10000
      })
      const base64Audio = Buffer.from(audioRes.data).toString('base64')
      const mediaType = audioRes.headers['content-type'] || 'audio/ogg'

      const userContent = [
        {
          type: 'text',
          text: "This is Sam's voice note from this evening. Please transcribe and extract signals."
        },
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64Audio
          }
        }
      ]

      // callClaudeJSON handles null return if API rejects audio content type
      parsed = await callClaudeJSON(SYSTEM_PROMPT_B, userContent, 800)
    } catch (err) {
      console.warn('[EveningCheckin] Audio download/parse failed:', err.message)
      parsed = null
    }
  }

  if (parsed === null) {
    // Fallback: store raw mediaUrl, reply "saved"
    await supabase.from('checkins').upsert({
      date: today,
      raw_text: mediaUrl || 'voice_note_received',
      parsed_signals_json: null,
      input_type: 'voice_note',
      claude_parse_success: false
    }, { onConflict: 'date' })
    await setBotState(phoneNumber, 'idle', null)
    await whatsappReply(phoneNumber, 'Got it Sam, I saved your note ✓')
    return
  }

  const { transcription, ...signals } = parsed
  await supabase.from('checkins').upsert({
    date: today,
    raw_text: transcription || mediaUrl,
    parsed_signals_json: signals,
    input_type: 'voice_note',
    claude_parse_success: true
  }, { onConflict: 'date' })

  await setBotState(phoneNumber, 'idle', null)
  await whatsappReply(phoneNumber, buildReply(signals))
}

async function handleEveningCheckinReply(phoneNumber, message, isVoiceNote, mediaUrl) {
  const today = todayIST()

  if (isVoiceNote) {
    await handleVoiceCheckin(phoneNumber, mediaUrl, today)
  } else {
    await handleTextCheckin(phoneNumber, message, today)
  }
}

module.exports = handleEveningCheckinReply
