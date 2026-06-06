const supabase = require('../../services/supabaseClient')
const { callClaudeJSON } = require('../../services/claudeService')
const { setBotState, todayIST, twilioReply, fuzzyMatchMenuItem } = require('./helpers')

const SYSTEM_PROMPT_D = `You are an assistant for a small cafe in Goa, India.
Sam has replied to her morning prep sheet with changes.
Extract the item quantity overrides she wants.
Sam may write in English, Hindi, Konkani, or a mix.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "overrides": [
    { "item_name": string, "qty": number }
  ],
  "unclear": boolean
}

Rules:
- "item_name": use the item name as Sam used it. Match loosely (e.g. "fish" matches "Fish Curry", "chai" matches "Masala Chai", "biriyani" matches "Biryani"). Never invent an item not in the known list.
- "qty": the quantity Sam wants as an integer.
  Use 0 for: "skip", "nahi", "nil", "none", "band karo", "mat banao", "zero".
  Use 0 for "thoda kam" only if combined with context suggesting skip — otherwise omit the item.
- Only include items Sam explicitly mentioned. Do not include items she did not change.
- If Sam said "everything same except biryani 25", return only the biryani override.
- If Sam said "sab same" or "sab theek hai" or "all fine", return overrides as [] and unclear as false.
- "unclear": set to true ONLY if the message contains no recognisable item names or quantities at all.`

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

Sam's edit message: "${editMessage}"`

  const parsed = await callClaudeJSON(SYSTEM_PROMPT_D, userMessage, 400)

  if (parsed === null || parsed.unclear) {
    await twilioReply(
      phoneNumber,
      "Sorry Sam, I didn't catch that clearly. Can you say it like:\n\"biryani 25, fish curry 10\"?"
    )
    return
  }

  if (parsed.overrides.length === 0) {
    await supabase.from('predictions').update({ confirmed: true }).eq('date', today)
    await setBotState(phoneNumber, 'idle', null)
    await twilioReply(phoneNumber, "Got it! Today's prep locked in ✓")
    return
  }

  const changedLines = []
  for (const override of parsed.overrides) {
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
    await twilioReply(phoneNumber, `Updated ✓\n${changedLines.join('\n')}\n\nAll other items unchanged.`)
  } else {
    await twilioReply(phoneNumber, "Got it! I've noted your changes ✓")
  }
}

async function handlePrepEditReply(phoneNumber, message) {
  await applyPrepEdits(phoneNumber, message)
}

module.exports = handlePrepEditReply
// Exported for reuse in handlePrepConfirmReply free-text path
module.exports.applyPrepEdits = applyPrepEdits
