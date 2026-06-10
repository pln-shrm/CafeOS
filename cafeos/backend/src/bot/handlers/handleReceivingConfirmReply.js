const supabase = require('../../services/supabaseClient')
const { setBotState, whatsappReply, incrementInventoryLevels } = require('./helpers')

async function handleReceivingConfirmReply(phoneNumber, message, context) {
  const text = message.trim().toLowerCase()
  const orderId = context?.order_id

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

  await whatsappReply(phoneNumber, 'Reply 1 to confirm everything arrived, or 2 to edit.')
}

module.exports = handleReceivingConfirmReply
