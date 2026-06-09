const supabase = require('../../services/supabaseClient')
const { formatRupees, whatsappReply } = require('./helpers')

async function getBalance(vendorName) {
  const { data, error } = await supabase
    .from('vendor_credit')
    .select('amount, type')
    .ilike('vendor_name', vendorName)

  if (error) throw error

  let balance = 0
  for (const entry of data || []) {
    if (entry.type === 'credit') balance += Number(entry.amount)
    if (entry.type === 'payment') balance -= Number(entry.amount)
  }
  return balance
}

async function handleCreditCommand(phoneNumber, message) {
  const creditMatch = message.match(/credit\s+([\w\s]+)\s+₹?(\d+)/i)
  const paidMatch = message.match(/paid\s+([\w\s]+)\s+₹?(\d+)/i)

  let vendorName
  let amount
  let type

  if (creditMatch) {
    vendorName = creditMatch[1].trim()
    amount = Number(creditMatch[2])
    type = 'credit'
  } else if (paidMatch) {
    vendorName = paidMatch[1].trim()
    amount = Number(paidMatch[2])
    type = 'payment'
  }

  if (!vendorName || !amount) {
    await whatsappReply(phoneNumber, "Try: 'credit Rice Vendor ₹4500' or 'paid Meat Vendor ₹2400'")
    return
  }

  await supabase
    .from('vendor_credit')
    .insert({
      vendor_name: vendorName,
      amount,
      type
    })

  const balance = await getBalance(vendorName)
  const balanceText = balance >= 0
    ? `Balance due: ${formatRupees(balance)}`
    : `Balance in your favor: ${formatRupees(Math.abs(balance))}`

  await whatsappReply(phoneNumber, `${vendorName} logged. ${balanceText}`)
}

module.exports = handleCreditCommand
