const supabase = require('../../services/supabaseClient')
const { setBotState, whatsappReply, whatsappButtons, incrementInventoryLevels } = require('./helpers')

async function handleReceivingConfirmReply(phoneNumber, message, context) {
  const text = message.trim().toLowerCase()
  const orderId = context?.order_id

  if (!orderId) {
    await setBotState(phoneNumber, 'idle', null)
    await whatsappReply(phoneNumber, "I lost track of which order this was. Send 'received' again to restart.")
    return
  }

  if (['1', 'ok', 'haan', 'yes', 'y'].includes(text)) {
    await supabase
      .from('procurement')
      .update({ status: 'delivered' })
      .eq('id', orderId)

    await incrementInventoryLevels(context?.items || [])

    await setBotState(phoneNumber, 'idle', null)
    await whatsappReply(
      phoneNumber,
      `Inventory updated ✓\n\nMarked order from ${context?.vendor_name} as received.`
    )
    return
  }

  if (text === '2') {
    await setBotState(phoneNumber, 'awaiting_receiving_edit', context || null)
    await whatsappReply(phoneNumber, "What changed? (e.g. 'Only got 4kg tomatoes' or 'Skip milk')")
    return
  }

  await whatsappButtons(phoneNumber, 'Did everything arrive as ordered?', [
    { id: '1', title: 'All arrived ✅' },
    { id: '2', title: "Something's off ✏️" }
  ])
}

module.exports = handleReceivingConfirmReply
