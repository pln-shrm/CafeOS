const { parseVendorItems, setBotState, whatsappReply } = require('./helpers')

function extractVendorName(message) {
  const arrowSplit = message.split('→')
  if (arrowSplit.length > 1) return arrowSplit[1].trim()
  const asciiSplit = message.split('->')
  if (asciiSplit.length > 1) return asciiSplit[1].trim()
  return ''
}

function buildVendorMessage(items) {
  const list = items.map(item => `${item.name} ${item.qty}${item.unit || ''}`)
  return `${list.join(', ')} — please deliver tomorrow morning.`
}

async function handleVendorOrderCommand(phoneNumber, message) {
  const vendorName = extractVendorName(message)
  const itemText = message.split('→')[0].split('->')[0]
  const items = await parseVendorItems(itemText)

  if (items.length === 0) {
    await whatsappReply(phoneNumber, 'Please include items like: order rice 5kg, dal 3kg → Rice Vendor')
    return
  }

  if (!vendorName) {
    await setBotState(phoneNumber, 'awaiting_vendor_name', { items })
    await whatsappReply(phoneNumber, 'Got the items ✓ Who should this go to? (Reply with vendor name)')
    return
  }

  const formattedMessage = buildVendorMessage(items)
  await setBotState(phoneNumber, 'awaiting_vendor_confirm', {
    vendor_name: vendorName,
    items,
    formatted_message: formattedMessage
  })

  await whatsappReply(
    phoneNumber,
    `Logged ✓\n\nReady to send to ${vendorName}:\n\n"${formattedMessage}"\n\nForward this to place the order.\nReply 2 to edit.`
  )
}

module.exports = handleVendorOrderCommand
