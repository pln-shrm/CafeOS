require('dotenv').config()
require('express-async-errors')

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET env var is not set — refusing to start')
if (!process.env.META_APP_SECRET) console.warn('[BistroBot21] META_APP_SECRET not set — webhook signature validation will be skipped')

const express = require('express')
const cors = require('cors')

const requestLogger = require('./middleware/requestLogger')
const errorHandler = require('./middleware/errorHandler')

const authRouter = require('./routes/auth')
const menuRouter = require('./routes/menu')
const ordersRouter = require('./routes/orders')
const staffRouter = require('./routes/staff')
const vendorRouter = require('./routes/vendor')
const billingRouter = require('./routes/billing')
const predictionsRouter = require('./routes/predictions')
const attendanceRouter = require('./routes/attendance')
const sheetsRouter = require('./routes/sheets')
const creditRouter = require('./routes/credit')
const ingredientsRouter = require('./routes/ingredients')
const webhookRouter = require('./bot/webhook')
const { runMorningPrepJob } = require('./jobs/cron')

const app = express()
app.set('trust proxy', 1) // trust first proxy (Render, Railway, Heroku) for correct req.ip

const envOrigin = process.env.FRONTEND_ORIGIN || process.env.ALLOWED_FRONTEND_URL
const allowedOrigins = envOrigin
  ? envOrigin.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:3000']
app.use(cors({ origin: allowedOrigins, credentials: true }))

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf }
}))
app.use(express.urlencoded({ extended: false }))
app.use(requestLogger)

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRouter)
app.use('/api/menu', menuRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/staff', staffRouter)
app.use('/api/vendor', vendorRouter)
app.use('/api/billing', billingRouter)
app.use('/api/predictions', predictionsRouter)
app.use('/api/attendance', attendanceRouter)
app.use('/api/sheets', sheetsRouter)
app.use('/api/credit', creditRouter)
app.use('/api/ingredients', ingredientsRouter)
app.use('/webhook/whatsapp', webhookRouter)

const logger = require('./utils/logger')

if (process.env.NODE_ENV !== 'production') {
  app.get('/dev/trigger-prep-job', async (req, res) => {
    try {
      await runMorningPrepJob()
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, '[DEV] Prep job trigger failed')
      res.status(500).json({ success: false })
    }
  })
}

app.use(errorHandler)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  logger.info(`[BistroBot21] Backend running on port ${PORT} (${process.env.NODE_ENV || 'development'})`)
})
