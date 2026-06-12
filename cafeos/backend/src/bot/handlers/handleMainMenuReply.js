const supabase = require('../../services/supabaseClient')
const { setBotState, whatsappButtons, whatsappList, whatsappReply } = require('./helpers')
const handleSummaryQuery = require('./handleSummaryQuery')
const handleStockQuery = require('./handleStockQuery')
const { showWhatElseMenu, MAIN_MENU_ROWS } = require('./handleWhatElseReply')

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
    return
  }

  if (id === 'menu_stock') {
    await handleStockQuery(phoneNumber)
    return
  }

  if (id === 'menu_manual') {
    await setBotState(phoneNumber, 'idle', null)
    await whatsappReply(phoneNumber, "Sure! Just type what you need — order, stock, balance, anything. I'll handle it.")
    return
  }

  // Unrecognised tap — re-show menu
  await whatsappList(phoneNumber, 'Please choose one of the options:', 'Choose an option', MAIN_MENU_ROWS)
}

module.exports = { handleMainMenuReply, showWhatElseMenu }
