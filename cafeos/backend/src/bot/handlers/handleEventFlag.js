const { twilioReply } = require('./helpers')

async function handleEventFlag(phoneNumber) {
  await twilioReply(phoneNumber, 'Noted — I will keep that in mind for prep planning.')
}

module.exports = handleEventFlag
