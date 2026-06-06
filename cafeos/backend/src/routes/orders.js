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
  return data ? data.bill_number + 1 : 1
}

async function createOrderFromBody(body, staffId) {
  const { local_uuid, order_type, payment_method, items } = body

  // Validate local_uuid
  if (!local_uuid || !uuidValidate(local_uuid)) {
    return { validationError: 'local_uuid must be a valid UUID' }
  }
  if (!VALID_ORDER_TYPES.includes(order_type)) {
    return { validationError: `order_type must be one of: ${VALID_ORDER_TYPES.join(', ')}` }
  }
  if (!VALID_PAYMENT_METHODS.includes(payment_method)) {
    return { validationError: `payment_method must be one of: ${VALID_PAYMENT_METHODS.join(', ')}` }
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { validationError: 'items must be a non-empty array' }
  }
  for (const item of items) {
    if (!item.menu_item_id || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) {
      return { validationError: 'Each item must have menu_item_id and quantity > 0' }
    }
  }

  // Idempotency: return existing order if local_uuid already processed
  const { data: existing } = await supabase
    .from('orders')
    .select('id, bill_number, bill_date, total, order_items(id, menu_item_id, quantity, unit_price)')
    .eq('local_uuid', local_uuid)
    .maybeSingle()

  if (existing) return { order: existing, alreadyExisted: true }

  // Fetch current prices for all items
  const menuIds = items.map(i => i.menu_item_id)
  const { data: menuItems, error: menuErr } = await supabase
    .from('menu_items')
    .select('id, name, price')
    .in('id', menuIds)
    .eq('active', true)

  if (menuErr) throw menuErr

  const menuMap = Object.fromEntries(menuItems.map(m => [m.id, m]))
  for (const item of items) {
    if (!menuMap[item.menu_item_id]) {
      return { unavailableItem: item.menu_item_id }
    }
  }

  const billDate = todayIST()
  const billNumber = await getNextBillNumber(billDate)

  const total = items.reduce((sum, item) => {
    return sum + menuMap[item.menu_item_id].price * Number(item.quantity)
  }, 0)

  // Insert order
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      local_uuid,
      order_type,
      payment_method,
      total,
      bill_number: billNumber,
      bill_date: billDate,
      staff_id: staffId
    })
    .select()
    .single()

  if (orderErr) {
    // Unique constraint on local_uuid: someone beat us to it — fetch and return existing
    if (orderErr.code === '23505') {
      const { data: retry } = await supabase
        .from('orders')
        .select('id, bill_number, bill_date, total, order_items(id, menu_item_id, quantity, unit_price)')
        .eq('local_uuid', local_uuid)
        .single()
      return { order: retry, alreadyExisted: true }
    }
    throw orderErr
  }

  // Insert order_items
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

// POST /api/orders
router.post('/', staffAuthMiddleware, async (req, res) => {
  const result = await createOrderFromBody(req.body, req.staffId)

  if (result.validationError) return fail(res, 'VALIDATION_ERROR', result.validationError, 400)
  if (result.unavailableItem) {
    return fail(res, 'ITEM_UNAVAILABLE', `Menu item ${result.unavailableItem} is not available`, 422)
  }

  const { order } = result
  return ok(res, {
    order_id: order.id,
    bill_number: order.bill_number,
    bill_date: order.bill_date,
    total: order.total,
    items: order.order_items
  }, result.alreadyExisted ? 200 : 201)
})

// GET /api/orders?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=200
router.get('/', ownerAuthMiddleware, async (req, res) => {
  const { from, to } = req.query
  const limit = Math.min(Number(req.query.limit) || 200, 500)

  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return fail(res, 'VALIDATION_ERROR', 'from must be YYYY-MM-DD', 400)
  }
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return fail(res, 'VALIDATION_ERROR', 'to must be YYYY-MM-DD', 400)
  }

  let query = supabase
    .from('orders')
    .select('id, bill_date, total, payment_method, order_type, created_at, order_items(menu_item_id, quantity, unit_price, menu_items(name))')
    .order('bill_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (from) query = query.gte('bill_date', from)
  if (to) query = query.lte('bill_date', to)

  const { data, error } = await query
  if (error) throw error

  return ok(res, { orders: data || [] })
})

// GET /api/orders/:id
router.get('/:id', anyAuthMiddleware, async (req, res) => {
  const { data: order, error } = await supabase
    .from('orders')
    .select(`
      id, bill_number, bill_date, order_type, payment_method, total, created_at,
      order_items(id, menu_item_id, quantity, unit_price, menu_items(name)),
      staff:staff_id(name)
    `)
    .eq('id', req.params.id)
    .maybeSingle()

  if (error) throw error
  if (!order) return fail(res, 'NOT_FOUND', 'Order not found', 404)

  return ok(res, {
    id: order.id,
    bill_number: order.bill_number,
    bill_date: order.bill_date,
    order_type: order.order_type,
    payment_method: order.payment_method,
    total: order.total,
    timestamp: order.created_at,
    staff_name: order.staff?.name || null,
    items: order.order_items.map(oi => ({
      id: oi.id,
      menu_item_id: oi.menu_item_id,
      name: oi.menu_items?.name || null,
      quantity: oi.quantity,
      unit_price: oi.unit_price,
      subtotal: oi.quantity * oi.unit_price
    }))
  })
})

// GET /api/orders/:id/bill
router.get('/:id/bill', anyAuthMiddleware, async (req, res) => {
  const { data: order, error } = await supabase
    .from('orders')
    .select(`
      id, bill_number, bill_date, order_type, payment_method, total, created_at,
      order_items(quantity, unit_price, menu_items(name))
    `)
    .eq('id', req.params.id)
    .maybeSingle()

  if (error) throw error
  if (!order) return fail(res, 'NOT_FOUND', 'Order not found', 404)

  const createdIST = toZonedTime(new Date(order.created_at), IST)

  return ok(res, {
    cafe_name: "Sam's Cafe",
    cafe_address: 'Vasco da Gama, Goa',
    bill_number: order.bill_number,
    date: format(createdIST, 'dd MMM yyyy'),
    time: format(createdIST, 'hh:mm a'),
    order_type: order.order_type,
    payment_method: order.payment_method,
    items: order.order_items.map(oi => ({
      name: oi.menu_items?.name || 'Unknown',
      quantity: oi.quantity,
      unit_price: oi.unit_price,
      subtotal: oi.quantity * oi.unit_price
    })),
    total: order.total,
    footer: "Thank you for visiting Sam's Cafe!"
  })
})

// POST /api/orders/sync
router.post('/sync', staffAuthMiddleware, async (req, res) => {
  const { orders } = req.body

  if (!Array.isArray(orders)) {
    return fail(res, 'VALIDATION_ERROR', 'orders must be an array', 400)
  }

  let synced = 0
  let skipped = 0
  const errors = []

  for (const orderBody of orders) {
    try {
      const result = await createOrderFromBody(orderBody, req.staffId)

      if (result.validationError) {
        errors.push({ local_uuid: orderBody.local_uuid, error: result.validationError })
      } else if (result.unavailableItem) {
        errors.push({ local_uuid: orderBody.local_uuid, error: `Item ${result.unavailableItem} unavailable` })
      } else if (result.alreadyExisted) {
        skipped++
      } else {
        synced++
      }
    } catch (err) {
      errors.push({ local_uuid: orderBody.local_uuid, error: err.message })
    }
  }

  return ok(res, { synced, skipped, errors })
})

module.exports = router
