const axios = require('axios')
const supabase = require('../../services/supabaseClient')
const { callGeminiJSON } = require('../../services/geminiService')
const { setBotState, todayIST, whatsappReply } = require('./helpers')

const schemaA = {
  type: "object",
  properties: {
    stockouts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string" },
          time: { type: "string", nullable: true }
        }
      },
      nullable: true
    },
    demand_spike: { type: "string", nullable: true },
    power_disruption: {
      type: "object",
      properties: {
        time: { type: "string", nullable: true },
        duration_hours: { type: "number", nullable: true }
      },
      nullable: true
    },
    weather_impact: { type: "string", nullable: true },
    other_notes: { type: "string", nullable: true }
  }
};

const SYSTEM_PROMPT_A = `You are an assistant for a small cafe in Goa, India.
The cafe owner, Sam, has sent a text message describing how today went.
Extract structured signals from her message.
Sam may write in English, Hindi, Konkani, or a mix of all three.

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

const schemaB = {
  type: "object",
  properties: {
    transcription: { type: "string" },
    stockouts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string" },
          time: { type: "string", nullable: true }
        }
      },
      nullable: true
    },
    demand_spike: { type: "string", nullable: true },
    power_disruption: {
      type: "object",
      properties: {
        time: { type: "string", nullable: true },
        duration_hours: { type: "number", nullable: true }
      },
      nullable: true
    },
    weather_impact: { type: "string", nullable: true },
    other_notes: { type: "string", nullable: true }
  }
};

const SYSTEM_PROMPT_B = `You are an assistant for a small cafe in Goa, India.
You will receive an audio file — a voice note from the cafe owner, Sam.
Sam may speak in English, Hindi, Konkani, or a mix of all three.

Step 1: Transcribe the voice note accurately.
Step 2: Extract structured operational signals from the transcription.

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
  const parsed = await callGeminiJSON(SYSTEM_PROMPT_A, userMessage, 500, schemaA)

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
        headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
        timeout: 10000
      })
      const base64Audio = Buffer.from(audioRes.data).toString('base64')
      const mediaType = audioRes.headers['content-type'] || 'audio/ogg'

      const userContent = [
        "This is Sam's voice note from this evening. Please transcribe and extract signals.",
        {
          inlineData: {
            mimeType: mediaType,
            data: base64Audio
          }
        }
      ]

      // callGeminiJSON handles null return if API rejects audio content type
      parsed = await callGeminiJSON(SYSTEM_PROMPT_B, userContent, 800, schemaB)
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
