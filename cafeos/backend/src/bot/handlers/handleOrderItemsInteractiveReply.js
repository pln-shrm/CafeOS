const { parseVendorItems, setBotState, whatsappReply, whatsappButtons } = require('./helpers')
const { handleGreeting, isGreeting } = require('./handleGreeting')

const CANCEL_WORDS = ['cancel', 'stop', 'exit', 'quit', 'close', 'close chat', 'back', 'menu', 'hi', 'hello', 'hey']

async function handleOrderItemsInteractiveReply(phoneNumber, message, context) {
  const { vendor_name, source } = context || {}
  const lowered = message.toLowerCase().trim()

  // Let users escape the ordering flow
  if (CANCEL_WORDS.includes(lowered) || isGreeting(lowered)) {
    await setBotState(phoneNumber, 'idle')
    await handleGreeting(phoneNumber)
    return
  }

  const items = await parseVendorItems(message)

  if (items.length === 0) {
    await whatsappReply(
      phoneNumber,
      `I didn't catch any items. Try something like: rice 5kg, dal 2kg, oil 1L\n\nOr type "cancel" to go back to the menu.`
    )
    return
  }

  const formattedMessage =
    items.map(i => `${i.name} ${i.qty}${i.unit || ''}`).join(', ') +
    ' — please deliver tomorrow morning.'

  await setBotState(phoneNumber, 'awaiting_vendor_confirm', {
    vendor_name,
    items,
    formatted_message: formattedMessage,
    source
  })

  await whatsappButtons(
    phoneNumber,
    `Logged ✓\n\nReady to send to ${vendor_name}:\n\n"${formattedMessage}"`,
    [
      { id: '1', title: 'Confirm ✅' },
      { id: '2', title: 'Edit ✏️' }
    ]
  )
}

module.exports = handleOrderItemsInteractiveReply
