const { Router } = require('express')
const axios = require('axios')
const crypto = require('crypto')

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
const handleReceivingCommand = require('./handlers/handleReceivingCommand')
const handleReceivingConfirmReply = require('./handlers/handleReceivingConfirmReply')
const handleReceivingEditReply = require('./handlers/handleReceivingEditReply')
const handleAnomalyResolutionReply = require('./handlers/handleAnomalyResolutionReply')
const handleStockConfirmReply = require('./handlers/handleStockConfirmReply')

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
    case 'awaiting_receiving_confirm':
      await handleReceivingConfirmReply(phoneNumber, trimmed, stateRow.context_json)
      return
    case 'awaiting_receiving_edit':
      await handleReceivingEditReply(phoneNumber, trimmed, stateRow.context_json)
      return
    case 'awaiting_anomaly_resolution':
      await handleAnomalyResolutionReply(phoneNumber, trimmed, stateRow.context_json)
      return
    case 'awaiting_stock_confirm':
      await handleStockConfirmReply(phoneNumber, trimmed, stateRow.context_json)
      return
    default:
      break
  }

  if (lowered.startsWith('order')) {
    await handleVendorOrderCommand(phoneNumber, trimmed)
    return
  }

  if (lowered.includes('received') || lowered.includes('arrived') || lowered.includes('delivery')) {
    await handleReceivingCommand(phoneNumber, trimmed)
    return
  }

  if (lowered.startsWith('credit') || lowered.startsWith('paid')) {
    await handleCreditCommand(phoneNumber, trimmed)
    return
  }

  // owe/balance before summary so "what do I owe today" isn't swallowed by "today"
  if (lowered.includes('owe') || lowered.includes('balance')) {
    await handleBalanceQuery(phoneNumber, trimmed)
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

  if (lowered.includes('event')) {
    await handleEventFlag(phoneNumber, trimmed)
    return
  }

  await handleFallback(phoneNumber, trimmed)
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
  // Verify Meta HMAC signature to reject forged webhooks
  const appSecret = process.env.META_APP_SECRET
  if (appSecret) {
    const sigHeader = req.headers['x-hub-signature-256']
    if (!sigHeader) return res.sendStatus(401)
    const expected = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(req.rawBody)
      .digest('hex')
    const sigBuf = Buffer.from(sigHeader)
    const expBuf = Buffer.from(expected)
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.sendStatus(403)
    }
  }

  const body = req.body

  if (!body.object) {
    return res.sendStatus(404)
  }

  const messageInfo = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
  if (messageInfo) {
    const MessageSid = messageInfo.id
    const From = messageInfo.from
    // Button/list taps arrive as type "interactive" — route the tapped option's id
    // as the message body so handlers see the same '1'/'2' they expect from text.
    const interactiveReply = messageInfo.interactive?.button_reply || messageInfo.interactive?.list_reply
    const Body = interactiveReply?.id || messageInfo.text?.body || ''
    const isAudio = messageInfo.type === 'audio'
    const audioMediaId = isAudio ? messageInfo.audio?.id : null

    // Atomic dedupe: insert and let the unique constraint reject retries.
    // Avoids the select-then-insert race when Meta delivers the same message twice concurrently.
    const { error: insertErr } = await supabase
      .from('processed_webhooks')
      .insert({ message_sid: MessageSid })

    if (insertErr) {
      if (insertErr.code !== '23505') {
        console.error('[Webhook] Dedup insert failed', insertErr)
      }
      return res.status(200).send('OK') // duplicate or can't guarantee dedup — bail out safely
    }

    console.log(`[DEBUG] Incoming from: "${From}", Expected: "${process.env.SAM_WHATSAPP_TO}"`)

    if (From !== process.env.SAM_WHATSAPP_TO) {
      console.log(`[DEBUG] Mismatch! Ignoring message.`)
      return res.status(200).send('OK')
    }

    res.status(200).send('OK')

    setImmediate(async () => {
      let mediaUrl = null
      if (isAudio && audioMediaId) {
        try {
          const mediaRes = await axios.get(
            `https://graph.facebook.com/v17.0/${audioMediaId}`,
            { headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` } }
          )
          mediaUrl = mediaRes.data?.url || null
        } catch (err) {
          console.warn('[Webhook] Failed to resolve audio media URL', err.message)
        }
      }

      routeMessage({
        phoneNumber: From,
        message: Body,
        isVoiceNote: isAudio,
        mediaUrl
      }).catch(err => {
        console.error('[Webhook] Async processing failed', err)
      })
    })
  } else {
    res.sendStatus(200)
  }
})

module.exports = router
