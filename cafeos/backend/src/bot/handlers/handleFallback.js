const { whatsappReply } = require('./helpers')

async function handleFallback(phoneNumber) {
  await whatsappReply(
    phoneNumber,
    "Sorry Sam, I didn't get that.\n\nYou can send me:\n• order [items] → [vendor]\n• summary\n• stock\n• credit/paid [vendor] ₹[amount]"
  )
}

module.exports = handleFallback
