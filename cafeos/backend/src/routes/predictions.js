const { Router } = require('express')
const supabase = require('../services/supabaseClient')
const { ownerAuthMiddleware } = require('../middleware/auth')
const { ok, fail } = require('../utils/response')
const { confirmPredictions } = require('../intelligence/predictions')
const { formatInTimeZone } = require('date-fns-tz')

const router = Router()
const IST = 'Asia/Kolkata'

function todayIST() {
  return formatInTimeZone(new Date(), IST, 'yyyy-MM-dd')
}

// GET /api/predictions/today
// Returns today's predictions with item names and effective quantity
router.get('/today', ownerAuthMiddleware, async (req, res) => {
  const date = req.query.date || todayIST()

  const { data, error } = await supabase
    .from('predictions')
    .select('id, date, predicted_qty, owner_override, actual_qty, confirmed, weather_multiplier_applied, festival_multiplier_applied, menu_items(id, name, category, seed_qty)')
    .eq('date', date)
    .order('menu_items(name)', { ascending: true })

  if (error) throw error

  const items = (data || []).map(row => ({
    id: row.id,
    date: row.date,
    menu_item_id: row.menu_items?.id,
    name: row.menu_items?.name,
    category: row.menu_items?.category,
    predicted_qty: row.predicted_qty,
    owner_override: row.owner_override,
    effective_qty: row.owner_override ?? row.predicted_qty,
    actual_qty: row.actual_qty,
    confirmed: row.confirmed,
    weather_multiplier_applied: row.weather_multiplier_applied,
    festival_multiplier_applied: row.festival_multiplier_applied
  }))

  return ok(res, { date, items })
})

// PATCH /api/predictions/override
// Body: [{ menu_item_id, qty }]
router.patch('/override', ownerAuthMiddleware, async (req, res) => {
  const overrides = req.body
  if (!Array.isArray(overrides) || overrides.length === 0) {
    return fail(res, 'VALIDATION_ERROR', 'Body must be a non-empty array of { menu_item_id, qty }', 400)
  }

  const date = req.query.date || todayIST()
  const results = []

  for (const { menu_item_id, qty } of overrides) {
    if (!menu_item_id || qty === undefined || qty === null || qty < 0) continue

    const { data, error } = await supabase
      .from('predictions')
      .update({ owner_override: Number(qty) })
      .eq('date', date)
      .eq('menu_item_id', menu_item_id)
      .select('id, menu_item_id, owner_override')
      .maybeSingle()

    if (!error && data) results.push(data)
  }

  return ok(res, { date, updated: results })
})

// POST /api/predictions/confirm
// Marks today's predictions as confirmed and populates actual_qty from orders
router.post('/confirm', ownerAuthMiddleware, async (req, res) => {
  const date = req.body?.date || todayIST()

  await confirmPredictions(date)

  return ok(res, { date, confirmed: true })
})

module.exports = router
