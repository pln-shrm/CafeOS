const { Router } = require('express')
const { formatInTimeZone } = require('date-fns-tz')
const supabase = require('../services/supabaseClient')
const { anyAuthMiddleware } = require('../middleware/auth')
const { ok, fail } = require('../utils/response')

const router = Router()
const IST = 'Asia/Kolkata'

// GET /api/billing/summary?date=YYYY-MM-DD
router.get('/summary', anyAuthMiddleware, async (req, res) => {
  const date = req.query.date || formatInTimeZone(new Date(), IST, 'yyyy-MM-dd')

  // Basic date format validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return fail(res, 'VALIDATION_ERROR', 'date must be YYYY-MM-DD', 400)
  }

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, total, payment_method, order_items(menu_item_id, quantity, menu_items(name))')
    .eq('bill_date', date)

  if (error) throw error

  const total_orders = orders.length

  // Top 5 items by quantity sold
  const itemTotals = {}
  for (const order of orders) {
    for (const oi of order.order_items || []) {
      const name = oi.menu_items?.name || `item_${oi.menu_item_id}`
      itemTotals[name] = (itemTotals[name] || 0) + oi.quantity
    }
  }
  const top_items = Object.entries(itemTotals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, units_sold]) => ({ name, units_sold }))

  if (req.role === 'staff') {
    return ok(res, { date, total_orders, top_items })
  }

  // Owner gets full revenue breakdown
  let total_revenue = 0, cash_revenue = 0, upi_revenue = 0, pending_revenue = 0
  for (const order of orders) {
    const amount = Number(order.total)
    total_revenue += amount
    if (order.payment_method === 'cash') cash_revenue += amount
    else if (order.payment_method === 'upi') upi_revenue += amount
    else if (order.payment_method === 'pending') pending_revenue += amount
  }

  return ok(res, {
    date,
    total_orders,
    total_revenue: Math.round(total_revenue * 100) / 100,
    cash_revenue: Math.round(cash_revenue * 100) / 100,
    upi_revenue: Math.round(upi_revenue * 100) / 100,
    pending_revenue: Math.round(pending_revenue * 100) / 100,
    top_items
  })
})

module.exports = router
