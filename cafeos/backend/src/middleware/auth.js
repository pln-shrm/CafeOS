const jwt = require('jsonwebtoken')
const supabase = require('../services/supabaseClient')
const { fail } = require('../utils/response')

function extractBearer(req) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return null
  return auth.slice(7)
}

function staffAuthMiddleware(req, res, next) {
  const token = extractBearer(req)
  if (!token) return fail(res, 'NO_TOKEN', 'Authorization token required', 401)

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    if (payload.role !== 'staff') return fail(res, 'FORBIDDEN', 'Staff access required', 403)
    req.staffId = payload.staff_id
    req.role = 'staff'
    next()
  } catch {
    return fail(res, 'INVALID_TOKEN', 'Invalid or expired token', 403)
  }
}

async function ownerAuthMiddleware(req, res, next) {
  const token = extractBearer(req)
  if (!token) return fail(res, 'NO_TOKEN', 'Authorization token required', 401)

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return fail(res, 'INVALID_TOKEN', 'Invalid or expired token', 403)
  
  const envEmails = (process.env.OWNER_EMAILS || process.env.OWNER_EMAIL || '').split(',').map(e => e.trim())
  let isAuthorized = envEmails.includes(user.email)
  
  if (!isAuthorized) {
    const { data } = await supabase.from('authorized_owners').select('email').eq('email', user.email).single()
    if (data) isAuthorized = true
  }

  if (!isAuthorized) return fail(res, 'FORBIDDEN', 'Owner access required', 403)

  req.owner = user
  req.role = 'owner'
  next()
}

// Accepts either a valid staff JWT or a valid owner Supabase token.
// Sets req.role to 'staff' or 'owner' for downstream role checks.
async function anyAuthMiddleware(req, res, next) {
  const token = extractBearer(req)
  if (!token) return fail(res, 'NO_TOKEN', 'Authorization token required', 401)

  // Try staff JWT first (synchronous, cheap)
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    if (payload.role === 'staff') {
      req.staffId = payload.staff_id
      req.role = 'staff'
      return next()
    }
  } catch {
    // Not a valid staff JWT — fall through to owner check
  }

  // Try Supabase owner auth
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return fail(res, 'INVALID_TOKEN', 'Invalid or expired token', 403)
  
  const envEmails = (process.env.OWNER_EMAILS || process.env.OWNER_EMAIL || '').split(',').map(e => e.trim())
  let isAuthorized = envEmails.includes(user.email)
  
  if (!isAuthorized) {
    const { data } = await supabase.from('authorized_owners').select('email').eq('email', user.email).single()
    if (data) isAuthorized = true
  }

  if (!isAuthorized) return fail(res, 'FORBIDDEN', 'Access denied', 403)

  req.owner = user
  req.role = 'owner'
  next()
}

module.exports = { staffAuthMiddleware, ownerAuthMiddleware, anyAuthMiddleware }
