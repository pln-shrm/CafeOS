const { Router } = require('express')

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

router.get('/', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      console.log('[Webhook] WEBHOOK_VERIFIED')
      return res.status(200).send(challenge)
    } else {
      return res.sendStatus(403)
    }
  } else {
    return res.sendStatus(400)
  }
})

router.post('/', async (req, res) => {
  const body = req.body
  console.log('\n--- Incoming Webhook ---')
  console.log(JSON.stringify(body, null, 2))


  if (!body.object) {
    return res.sendStatus(404)
  }

  if (
    body.entry &&
    body.entry[0].changes &&
    body.entry[0].changes[0] &&
    body.entry[0].changes[0].value.messages &&
    body.entry[0].changes[0].value.messages[0]
  ) {
    const messageInfo = body.entry[0].changes[0].value.messages[0]
    const MessageSid = messageInfo.id
    const From = messageInfo.from
    const Body = messageInfo.text?.body || ''

    const { data: existing, error: dedupeErr } = await supabase
      .from('processed_webhooks')
      .select('message_sid')
      .eq('message_sid', MessageSid)
      .maybeSingle()

    if (dedupeErr) {
      console.error('[Webhook] Dedup check failed', dedupeErr)
    }

    if (existing) {
      return res.status(200).send('OK')
    }

    const { error: insertErr } = await supabase
      .from('processed_webhooks')
      .insert({ message_sid: MessageSid })

    if (insertErr) {
      console.error('[Webhook] Dedup insert failed', insertErr)
    }

    if (From !== process.env.SAM_WHATSAPP_TO) {
      return res.status(200).send('OK')
    }

    res.status(200).send('OK')

    setImmediate(() => {
      routeMessage({
        phoneNumber: From,
        message: Body,
        isVoiceNote: false,
        mediaUrl: null
      }).catch(err => {
        console.error('[Webhook] Async processing failed', err)
      })
    })
  } else {
    res.sendStatus(200)
  }
})

module.exports = router
