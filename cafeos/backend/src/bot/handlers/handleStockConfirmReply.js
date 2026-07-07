const supabase = require('../../services/supabaseClient')
const { callGeminiJSON } = require('../../services/geminiService')
const { setBotState, whatsappReply, fuzzyMatchMenuItem } = require('./helpers')
const { proceedToVendorOrder } = require('./handleWastageReply')

const schemaStock = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["confirm", "correct_it", "provide_corrections"]
    },
    corrections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          qty: { type: "number" }
        }
      }
    },
    unclear: { type: "boolean" }
  }
}

const SYSTEM_PROMPT_STOCK = `You are an assistant for a small cafe in Goa, India.
The system estimated the remaining ingredient stock after today's orders, and Sam (the owner) is responding.
Sam may write in English, Hindi, Konkani, or a mix. She may tap a button or type freely.
Number words are valid: ek=1, don/do=2, teen=3, char=4, panch=5, chhe/saa=6.

First, determine the "action":
- "confirm": Sam accepts the stock estimates as correct. Examples: "ok", "yes", "haan", "sahi", "right", "correct", "looks right", "1", "y", "theek hai".
- "correct_it": Sam wants to correct stock but hasn't provided specifics yet. Examples: "correct it", "fix it", "not right", "galat", "change", "2".
- "provide_corrections": Sam is providing specific ingredient corrections. Examples: "rice 3, oil 0.5, milk zero".

For "provide_corrections", also extract the corrections array:
- "name": the ingredient name as Sam stated it. Match loosely to the known ingredient list.
- "qty": the actual quantity remaining, as a number in the unit shown next to that ingredient (e.g. if list shows "Rice (kg)" and Sam says "rice 500g", return 0.5).
- Treat "khatam", "zero", "nil", "none", "nahi hai", "finished" as 0.
- Only include ingredients Sam explicitly corrected.

For "confirm" or "correct_it", set corrections to [].
- "unclear": true ONLY if no recognisable intent or corrections can be extracted.`

async function handleStockConfirmReply(phoneNumber, message, context) {
  const estimates = context?.estimates || []

  const known = estimates.map(e => `${e.name} (${e.unit || 'units'})`).join(', ')
  const userMessage = `Known ingredients with units: ${known}\n\nSam's message: "${message}"`
  const parsed = await callGeminiJSON(SYSTEM_PROMPT_STOCK, userMessage, 400, schemaStock)

  if (!parsed || parsed.unclear) {
    await whatsappReply(
      phoneNumber,
      "Sorry Sam, I didn't catch that. Reply 1 if the stock looks right, or correct me like:\n\"rice 3, oil 0.5, milk zero\""
    )
    return
  }

  // --- Branch on AI-determined action ---

  if (parsed.action === 'confirm') {
    await proceedToVendorOrder(phoneNumber, 'Stock confirmed ✓')
    return
  }

  if (parsed.action === 'correct_it') {
    await whatsappReply(
      phoneNumber,
      "Tell me what's different (e.g. 'rice 3, oil 0.5, milk zero')"
    )
    return
  }

  // action === 'provide_corrections'
  const corrections = parsed.corrections || []

  if (corrections.length === 0) {
    await whatsappReply(
      phoneNumber,
      "I got your message but couldn't match any ingredients. Try: \"rice 3, oil 0.5, milk zero\""
    )
    return
  }

  const candidates = estimates.map(e => ({ id: e.ingredient_id, name: e.name }))
  const updatedLines = []

  for (const c of corrections) {
    const qty = Number(c.qty)
    if (!c.name || Number.isNaN(qty) || qty < 0) continue

    const match = fuzzyMatchMenuItem(c.name, candidates)
    if (!match) {
      console.warn(`[StockConfirm] No ingredient match for "${c.name}" — skipping`)
      continue
    }

    await supabase
      .from('inventory_levels')
      .upsert({
        ingredient_id: match.id,
        current_qty: qty,
        last_updated: new Date().toISOString()
      }, { onConflict: 'ingredient_id' })

    const est = estimates.find(e => e.ingredient_id === match.id)
    updatedLines.push(`${match.name}: ${qty}${est?.unit || ''}`)
  }

  if (updatedLines.length === 0) {
    await whatsappReply(
      phoneNumber,
      "I couldn't match those to ingredients I track. Reply 1 to accept my estimate, or use the names from the list."
    )
    return
  }

  await proceedToVendorOrder(phoneNumber, `Stock updated ✓\n${updatedLines.join('\n')}`)
}

module.exports = handleStockConfirmReply
