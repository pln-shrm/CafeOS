const supabase = require('../../services/supabaseClient')
const { setBotState, whatsappReply, todayIST, formatRupees } = require('./helpers')
const { formatInTimeZone } = require('date-fns-tz')

function tomorrowIST() {
  return formatInTimeZone(new Date(Date.now() + 86400000), 'Asia/Kolkata', 'yyyy-MM-dd')
}

async function handleBulkOrderCommand(phoneNumber, message) {
  const tomorrow = tomorrowIST()
  
  // 1. Get predictions for tomorrow (we assume they might be generated, or we just look at what's in the DB)
  // Or we use today's predictions? The prompt says "order all ingredients for tomorrow's prep".
  // Let's fetch predictions for tomorrow. If none exist, we can fetch today's or tell the user.
  let { data: predictions } = await supabase
    .from('predictions')
    .select('menu_item_id, predicted_qty, owner_override')
    .eq('date', tomorrow)

  if (!predictions || predictions.length === 0) {
    // Attempt to fallback to today's if tomorrow is not generated yet
    const today = todayIST()
    const { data: todayPreds } = await supabase
      .from('predictions')
      .select('menu_item_id, predicted_qty, owner_override')
      .eq('date', today)
      
    if (!todayPreds || todayPreds.length === 0) {
      await whatsappReply(phoneNumber, `I don't have predictions for tomorrow's prep yet. Please wait for the morning prep sheet or generate predictions first.`)
      return
    }
    predictions = todayPreds // fallback to today's prep as a proxy if tomorrow isn't there
  }

  const predictionMap = new Map()
  for (const p of predictions) {
    predictionMap.set(p.menu_item_id, p.owner_override ?? p.predicted_qty)
  }

  // 2. Fetch recipes
  const { data: recipes } = await supabase
    .from('menu_item_ingredients')
    .select('menu_item_id, ingredient_id, quantity_per_portion')
    .in('menu_item_id', [...predictionMap.keys()])

  const requiredIngredients = new Map()
  for (const r of recipes || []) {
    const qty = predictionMap.get(r.menu_item_id) || 0
    if (qty > 0) {
      requiredIngredients.set(
        r.ingredient_id,
        (requiredIngredients.get(r.ingredient_id) || 0) + qty * Number(r.quantity_per_portion)
      )
    }
  }

  // 3. Fetch current inventory
  const { data: inventory } = await supabase
    .from('inventory_levels')
    .select('ingredient_id, current_qty, ingredient_master(name, unit)')
    .in('ingredient_id', [...requiredIngredients.keys()])

  const inventoryMap = new Map()
  const namesMap = new Map()
  for (const item of inventory || []) {
    inventoryMap.set(item.ingredient_id, Number(item.current_qty))
    namesMap.set(item.ingredient_id, { name: item.ingredient_master.name, unit: item.ingredient_master.unit })
  }

  // 4. Compute deficits
  const deficits = []
  for (const [ingredientId, requiredQty] of requiredIngredients.entries()) {
    const currentQty = inventoryMap.get(ingredientId) || 0
    const deficit = requiredQty - currentQty
    if (deficit > 0) {
      const info = namesMap.get(ingredientId) || { name: 'Unknown', unit: '' }
      deficits.push(`${info.name}: ${Math.ceil(deficit)}${info.unit}`)
    }
  }

  if (deficits.length === 0) {
    await whatsappReply(phoneNumber, `Good news! You have enough stock for tomorrow's prep. Nothing to order. ✅`)
    return
  }

  const listText = deficits.join('\n- ')
  await whatsappReply(phoneNumber, `Here is the consolidated list of ingredients you need to order for tomorrow's prep:\n\n- ${listText}\n\nYou can manually forward this list to your vendors.`)
}

module.exports = handleBulkOrderCommand
