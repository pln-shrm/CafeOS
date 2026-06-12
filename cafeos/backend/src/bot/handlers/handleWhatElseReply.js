const { setBotState, whatsappButtons, whatsappList, whatsappReply } = require('./helpers')

const MAIN_MENU_ROWS = [
  { id: 'menu_order',   title: 'Place Order',      description: 'Order from a vendor' },
  { id: 'menu_summary', title: "Today's Summary",   description: 'Sales & revenue today' },
  { id: 'menu_stock',   title: 'Check Stock',       description: 'Inventory & prep levels' },
  { id: 'menu_manual',  title: 'Type Freely',       description: 'Ask anything or give info' }
]

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

async function handleWhatElseReply(phoneNumber, message) {
  const id = message.trim()

  if (id === 'more_yes') {
    await setBotState(phoneNumber, 'awaiting_main_menu', null)
    await whatsappList(
      phoneNumber,
      'Sure! What can I help you with?',
      'Choose an option',
      MAIN_MENU_ROWS
    )
    return
  }

  if (id === 'more_done') {
    await setBotState(phoneNumber, 'idle', null)
    await whatsappReply(phoneNumber, 'Got it! Have a great day Sam 👋')
    return
  }

  // Unrecognised — re-show the prompt
  await whatsappButtons(
    phoneNumber,
    'Is there anything else I can help you with?',
    [
      { id: 'more_yes', title: 'Yes, more please' },
      { id: 'more_done', title: 'No, all done!' }
    ]
  )
}

module.exports = { handleWhatElseReply, showWhatElseMenu, MAIN_MENU_ROWS }
