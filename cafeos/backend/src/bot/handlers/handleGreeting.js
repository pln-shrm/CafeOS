const { setBotState, whatsappButtons } = require('./helpers')

const GREETING_RE = /^(hi+|hello+|hey+|helo+|hola|namaste|good\s*(morning|afternoon|evening)|morning|evening|yo|sup|wassup|hai)[\s!.]*$/i

function isGreeting(text) {
  return GREETING_RE.test(text.trim())
}

async function handleGreeting(phoneNumber) {
  await setBotState(phoneNumber, 'awaiting_main_menu', null)
  await whatsappButtons(
    phoneNumber,
    'Hello Sam! What can I do for you today?',
    [
      { id: 'menu_order', title: 'Place Order' },
      { id: 'menu_summary', title: "Today's Summary" },
      { id: 'menu_stock', title: 'Check Stock' }
    ]
  )
}

module.exports = { handleGreeting, isGreeting }
