const { Router } = require('express')
const supabase = require('../services/supabaseClient')
const { ownerAuthMiddleware } = require('../middleware/auth')
const { ok, fail } = require('../utils/response')

const router = Router()

// ── Ingredient master ─────────────────────────────────────────────────────────

// GET /api/ingredients
router.get('/', ownerAuthMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('ingredient_master')
    .select('*, inventory_levels(current_qty, last_updated)')
    .order('name')

  if (error) throw error

  return ok(res, {
    ingredients: (data || []).map(i => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      cost_per_unit: i.cost_per_unit,
      vendor_item_name: i.vendor_item_name,
      active: i.active,
      current_qty: i.inventory_levels?.current_qty ?? 0,
      last_updated: i.inventory_levels?.last_updated ?? null
    }))
  })
})

// POST /api/ingredients
router.post('/', ownerAuthMiddleware, async (req, res) => {
  const { name, unit, cost_per_unit, vendor_item_name } = req.body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return fail(res, 'VALIDATION_ERROR', 'name is required', 400)
  }
  if (!unit || typeof unit !== 'string' || !unit.trim()) {
    return fail(res, 'VALIDATION_ERROR', 'unit is required', 400)
  }

  const { data, error } = await supabase
    .from('ingredient_master')
    .insert({
      name: name.trim(),
      unit: unit.trim(),
      cost_per_unit: cost_per_unit != null ? Number(cost_per_unit) : null,
      vendor_item_name: vendor_item_name?.trim() || null
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return fail(res, 'DUPLICATE_NAME', `Ingredient "${name.trim()}" already exists`, 409)
    throw error
  }

  return ok(res, { ingredient: data }, 201)
})

// GET /api/ingredients/inventory
router.get('/inventory', ownerAuthMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('inventory_levels')
    .select('ingredient_id, current_qty, last_updated, ingredient_master(name, unit, cost_per_unit)')

  if (error) throw error

  return ok(res, {
    inventory: (data || []).map(row => ({
      ingredient_id: row.ingredient_id,
      name: row.ingredient_master?.name,
      unit: row.ingredient_master?.unit,
      cost_per_unit: row.ingredient_master?.cost_per_unit,
      current_qty: row.current_qty,
      last_updated: row.last_updated
    }))
  })
})

// PATCH /api/ingredients/inventory — set stock level (physical stock count)
// Body: { ingredient_id, current_qty }
router.patch('/inventory', ownerAuthMiddleware, async (req, res) => {
  const { ingredient_id, current_qty } = req.body

  if (!ingredient_id) return fail(res, 'VALIDATION_ERROR', 'ingredient_id is required', 400)
  if (current_qty === undefined || current_qty === null || Number(current_qty) < 0) {
    return fail(res, 'VALIDATION_ERROR', 'current_qty must be >= 0', 400)
  }

  const { data, error } = await supabase
    .from('inventory_levels')
    .upsert(
      { ingredient_id: Number(ingredient_id), current_qty: Number(current_qty), last_updated: new Date().toISOString() },
      { onConflict: 'ingredient_id' }
    )
    .select()
    .single()

  if (error) throw error

  return ok(res, { ingredient_id: Number(ingredient_id), current_qty: Number(current_qty) })
})

// GET /api/ingredients/recipe/:menu_item_id
router.get('/recipe/:menu_item_id', ownerAuthMiddleware, async (req, res) => {
  const { menu_item_id } = req.params

  const { data, error } = await supabase
    .from('menu_item_ingredients')
    .select('id, quantity_per_portion, ingredient_master(id, name, unit, cost_per_unit, vendor_item_name)')
    .eq('menu_item_id', menu_item_id)

  if (error) throw error

  return ok(res, {
    menu_item_id: Number(menu_item_id),
    ingredients: (data || []).map(row => ({
      id: row.id,
      ingredient_id: row.ingredient_master?.id,
      name: row.ingredient_master?.name,
      unit: row.ingredient_master?.unit,
      cost_per_unit: row.ingredient_master?.cost_per_unit,
      vendor_item_name: row.ingredient_master?.vendor_item_name,
      quantity_per_portion: row.quantity_per_portion
    }))
  })
})

// POST /api/ingredients/recipe/:menu_item_id — replaces the whole recipe
// Body: [{ ingredient_id, quantity_per_portion }]
router.post('/recipe/:menu_item_id', ownerAuthMiddleware, async (req, res) => {
  const { menu_item_id } = req.params
  const ingredients = req.body

  if (!Array.isArray(ingredients)) {
    return fail(res, 'VALIDATION_ERROR', 'Body must be an array of { ingredient_id, quantity_per_portion }', 400)
  }
  for (const ing of ingredients) {
    if (!ing.ingredient_id || !ing.quantity_per_portion || Number(ing.quantity_per_portion) <= 0) {
      return fail(res, 'VALIDATION_ERROR', 'Each entry must have ingredient_id and quantity_per_portion > 0', 400)
    }
  }

  const { data: menuItem } = await supabase
    .from('menu_items')
    .select('id')
    .eq('id', menu_item_id)
    .maybeSingle()
  if (!menuItem) return fail(res, 'NOT_FOUND', 'Menu item not found', 404)

  const { error: deleteErr } = await supabase
    .from('menu_item_ingredients')
    .delete()
    .eq('menu_item_id', menu_item_id)
  if (deleteErr) throw deleteErr

  if (ingredients.length > 0) {
    const rows = ingredients.map(ing => ({
      menu_item_id: Number(menu_item_id),
      ingredient_id: Number(ing.ingredient_id),
      quantity_per_portion: Number(ing.quantity_per_portion)
    }))
    const { error: insertErr } = await supabase.from('menu_item_ingredients').insert(rows)
    if (insertErr) throw insertErr
  }

  return ok(res, { menu_item_id: Number(menu_item_id), ingredients_set: ingredients.length })
})

// DELETE /api/ingredients/recipe/:menu_item_id — clear recipe for a menu item
router.delete('/recipe/:menu_item_id', ownerAuthMiddleware, async (req, res) => {
  const { menu_item_id } = req.params
  await supabase.from('menu_item_ingredients').delete().eq('menu_item_id', menu_item_id)
  return ok(res, { menu_item_id: Number(menu_item_id), cleared: true })
})

// PUT /api/ingredients/:id
router.put('/:id', ownerAuthMiddleware, async (req, res) => {
  const { id } = req.params
  const { name, unit, cost_per_unit, vendor_item_name, active } = req.body

  const updates = {}
  if (name !== undefined) updates.name = name.trim()
  if (unit !== undefined) updates.unit = unit.trim()
  if (cost_per_unit !== undefined) updates.cost_per_unit = cost_per_unit != null ? Number(cost_per_unit) : null
  if (vendor_item_name !== undefined) updates.vendor_item_name = vendor_item_name?.trim() || null
  if (active !== undefined) updates.active = Boolean(active)

  if (Object.keys(updates).length === 0) {
    return fail(res, 'VALIDATION_ERROR', 'No fields to update', 400)
  }

  const { data, error } = await supabase
    .from('ingredient_master')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  if (!data) return fail(res, 'NOT_FOUND', 'Ingredient not found', 404)

  return ok(res, { ingredient: data })
})

// DELETE /api/ingredients/:id
router.delete('/:id', ownerAuthMiddleware, async (req, res) => {
  const { id } = req.params

  const { data: uses } = await supabase
    .from('menu_item_ingredients')
    .select('id')
    .eq('ingredient_id', id)
    .limit(1)

  if (uses && uses.length > 0) {
    return fail(res, 'IN_USE', 'Ingredient is used in recipes — remove it from all recipes first', 409)
  }

  const { error } = await supabase.from('ingredient_master').delete().eq('id', id)
  if (error) throw error

  return ok(res, { deleted: true })
})

module.exports = router
