const { Router } = require('express')
const { formatInTimeZone } = require('date-fns-tz')
const supabase = require('../services/supabaseClient')
const { ownerAuthMiddleware } = require('../middleware/auth')
const { ok, fail } = require('../utils/response')

const router = Router()
const IST = 'Asia/Kolkata'

function todayIST() {
  return formatInTimeZone(new Date(), IST, 'yyyy-MM-dd')
}

router.get('/', ownerAuthMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('offers')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return ok(res, { offers: data || [] })
})

router.post('/', ownerAuthMiddleware, async (req, res) => {
  const { name, scope, item_ids, category, discount_type, discount_value, start_date, end_date } = req.body

  if (!name || !String(name).trim()) return fail(res, 'VALIDATION_ERROR', 'Name is required', 400)
  if (!['item', 'category', 'all'].includes(scope)) return fail(res, 'VALIDATION_ERROR', 'scope must be item, category, or all', 400)
  if (!['percentage', 'flat'].includes(discount_type)) return fail(res, 'VALIDATION_ERROR', 'discount_type must be percentage or flat', 400)
  if (!discount_value || Number(discount_value) <= 0) return fail(res, 'VALIDATION_ERROR', 'discount_value must be positive', 400)
  if (discount_type === 'percentage' && Number(discount_value) > 100) return fail(res, 'VALIDATION_ERROR', 'Percentage discount cannot exceed 100', 400)
  if (!start_date || !end_date) return fail(res, 'VALIDATION_ERROR', 'start_date and end_date are required', 400)
  if (start_date > end_date) return fail(res, 'VALIDATION_ERROR', 'end_date must be on or after start_date', 400)
  if (scope === 'category' && !category) return fail(res, 'VALIDATION_ERROR', 'category is required when scope is category', 400)
  if (scope === 'item' && (!Array.isArray(item_ids) || item_ids.length === 0)) return fail(res, 'VALIDATION_ERROR', 'item_ids required when scope is item', 400)

  const { data, error } = await supabase
    .from('offers')
    .insert({
      name: String(name).trim(),
      scope,
      item_ids: scope === 'item' ? item_ids.map(Number) : null,
      category: scope === 'category' ? category : null,
      discount_type,
      discount_value: Number(discount_value),
      start_date,
      end_date,
      active: true
    })
    .select()
    .single()

  if (error) throw error
  return ok(res, data, 201)
})

router.patch('/:id', ownerAuthMiddleware, async (req, res) => {
  const { id } = req.params
  const allowed = ['active', 'name', 'start_date', 'end_date', 'discount_value', 'discount_type']
  const updates = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }
  if (Object.keys(updates).length === 0) return fail(res, 'VALIDATION_ERROR', 'Nothing to update', 400)

  const { data, error } = await supabase
    .from('offers')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return ok(res, data)
})

router.delete('/:id', ownerAuthMiddleware, async (req, res) => {
  const { error } = await supabase.from('offers').delete().eq('id', req.params.id)
  if (error) throw error
  return ok(res, { deleted: true })
})

// Internal helper — fetch active offers for a given date (used by order creation)
async function fetchActiveOffers(dateStr) {
  try {
    const { data, error } = await supabase
      .from('offers')
      .select('*')
      .eq('active', true)
      .lte('start_date', dateStr)
      .gte('end_date', dateStr)
    if (error) return []
    return data || []
  } catch {
    return []
  }
}

function applyBestOffer(menuItem, offers) {
  let bestDiscount = 0
  for (const offer of offers) {
    let applicable = false
    if (offer.scope === 'all') applicable = true
    else if (offer.scope === 'category' && offer.category === menuItem.category) applicable = true
    else if (offer.scope === 'item' && Array.isArray(offer.item_ids) && offer.item_ids.includes(menuItem.id)) applicable = true

    if (applicable) {
      const discount = offer.discount_type === 'percentage'
        ? menuItem.price * (offer.discount_value / 100)
        : Math.min(offer.discount_value, menuItem.price)
      if (discount > bestDiscount) bestDiscount = discount
    }
  }
  return Math.round(bestDiscount * 100) / 100
}

module.exports = router
module.exports.fetchActiveOffers = fetchActiveOffers
module.exports.applyBestOffer = applyBestOffer
