const { Router } = require('express')
const { formatInTimeZone, toZonedTime } = require('date-fns-tz')
const { format } = require('date-fns')
const supabase = require('../services/supabaseClient')
const { staffAuthMiddleware, ownerAuthMiddleware, anyAuthMiddleware } = require('../middleware/auth')
const { ok, fail } = require('../utils/response')

const router = Router()
const IST = 'Asia/Kolkata'

// POST /api/attendance/checkin
router.post('/checkin', staffAuthMiddleware, async (req, res) => {
  const { note } = req.body
  const todayIST = formatInTimeZone(new Date(), IST, 'yyyy-MM-dd')

  // Check for duplicate check-in today
  const { data: existing, error: fetchErr } = await supabase
    .from('attendance')
    .select('id')
    .eq('staff_id', req.staffId)
    .eq('date', todayIST)
    .maybeSingle()

  if (fetchErr) throw fetchErr
  if (existing) {
    return fail(res, 'ALREADY_CHECKED_IN', 'Already checked in today', 409)
  }

  const now = new Date()
  const nowIST = toZonedTime(now, IST)
  // Late if after 10:00 AM IST
  const isLate = nowIST.getHours() > 10 || (nowIST.getHours() === 10 && nowIST.getMinutes() > 0)

  const { data, error } = await supabase
    .from('attendance')
    .insert({
      staff_id: req.staffId,
      date: todayIST,
      check_in_time: now.toISOString(),
      late: isLate,
      late_reason: note || null
    })
    .select()
    .single()

  if (error) throw error

  return ok(res, {
    ...data,
    check_in_time_ist: format(nowIST, 'hh:mm a')
  }, 201)
})

// PATCH /api/attendance/:id — update note after late check-in
router.patch('/:id', staffAuthMiddleware, async (req, res) => {
  const { note } = req.body
  const { id } = req.params

  const { data, error } = await supabase
    .from('attendance')
    .update({ late_reason: note || null })
    .eq('id', id)
    .eq('staff_id', req.staffId)
    .select()
    .single()

  if (error) throw error
  if (!data) return fail(res, 'NOT_FOUND', 'Attendance record not found', 404)

  return ok(res, data)
})

// GET /api/attendance
router.get('/', anyAuthMiddleware, async (req, res) => {
  const { staff_id, from, to, late_only } = req.query

  let query = supabase
    .from('attendance')
    .select('*, staff:staff_id(id, name)')
    .order('date', { ascending: false })
    .order('check_in_time', { ascending: false })

  if (req.role === 'staff') {
    query = query.eq('staff_id', req.staffId)
  } else if (staff_id) {
    query = query.eq('staff_id', staff_id)
  }

  if (from) query = query.gte('date', from)
  if (to) query = query.lte('date', to)
  if (late_only === 'true') query = query.eq('late', true)

  const { data, error } = await query
  if (error) throw error

  return ok(res, { records: data })
})

module.exports = router
