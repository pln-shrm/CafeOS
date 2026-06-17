const { formatInTimeZone } = require('date-fns-tz')
const supabase = require('../../services/supabaseClient')
const { whatsappReply, whatsappButtons, whatsappList } = require('../../services/whatsappClient')

const IST = 'Asia/Kolkata'

function todayIST() {
  return formatInTimeZone(new Date(), IST, 'yyyy-MM-dd')
}

function tomorrowIST() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return formatInTimeZone(d, IST, 'yyyy-MM-dd')
}

function formatRupees(amount) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '₹0'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(Number(amount))
}

async function getBotState(phoneNumber) {
  const { data, error } = await supabase
    .from('bot_state')
    .select('*')
    .eq('phone_number', phoneNumber)
    .maybeSingle()

  if (error) throw error
  return data
}

async function setBotState(phoneNumber, state, contextJson = null) {
  const { error } = await supabase
    .from('bot_state')
    .upsert({
      phone_number: phoneNumber,
      current_state: state,
      context_json: contextJson
    }, { onConflict: 'phone_number' })

  if (error) throw error
}

const { aiClient: ai } = require('../../services/geminiService')

async function parseVendorItems(text) {
  console.log(`[parseVendorItems] Input text: "${text}", ai client exists: ${!!ai}`)
  
  if (ai) {
    try {
      console.log('[parseVendorItems] Calling Gemini API...')
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Extract the items, quantities, and units from this user order: "${text}". If they mention "half", "quarter", etc., convert it to a decimal quantity.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            description: 'List of items being ordered or received.',
            properties: {
              items: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    name: { type: 'STRING', description: 'Name of the item (e.g. dal, rice, oil)' },
                    qty: { type: 'NUMBER', description: 'Quantity (must be a number)' },
                    unit: { type: 'STRING', description: 'Unit (e.g. kg, L, pieces, grams)' }
                  },
                  required: ['name', 'qty']
                }
              }
            },
            required: ['items']
          }
        }
      })
      
      let rawText = response.text || ''
      console.log(`[parseVendorItems] Gemini raw response: "${rawText}"`)
      rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
      
      const parsed = JSON.parse(rawText)
      const parsedItems = parsed.items || parsed || []
      const itemsArray = Array.isArray(parsedItems) ? parsedItems : []
      
      const validItems = itemsArray.filter(i => i.name && !Number.isNaN(Number(i.qty)))
      console.log(`[parseVendorItems] Gemini parsed ${validItems.length} items:`, JSON.stringify(validItems))
      return validItems.map(i => ({
        name: i.name.trim(),
        qty: Number(i.qty),
        unit: (i.unit || '').trim().toLowerCase()
      }))
    } catch (err) {
      console.error('[parseVendorItems] Gemini FAILED, falling back to regex:', err.message || err)
    }
  } else {
    console.warn('[parseVendorItems] No AI client — using regex fallback')
  }

  const items = []
  // Split on commas/semicolons so each segment is one item
  const segments = text.split(/[,;]+/)
  for (const seg of segments) {
    const trimmed = seg.trim()
    if (!trimmed) continue
    // Pattern 1: name first — "dal 3 kg"
    const match1 = trimmed.match(/^([\w\s]+?)\s+(\d+\.?\d*)\s*(kg|l|g|litre|litres|liter|liters|pieces|pcs)?$/i)
    // Pattern 2: qty first — "3 kg dal"
    const match2 = trimmed.match(/^(\d+\.?\d*)\s*(kg|l|g|litre|litres|liter|liters|pieces|pcs)?\s+([\w\s]+)$/i)
    
    let name, qty, unit
    if (match1) {
      name = match1[1].trim()
      qty = Number(match1[2])
      unit = match1[3]?.toLowerCase() || ''
    } else if (match2) {
      name = match2[3].trim()
      qty = Number(match2[1])
      unit = match2[2]?.toLowerCase() || ''
    }
    
    if (name && !Number.isNaN(qty) && qty > 0) {
      items.push({ name, qty, unit })
    }
  }
  return items
}

async function incrementInventoryLevels(items) {
  for (const item of items) {
    const qty = Number(item.qty ?? item.quantity ?? 0)
    if (!qty || qty <= 0) continue

    let ingredientId = item.ingredient_id || null

    // Fall back to case-insensitive name match if no ingredient_id on the item
    if (!ingredientId) {
      const { data: ing } = await supabase
        .from('ingredient_master')
        .select('id')
        .ilike('name', item.name)
        .maybeSingle()
      ingredientId = ing?.id || null
    }

    if (!ingredientId) continue

    await adjustInventory(ingredientId, qty)
  }
}

// Atomic stock adjustment (positive = delivery, negative = consumption).
// Falls back to read-then-upsert if the increment_inventory RPC isn't deployed yet.
async function adjustInventory(ingredientId, delta) {
  const { error: rpcErr } = await supabase.rpc('increment_inventory', {
    p_ingredient_id: ingredientId,
    p_qty: delta
  })
  if (!rpcErr) return

  const { data: existing } = await supabase
    .from('inventory_levels')
    .select('current_qty')
    .eq('ingredient_id', ingredientId)
    .maybeSingle()

  await supabase
    .from('inventory_levels')
    .upsert({
      ingredient_id: ingredientId,
      current_qty: Math.max(0, (existing?.current_qty ?? 0) + delta),
      last_updated: new Date().toISOString()
    }, { onConflict: 'ingredient_id' })
}

// Levenshtein distance for fuzzy name matching
function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

// menuItems: array of { id, name, ... }
// Returns the best-matching item or null if no reasonable match
function fuzzyMatchMenuItem(searchName, menuItems) {
  if (!searchName || !menuItems || menuItems.length === 0) return null
  const search = searchName.toLowerCase().trim()

  // Exact match first
  const exact = menuItems.find(i => i.name.toLowerCase() === search)
  if (exact) return exact

  // Substring match: search word found in item name or vice versa
  const sub = menuItems.find(i => {
    const iName = i.name.toLowerCase()
    return iName.includes(search) || search.includes(iName.split(' ')[0])
  })
  if (sub) return sub

  // Fuzzy: find lowest Levenshtein distance
  let best = null, bestDist = Infinity
  for (const item of menuItems) {
    const dist = levenshtein(search, item.name.toLowerCase())
    if (dist < bestDist) {
      bestDist = dist
      best = item
    }
  }
  // Only accept if distance is within 40% of the longer string length
  const threshold = Math.max(search.length, best?.name.length ?? 0) * 0.4
  return bestDist <= threshold ? best : null
}

module.exports = {
  whatsappReply,
  whatsappButtons,
  whatsappList,
  todayIST,
  tomorrowIST,
  formatRupees,
  getBotState,
  setBotState,
  parseVendorItems,
  fuzzyMatchMenuItem,
  incrementInventoryLevels,
  adjustInventory
}
