const supabase = require('../../services/supabaseClient')
const { callGeminiJSON } = require('../../services/geminiService')
const { setBotState, whatsappReply, incrementInventoryLevels } = require('./helpers')

const schemaReceivingEdit = {
  type: "object",
  properties: {
    updated_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          qty: { type: "number" },
          unit: { type: "string", nullable: true }
        }
      }
    }
  }
}

const SYSTEM_PROMPT_RECEIVING_EDIT = `You are CafeOS. The user is editing a received vendor order.
Update the JSON array of items based on the user's modifications.
If they say "only 4kg tomatoes", change the tomatoes quantity to 4. If they say "no milk", remove milk or set qty to 0.
Return the complete updated list of items.`

async function handleReceivingEditReply(phoneNumber, message, context) {
  const userMessage = `Original Items: ${JSON.stringify(context.items)}\nUser Edit: "${message}"`
  
  const parsed = await callGeminiJSON(SYSTEM_PROMPT_RECEIVING_EDIT, userMessage, 400, schemaReceivingEdit)

  if (!parsed || !parsed.updated_items) {
    await whatsappReply(phoneNumber, "I couldn't understand those changes. Try saying 'tomatoes 4kg'.")
    return
  }

  // Update DB with the new json and set to received
  await supabase
    .from('procurement')
    .update({
      items_json: parsed.updated_items,
      status: 'delivered'
    })
    .eq('id', context.order_id)

  await incrementInventoryLevels(parsed.updated_items)

  await setBotState(phoneNumber, 'idle', null)

  const itemList = parsed.updated_items.map(i => `${i.name} ${i.qty}${i.unit || ''}`).join(', ')
  await whatsappReply(phoneNumber, `Inventory updated ✓\n\nMarked order from ${context.vendor_name} as received with these changes:\n${itemList}`)
}

module.exports = handleReceivingEditReply
