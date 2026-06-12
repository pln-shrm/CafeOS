const { setBotState, whatsappReply } = require('./helpers')

async function handleVendorSelectionReply(phoneNumber, message, context) {
  const { vendors = [], source } = context || {}
  const id = message.trim()

  if (id === 'vendor_other') {
    await setBotState(phoneNumber, 'awaiting_order_vendor_name', { source })
    await whatsappReply(phoneNumber, 'Which vendor? (Reply with their name)')
    return
  }

  const idx = parseInt(id.replace('vendor_', ''), 10)
  const vendorName = (!isNaN(idx) && vendors[idx]) ? vendors[idx] : id

  await setBotState(phoneNumber, 'awaiting_order_items_interactive', { vendor_name: vendorName, source })
  await whatsappReply(
    phoneNumber,
    `What would you like to order from *${vendorName}*?\n\nType items like: rice 5kg, dal 2kg, oil 1L`
  )
}

module.exports = handleVendorSelectionReply
