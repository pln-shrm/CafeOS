const supabase = require('../../services/supabaseClient')
const { callGemini } = require('../../services/geminiService')
const { setBotState, whatsappReply } = require('./helpers')
const { VENDOR_MESSAGE_PROMPT } = require('./prompts')

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
  const text = message.trim().toLowerCase()
  const vendorName = context?.vendor_name

  if (['1', 'ok', 'haan', 'yes'].includes(text)) {
    const formattedMessage = await buildForwardableMessage(context?.items, vendorName)
      || context?.formatted_message
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
    return
  }

  if (text === '2') {
    await setBotState(phoneNumber, 'awaiting_vendor_edit', context || null)
    await whatsappReply(phoneNumber, "What changes? (e.g. 'rice 6kg, skip oil')")
    return
  }

  await whatsappReply(phoneNumber, 'Reply 1 to confirm or 2 to edit.')
}

module.exports = handleVendorConfirmReply
