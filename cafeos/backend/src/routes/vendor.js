const { Router } = require('express')
const supabase = require('../services/supabaseClient')
const { ownerAuthMiddleware } = require('../middleware/auth')
const { ok, fail } = require('../utils/response')
const { formatInTimeZone } = require('date-fns-tz')

const router = Router()
const IST = 'Asia/Kolkata'

function tomorrowIST() {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return formatInTimeZone(tomorrow, IST, 'yyyy-MM-dd')
}

// 7.1 Create Vendor Order (Procurement)
// POST /api/vendor/orders
router.post('/orders', ownerAuthMiddleware, async (req, res) => {
  const { vendor_name, items, delivery_date, notes } = req.body

  if (!vendor_name || typeof vendor_name !== 'string' || vendor_name.trim() === '') {
    return fail(res, 'VALIDATION_ERROR', 'vendor_name is required and must be a string', 400)
  }

  if (!Array.isArray(items) || items.length === 0) {
    return fail(res, 'VALIDATION_ERROR', 'items must be a non-empty array', 400)
  }

  for (const item of items) {
    if (!item.name || typeof item.name !== 'string') {
      return fail(res, 'VALIDATION_ERROR', 'Each item must have a name string', 400)
    }
    if (item.qty === undefined || item.qty === null || Number(item.qty) <= 0) {
      return fail(res, 'VALIDATION_ERROR', 'Each item must have a quantity > 0', 400)
    }
  }

  // Calculate total_cost if all items have price_per_unit
  let total_cost = 0
  let anyPriceMissing = false

  for (const item of items) {
    if (item.price_per_unit === undefined || item.price_per_unit === null) {
      anyPriceMissing = true
    } else {
      total_cost += Number(item.qty) * Number(item.price_per_unit)
    }
  }

  if (anyPriceMissing) {
    total_cost = null
  } else {
    total_cost = Math.round(total_cost * 100) / 100
  }

  const finalDeliveryDate = delivery_date || tomorrowIST()

  // Verify / Auto-create vendor contact if doesn't exist
  const { data: existingVendor, error: vendorSearchErr } = await supabase
    .from('vendor_contacts')
    .select('name')
    .eq('name', vendor_name)
    .maybeSingle()

  if (vendorSearchErr) throw vendorSearchErr

  if (!existingVendor) {
    const { error: insertVendorErr } = await supabase
      .from('vendor_contacts')
      .insert({
        name: vendor_name,
        whatsapp_number: '',
        notes: 'Created via order command — add number in Owner Portal',
        active: true
      })
    if (insertVendorErr) throw insertVendorErr
  }

  // Insert procurement record
  const { data: procurement, error: procErr } = await supabase
    .from('procurement')
    .insert({
      vendor_name,
      items_json: items,
      total_cost,
      delivery_date: finalDeliveryDate,
      status: 'pending_delivery'
    })
    .select()
    .single()

  if (procErr) throw procErr

  // Generate forward-ready message
  const itemsText = items.map(item => `${item.name} ${item.qty}${item.unit || ''}`).join(', ')
  const forward_message = `${itemsText} — please deliver tomorrow morning.`

  return ok(res, {
    procurement,
    forward_message
  }, 201)
})

// 7.2 Get Procurement Orders
// GET /api/vendor/orders
router.get('/orders', ownerAuthMiddleware, async (req, res) => {
  const { status, vendor_name, from, to } = req.query

  let query = supabase.from('procurement').select('*').order('timestamp', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }
  if (vendor_name) {
    query = query.eq('vendor_name', vendor_name)
  }
  if (from) {
    query = query.gte('delivery_date', from)
  }
  if (to) {
    query = query.lte('delivery_date', to)
  }

  const { data: orders, error } = await query
  if (error) throw error

  return ok(res, { orders: orders || [] })
})

// 7.3 Update Procurement Status
// PATCH /api/vendor/orders/:id/status
router.patch('/orders/:id/status', ownerAuthMiddleware, async (req, res) => {
  const { status } = req.body
  const { id } = req.params

  if (status !== 'delivered' && status !== 'cancelled') {
    return fail(res, 'VALIDATION_ERROR', 'status must be "delivered" or "cancelled"', 400)
  }

  const { data: existing, error: getErr } = await supabase
    .from('procurement')
    .select('status')
    .eq('id', id)
    .maybeSingle()

  if (getErr) throw getErr
  if (!existing) {
    return fail(res, 'NOT_FOUND', 'Procurement order not found', 404)
  }

  if (existing.status === 'delivered' || existing.status === 'cancelled') {
    return fail(res, 'ALREADY_COMPLETED', `Procurement order is already ${existing.status}`, 409)
  }

  const { data: updated, error: updateErr } = await supabase
    .from('procurement')
    .update({ status })
    .eq('id', id)
    .select('id, status')
    .single()

  if (updateErr) throw updateErr

  return ok(res, updated)
})

// 7.4 Get Vendor Contacts
// GET /api/vendor/contacts
router.get('/contacts', ownerAuthMiddleware, async (req, res) => {
  const { data: vendors, error } = await supabase
    .from('vendor_contacts')
    .select('*')
    .order('name', { ascending: true })

  if (error) throw error
  return ok(res, { vendors: vendors || [] })
})

// 7.5 Create Vendor Contact
// POST /api/vendor/contacts
router.post('/contacts', ownerAuthMiddleware, async (req, res) => {
  const { name, whatsapp_number, notes } = req.body

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return fail(res, 'VALIDATION_ERROR', 'name is required and must be a string', 400)
  }
  if (!whatsapp_number || typeof whatsapp_number !== 'string') {
    return fail(res, 'VALIDATION_ERROR', 'whatsapp_number is required and must be a string', 400)
  }

  // Check for duplicate name
  const { data: existing, error: checkErr } = await supabase
    .from('vendor_contacts')
    .select('name')
    .eq('name', name)
    .maybeSingle()

  if (checkErr) throw checkErr
  if (existing) {
    return fail(res, 'DUPLICATE_VENDOR_NAME', 'Vendor with this name already exists', 409)
  }

  const { data: vendor, error: insertErr } = await supabase
    .from('vendor_contacts')
    .insert({
      name,
      whatsapp_number,
      notes: notes || '',
      active: true
    })
    .select()
    .single()

  if (insertErr) throw insertErr

  return ok(res, { vendor }, 201)
})

// 7.5 Update Vendor Contact
// PUT /api/vendor/contacts/:id
router.put('/contacts/:id', ownerAuthMiddleware, async (req, res) => {
  const { name, whatsapp_number, notes, active } = req.body
  const { id } = req.params

  const { data: existing, error: getErr } = await supabase
    .from('vendor_contacts')
    .select('id, name')
    .eq('id', id)
    .maybeSingle()

  if (getErr) throw getErr
  if (!existing) {
    return fail(res, 'NOT_FOUND', 'Vendor contact not found', 404)
  }

  // Check duplicate name if changing
  if (name && name !== existing.name) {
    const { data: nameDuplicate, error: checkErr } = await supabase
      .from('vendor_contacts')
      .select('id')
      .eq('name', name)
      .maybeSingle()

    if (checkErr) throw checkErr
    if (nameDuplicate) {
      return fail(res, 'DUPLICATE_VENDOR_NAME', 'Another vendor has this name', 409)
    }
  }

  const updates = {}
  if (name !== undefined) updates.name = name
  if (whatsapp_number !== undefined) updates.whatsapp_number = whatsapp_number
  if (notes !== undefined) updates.notes = notes
  if (active !== undefined) updates.active = active

  const { data: vendor, error: updateErr } = await supabase
    .from('vendor_contacts')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (updateErr) throw updateErr

  return ok(res, { vendor })
})

module.exports = router
