const supabase = require('../../services/supabaseClient')
const { formatRupees, whatsappReply } = require('./helpers')

async function handleBalanceQuery(phoneNumber, message) {
  const match = message.match(/(?:owe|balance)\s+(.+)/i)
  if (!match) {
    await whatsappReply(phoneNumber, "Try: 'owe Rice Vendor' or 'balance Meat Vendor'")
    return
  }

  const vendorName = match[1].trim()

  const { data, error } = await supabase
    .from('vendor_credit')
    .select('amount, type')
    .ilike('vendor_name', vendorName)

  if (error) throw error

  if (!data || data.length === 0) {
    await whatsappReply(phoneNumber, `No credit entries found for ${vendorName}.`)
    return
  }

  let balance = 0
  for (const entry of data) {
    if (entry.type === 'credit') balance += Number(entry.amount)
    if (entry.type === 'payment') balance -= Number(entry.amount)
  }

  const balanceText = balance >= 0
    ? `Balance due: ${formatRupees(balance)}`
    : `Balance in your favor: ${formatRupees(Math.abs(balance))}`

  await whatsappReply(phoneNumber, `${vendorName} — ${balanceText}`)
}

module.exports = handleBalanceQuery
