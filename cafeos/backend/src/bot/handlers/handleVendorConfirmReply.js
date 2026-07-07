const supabase = require('../../services/supabaseClient')
const { callGemini, callGeminiJSON } = require('../../services/geminiService')
const { setBotState, whatsappReply, whatsappButtons } = require('./helpers')
const { VENDOR_MESSAGE_PROMPT } = require('./prompts')
const { showWhatElseMenu } = require('./handleWhatElseReply')

// Lightweight schema for vendor confirm intent classification
const schemaVendorConfirm = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["confirm", "edit_request"]
    },
    unclear: { type: "boolean" }
  }
}

const SYSTEM_PROMPT_VENDOR_CONFIRM = `You are an assistant for a small cafe in Goa, India.
Sam (the owner) is reviewing a vendor order draft. Classify her intent.
Sam may write in English, Hindi, Konkani, or a mix. She may tap a button or type freely.

Determine the "action":
- "confirm": Sam wants to proceed with the order as-is. Examples: "ok", "yes", "haan", "send it", "confirm", "go ahead", "done", "theek hai", "bhej do", "1", "yeah send it".
- "edit_request": Sam wants to change the order. Examples: "edit", "make changes", "change karo", "wait", "ruko", "not this", "2", "add rice", "skip oil".

- "unclear": true ONLY if the message has no recognisable intent at all.`

async function buildForwardableMessage(items, vendorName) {
  const itemList = (items || [])
    .filter(i => (i.qty ?? i.quantity ?? 0) > 0)
    .map(i => `${i.name} ${i.qty ?? i.quantity}${i.unit ? i.unit : ''}`)
    .join(', ')

  if (!itemList) return null

  const userMessage = `Vendor: ${vendorName || 'vendor'}\nItems: ${itemList}\nDelivery: tomorrow morning\nNotes: none`
  const claudeMsg = await callGemini(VENDOR_MESSAGE_PROMPT, userMessage, 300, 0.7)
  if (claudeMsg) return claudeMsg

  // Fallback
  return `${itemList} — please deliver tomorrow morning`
}

async function handleVendorConfirmReply(phoneNumber, message, context) {
  const vendorName = context?.vendor_name

  // Use AI to classify intent — no hardcoded string checks
  const userMessage = `Sam's reply to the vendor order draft: "${message}"`
  const parsed = await callGeminiJSON(SYSTEM_PROMPT_VENDOR_CONFIRM, userMessage, 200, schemaVendorConfirm)

  // If AI classification failed or is unclear, fall back to showing buttons
  if (!parsed || parsed.unclear) {
    await whatsappButtons(phoneNumber, 'What would you like to do with this order?', [
      { id: '1', title: 'Confirm ✅' },
      { id: '2', title: 'Edit ✏️' }
    ])
    return
  }

  if (parsed.action === 'confirm') {
    // Send exactly what Sam confirmed — only generate fresh if context lost it
    const formattedMessage = context?.formatted_message
      || await buildForwardableMessage(context?.items, vendorName)
      || 'Order placed — please deliver tomorrow morning.'

    const items = context?.items || []

    // Calculate total cost if all items have cost_per_unit (set by recipe-based ordering)
    let totalCost = null
    const allPriced = items.length > 0 && items.every(i => i.cost_per_unit != null)
    if (allPriced) {
      totalCost = Math.round(
        items.reduce((sum, i) => sum + Number(i.cost_per_unit) * Number(i.qty ?? i.quantity ?? 0), 0) * 100
      ) / 100
    }

    await supabase
      .from('procurement')
      .insert({
        vendor_name: vendorName || 'vendor',
        items_json: items,
        total_cost: totalCost,
        status: 'pending_delivery'
      })

    // Auto-log vendor credit when cost is known
    if (totalCost && totalCost > 0 && vendorName) {
      const description = items.map(i => `${i.name} ${i.qty ?? i.quantity ?? ''}${i.unit || ''}`).join(', ')
      await supabase.from('vendor_credit').insert({
        vendor_name: vendorName,
        type: 'credit',
        amount: totalCost,
        item_description: `Auto: ${description}`,
        settled: false
      })
    }

    await setBotState(phoneNumber, 'idle', null)

    const vendorLine = vendorName ? ` to ${vendorName}` : ''
    await whatsappReply(
      phoneNumber,
      `Order confirmed ✓\n\nForward this${vendorLine}:\n\n"${formattedMessage}"`
    )

    await showWhatElseMenu(phoneNumber)
    return
  }

  if (parsed.action === 'edit_request') {
    await setBotState(phoneNumber, 'awaiting_vendor_edit', context || null)
    await whatsappReply(phoneNumber, "What changes? (e.g. 'rice 6kg, skip oil')")
    return
  }
}

module.exports = handleVendorConfirmReply
