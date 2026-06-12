const { setBotState, whatsappReply } = require('./helpers')

async function handleOrderVendorNameReply(phoneNumber, message, context) {
  const vendorName = message.trim()
  const source = context?.source

  await setBotState(phoneNumber, 'awaiting_order_items_interactive', { vendor_name: vendorName, source })
  await whatsappReply(
    phoneNumber,
    `What would you like to order from *${vendorName}*?\n\nType items like: rice 5kg, dal 2kg, oil 1L`
  )
}

module.exports = handleOrderVendorNameReply
