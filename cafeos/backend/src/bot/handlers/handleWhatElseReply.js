const { setBotState, whatsappButtons, whatsappReply } = require('./helpers')

async function handleWhatElseReply(phoneNumber, message) {
  const id = message.trim()

  if (id === 'more_yes') {
    await setBotState(phoneNumber, 'awaiting_main_menu', null)
    await whatsappButtons(
      phoneNumber,
      'Sure! What can I help you with?',
      [
        { id: 'menu_order', title: 'Place Order' },
        { id: 'menu_summary', title: "Today's Summary" },
        { id: 'menu_stock', title: 'Check Stock' }
      ]
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

module.exports = handleWhatElseReply
