const supabase = require('../../services/supabaseClient')
const { callGeminiJSON } = require('../../services/geminiService')
const { setBotState, todayIST, whatsappReply, fuzzyMatchMenuItem } = require('./helpers')

const schemaD = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["confirm", "edit_request", "provide_overrides"]
    },
    overrides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item_name: { type: "string" },
          qty: { type: "number" }
        }
      }
    },
    unclear: { type: "boolean" }
  }
};

const SYSTEM_PROMPT_D = `You are an assistant for a small cafe in Goa, India.
Sam has replied to her morning prep sheet. Classify her intent and extract any edits.
Sam may write in English, Hindi, Konkani, or a mix. She may tap a button or type freely.

First, determine the "action":
- "confirm": Sam is happy with the prep sheet as-is. Examples: "ok", "yes", "haan", "looks good", "go with this", "sab theek hai", "all fine", "sab same", "1", "perfect", "done", "lock it", "chalega", tapping a confirm button.
- "edit_request": Sam wants to make changes but hasn't specified them yet. Examples: "make changes", "edit karna hai", "change karo", "wait", "ruko", "2", tapping an edit button.
- "provide_overrides": Sam is providing specific item + quantity changes. Examples: "biryani 25, fish curry 10", "skip biryani", "chai 30 aur samosa 15".

For "provide_overrides", also extract the overrides array:
- "item_name": use the item name as Sam used it. Match loosely (e.g. "fish" → "Fish Curry", "chai" → "Masala Chai"). Never invent an item not in the known list.
- "qty": the quantity Sam wants as an integer.
  Use 0 for: "skip", "nahi", "nil", "none", "band karo", "mat banao", "zero".
- Only include items Sam explicitly mentioned.

For "confirm" or "edit_request", set overrides to [].
- "unclear": set to true ONLY if the message contains no recognisable intent or items at all.`

async function applyPrepEdits(phoneNumber, editMessage) {
  const today = todayIST()

  // Fetch today's predicted items
  const { data: predictions, error: predErr } = await supabase
    .from('predictions')
    .select('menu_item_id, menu_items(id, name)')
    .eq('date', today)
  if (predErr) throw predErr

  const currentItems = (predictions || []).map(p => ({
    id: p.menu_items?.id || p.menu_item_id,
    name: p.menu_items?.name || 'Item'
  }))

  const userMessage = `Current prep sheet items: ${currentItems.map(i => i.name).join(', ')}

Sam's message: "${editMessage}"`

  const parsed = await callGeminiJSON(SYSTEM_PROMPT_D, userMessage, 400, schemaD)

  if (parsed === null || parsed.unclear) {
    await whatsappReply(
      phoneNumber,
      "Sorry Sam, I didn't catch that clearly. Can you say it like:\n\"biryani 25, fish curry 10\"?"
    )
    return
  }

  // --- Branch on AI-determined action ---

  if (parsed.action === 'confirm') {
    await supabase.from('predictions').update({ confirmed: true }).eq('date', today)
    await setBotState(phoneNumber, 'idle', null)
    await whatsappReply(phoneNumber, "Got it! Today's prep locked in ✓")
    return
  }

  if (parsed.action === 'edit_request') {
    await setBotState(phoneNumber, 'awaiting_prep_edit', null)
    await whatsappReply(phoneNumber, "What would you like to change? (e.g. 'biryani 25, fish curry 10')")
    return
  }

  // action === 'provide_overrides'
  const overrides = parsed.overrides || []

  if (overrides.length === 0) {
    await whatsappReply(
      phoneNumber,
      "I got your message but couldn't find specific items. Can you say it like:\n\"biryani 25, fish curry 10\"?"
    )
    return
  }

  const changedLines = []
  for (const override of overrides) {
    const menuItem = fuzzyMatchMenuItem(override.item_name, currentItems)
    if (!menuItem) continue

    await supabase
      .from('predictions')
      .update({ owner_override: override.qty, confirmed: true })
      .eq('date', today)
      .eq('menu_item_id', menuItem.id)

    changedLines.push(`${menuItem.name}: ${override.qty === 0 ? 'skipped' : override.qty}`)
  }

  await setBotState(phoneNumber, 'idle', null)

  if (changedLines.length > 0) {
    await whatsappReply(phoneNumber, `Updated ✓\n${changedLines.join('\n')}\n\nAll other items unchanged.`)
  } else {
    await whatsappReply(phoneNumber, "Got it! I've noted your changes ✓")
  }
}

async function handlePrepEditReply(phoneNumber, message) {
  await applyPrepEdits(phoneNumber, message)
}

module.exports = handlePrepEditReply
// Exported for reuse in handlePrepConfirmReply free-text path
module.exports.applyPrepEdits = applyPrepEdits
