const { parseVendorItems, setBotState, whatsappReply, whatsappButtons } = require('./helpers')

function buildVendorMessage(items) {
  const list = items.map(item => `${item.name} ${item.qty}${item.unit || ''}`)
  return `${list.join(', ')} — please deliver tomorrow morning.`
}

// Extract items the user wants removed: "skip oil", "no milk", "remove dal"
function parseSkips(text) {
  const skips = []
  for (const seg of text.split(/[,;]+/)) {
    const m = seg.trim().match(/^(?:skip|no|remove|cancel|hatao)\s+([\w\s]+)$/i)
    if (m) skips.push(m[1].trim().toLowerCase())
  }
  return skips
}

async function handleVendorEditReply(phoneNumber, message, context) {
  const lowered = message.trim().toLowerCase()
  if (['1', 'ok', 'haan', 'yes'].includes(lowered)) {
    await setBotState(phoneNumber, 'awaiting_vendor_confirm', context || null)
    await whatsappButtons(
      phoneNumber,
      `Keeping the order as is:\n\n"${context?.formatted_message || ''}"`,
      [
        { id: '1', title: 'Confirm ✅' },
        { id: '2', title: 'Edit ✏️' }
      ]
    )
    return
  }

  const parsedItems = await parseVendorItems(message)
  const skips = parseSkips(message)

  if (parsedItems.length === 0 && skips.length === 0) {
    await whatsappReply(
      phoneNumber,
      "I didn't catch any changes. Try: 'rice 6kg, skip oil' — or reply 1 to keep the order as is."
    )
    return
  }

  // Merge edits into the existing order instead of replacing it
  const items = [...(context?.items || [])]
  for (const edit of parsedItems) {
    const idx = items.findIndex(i => i.name.toLowerCase() === edit.name.toLowerCase())
    if (idx >= 0) {
      items[idx] = { ...items[idx], qty: edit.qty, unit: edit.unit || items[idx].unit }
    } else {
      items.push(edit)
    }
  }

  const finalItems = items.filter(i => {
    const name = i.name.toLowerCase()
    return !skips.some(s => name.includes(s) || s.includes(name))
  })

  if (finalItems.length === 0) {
    await setBotState(phoneNumber, 'idle', null)
    await whatsappReply(phoneNumber, 'All items removed — order cancelled.')
    return
  }

  const formattedMessage = buildVendorMessage(finalItems)
  const vendorName = context?.vendor_name || 'vendor'

  const nextContext = {
    ...context,
    vendor_name: vendorName,
    items: finalItems,
    formatted_message: formattedMessage
  }

  await setBotState(phoneNumber, 'awaiting_vendor_confirm', nextContext)
  await whatsappButtons(
    phoneNumber,
    `Got it — here's the updated order: ${formattedMessage}`,
    [
      { id: '1', title: 'Confirm ✅' },
      { id: '2', title: 'Edit again ✏️' }
    ]
  )
}

module.exports = handleVendorEditReply
