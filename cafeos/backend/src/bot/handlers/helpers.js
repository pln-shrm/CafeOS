const { formatInTimeZone } = require('date-fns-tz')
const supabase = require('../../services/supabaseClient')
const { twilioReply } = require('../../services/twilioClient')

const IST = 'Asia/Kolkata'

function todayIST() {
  return formatInTimeZone(new Date(), IST, 'yyyy-MM-dd')
}

function formatRupees(amount) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '₹0'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(Number(amount))
}

async function getBotState(phoneNumber) {
  const { data, error } = await supabase
    .from('bot_state')
    .select('*')
    .eq('phone_number', phoneNumber)
    .maybeSingle()

  if (error) throw error
  return data
}

async function setBotState(phoneNumber, state, contextJson = null) {
  const { error } = await supabase
    .from('bot_state')
    .upsert({
      phone_number: phoneNumber,
      current_state: state,
      context_json: contextJson
    }, { onConflict: 'phone_number' })

  if (error) throw error
}

function parseVendorItems(text) {
  const items = []
  const regex = /(\w+)\s+(\d+\.?\d*)\s*(kg|l|g|litre|pieces|pcs)?/gi
  let match
  while ((match = regex.exec(text)) !== null) {
    const name = match[1]
    const qty = Number(match[2])
    const unit = match[3] || ''
    if (!Number.isNaN(qty)) {
      items.push({ name, qty, unit })
    }
  }
  return items
}

// Levenshtein distance for fuzzy name matching
function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

// menuItems: array of { id, name, ... }
// Returns the best-matching item or null if no reasonable match
function fuzzyMatchMenuItem(searchName, menuItems) {
  if (!searchName || !menuItems || menuItems.length === 0) return null
  const search = searchName.toLowerCase().trim()

  // Exact match first
  const exact = menuItems.find(i => i.name.toLowerCase() === search)
  if (exact) return exact

  // Substring match: search word found in item name or vice versa
  const sub = menuItems.find(i => {
    const iName = i.name.toLowerCase()
    return iName.includes(search) || search.includes(iName.split(' ')[0])
  })
  if (sub) return sub

  // Fuzzy: find lowest Levenshtein distance
  let best = null, bestDist = Infinity
  for (const item of menuItems) {
    const dist = levenshtein(search, item.name.toLowerCase())
    if (dist < bestDist) {
      bestDist = dist
      best = item
    }
  }
  // Only accept if distance is within 40% of the longer string length
  const threshold = Math.max(search.length, best?.name.length ?? 0) * 0.4
  return bestDist <= threshold ? best : null
}

module.exports = {
  twilioReply,
  todayIST,
  formatRupees,
  getBotState,
  setBotState,
  parseVendorItems,
  fuzzyMatchMenuItem
}
