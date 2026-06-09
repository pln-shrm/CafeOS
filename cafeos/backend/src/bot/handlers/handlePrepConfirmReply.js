const supabase = require('../../services/supabaseClient')
const { setBotState, todayIST, whatsappReply } = require('./helpers')
const { applyPrepEdits } = require('./handlePrepEditReply')

async function handlePrepConfirmReply(phoneNumber, message) {
  const text = message.trim().toLowerCase()

  if (['1', 'ok', 'haan', 'yes'].includes(text)) {
    const today = todayIST()
    await supabase
      .from('predictions')
      .update({ confirmed: true })
      .eq('date', today)

    await setBotState(phoneNumber, 'idle', null)
    await whatsappReply(phoneNumber, "Got it! Today's prep locked in ✓")
    return
  }

  if (text === '2') {
    await setBotState(phoneNumber, 'awaiting_prep_edit', null)
    await whatsappReply(phoneNumber, "What would you like to change? (e.g. 'biryani 25, fish curry 10')")
    return
  }

  // Free-text edit — parse with Prompt D inline
  await applyPrepEdits(phoneNumber, message)
}

module.exports = handlePrepConfirmReply
