const { Router } = require('express')
const { ownerAuthMiddleware } = require('../middleware/auth')
const { ok } = require('../utils/response')

const router = Router()

// POST /api/sheets/sync
router.post('/sync', ownerAuthMiddleware, async (req, res) => {
  return ok(res, { success: true, message: 'Sync triggered' })
})

module.exports = router
