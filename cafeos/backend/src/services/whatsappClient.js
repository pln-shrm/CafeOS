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
    console.error('[WhatsApp Client] Failed to send message:', JSON.stringify(error.response?.data || error.message, null, 2))
    throw error
  }
}

// Interactive reply buttons (MCQ-style, tappable). buttons: [{ id, title }], max 3.
// Meta limits: body ≤ 1024 chars, button title ≤ 20 chars.
// Falls back to plain text with a reply hint if the body is too long or the send fails,
// so flows never break on devices/situations where interactive messages don't work.
async function whatsappButtons(to, body, buttons = []) {
  const valid = (buttons || []).slice(0, 3).map(b => ({
    type: 'reply',
    reply: { id: String(b.id), title: String(b.title).slice(0, 20) }
  }))

  if (valid.length === 0) return whatsappReply(to, body)

  const textFallback = () => {
    const hint = valid.map(b => `${b.reply.id} = ${b.reply.title}`).join(' | ')
    return whatsappReply(to, `${body}\n\nReply: ${hint}`)
  }

  if (body.length > 1024) return textFallback()

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.META_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: { buttons: valid }
        }
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
    console.error('[WhatsApp Client] Interactive send failed, falling back to text:', JSON.stringify(error.response?.data || error.message, null, 2))
    return textFallback()
  }
}

// Interactive list message — supports up to 10 rows, ideal for menus > 3 options.
// rows: [{ id, title, description? }]  title ≤ 24 chars, description ≤ 72 chars.
// Falls back to plain text on failure so flows never break.
async function whatsappList(to, body, buttonLabel, rows = []) {
  const validRows = (rows || []).slice(0, 10).map(r => {
    const row = { id: String(r.id), title: String(r.title).slice(0, 24) }
    if (r.description) row.description = String(r.description).slice(0, 72)
    return row
  })

  if (validRows.length === 0) return whatsappReply(to, body)

  const textFallback = () => {
    const hint = validRows.map(r => `${r.id} = ${r.title}`).join(' | ')
    return whatsappReply(to, `${body}\n\nReply: ${hint}`)
  }

  if (body.length > 1024) return textFallback()

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.META_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body },
          action: {
            button: String(buttonLabel || 'Options').slice(0, 20),
            sections: [{ title: 'Options', rows: validRows }]
          }
        }
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
    console.error('[WhatsApp Client] List send failed, falling back to text:', JSON.stringify(error.response?.data || error.message, null, 2))
    return textFallback()
  }
}

module.exports = { whatsappReply, whatsappButtons, whatsappList }
