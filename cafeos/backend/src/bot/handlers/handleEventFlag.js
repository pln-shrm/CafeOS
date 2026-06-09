const { whatsappReply } = require('./helpers')

async function handleEventFlag(phoneNumber) {
  await whatsappReply(phoneNumber, 'Noted — I will keep that in mind for prep planning.')
}

module.exports = handleEventFlag
