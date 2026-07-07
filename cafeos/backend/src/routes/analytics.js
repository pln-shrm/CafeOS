const { Router } = require('express')
const supabase = require('../services/supabaseClient')
const { ok, fail } = require('../utils/response')
const { anyAuthMiddleware, ownerAuthMiddleware } = require('../middleware/auth')
const { trackUsage } = require('../services/analyticsService')

const router = Router()

// Helper to calculate current streak from a list of sorted (desc) date strings 'YYYY-MM-DD'
function calculateStreak(dates) {
  if (!dates || dates.length === 0) return 0

  // Format today and yesterday in local timezone
  const tzOptions = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }
  const now = new Date()
  
  // Format to YYYY-MM-DD
  const formatYMD = (d) => {
    const parts = new Intl.DateTimeFormat('en-CA', tzOptions).formatToParts(d)
    const year = parts.find(p => p.type === 'year').value
    const month = parts.find(p => p.type === 'month').value
    const day = parts.find(p => p.type === 'day').value
    return `${year}-${month}-${day}`
  }

  const todayStr = formatYMD(now)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = formatYMD(yesterday)

  const uniqueDates = [...new Set(dates)] // should already be unique per logic, but just in case
  
  let currentStreak = 0
  
  // If the most recent usage is neither today nor yesterday, streak is broken.
  if (uniqueDates[0] !== todayStr && uniqueDates[0] !== yesterdayStr) {
    return 0
  }

  let expectedDate = new Date(uniqueDates[0])
  
  for (let i = 0; i < uniqueDates.length; i++) {
    if (uniqueDates[i] === formatYMD(expectedDate)) {
      currentStreak++
      expectedDate.setDate(expectedDate.getDate() - 1)
    } else {
      break
    }
  }

  return currentStreak
}

// POST /api/analytics/track
// Called by WebApp to track usage
router.post('/track', anyAuthMiddleware, async (req, res) => {
  const userIdentifier = req.role === 'owner' ? req.owner.email : req.staffId
  
  const tzOptions = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }
  const parts = new Intl.DateTimeFormat('en-CA', tzOptions).formatToParts(new Date())
  const year = parts.find(p => p.type === 'year').value
  const month = parts.find(p => p.type === 'month').value
  const day = parts.find(p => p.type === 'day').value
  const dateStr = `${year}-${month}-${day}`

  await trackUsage('webapp', userIdentifier, dateStr)
  return ok(res, { tracked: true })
})

// GET /api/analytics/summary
// Fetches total days and streak for bot and webapp
router.get('/summary', ownerAuthMiddleware, async (req, res) => {
  // Fetch all unique date_used per source
  const { data, error } = await supabase
    .from('app_usage_logs')
    .select('source, date_used')
    
  if (error) {
    return fail(res, 'DB_ERROR', error.message, 500)
  }

  // We want to calculate the global streak for "bot" and "webapp", meaning did *anyone* use it.
  const botDates = [...new Set(data.filter(d => d.source === 'bot').map(d => d.date_used))].sort().reverse()
  const webappDates = [...new Set(data.filter(d => d.source === 'webapp').map(d => d.date_used))].sort().reverse()

  const summary = {
    bot: {
      totalDays: botDates.length,
      currentStreak: calculateStreak(botDates)
    },
    webapp: {
      totalDays: webappDates.length,
      currentStreak: calculateStreak(webappDates)
    }
  }

  return ok(res, summary)
})

// GET /api/analytics/business
// Fetches detailed business analytics (Revenue, Orders, Expenses, Top Items)
router.get('/business', ownerAuthMiddleware, async (req, res) => {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const fromTimestamp = thirtyDaysAgo.toISOString()

  try {
    // 1. Get Completed Orders in last 30 days
    const { data: orders, error: ordersErr } = await supabase
      .from('orders')
      .select('id, total')
      .eq('status', 'completed')
      .gte('timestamp', fromTimestamp)

    if (ordersErr) throw ordersErr

    const totalOrders = orders.length
    const totalRevenue = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0)
    const orderIds = orders.map(o => o.id)

    // 2. Get Top Selling Items
    let topItems = []
    if (orderIds.length > 0) {
      // Chunk orderIds if there are too many (Supabase URL limit), but for 100-200 it's fine.
      // Alternatively, we can just fetch all order_items joined with menu_items and filter in memory
      // to avoid URL length issues entirely.
      const { data: allOrderItems, error: oiErr } = await supabase
        .from('order_items')
        .select('order_id, quantity, menu_items ( name )')
      
      if (oiErr) throw oiErr

      const recentOrderItems = allOrderItems.filter(oi => orderIds.includes(oi.order_id))

      const itemCounts = {}
      for (const oi of recentOrderItems) {
        const name = oi.menu_items?.name || 'Unknown Item'
        const qty = Number(oi.quantity) || 1
        itemCounts[name] = (itemCounts[name] || 0) + qty
      }

      topItems = Object.entries(itemCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5) // Top 5
    }

    // 3. Get Procurement Expenses in last 30 days
    const { data: procurements, error: procErr } = await supabase
      .from('procurement')
      .select('total_cost')
      .gte('timestamp', fromTimestamp)
      // Exclude cancelled? Let's just sum everything that has a total_cost
      .neq('status', 'cancelled')

    if (procErr) throw procErr

    const totalExpenses = procurements.reduce((sum, p) => sum + (Number(p.total_cost) || 0), 0)

    return ok(res, {
      totalRevenue: Math.round(totalRevenue),
      totalOrders,
      totalExpenses: Math.round(totalExpenses),
      profit: Math.round(totalRevenue - totalExpenses),
      topItems
    })
  } catch (error) {
    console.error('Business Analytics Error:', error)
    return fail(res, 'DB_ERROR', error.message, 500)
  }
})

module.exports = router
