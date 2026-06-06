const { Router } = require('express')
const twilio = require('twilio')
const supabase = require('../services/supabaseClient')
const {
  getBotState,
  setBotState
} = require('./handlers/helpers')
const handleOnboarding = require('./handlers/handleOnboarding')
const handlePrepConfirmReply = require('./handlers/handlePrepConfirmReply')
const handlePrepEditReply = require('./handlers/handlePrepEditReply')
const handleVendorConfirmReply = require('./handlers/handleVendorConfirmReply')
const handleVendorEditReply = require('./handlers/handleVendorEditReply')
const handleVendorNameReply = require('./handlers/handleVendorNameReply')
const handleEveningCheckinReply = require('./handlers/handleEveningCheckinReply')
const handleWastageReply = require('./handlers/handleWastageReply')
const handleVendorOrderCommand = require('./handlers/handleVendorOrderCommand')
const handleCreditCommand = require('./handlers/handleCreditCommand')
const handleSummaryQuery = require('./handlers/handleSummaryQuery')
const handleStockQuery = require('./handlers/handleStockQuery')
const handleBalanceQuery = require('./handlers/handleBalanceQuery')
const handleEventFlag = require('./handlers/handleEventFlag')
const handleFallback = require('./handlers/handleFallback')

const router = Router()

function buildRequestUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol
  return `${proto}://${req.get('host')}${req.originalUrl}`
}

async function routeMessage({ phoneNumber, message, isVoiceNote, mediaUrl }) {
  const trimmed = message.trim()
  const lowered = trimmed.toLowerCase()

  const stateRow = await getBotState(phoneNumber)
  if (!stateRow) {
    await handleOnboarding(phoneNumber)
    return
  }

  if (stateRow.updated_at && stateRow.current_state !== 'idle') {
    const updatedAt = new Date(stateRow.updated_at)
    const staleCutoff = Date.now() - 6 * 60 * 60 * 1000
    if (updatedAt.getTime() < staleCutoff) {
      await setBotState(phoneNumber, 'idle', null)
      console.log('[Bot] Stale state reset', stateRow.current_state)
      stateRow.current_state = 'idle'
      stateRow.context_json = null
    }
  }

  switch (stateRow.current_state) {
    case 'awaiting_prep_confirm':
      await handlePrepConfirmReply(phoneNumber, trimmed)
      return
    case 'awaiting_prep_edit':
      await handlePrepEditReply(phoneNumber, trimmed)
      return
    case 'awaiting_vendor_confirm':
      await handleVendorConfirmReply(phoneNumber, trimmed, stateRow.context_json)
      return
    case 'awaiting_vendor_edit':
      await handleVendorEditReply(phoneNumber, trimmed, stateRow.context_json)
      return
    case 'awaiting_vendor_name':
      await handleVendorNameReply(phoneNumber, trimmed, stateRow.context_json)
      return
    case 'awaiting_evening_checkin':
      await handleEveningCheckinReply(phoneNumber, trimmed, isVoiceNote, mediaUrl)
      return
    case 'awaiting_wastage':
      await handleWastageReply(phoneNumber, trimmed)
      return
    default:
      break
  }

  if (lowered.startsWith('order')) {
    await handleVendorOrderCommand(phoneNumber, trimmed)
    return
  }

  if (lowered.startsWith('credit') || lowered.startsWith('paid')) {
    await handleCreditCommand(phoneNumber, trimmed)
    return
  }

  if (lowered.includes('summary') || lowered.includes('aaj') || lowered.includes('today')) {
    await handleSummaryQuery(phoneNumber)
    return
  }

  if (lowered.includes('stock') || lowered.includes('inventory')) {
    await handleStockQuery(phoneNumber)
    return
  }

  if (lowered.includes('owe') || lowered.includes('balance')) {
    await handleBalanceQuery(phoneNumber, trimmed)
    return
  }

  if (lowered.includes('event')) {
    await handleEventFlag(phoneNumber)
    return
  }

  await handleFallback(phoneNumber)
}

router.post('/', async (req, res) => {
  const signature = req.headers['x-twilio-signature']
  const url = buildRequestUrl(req)

  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    req.body
  )

  if (!valid) {
    return res.status(403).send('Forbidden')
  }

  const { MessageSid, From, Body, NumMedia, MediaContentType0, MediaUrl0 } = req.body

  const { data: existing, error: dedupeErr } = await supabase
    .from('processed_webhooks')
    .select('message_sid')
    .eq('message_sid', MessageSid)
    .maybeSingle()

  if (dedupeErr) {
    console.error('[Webhook] Dedup check failed', dedupeErr)
  }

  if (existing) {
    return res.status(200).send('<Response></Response>')
  }

  const { error: insertErr } = await supabase
    .from('processed_webhooks')
    .insert({ message_sid: MessageSid })

  if (insertErr) {
    console.error('[Webhook] Dedup insert failed', insertErr)
  }

  if (From !== process.env.SAM_WHATSAPP_TO) {
    return res.status(200).send('<Response></Response>')
  }

  res.status(200).send('<Response></Response>')

  const isVoiceNote = Number(NumMedia) === 1 && MediaContentType0?.startsWith('audio/')

  setImmediate(() => {
    routeMessage({
      phoneNumber: From,
      message: Body || '',
      isVoiceNote,
      mediaUrl: isVoiceNote ? (MediaUrl0 || null) : null
    }).catch(err => {
      console.error('[Webhook] Async processing failed', err)
    })
  })
})

module.exports = router
