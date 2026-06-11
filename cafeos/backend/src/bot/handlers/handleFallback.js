const { callGeminiJSON } = require('../../services/geminiService')
const { whatsappReply } = require('./helpers')
const handleSummaryQuery = require('./handleSummaryQuery')
const handleStockQuery = require('./handleStockQuery')
const handleBalanceQuery = require('./handleBalanceQuery')
const handleVendorOrderCommand = require('./handleVendorOrderCommand')
const handleReceivingCommand = require('./handleReceivingCommand')
const handleCreditCommand = require('./handleCreditCommand')
const handleEventFlag = require('./handleEventFlag')

const HELP_TEXT = "Sorry Sam, I didn't get that.\n\nYou can send me:\n• order [items] → [vendor]\n• summary\n• stock\n• credit/paid [vendor] ₹[amount]"

const schemaIntent = {
  type: "object",
  properties: {
    intent: { type: "string" },
    vendor_name: { type: "string", nullable: true }
  }
}

const SYSTEM_PROMPT_INTENT = `You are the intent router for CafeOS, a WhatsApp assistant for Sam, a cafe owner in Goa.
Sam writes in English, Hindi, Konkani, or a mix. Classify her message into exactly ONE intent:

- "summary": asking about today's sales, revenue, or orders ("kitna hua aaj", "how was business")
- "stock": asking what's left to sell / prep remaining / inventory status
- "balance": asking how much she owes a vendor — also extract "vendor_name"
- "credit": logging that she took goods on credit OR made a payment to a vendor (mentions an amount)
- "vendor_order": wants to order/buy items from a vendor (mentions items and quantities to buy)
- "receiving": reporting that a delivery/order arrived
- "event": flagging an upcoming event, big group, or anything that changes expected demand
- "unknown": greetings, thanks, or anything that doesn't fit

Set "vendor_name" only for "balance"; otherwise null. When in doubt, use "unknown" — never guess.`

async function handleFallback(phoneNumber, message = '') {
  if (message.trim()) {
    const parsed = await callGeminiJSON(
      SYSTEM_PROMPT_INTENT,
      `Sam's message: "${message}"`,
      150,
      schemaIntent
    )

    switch (parsed?.intent) {
      case 'summary':
        return handleSummaryQuery(phoneNumber)
      case 'stock':
        return handleStockQuery(phoneNumber)
      case 'balance':
        return handleBalanceQuery(phoneNumber, `owe ${parsed.vendor_name || message}`)
      case 'credit':
        return handleCreditCommand(phoneNumber, message)
      case 'vendor_order':
        return handleVendorOrderCommand(phoneNumber, message)
      case 'receiving':
        return handleReceivingCommand(phoneNumber, message)
      case 'event':
        return handleEventFlag(phoneNumber, message)
      default:
        break
    }
  }

  await whatsappReply(phoneNumber, HELP_TEXT)
}

module.exports = handleFallback
