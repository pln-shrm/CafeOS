const supabase = require('../../services/supabaseClient')
const { formatRupees, todayIST, twilioReply } = require('./helpers')

async function handleSummaryQuery(phoneNumber) {
  const today = todayIST()

  const { data: orders, error } = await supabase
    .from('orders')
    .select('total, payment_method')
    .eq('bill_date', today)

  if (error) throw error

  if (!orders || orders.length === 0) {
    await twilioReply(phoneNumber, 'No orders logged yet today.')
    return
  }

  let total = 0
  let cash = 0
  let upi = 0
  let pending = 0

  for (const order of orders) {
    const amount = Number(order.total)
    total += amount
    if (order.payment_method === 'cash') cash += amount
    if (order.payment_method === 'upi') upi += amount
    if (order.payment_method === 'pending') pending += amount
  }

  await twilioReply(
    phoneNumber,
    `Today's summary:\nOrders: ${orders.length}\nRevenue: ${formatRupees(total)}\nCash: ${formatRupees(cash)} | UPI: ${formatRupees(upi)} | Pending: ${formatRupees(pending)}`
  )
}

module.exports = handleSummaryQuery
