const { applyPrepEdits } = require('./handlePrepEditReply')

// All intent classification (confirm / edit_request / provide_overrides) is now
// handled by the AI inside applyPrepEdits — no hardcoded string checks needed.
async function handlePrepConfirmReply(phoneNumber, message) {
  await applyPrepEdits(phoneNumber, message)
}

module.exports = handlePrepConfirmReply
