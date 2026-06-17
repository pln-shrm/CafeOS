const { Router } = require('express')
const { validate: uuidValidate } = require('uuid')
const { formatInTimeZone, toZonedTime } = require('date-fns-tz')
const { format } = require('date-fns')
const supabase = require('../services/supabaseClient')
const { staffAuthMiddleware, anyAuthMiddleware, ownerAuthMiddleware } = require('../middleware/auth')
const { ok, fail } = require('../utils/response')

const router = Router()
const IST = 'Asia/Kolkata'

const VALID_ORDER_TYPES = ['dine_in', 'takeaway']
const VALID_PAYMENT_METHODS = ['cash', 'upi', 'pending']

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
  return data && data.bill_number ? data.bill_number + 1 : 1
}

async function createOrderFromBody(body, staffId) {
  const { local_uuid, order_type, payment_method, items, table_number, customer_name, contact_info } = body

  if (!local_uuid || !uuidValidate(local_uuid)) return { validationError: 'local_uuid must be a valid UUID' }
  if (!VALID_ORDER_TYPES.includes(order_type)) return { validationError: `order_type must be one of: ${VALID_ORDER_TYPES.join(', ')}` }
  if (!VALID_PAYMENT_METHODS.includes(payment_method)) return { validationError: `payment_method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}` }
  
  if (!customer_name || !String(customer_name).trim()) return { validationError: 'Customer name is required' }
  if (order_type === 'dine_in' && (!table_number || !String(table_number).trim())) {
    return { validationError: 'Table number is required for dine-in orders' }
  }

  if (!Array.isArray(items) || items.length === 0) return { validationError: 'items must be a non-empty array' }
  for (const item of items) {
    if (!item.menu_item_id || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) {
      return { validationError: 'Each item must have menu_item_id and quantity > 0' }
    }
  }

  if (order_type === 'dine_in') {
    const { data: activeTable } = await supabase
      .from('orders')
      .select('id, local_uuid')
      .eq('table_number', String(table_number).trim())
      .eq('status', 'ongoing')
      .maybeSingle()
    
    if (activeTable && activeTable.local_uuid !== local_uuid) {
      return { validationError: `Table ${String(table_number).trim()} already has an ongoing order.` }
    }
  }

  const { data: existing } = await supabase
    .from('orders')
    .select('id, bill_number, bill_date, total, status, table_number, customer_name, order_items(id, menu_item_id, quantity, unit_price)')
    .eq('local_uuid', local_uuid)
    .maybeSingle()

  if (existing) return { order: existing, alreadyExisted: true }

  const menuIds = items.map(i => i.menu_item_id)
  const { data: menuItems, error: menuErr } = await supabase
    .from('menu_items')
    .select('id, name, price')
    .in('id', menuIds)
    .eq('active', true)

  if (menuErr) throw menuErr

  const menuMap = Object.fromEntries(menuItems.map(m => [m.id, m]))
  for (const item of items) {
    if (!menuMap[item.menu_item_id]) return { unavailableItem: item.menu_item_id }
  }

  const billDate = todayIST()
  const total = items.reduce((sum, item) => sum + menuMap[item.menu_item_id].price * Number(item.quantity), 0)

  let order, orderErr
  for (let attempt = 0; attempt < 3; attempt++) {
    const billNumber = await getNextBillNumber(billDate)
    ;({ data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        local_uuid,
        order_type,
        payment_method,
        total,
        bill_number: billNumber,
        bill_date: billDate,
        staff_id: staffId,
        table_number: order_type === 'dine_in' ? String(table_number).trim() : null,
        customer_name: String(customer_name).trim(),
        contact_info: contact_info ? String(contact_info).trim() : null,
        status: 'ongoing'
      })
      .select()
      .single())
    if (!orderErr || orderErr.code !== '23505') break
  }

  if (orderErr) {
    if (orderErr.code === '23505') {
      const { data: retry } = await supabase
        .from('orders')
        .select('id, bill_number, bill_date, total, status, table_number, customer_name, order_items(id, menu_item_id, quantity, unit_price)')
        .eq('local_uuid', local_uuid)
        .single()
      return { order: retry, alreadyExisted: true }
    }
    throw orderErr
  }

  const orderItemRows = items.map(item => ({
    order_id: order.id,
    menu_item_id: item.menu_item_id,
    quantity: Number(item.quantity),
    unit_price: menuMap[item.menu_item_id].price
  }))

  const { data: orderItems, error: itemsErr } = await supabase
    .from('order_items')
    .insert(orderItemRows)
    .select()

  if (itemsErr) throw itemsErr

  return { order: { ...order, order_items: orderItems }, alreadyExisted: false }
}

router.post('/', staffAuthMiddleware, async (req, res) => {
  const result = await createOrderFromBody(req.body, req.staffId)
  if (result.validationError) return fail(res, 'VALIDATION_ERROR', result.validationError, 400)
  if (result.unavailableItem) return fail(res, 'ITEM_UNAVAILABLE', `Menu item ${result.unavailableItem} is not available`, 422)

  return ok(res, result.order, result.alreadyExisted ? 200 : 201)
})

router.get('/ongoing', staffAuthMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, local_uuid, bill_number, bill_date, total, order_type, table_number, customer_name, status, timestamp, order_items(menu_item_id, quantity, unit_price, menu_items(name))')
    .eq('status', 'ongoing')
    .order('timestamp', { ascending: true })

  if (error) throw error
  return ok(res, { orders: data || [] })
})

router.patch('/:id/items', staffAuthMiddleware, async (req, res) => {
  const { id } = req.params
  const { items } = req.body

  if (!Array.isArray(items) || items.length === 0) return fail(res, 'VALIDATION_ERROR', 'items must be a non-empty array', 400)

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .maybeSingle()

  if (orderErr) throw orderErr
  if (!order) return fail(res, 'NOT_FOUND', 'Order not found', 404)
  if (order.status !== 'ongoing') return fail(res, 'INVALID_STATE', 'Cannot modify a completed order', 400)

  const menuIds = items.map(i => i.menu_item_id)
  const { data: menuItems, error: menuErr } = await supabase
    .from('menu_items')
    .select('id, name, price')
    .in('id', menuIds)
    .eq('active', true)

  if (menuErr) throw menuErr
  const menuMap = Object.fromEntries(menuItems.map(m => [m.id, m]))
  
  let newTotal = 0
  const orderItemRows = []
  for (const item of items) {
    if (!menuMap[item.menu_item_id]) return fail(res, 'ITEM_UNAVAILABLE', `Item ${item.menu_item_id} unavailable`, 422)
    const qty = Number(item.quantity)
    if (!Number.isInteger(qty) || qty <= 0) return fail(res, 'VALIDATION_ERROR', 'Invalid quantity', 400)
    
    newTotal += menuMap[item.menu_item_id].price * qty
    orderItemRows.push({
      order_id: id,
      menu_item_id: item.menu_item_id,
      quantity: qty,
      unit_price: menuMap[item.menu_item_id].price
    })
  }

  const { error: delErr } = await supabase.from('order_items').delete().eq('order_id', id)
  if (delErr) throw delErr

  const { error: insErr } = await supabase.from('order_items').insert(orderItemRows)
  if (insErr) throw insErr

  const { data: updatedOrder, error: upErr } = await supabase
    .from('orders')
    .update({ total: newTotal })
    .eq('id', id)
    .select()
    .single()

  if (upErr) throw upErr
  return ok(res, updatedOrder)
})

router.patch('/:id/close', staffAuthMiddleware, async (req, res) => {
  const { id } = req.params
  const { payment_method } = req.body

  if (!VALID_PAYMENT_METHODS.includes(payment_method) || payment_method === 'pending') {
    return fail(res, 'VALIDATION_ERROR', `Valid payment method required`, 400)
  }

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, status')
    .eq('id', id)
    .maybeSingle()

  if (orderErr) throw orderErr
  if (!order) return fail(res, 'NOT_FOUND', 'Order not found', 404)
  if (order.status !== 'ongoing') return fail(res, 'INVALID_STATE', 'Order is already completed', 400)

  const { data: updatedOrder, error: updateErr } = await supabase
    .from('orders')
    .update({ status: 'completed', payment_method })
    .eq('id', id)
    .select()
    .single()

  if (updateErr) throw updateErr
  return ok(res, updatedOrder)
})

router.patch('/:id/payment', anyAuthMiddleware, async (req, res) => {
  const { payment_method } = req.body
  const { id } = req.params

  if (!VALID_PAYMENT_METHODS.includes(payment_method)) {
    return fail(res, 'VALIDATION_ERROR', `payment_method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}`, 400)
  }

  const { data: order, error: updateErr } = await supabase
    .from('orders')
    .update({ payment_method })
    .eq('id', id)
    .select('id, bill_number, bill_date, total, payment_method')
    .single()

  if (updateErr) throw updateErr
  return ok(res, { order })
})

router.get('/', ownerAuthMiddleware, async (req, res) => {
  const { from, to } = req.query
  const limit = Math.min(Number(req.query.limit) || 200, 500)

  let query = supabase
    .from('orders')
    .select('id, bill_date, total, payment_method, order_type, table_number, customer_name, status, timestamp, order_items(menu_item_id, quantity, unit_price, menu_items(name))')
    .order('bill_date', { ascending: false })
    .order('timestamp', { ascending: false })
    .limit(limit)

  if (from) query = query.gte('bill_date', from)
  if (to) query = query.lte('bill_date', to)

  const { data, error } = await query
  if (error) throw error

  return ok(res, { orders: data || [] })
})

router.get('/staff-history', staffAuthMiddleware, async (req, res) => {
  const limit = 50
  const { data, error } = await supabase
    .from('orders')
    .select('id, local_uuid, bill_number, bill_date, total, order_type, table_number, customer_name, status, timestamp, order_items(menu_item_id, quantity, unit_price, menu_items(name))')
    .eq('status', 'completed')
    .eq('staff_id', req.staffId)
    .order('timestamp', { ascending: false })
    .limit(limit)

  if (error) throw error
  return ok(res, { orders: data || [] })
})

router.get('/:id', anyAuthMiddleware, async (req, res) => {
  const { data: order, error } = await supabase
    .from('orders')
    .select(`
      id, bill_number, bill_date, order_type, payment_method, total, timestamp, status, table_number, customer_name, contact_info,
      order_items(id, menu_item_id, quantity, unit_price, menu_items(name)),
      staff:staff_id(name)
    `)
    .eq('id', req.params.id)
    .maybeSingle()

  if (error) throw error
  if (!order) return fail(res, 'NOT_FOUND', 'Order not found', 404)

  return ok(res, {
    ...order,
    staff_name: order.staff?.name || null,
    items: order.order_items.map(oi => ({
      ...oi,
      name: oi.menu_items?.name || null,
      subtotal: oi.quantity * oi.unit_price
    }))
  })
})

router.get('/:id/bill', anyAuthMiddleware, async (req, res) => {
  const { data: order, error } = await supabase
    .from('orders')
    .select(`
      id, bill_number, bill_date, order_type, payment_method, total, timestamp, status, customer_name, table_number,
      order_items(quantity, unit_price, menu_items(name))
    `)
    .eq('id', req.params.id)
    .maybeSingle()

  if (error) throw error
  if (!order) return fail(res, 'NOT_FOUND', 'Order not found', 404)

  const createdIST = toZonedTime(new Date(order.timestamp), IST)

  return ok(res, {
    cafe_name: "CafeOS",
    cafe_address: 'Vasco da Gama, Goa',
    bill_number: order.bill_number,
    date: format(createdIST, 'dd MMM yyyy'),
    time: format(createdIST, 'hh:mm a'),
    order_type: order.order_type,
    table_number: order.table_number,
    customer_name: order.customer_name,
    payment_method: order.payment_method,
    items: order.order_items.map(oi => ({
      name: oi.menu_items?.name || 'Unknown',
      quantity: oi.quantity,
      unit_price: oi.unit_price,
      subtotal: oi.quantity * oi.unit_price
    })),
    total: order.total,
    footer: "Thank you for visiting CafeOS!"
  })
})

router.post('/sync', staffAuthMiddleware, async (req, res) => {
  const { orders } = req.body
  if (!Array.isArray(orders)) return fail(res, 'VALIDATION_ERROR', 'orders must be an array', 400)

  let synced = 0
  let skipped = 0
  const errors = []

  for (const orderBody of orders) {
    try {
      const result = await createOrderFromBody(orderBody, req.staffId)
      if (result.validationError) errors.push({ local_uuid: orderBody.local_uuid, error: result.validationError })
      else if (result.unavailableItem) errors.push({ local_uuid: orderBody.local_uuid, error: `Item ${result.unavailableItem} unavailable` })
      else if (result.alreadyExisted) skipped++
      else synced++
    } catch (err) {
      errors.push({ local_uuid: orderBody.local_uuid, error: err.message })
    }
  }

  return ok(res, { synced, skipped, errors })
})

module.exports = router
