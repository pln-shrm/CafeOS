const { setBotState, whatsappList } = require('./helpers')
const { MAIN_MENU_ROWS } = require('./handleWhatElseReply')

const GREETING_RE = /^(hi+|hello+|hey+|helo+|hola|namaste|good\s*(morning|afternoon|evening)|morning|evening|yo|sup|wassup|hai)[\s!.]*$/i

function isGreeting(text) {
  return GREETING_RE.test(text.trim())
}

async function handleGreeting(phoneNumber) {
  await setBotState(phoneNumber, 'awaiting_main_menu', null)
  await whatsappList(
    phoneNumber,
    'Hello Sam! What can I do for you today?',
    'Choose an option',
    MAIN_MENU_ROWS
  )
}

module.exports = { handleGreeting, isGreeting }
