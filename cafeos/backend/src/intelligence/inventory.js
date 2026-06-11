const supabase = require('../services/supabaseClient')
const { adjustInventory } = require('../bot/handlers/helpers')

// Theoretical ingredient consumption for a date:
// portions sold (order_items) × recipe quantity_per_portion (menu_item_ingredients)
async function computeConsumption(date) {
  const { data: orders } = await supabase
    .from('orders')
    .select('id')
    .eq('bill_date', date)

  const orderIds = (orders || []).map(o => o.id)
  if (orderIds.length === 0) return new Map()

  const { data: items } = await supabase
    .from('order_items')
    .select('menu_item_id, quantity')
    .in('order_id', orderIds)

  const soldMap = new Map()
  for (const row of items || []) {
    soldMap.set(row.menu_item_id, (soldMap.get(row.menu_item_id) || 0) + Number(row.quantity))
  }
  if (soldMap.size === 0) return new Map()

  const { data: recipes } = await supabase
    .from('menu_item_ingredients')
    .select('menu_item_id, ingredient_id, quantity_per_portion')
    .in('menu_item_id', [...soldMap.keys()])

  const usage = new Map()
  for (const r of recipes || []) {
    const sold = soldMap.get(r.menu_item_id) || 0
    if (!sold) continue
    usage.set(
      r.ingredient_id,
      (usage.get(r.ingredient_id) || 0) + sold * Number(r.quantity_per_portion)
    )
  }
  return usage
}

// Subtract the day's theoretical consumption from stock.
// Idempotent per date via inventory_deductions — safe to call from both the
// wastage flow and the auto-proceed cron without double-subtracting.
async function applyDailyConsumption(date) {
  const { data: already } = await supabase
    .from('inventory_deductions')
    .select('date')
    .eq('date', date)
    .maybeSingle()
  if (already) return false

  const usage = await computeConsumption(date)

  for (const [ingredientId, qty] of usage.entries()) {
    if (qty > 0) await adjustInventory(ingredientId, -qty)
  }

  const { error: markErr } = await supabase
    .from('inventory_deductions')
    .insert({ date })
  if (markErr && markErr.code !== '23505') {
    console.warn('[Inventory] Failed to mark deduction applied:', markErr.message)
  }

  return true
}

// Current estimated stock with names/units, for owner review on WhatsApp
async function estimateRemainingStock() {
  const { data } = await supabase
    .from('inventory_levels')
    .select('ingredient_id, current_qty, ingredient_master(name, unit)')

  return (data || [])
    .map(r => ({
      ingredient_id: r.ingredient_id,
      name: r.ingredient_master?.name || 'Ingredient',
      unit: r.ingredient_master?.unit || '',
      qty: Number(r.current_qty)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

module.exports = { computeConsumption, applyDailyConsumption, estimateRemainingStock }
