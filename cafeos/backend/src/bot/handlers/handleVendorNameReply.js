const { setBotState, whatsappButtons } = require('./helpers')

function buildVendorMessage(items) {
  const list = items.map(item => `${item.name} ${item.qty}${item.unit || ''}`)
  return `${list.join(', ')} — please deliver tomorrow morning.`
}

async function handleVendorNameReply(phoneNumber, message, context) {
  const vendorName = message.trim()
  const items = context?.items || []
  const formattedMessage = buildVendorMessage(items)

  await setBotState(phoneNumber, 'awaiting_vendor_confirm', {
    vendor_name: vendorName,
    items,
    formatted_message: formattedMessage
  })

  await whatsappButtons(
    phoneNumber,
    `Logged ✓\n\nReady to send to ${vendorName}:\n\n"${formattedMessage}"`,
    [
      { id: '1', title: 'Confirm ✅' },
      { id: '2', title: 'Edit ✏️' }
    ]
  )
}

module.exports = handleVendorNameReply
