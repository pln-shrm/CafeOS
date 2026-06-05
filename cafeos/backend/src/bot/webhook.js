const { Router } = require('express')
const twilio = require('twilio')
const supabase = require('../services/supabaseClient')

const router = Router()

// Validate that the request genuinely came from Twilio
const twilioValidate = twilio.webhook({ validate: true })

router.post('/', twilioValidate, async (req, res) => {
  const { MessageSid, From, Body } = req.body

  // ACK immediately so Twilio doesn't retry
  res.status(200).send('<Response></Response>')

  // Deduplicate — skip if we've already processed this MessageSid
  const { data: existing } = await supabase
    .from('processed_webhooks')
    .select('id')
    .eq('message_sid', MessageSid)
    .maybeSingle()

  if (existing) return

  await supabase
    .from('processed_webhooks')
    .insert({ message_sid: MessageSid })

  // Silently ignore messages from anyone other than the configured owner number
  if (From !== process.env.SAM_WHATSAPP_TO) return

  // Full routing comes in Week 5 — log for now
  console.log('[Webhook] Message received', { MessageSid, From, Body })
})

module.exports = router
