const { setBotState, whatsappReply } = require('./helpers')

async function handleRecoveryReply(phoneNumber, message, contextJson) {
  // message should be '1' for Resume or '2' for Start Over
  if (message === '1' || message.toLowerCase().includes('resume') || message.toLowerCase().includes('continue')) {
    // Restore previous state
    if (contextJson && contextJson.previous_state) {
      await setBotState(phoneNumber, contextJson.previous_state, contextJson.previous_context)
      await whatsappReply(phoneNumber, `Got it. Resuming where we left off... Please reply to the last prompt or type 'cancel' to stop.`)
    } else {
      await setBotState(phoneNumber, 'idle', null)
      await whatsappReply(phoneNumber, `Sorry, I lost the exact step. Let's start over. What do you need?`)
    }
  } else if (message === '2' || message.toLowerCase().includes('start') || message.toLowerCase().includes('over')) {
    await setBotState(phoneNumber, 'idle', null)
    await whatsappReply(phoneNumber, `No problem, we've started fresh. What do you need?`)
  } else {
    // Fallback if they reply something else
    await whatsappReply(phoneNumber, `Please reply '1' to Resume or '2' to Start Over.`)
  }
}

module.exports = handleRecoveryReply
