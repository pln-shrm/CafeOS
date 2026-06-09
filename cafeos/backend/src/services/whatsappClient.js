const axios = require('axios')

async function whatsappReply(to, body) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.META_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: body }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )
    return response.data
  } catch (error) {
    console.error('[WhatsApp Client] Failed to send message:', error.response?.data || error.message)
    throw error
  }
}

module.exports = { whatsappReply }
