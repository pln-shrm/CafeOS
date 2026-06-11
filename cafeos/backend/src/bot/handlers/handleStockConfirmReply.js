const supabase = require('../../services/supabaseClient')
const { callGeminiJSON } = require('../../services/geminiService')
const { setBotState, whatsappReply, fuzzyMatchMenuItem } = require('./helpers')
const { proceedToVendorOrder } = require('./handleWastageReply')

const schemaStock = {
  type: "object",
  properties: {
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
The system estimated the remaining ingredient stock after today's orders, and Sam (the owner) is correcting it.
Extract her corrections: ingredient name + the actual quantity left.
Sam may write in English, Hindi, Konkani, or a mix.
Number words are valid: ek=1, don/do=2, teen=3, char=4, panch=5, chhe/saa=6.

Rules:
- "name": the ingredient name as Sam stated it. Match loosely to the known ingredient list.
- "qty": the actual quantity remaining, as a number in the unit shown next to that ingredient in the known list (e.g. if the list shows "Rice (kg)" and Sam says "rice 500g", return 0.5).
- Treat "khatam", "zero", "nil", "none", "nahi hai", "finished" as 0.
- Only include ingredients Sam explicitly corrected. Do not include ones she didn't mention.
- "unclear": true ONLY if no ingredient names or quantities can be extracted at all.`

async function handleStockConfirmReply(phoneNumber, message, context) {
  const text = message.trim().toLowerCase()
  const estimates = context?.estimates || []

  // Estimates are already in inventory_levels (the deduction step wrote them) —
  // confirming just moves on to the vendor order draft.
  if (['1', 'ok', 'haan', 'yes', 'y', 'sahi', 'right', 'correct'].includes(text)) {
    await proceedToVendorOrder(phoneNumber, 'Stock confirmed ✓')
    return
  }

  // "Correct it" button — stay in this state and ask for the corrections
  if (text === '2') {
    await whatsappReply(
      phoneNumber,
      "Tell me what's different (e.g. 'rice 3, oil 0.5, milk zero')"
    )
    return
  }

  const known = estimates.map(e => `${e.name} (${e.unit || 'units'})`).join(', ')
  const userMessage = `Known ingredients with units: ${known}\n\nSam's correction: "${message}"`
  const parsed = await callGeminiJSON(SYSTEM_PROMPT_STOCK, userMessage, 400, schemaStock)

  if (!parsed || parsed.unclear || !(parsed.corrections || []).length) {
    await whatsappReply(
      phoneNumber,
      "Sorry Sam, I didn't catch that. Reply 1 if the stock looks right, or correct me like:\n\"rice 3, oil 0.5, milk zero\""
    )
    return
  }

  const candidates = estimates.map(e => ({ id: e.ingredient_id, name: e.name }))
  const updatedLines = []

  for (const c of parsed.corrections) {
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
