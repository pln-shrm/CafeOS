const supabase = require('../../services/supabaseClient')
const { todayIST, twilioReply } = require('./helpers')

async function handleStockQuery(phoneNumber) {
  const today = todayIST()

  const { data: predictions, error: predErr } = await supabase
    .from('predictions')
    .select('menu_item_id, predicted_qty, owner_override, menu_items(name)')
    .eq('date', today)

  if (predErr) throw predErr

  if (!predictions || predictions.length === 0) {
    await twilioReply(phoneNumber, 'No prep predictions found for today.')
    return
  }

  const { data: orders, error: orderErr } = await supabase
    .from('orders')
    .select('order_items(menu_item_id, quantity)')
    .eq('bill_date', today)

  if (orderErr) throw orderErr

  const soldMap = new Map()
  for (const order of orders || []) {
    for (const item of order.order_items || []) {
      const current = soldMap.get(item.menu_item_id) || 0
      soldMap.set(item.menu_item_id, current + Number(item.quantity))
    }
  }

  const lines = predictions.map(prediction => {
    const planned = prediction.owner_override ?? prediction.predicted_qty
    const sold = soldMap.get(prediction.menu_item_id) || 0
    const remaining = Math.max(0, planned - sold)
    const name = prediction.menu_items?.name || 'Item'
    return `${name}: ${remaining} left (planned ${planned})`
  })

  await twilioReply(phoneNumber, `Stock status (est.):\n${lines.join('\n')}`)
}

module.exports = handleStockQuery
