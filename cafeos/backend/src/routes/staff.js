const { Router } = require('express')
const bcrypt = require('bcrypt')
const supabase = require('../services/supabaseClient')
const { ownerAuthMiddleware } = require('../middleware/auth')
const { ok, fail } = require('../utils/response')

const router = Router()

// GET /api/staff/public — name selector for login screen, no auth
router.get('/public', async (req, res) => {
  const { data, error } = await supabase
    .from('staff')
    .select('id, name')
    .eq('active', true)
    .order('name')

  if (error) throw error

  return ok(res, { staff: data })
})

// GET /api/staff — owner list
router.get('/', ownerAuthMiddleware, async (req, res) => {
  const { data: staff, error } = await supabase
    .from('staff')
    .select('id, name, role, daily_wage, active, created_at')
    .order('active', { ascending: false })
    .order('name')

  if (error) throw error

  const { data: attendance, error: attErr } = await supabase
    .from('attendance')
    .select('staff_id, date, check_in_time')
    .order('date', { ascending: false })
    .order('check_in_time', { ascending: false })
    .limit(5000)

  if (attErr) throw attErr

  const latestByStaff = new Map()
  for (const record of attendance || []) {
    if (!latestByStaff.has(record.staff_id)) {
      latestByStaff.set(record.staff_id, record)
    }
  }

  const payload = (staff || []).map(member => {
    const latest = latestByStaff.get(member.id)
    return {
      ...member,
      last_check_in_date: latest?.date || null,
      last_check_in_time: latest?.check_in_time || null
    }
  })

  return ok(res, { staff: payload })
})

// GET /api/staff/:id — owner view
router.get('/:id', ownerAuthMiddleware, async (req, res) => {
  const { id } = req.params

  const { data, error } = await supabase
    .from('staff')
    .select('id, name, role, daily_wage, active, created_at')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return fail(res, 'NOT_FOUND', 'Staff member not found', 404)

  return ok(res, data)
})

// POST /api/staff — owner create
router.post('/', ownerAuthMiddleware, async (req, res) => {
  const { name, pin, role, daily_wage, active } = req.body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return fail(res, 'VALIDATION_ERROR', 'name is required', 400)
  }
  if (!pin || !/^\d{4}$/.test(String(pin))) {
    return fail(res, 'VALIDATION_ERROR', 'pin must be exactly 4 digits', 400)
  }

  // PIN uniqueness check removed to allow shared PINs

  const pin_hash = await bcrypt.hash(String(pin), 10)

  const { data, error } = await supabase
    .from('staff')
    .insert({
      name: name.trim(),
      pin_hash,
      role: role || null,
      daily_wage: daily_wage !== undefined && daily_wage !== null ? Number(daily_wage) : null,
      active: active !== undefined ? Boolean(active) : true
    })
    .select('id, name, role, daily_wage, active, created_at')
    .single()

  if (error) throw error

  return ok(res, data, 201)
})

// PUT /api/staff/:id — owner update
router.put('/:id', ownerAuthMiddleware, async (req, res) => {
  const { id } = req.params
  const { name, pin, role, daily_wage, active } = req.body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return fail(res, 'VALIDATION_ERROR', 'name is required', 400)
  }

  if (pin !== undefined && pin !== null && String(pin).length > 0) {
    if (!/^\d{4}$/.test(String(pin))) {
      return fail(res, 'VALIDATION_ERROR', 'pin must be exactly 4 digits', 400)
    }

    // PIN uniqueness check removed to allow shared PINs
  }

  const updates = {
    name: name.trim(),
    role: role || null,
    daily_wage: daily_wage !== undefined && daily_wage !== null && String(daily_wage).length > 0
      ? Number(daily_wage)
      : null,
    active: active !== undefined ? Boolean(active) : true
  }

  if (pin !== undefined && pin !== null && String(pin).length > 0) {
    updates.pin_hash = await bcrypt.hash(String(pin), 10)
  }

  const { data, error } = await supabase
    .from('staff')
    .update(updates)
    .eq('id', id)
    .select('id, name, role, daily_wage, active, created_at')
    .single()

  if (error) throw error
  if (!data) return fail(res, 'NOT_FOUND', 'Staff member not found', 404)

  return ok(res, data)
})

module.exports = router
