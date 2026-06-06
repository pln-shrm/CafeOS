const { Router } = require('express')
const supabase = require('../services/supabaseClient')
const { anyAuthMiddleware, ownerAuthMiddleware } = require('../middleware/auth')
const { ok, fail } = require('../utils/response')

const router = Router()

// GET /api/menu
router.get('/', anyAuthMiddleware, async (req, res) => {
  let query = supabase.from('menu_items').select('*').order('category').order('name')

  if (req.role === 'owner' && req.query.include_inactive === 'true') {
    // no extra filter — return all
  } else {
    query = query.eq('active', true)
  }

  const { data, error } = await query
  if (error) throw error

  return ok(res, { items: data })
})

// GET /api/menu/:id
router.get('/:id', ownerAuthMiddleware, async (req, res) => {
  const { id } = req.params

  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return fail(res, 'NOT_FOUND', 'Menu item not found', 404)

  return ok(res, data)
})

// POST /api/menu
router.post('/', ownerAuthMiddleware, async (req, res) => {
  const { name, price, category, active, seed_qty, is_perishable } = req.body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return fail(res, 'VALIDATION_ERROR', 'name is required', 400)
  }
  if (price === undefined || price === null || Number(price) <= 0) {
    return fail(res, 'VALIDATION_ERROR', 'price must be greater than 0', 400)
  }

  // Duplicate name check (case-insensitive)
  const { data: existing } = await supabase
    .from('menu_items')
    .select('id')
    .ilike('name', name.trim())
    .maybeSingle()

  if (existing) return fail(res, 'DUPLICATE_NAME', `A menu item named "${name.trim()}" already exists`, 409)

  const { data, error } = await supabase
    .from('menu_items')
    .insert({
      name: name.trim(),
      price: Number(price),
      category: category || null,
      active: active !== undefined ? Boolean(active) : true,
      seed_qty: seed_qty !== undefined ? Number(seed_qty) : null,
      is_perishable: is_perishable !== undefined ? Boolean(is_perishable) : false
    })
    .select()
    .single()

  if (error) throw error

  return ok(res, data, 201)
})

// PUT /api/menu/:id
router.put('/:id', ownerAuthMiddleware, async (req, res) => {
  const { id } = req.params
  const { name, price, category, active, seed_qty, is_perishable } = req.body

  if (price !== undefined && (price === null || Number(price) <= 0)) {
    return fail(res, 'VALIDATION_ERROR', 'price must be greater than 0', 400)
  }

  const updates = {}
  if (name !== undefined) updates.name = name.trim()
  if (price !== undefined) updates.price = Number(price)
  if (category !== undefined) updates.category = category
  if (active !== undefined) updates.active = Boolean(active)
  if (seed_qty !== undefined) updates.seed_qty = seed_qty !== null ? Number(seed_qty) : null
  if (is_perishable !== undefined) updates.is_perishable = Boolean(is_perishable)

  const { data, error } = await supabase
    .from('menu_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  if (!data) return fail(res, 'NOT_FOUND', 'Menu item not found', 404)

  return ok(res, data)
})

// PATCH /api/menu/:id/deactivate
router.patch('/:id/deactivate', ownerAuthMiddleware, async (req, res) => {
  const { id } = req.params

  const { data: existing, error: fetchErr } = await supabase
    .from('menu_items')
    .select('id, active')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr) throw fetchErr
  if (!existing) return fail(res, 'NOT_FOUND', 'Menu item not found', 404)

  if (!existing.active) {
    return ok(res, { already_inactive: true })
  }

  const { data, error } = await supabase
    .from('menu_items')
    .update({ active: false })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error

  return ok(res, { ...data, already_inactive: false })
})

module.exports = router
