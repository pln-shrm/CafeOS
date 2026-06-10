const supabase = require('../../services/supabaseClient')
const { callGeminiJSON, callGemini } = require('../../services/geminiService')
const { setBotState, todayIST, tomorrowIST, whatsappReply, fuzzyMatchMenuItem } = require('./helpers')
const { generatePredictions, detectAnomalies, confirmPredictions } = require('../../intelligence/predictions')
const { VENDOR_MESSAGE_PROMPT } = require('./prompts')

const schemaG = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string" },
          qty_left: { type: "number" }
        }
      }
    },
    all_clear: { type: "boolean" },
    unclear: { type: "boolean" }
  }
};

const SYSTEM_PROMPT_G = `You are an assistant for a small cafe in Goa, India.
Sam has just sent her nightly wastage log — what portions are left over from today.
Extract structured leftover quantities per item.
Sam may write in English, Hindi, Konkani, or a mix.
Number words are valid: teen=3, char=4, panch=5, don/do=2, ek=1, chhe/saa=6.

Rules:
- "item": item name as Sam stated it. Match loosely to known menu items.
- "qty_left": integer number of portions or units remaining.
- Treat "nil", "zero", "nahi", "khatam", "sold out" as 0.
- Treat "fine", "ok", "thoda", "negligible", "bahut kam" as 0 — negligible remainder.
- "all_clear": set to true if Sam implies EVERYTHING sold (e.g. "sab bik gaya", "nothing left", "all clear", "sab khatam", "zero wastage"). When true, set items to [].
- "unclear": set to true only if the message is completely unintelligible and no items/quantities can be extracted at all.
- Never invent items Sam did not mention.
- Sam does not need to mention every item — only report what she explicitly stated.`

async function buildVendorOrderFromPredictions(predictions, menuItems) {
  const activePredictions = predictions.filter(p => p.predicted_qty > 0)
  const menuItemIds = activePredictions.map(p => p.menu_item_id)

  // Check whether any recipes are defined for these menu items
  const { data: recipeRows } = await supabase
    .from('menu_item_ingredients')
    .select('menu_item_id, ingredient_id, quantity_per_portion, ingredient_master(id, name, unit, vendor_item_name, cost_per_unit)')
    .in('menu_item_id', menuItemIds)

  if (!recipeRows || recipeRows.length === 0) {
    // No recipes yet — fall back to portion-level so the vendor prompt still fires
    return activePredictions.map(p => {
      const item = menuItems.find(m => m.id === p.menu_item_id)
      return { name: item?.name || 'Item', qty: p.predicted_qty, unit: 'portions' }
    })
  }

  // Aggregate raw ingredient requirements across all menu items
  const ingredientNeeds = new Map()
  for (const pred of activePredictions) {
    const recipes = recipeRows.filter(r => r.menu_item_id === pred.menu_item_id)
    for (const recipe of recipes) {
      const ing = recipe.ingredient_master
      if (!ing) continue
      const needed = recipe.quantity_per_portion * pred.predicted_qty
      if (ingredientNeeds.has(ing.id)) {
        ingredientNeeds.get(ing.id).qty += needed
      } else {
        ingredientNeeds.set(ing.id, {
          name: ing.vendor_item_name || ing.name,
          qty: needed,
          unit: ing.unit,
          ingredient_id: ing.id,
          cost_per_unit: ing.cost_per_unit
        })
      }
    }
  }

  // Subtract what's already in stock
  const { data: stockLevels } = await supabase
    .from('inventory_levels')
    .select('ingredient_id, current_qty')

  const stockMap = new Map((stockLevels || []).map(s => [s.ingredient_id, s.current_qty]))

  const orderItems = []
  for (const [ingId, need] of ingredientNeeds.entries()) {
    const stock = stockMap.get(ingId) ?? 0
    const toOrder = Math.max(0, need.qty - stock)
    if (toOrder > 0) {
      orderItems.push({
        name: need.name,
        qty: Math.ceil(toOrder * 10) / 10,
        unit: need.unit,
        ingredient_id: ingId,
        cost_per_unit: need.cost_per_unit ?? null
      })
    }
  }

  return orderItems
}

async function findVendorName() {
  // Try to find the most recently used vendor from procurement records
  const { data: recent } = await supabase
    .from('procurement')
    .select('vendor_name')
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (recent?.vendor_name) return recent.vendor_name

  // Fall back to first active vendor contact
  const { data: vendor } = await supabase
    .from('vendor_contacts')
    .select('name')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return vendor?.name || null
}

async function formatVendorMessage(items, vendorName) {
  const itemList = items.map(i => `${i.name} ${i.qty}${i.unit ? i.unit : ''}`).join(', ')
  const userMessage = `Vendor: ${vendorName || 'vendor'}\nItems: ${itemList}\nDelivery: tomorrow morning\nNotes: none`

  const claudeMsg = await callGemini(VENDOR_MESSAGE_PROMPT, userMessage, 300, 0.7)
  if (claudeMsg) return claudeMsg

  return `${itemList} — please deliver tomorrow morning`
}

async function handleWastageReply(phoneNumber, message) {
  const today = todayIST()

  // Fetch today's active menu items for context
  const { data: menuItems, error: menuErr } = await supabase
    .from('menu_items')
    .select('id, name')
    .eq('active', true)
  if (menuErr) throw menuErr

  const userMessage = `Known menu items today: ${(menuItems || []).map(i => i.name).join(', ')}

Sam's wastage message: "${message}"`

  const parsed = await callGeminiJSON(SYSTEM_PROMPT_G, userMessage, 400, schemaG)

  if (parsed === null || parsed.unclear) {
    await whatsappReply(
      phoneNumber,
      "Sorry Sam, I didn't catch that. Try:\n\"biryani 3 left, fish curry zero, chai all sold\""
    )
    return
  }

  // Write wastage_logs — only items Sam mentioned (not all items)
  if (parsed.all_clear) {
    // Everything sold — upsert 0 for all menu items
    const wastageRows = (menuItems || []).map(item => ({
      menu_item_id: item.id,
      item_name: item.name,
      quantity_left: 0,
      logged_at: today
    }))
    if (wastageRows.length > 0) {
      await supabase
        .from('wastage_logs')
        .upsert(wastageRows, { onConflict: 'menu_item_id,logged_at' })
    }
  } else {
    for (const entry of parsed.items || []) {
      const matchedItem = fuzzyMatchMenuItem(entry.item, menuItems)
      if (!matchedItem) {
        console.warn(`[WastageReply] No menu item match for "${entry.item}" — skipping`)
        continue
      }
      await supabase
        .from('wastage_logs')
        .upsert({
          menu_item_id: matchedItem.id,
          item_name: entry.item,
          quantity_left: entry.qty_left,
          logged_at: today
        }, { onConflict: 'menu_item_id,logged_at' })
    }
  }

  // Detect anomalies before predicting
  const wastageMap = new Map()
  if (parsed.all_clear) {
    for (const item of menuItems || []) wastageMap.set(item.id, 0)
  } else {
    for (const entry of parsed.items || []) {
      const matchedItem = fuzzyMatchMenuItem(entry.item, menuItems)
      if (matchedItem) wastageMap.set(matchedItem.id, entry.qty_left)
    }
  }

  // Confirm today's predictions now that wastage is written — sets actual_qty = sold + wasted
  try {
    await confirmPredictions(today)
  } catch (err) {
    console.warn('[WastageReply] confirmPredictions failed:', err.message)
  }

  const anomalies = await detectAnomalies(today, wastageMap)
  if (anomalies.length > 0) {
    const anomalyMsg = anomalies.map(a => a.name).join(', ')
    await setBotState(phoneNumber, 'awaiting_anomaly_resolution', { anomalies, date: today })
    await whatsappReply(phoneNumber, `Hey Sam, it looks like consumption for ${anomalyMsg} was unusually high compared to today's sales. Was there any unrecorded wastage or staff meals? (Reply with reason or 'Ignore')`)
    return
  }

  await resumePostWastageFlow(phoneNumber)
}

async function resumePostWastageFlow(phoneNumber) {
  const { data: menuItems, error: menuErr } = await supabase
    .from('menu_items')
    .select('id, name')
    .eq('active', true)
  if (menuErr) throw menuErr

  const tomorrow = tomorrowIST()
  let tomorrowPredictions
  try {
    const result = await generatePredictions(tomorrow)
    tomorrowPredictions = result.rows
  } catch (err) {
    console.error('[WastageFlow] Failed to generate tomorrow predictions:', err)
    await setBotState(phoneNumber, 'idle', null)
    await whatsappReply(phoneNumber, 'Wastage logged ✓ Thanks Sam!')
    return
  }

  const orderItems = await buildVendorOrderFromPredictions(tomorrowPredictions, menuItems)
  if (orderItems.length === 0) {
    await setBotState(phoneNumber, 'idle', null)
    await whatsappReply(phoneNumber, 'Wastage logged ✓ No items predicted for tomorrow.')
    return
  }

  const vendorName = await findVendorName()
  const formattedMessage = await formatVendorMessage(orderItems, vendorName)

  const vendorLine = vendorName ? ` to ${vendorName}` : ''
  await setBotState(phoneNumber, 'awaiting_vendor_confirm', {
    vendor_name: vendorName,
    items: orderItems,
    formatted_message: formattedMessage,
    source: 'wastage_flow'
  })

  await whatsappReply(
    phoneNumber,
    `Wastage logged ✓\n\nHere's tomorrow's order${vendorLine}:\n\n"${formattedMessage}"\n\nReply 1 to confirm or 2 to edit.`
  )
}

module.exports = handleWastageReply
module.exports.resumePostWastageFlow = resumePostWastageFlow
