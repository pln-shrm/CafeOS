const supabase = require('../../services/supabaseClient')
const { callClaudeJSON, callClaude } = require('../../services/claudeService')
const { setBotState, todayIST, twilioReply, fuzzyMatchMenuItem } = require('./helpers')
const { generatePredictions } = require('../../intelligence/predictions')
const { formatInTimeZone } = require('date-fns-tz')

const IST = 'Asia/Kolkata'

const SYSTEM_PROMPT_G = `You are an assistant for a small cafe in Goa, India.
Sam has just sent her nightly wastage log — what portions are left over from today.
Extract structured leftover quantities per item.
Sam may write in English, Hindi, Konkani, or a mix.
Number words are valid: teen=3, char=4, panch=5, don/do=2, ek=1, chhe/saa=6.
Return ONLY valid JSON — no preamble, no markdown, no explanation.

JSON schema:
{
  "items": [
    { "item": string, "qty_left": number }
  ],
  "all_clear": boolean,
  "unclear": boolean
}

Rules:
- "item": item name as Sam stated it. Match loosely to known menu items.
- "qty_left": integer number of portions or units remaining.
- Treat "nil", "zero", "nahi", "khatam", "sold out" as 0.
- Treat "fine", "ok", "thoda", "negligible", "bahut kam" as 0 — negligible remainder.
- "all_clear": set to true if Sam said everything sold (e.g. "sab bik gaya", "nothing left", "all clear", "sab khatam", "zero wastage"). When true, set items to [].
- "unclear": set to true only if the message is completely unintelligible and no items/quantities can be extracted at all.
- Never invent items Sam did not mention.
- Sam does not need to mention every item — only report what she explicitly stated.`

const SYSTEM_PROMPT_F = `You are CafeOS, generating a WhatsApp vendor order message on behalf of Sam's Cafe in Goa.
The message must sound like Sam wrote it herself — natural, conversational, direct.
The vendor should not know a system generated this.
Return ONLY the message text — no quotes, no preamble, no label, no explanation.

Rules:
- Write in simple, warm Hindi-English mix OR plain English depending on vendor name context.
  Default to plain English unless vendor name suggests a local contact.
- List items clearly: item + quantity per line or as a comma-separated list.
- Include delivery date naturally: "please send tomorrow morning" or "please deliver tomorrow".
  Never use ISO dates.
- Keep it under 200 characters if possible. Never exceed 350 characters.
- Sound like a regular WhatsApp message between two people who know each other.`

function tomorrowIST() {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return formatInTimeZone(tomorrow, IST, 'yyyy-MM-dd')
}

async function buildVendorOrderFromPredictions(predictions, menuItems) {
  // Only items with meaningful predicted quantities
  const orderItems = predictions
    .filter(p => p.predicted_qty > 0)
    .map(p => {
      const item = menuItems.find(m => m.id === p.menu_item_id)
      return {
        name: item?.name || 'Item',
        qty: p.predicted_qty,
        unit: 'portions'
      }
    })

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
  const itemList = items.map(i => `${i.name} ${i.qty}`).join(', ')
  const userMessage = `Items: ${itemList}\nDelivery: tomorrow morning\nNotes: none`

  const claudeMsg = await callClaude(SYSTEM_PROMPT_F, userMessage, 300, 0.7)
  if (claudeMsg) return claudeMsg

  // Fallback: deterministic format
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

  const parsed = await callClaudeJSON(SYSTEM_PROMPT_G, userMessage, 400)

  if (parsed === null || parsed.unclear) {
    await twilioReply(
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
      await supabase
        .from('wastage_logs')
        .upsert({
          menu_item_id: matchedItem?.id || null,
          item_name: entry.item,
          quantity_left: entry.qty_left,
          logged_at: today
        }, { onConflict: 'menu_item_id,logged_at' })
    }
  }

  // Generate predictions for tomorrow
  const tomorrow = tomorrowIST()
  let tomorrowPredictions
  try {
    const result = await generatePredictions(tomorrow)
    tomorrowPredictions = result.rows
  } catch (err) {
    console.error('[WastageReply] Failed to generate tomorrow predictions:', err)
    await setBotState(phoneNumber, 'idle', null)
    await twilioReply(phoneNumber, 'Wastage logged ✓ Thanks Sam!')
    return
  }

  // Build vendor order from predictions
  const orderItems = await buildVendorOrderFromPredictions(tomorrowPredictions, menuItems)
  if (orderItems.length === 0) {
    await setBotState(phoneNumber, 'idle', null)
    await twilioReply(phoneNumber, 'Wastage logged ✓ No items predicted for tomorrow.')
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

  await twilioReply(
    phoneNumber,
    `Wastage logged ✓\n\nHere's tomorrow's order${vendorLine}:\n\n"${formattedMessage}"\n\nReply 1 to confirm or 2 to edit.`
  )
}

module.exports = handleWastageReply
