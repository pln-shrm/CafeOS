const { parseVendorItems, setBotState, whatsappReply } = require('./helpers')

function buildVendorMessage(items) {
  const list = items.map(item => `${item.name} ${item.qty}${item.unit || ''}`)
  return `${list.join(', ')} — please deliver tomorrow morning.`
}

async function handleVendorEditReply(phoneNumber, message, context) {
  const parsedItems = parseVendorItems(message)
  const items = parsedItems.length > 0 ? parsedItems : (context?.items || [])
  const formattedMessage = buildVendorMessage(items)
  const vendorName = context?.vendor_name || 'vendor'

  const nextContext = {
    vendor_name: vendorName,
    items,
    formatted_message: formattedMessage
  }

  await setBotState(phoneNumber, 'awaiting_vendor_confirm', nextContext)
  await whatsappReply(
    phoneNumber,
    `Got it — here's the updated order: ${formattedMessage}\nReply 1 to confirm.`
  )
}

module.exports = handleVendorEditReply
