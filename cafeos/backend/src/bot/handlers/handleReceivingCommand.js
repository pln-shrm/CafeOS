const supabase = require('../../services/supabaseClient')
const { setBotState, whatsappReply } = require('./helpers')

async function handleReceivingCommand(phoneNumber, message) {
  // Try to find the most recent pending delivery
  const { data: pendingOrders, error } = await supabase
    .from('procurement')
    .select('*')
    .eq('status', 'pending_delivery')
    .order('timestamp', { ascending: false })
    .limit(1)
  
  if (error || !pendingOrders || pendingOrders.length === 0) {
    await whatsappReply(phoneNumber, 'I could not find any pending orders expecting delivery right now.')
    return
  }

  const order = pendingOrders[0]
  const vendorName = order.vendor_name
  const items = order.items_json || []

  if (items.length === 0) {
    await whatsappReply(phoneNumber, `Order from ${vendorName} is pending but has no items logged.`)
    return
  }

  const itemList = items.map(i => `${i.name} ${i.qty || i.quantity || 0}${i.unit || ''}`).join(', ')

  await setBotState(phoneNumber, 'awaiting_receiving_confirm', {
    order_id: order.id,
    vendor_name: vendorName,
    items: items
  })

  await whatsappReply(
    phoneNumber,
    `Did you receive the following from ${vendorName}?\n\n${itemList}\n\nReply 1 to confirm everything arrived, or 2 to edit (if items are missing).`
  )
}

module.exports = handleReceivingCommand
