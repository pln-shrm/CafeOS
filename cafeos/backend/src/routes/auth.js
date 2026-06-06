const { Router } = require('express')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const supabase = require('../services/supabaseClient')
const { ok, fail } = require('../utils/response')

const router = Router()

// POST /api/auth/staff/login
// Body: { pin } or { staff_id, pin } — providing staff_id avoids scanning all staff
router.post('/staff/login', async (req, res) => {
  const { pin, staff_id } = req.body

  if (!pin || !/^\d{4}$/.test(String(pin))) {
    return fail(res, 'INVALID_PIN_FORMAT', 'PIN must be exactly 4 numeric digits', 400)
  }

  let matched = null

  if (staff_id) {
    // Fast path: verify a single staff member directly
    const { data: member, error } = await supabase
      .from('staff')
      .select('id, name, role, pin_hash')
      .eq('id', staff_id)
      .eq('active', true)
      .maybeSingle()
    if (error) throw error
    if (member && member.pin_hash && await bcrypt.compare(String(pin), member.pin_hash)) {
      matched = member
    }
  } else {
    // Slow path: scan all active staff (sequential — bcrypt is CPU-bound)
    const { data: staffList, error } = await supabase
      .from('staff')
      .select('id, name, role, pin_hash')
      .eq('active', true)
    if (error) throw error
    for (const member of staffList) {
      if (member.pin_hash && await bcrypt.compare(String(pin), member.pin_hash)) {
        matched = member
        break
      }
    }
  }

  if (!matched) return fail(res, 'INVALID_PIN', 'Incorrect PIN', 401)

  const token = jwt.sign(
    { staff_id: matched.id, role: 'staff', name: matched.name },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  )

  return ok(res, {
    token,
    staff: { id: matched.id, name: matched.name, role: matched.role }
  })
})

module.exports = router
