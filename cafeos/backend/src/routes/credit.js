const { Router } = require('express')
const supabase = require('../services/supabaseClient')
const { ownerAuthMiddleware } = require('../middleware/auth')
const { ok, fail } = require('../utils/response')

const router = Router()

// 10.1 Log Credit or Payment
// POST /api/credit
router.post('/', ownerAuthMiddleware, async (req, res) => {
  const { vendor_name, type, amount, item_description, reference_procurement_id } = req.body

  if (!vendor_name || typeof vendor_name !== 'string' || vendor_name.trim() === '') {
    return fail(res, 'VALIDATION_ERROR', 'vendor_name is required', 400)
  }

  if (type !== 'credit' && type !== 'payment') {
    return fail(res, 'INVALID_TYPE', 'type must be either "credit" or "payment"', 400)
  }

  if (amount === undefined || amount === null || Number(amount) <= 0) {
    return fail(res, 'VALIDATION_ERROR', 'amount must be a positive number', 400)
  }

  // Insert entry into vendor_credit
  const insertData = {
    vendor_name,
    type,
    amount: Number(amount),
    item_description: item_description || '',
    settled: false
  }

  // Check if reference_procurement_id is a valid column. If yes, add it (or check if it exists in the schema).
  // In the DB script it lists reference_procurement_id as optional, but let's check:
  // In the DB script we saw: `vendor_name TEXT NOT NULL, amount NUMERIC(8,2) NOT NULL, type TEXT, item_description TEXT, settled BOOLEAN, timestamp TIMESTAMPTZ`
  // Let's add it if provided, or leave it out if not needed.
  if (reference_procurement_id) {
    insertData.reference_procurement_id = reference_procurement_id
  }

  const { data: entry, error: insertErr } = await supabase
    .from('vendor_credit')
    .insert(insertData)
    .select()
    .single()

  if (insertErr) {
    // If reference_procurement_id column does not exist in schema, try inserting without it
    if (insertErr.message?.includes('reference_procurement_id')) {
      delete insertData.reference_procurement_id
      const { data: entry2, error: insertErr2 } = await supabase
        .from('vendor_credit')
        .insert(insertData)
        .select()
        .single()
      if (insertErr2) throw insertErr2
      return processInsertedEntry(entry2, res, vendor_name)
    }
    throw insertErr
  }

  return processInsertedEntry(entry, res, vendor_name)
})

async function processInsertedEntry(entry, res, vendor_name) {
  // Compute outstanding balance
  const { data: history, error: historyErr } = await supabase
    .from('vendor_credit')
    .select('id, amount, type')
    .eq('vendor_name', vendor_name)

  if (historyErr) throw historyErr

  let outstanding = 0
  for (const item of history || []) {
    if (item.type === 'credit') {
      outstanding += Number(item.amount)
    } else if (item.type === 'payment') {
      outstanding -= Number(item.amount)
    }
  }

  outstanding = Math.round(outstanding * 100) / 100

  let is_settled = outstanding <= 0

  if (is_settled) {
    // Update all entries for this vendor to settled = true
    const { error: updateErr } = await supabase
      .from('vendor_credit')
      .update({ settled: true })
      .eq('vendor_name', vendor_name)
    
    if (updateErr) throw updateErr
    entry.settled = true
  }

  return ok(res, {
    entry,
    balance: {
      vendor_name,
      outstanding: Math.max(0, outstanding),
      is_settled
    }
  }, 201)
}

// 10.4 Get All Vendor Balances
// GET /api/credit/balances
router.get('/balances', ownerAuthMiddleware, async (req, res) => {
  const { data: entries, error } = await supabase
    .from('vendor_credit')
    .select('vendor_name, amount, type, timestamp, settled')

  if (error) throw error

  const vendorMap = {}

  for (const row of entries || []) {
    const vName = row.vendor_name
    if (!vendorMap[vName]) {
      vendorMap[vName] = {
        vendor_name: vName,
        outstanding: 0,
        last_transaction: row.timestamp,
        is_settled: true
      }
    }

    const val = vendorMap[vName]
    const amount = Number(row.amount)

    if (row.type === 'credit') {
      val.outstanding += amount
    } else if (row.type === 'payment') {
      val.outstanding -= amount
    }

    if (new Date(row.timestamp) > new Date(val.last_transaction)) {
      val.last_transaction = row.timestamp
    }

    // A vendor is settled only if all credit logs are marked settled
    if (!row.settled) {
      val.is_settled = false
    }
  }

  const vendors = Object.values(vendorMap).map(v => {
    v.outstanding = Math.max(0, Math.round(v.outstanding * 100) / 100)
    // Double check: if outstanding is 0, force is_settled to true
    if (v.outstanding === 0) {
      v.is_settled = true
    }
    return v
  }).sort((a, b) => b.outstanding - a.outstanding)

  return ok(res, { vendors })
})

// 10.2 Get Vendor Balance
// GET /api/credit/balance/:vendor_name
router.get('/balance/:vendor_name', ownerAuthMiddleware, async (req, res) => {
  const { vendor_name } = req.params

  const { data: entries, error } = await supabase
    .from('vendor_credit')
    .select('amount, type, timestamp, settled')
    .eq('vendor_name', vendor_name)

  if (error) throw error
  if (!entries || entries.length === 0) {
    return fail(res, 'VENDOR_NOT_FOUND', `No transactions found for vendor: ${vendor_name}`, 404)
  }

  let outstanding = 0
  let last_transaction = entries[0].timestamp
  let is_settled = true

  for (const row of entries) {
    const amount = Number(row.amount)
    if (row.type === 'credit') {
      outstanding += amount
    } else if (row.type === 'payment') {
      outstanding -= amount
    }

    if (new Date(row.timestamp) > new Date(last_transaction)) {
      last_transaction = row.timestamp
    }

    if (!row.settled) {
      is_settled = false
    }
  }

  outstanding = Math.max(0, Math.round(outstanding * 100) / 100)
  if (outstanding === 0) {
    is_settled = true
  }

  return ok(res, {
    vendor_name,
    outstanding,
    is_settled,
    last_transaction
  })
})

// 10.3 Get Credit Ledger History
// GET /api/credit
router.get('/', ownerAuthMiddleware, async (req, res) => {
  const { vendor_name, type, settled, from, to, page = 1, limit = 50 } = req.query

  let query = supabase.from('vendor_credit').select('*', { count: 'exact' })

  if (vendor_name) {
    query = query.eq('vendor_name', vendor_name)
  }
  if (type) {
    query = query.eq('type', type)
  }
  if (settled !== undefined) {
    query = query.eq('settled', settled === 'true')
  }
  if (from) {
    query = query.gte('timestamp', from)
  }
  if (to) {
    query = query.lte('timestamp', to)
  }

  const parsedPage = Number(page)
  const parsedLimit = Math.min(Number(limit), 200)
  const offset = (parsedPage - 1) * parsedLimit

  query = query
    .order('timestamp', { ascending: false })
    .range(offset, offset + parsedLimit - 1)

  const { data: entries, error, count } = await query
  if (error) throw error

  return ok(res, {
    entries: entries || [],
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total: count || 0
    }
  })
})

module.exports = router
