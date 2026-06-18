const { v4: uuidv4 } = require('uuid')
const { formatInTimeZone } = require('date-fns-tz')
const supabase = require('../../services/supabaseClient')
const { whatsappReply } = require('../../services/whatsappClient')
const { callGeminiJSON, aiClient: ai } = require('../../services/geminiService')

const IST = 'Asia/Kolkata'

function todayIST() {
  return formatInTimeZone(new Date(), IST, 'yyyy-MM-dd')
}

async function getNextBillNumber(billDate) {
  const { data, error } = await supabase
    .from('orders')
    .select('bill_number')
    .eq('bill_date', billDate)
    .order('bill_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.bill_number ? data.bill_number + 1 : 1
}

const PARSE_SYSTEM = `You are a restaurant order parser for an Indian cafe.
Extract structured order data from a Swiggy or Zomato order message or screenshot.
Return only valid JSON.`

async function parseFromText(text, menuNames) {
  return callGeminiJSON(
    PARSE_SYSTEM,
    `Available menu items: ${menuNames}\n\nOrder text:\n${text}\n\nExtract and return JSON: { "platform": "swiggy"|"zomato"|"unknown", "customer_name": string or null, "items": [{ "name": string, "quantity": number }] }`,
    600
  )
}

async function parseFromImage(imageBase64, imageMimeType, menuNames) {
  if (!ai) return null
  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Available menu items: ${menuNames}\n\nThis is a screenshot of a Swiggy or Zomato order. Extract the platform, customer name, and ordered items with quantities. Return JSON: { "platform": "swiggy"|"zomato"|"unknown", "customer_name": string or null, "items": [{ "name": string, "quantity": number }] }`
            },
            { inlineData: { mimeType: imageMimeType, data: imageBase64 } }
          ]
        }
      ],
      config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 600 }
    })
    return JSON.parse(response.text.trim())
  } catch (err) {
    console.error('[handlePlatformOrder] Gemini image parse failed:', err.message)
    return null
  }
}

async function handlePlatformOrder(phoneNumber, text, imageData) {
  await whatsappReply(phoneNumber, '⏳ Parsing platform order...')

  const { data: menuItems, error: menuErr } = await supabase
    .from('menu_items')
    .select('id, name, price, category')
    .eq('active', true)

  if (menuErr || !menuItems?.length) {
    await whatsappReply(phoneNumber, '❌ Could not load menu. Try again.')
    return
  }

  const menuNames = menuItems.map(m => m.name).join(', ')

  let parsed
  try {
    parsed = imageData
      ? await parseFromImage(imageData.base64, imageData.mimeType, menuNames)
      : await parseFromText(text, menuNames)
  } catch (err) {
    console.error('[handlePlatformOrder] Parse error:', err.message)
  }

  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
    await whatsappReply(phoneNumber, '❌ Couldn\'t read the order. Send the order text or a clearer screenshot.')
    return
  }

  // Match parsed item names to menu items (fuzzy)
  const matchedItems = []
  const unmatched = []
  for (const item of parsed.items) {
    const nameLower = item.name.toLowerCase().trim()
    const match = menuItems.find(m =>
      m.name.toLowerCase().includes(nameLower) ||
      nameLower.includes(m.name.toLowerCase())
    )
    if (match) {
      const qty = Math.max(1, Math.round(Number(item.quantity) || 1))
      matchedItems.push({ menu_item_id: match.id, quantity: qty })
    } else {
      unmatched.push(item.name)
    }
  }

  if (matchedItems.length === 0) {
    const names = parsed.items.map(i => i.name).join(', ')
    await whatsappReply(phoneNumber, `❌ None of the items matched the menu: ${names}\nPlease log this order manually in the app.`)
    return
  }

  const menuMap = Object.fromEntries(menuItems.map(m => [m.id, m]))
  const total = matchedItems.reduce((sum, i) => sum + menuMap[i.menu_item_id].price * i.quantity, 0)

  const platform = ['swiggy', 'zomato'].includes(parsed.platform?.toLowerCase()) ? parsed.platform.toLowerCase() : 'swiggy'
  const customerName = parsed.customer_name?.trim() || `${platform.charAt(0).toUpperCase() + platform.slice(1)} Customer`
  const billDate = todayIST()
  const localUuid = uuidv4()

  let order, orderErr
  for (let attempt = 0; attempt < 3; attempt++) {
    const billNumber = await getNextBillNumber(billDate)
    ;({ data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        local_uuid: localUuid,
        order_type: platform,
        payment_method: 'pending',
        total,
        bill_number: billNumber,
        bill_date: billDate,
        customer_name: customerName,
        status: 'ongoing'
      })
      .select()
      .single())
    if (!orderErr || orderErr.code !== '23505') break
  }

  if (orderErr) {
    console.error('[handlePlatformOrder] Order insert failed:', orderErr)
    await whatsappReply(phoneNumber, '❌ Failed to create order. Try again.')
    return
  }

  const itemRows = matchedItems.map(i => ({
    order_id: order.id,
    menu_item_id: i.menu_item_id,
    quantity: i.quantity,
    unit_price: menuMap[i.menu_item_id].price,
    discount_amount: 0
  }))

  const { error: itemsErr } = await supabase.from('order_items').insert(itemRows)
  if (itemsErr) {
    await supabase.from('orders').delete().eq('id', order.id)
    await whatsappReply(phoneNumber, '❌ Failed to save order items. Try again.')
    return
  }

  const itemLines = matchedItems
    .map(i => `  • ${menuMap[i.menu_item_id].name} ×${i.quantity}  ₹${menuMap[i.menu_item_id].price * i.quantity}`)
    .join('\n')

  const unmatchedNote = unmatched.length > 0
    ? `\n\n⚠️ Items not found in menu (add manually): ${unmatched.join(', ')}`
    : ''

  const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1)
  await whatsappReply(phoneNumber,
    `✅ ${platformLabel} order logged!\n\n` +
    `Customer: ${customerName}\n` +
    `Bill #${order.bill_number}\n\n` +
    `${itemLines}\n\n` +
    `Total: ₹${total}${unmatchedNote}`
  )
}

module.exports = handlePlatformOrder
