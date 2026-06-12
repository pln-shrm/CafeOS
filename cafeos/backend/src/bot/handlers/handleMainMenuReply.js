const supabase = require('../../services/supabaseClient')
const { setBotState, whatsappButtons, whatsappReply } = require('./helpers')
const handleSummaryQuery = require('./handleSummaryQuery')
const handleStockQuery = require('./handleStockQuery')

async function fetchRecentVendors() {
  const { data } = await supabase
    .from('procurement')
    .select('vendor_name')
    .order('created_at', { ascending: false })
    .limit(50)

  if (!data) return []
  const seen = new Set()
  const vendors = []
  for (const row of data) {
    const name = row.vendor_name?.trim()
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase())
      vendors.push(name)
      if (vendors.length >= 2) break
    }
  }
  return vendors
}

async function handleMainMenuReply(phoneNumber, message) {
  const id = message.trim()

  if (id === 'menu_order') {
    const vendors = await fetchRecentVendors()

    if (vendors.length === 0) {
      await setBotState(phoneNumber, 'awaiting_order_vendor_name', { source: 'greeting_flow' })
      await whatsappReply(phoneNumber, "Who are you ordering from? (Reply with vendor name)")
      return
    }

    const buttons = vendors.map((v, i) => ({ id: `vendor_${i}`, title: v.slice(0, 20) }))
    buttons.push({ id: 'vendor_other', title: 'Other Vendor' })

    await setBotState(phoneNumber, 'awaiting_vendor_selection', { vendors, source: 'greeting_flow' })
    await whatsappButtons(phoneNumber, 'Who are you ordering from?', buttons)
    return
  }

  if (id === 'menu_summary') {
    await handleSummaryQuery(phoneNumber)
    await showWhatElseMenu(phoneNumber)
    return
  }

  if (id === 'menu_stock') {
    await handleStockQuery(phoneNumber)
    await showWhatElseMenu(phoneNumber)
    return
  }

  // Unrecognised tap — re-show menu
  await whatsappButtons(
    phoneNumber,
    'Please choose one of the options:',
    [
      { id: 'menu_order', title: 'Place Order' },
      { id: 'menu_summary', title: "Today's Summary" },
      { id: 'menu_stock', title: 'Check Stock' }
    ]
  )
}

async function showWhatElseMenu(phoneNumber) {
  await setBotState(phoneNumber, 'awaiting_what_else', null)
  await whatsappButtons(
    phoneNumber,
    'Is there anything else I can help you with?',
    [
      { id: 'more_yes', title: 'Yes, more please' },
      { id: 'more_done', title: 'No, all done!' }
    ]
  )
}

module.exports = { handleMainMenuReply, showWhatElseMenu }
