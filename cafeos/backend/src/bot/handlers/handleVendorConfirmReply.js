const supabase = require('../../services/supabaseClient')
const { callClaude } = require('../../services/claudeService')
const { setBotState, whatsappReply } = require('./helpers')

const SYSTEM_PROMPT_F = `You are CafeOS, generating a WhatsApp vendor order message on behalf of Sam's Cafe in Goa.
The message must sound like Sam wrote it herself — natural, conversational, direct.
The vendor should not know a system generated this.
Return ONLY the message text — no quotes, no preamble, no label, no explanation.

Rules:
- Write in simple, warm Hindi-English mix OR plain English depending on vendor name context.
  Default to plain English unless vendor name suggests a local contact.
- List items clearly: item + quantity per line or as a comma-separated list.
- Include delivery date naturally: "please send tomorrow morning" or "please deliver tomorrow".
  Never use ISO dates.
- Keep it under 200 characters if possible. Never exceed 350 characters.
- Sound like a regular WhatsApp message between two people who know each other.`

async function buildForwardableMessage(items, vendorName) {
  const itemList = (items || [])
    .filter(i => (i.qty ?? i.quantity ?? 0) > 0)
    .map(i => `${i.name} ${i.qty ?? i.quantity}${i.unit ? i.unit : ''}`)
    .join(', ')

  if (!itemList) return null

  const userMessage = `Items: ${itemList}\nDelivery: tomorrow morning\nNotes: none`
  const claudeMsg = await callClaude(SYSTEM_PROMPT_F, userMessage, 300, 0.7)
  if (claudeMsg) return claudeMsg

  // Fallback
  return `${itemList} — please deliver tomorrow morning`
}

async function handleVendorConfirmReply(phoneNumber, message, context) {
  const text = message.trim().toLowerCase()
  const vendorName = context?.vendor_name

  if (['1', 'ok', 'haan', 'yes'].includes(text)) {
    // Build the final forwardable message with Prompt F
    const formattedMessage = await buildForwardableMessage(context?.items, vendorName)
      || context?.formatted_message
      || 'Order placed — please deliver tomorrow morning.'

    await supabase
      .from('procurement')
      .insert({
        vendor_name: vendorName || 'vendor',
        items_json: context?.items || [],
        status: 'pending_delivery'
      })

    await setBotState(phoneNumber, 'idle', null)

    const vendorLine = vendorName ? ` to ${vendorName}` : ''
    await whatsappReply(
      phoneNumber,
      `Order confirmed ✓\n\nForward this${vendorLine}:\n\n"${formattedMessage}"`
    )
    return
  }

  if (text === '2') {
    await setBotState(phoneNumber, 'awaiting_vendor_edit', context || null)
    await whatsappReply(phoneNumber, "What changes? (e.g. 'rice 6kg, skip oil')")
    return
  }

  await whatsappReply(phoneNumber, 'Reply 1 to confirm or 2 to edit.')
}

module.exports = handleVendorConfirmReply
