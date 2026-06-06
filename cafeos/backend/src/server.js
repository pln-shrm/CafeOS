require('dotenv').config()
require('express-async-errors')

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
const webhookRouter = require('./bot/webhook')
const { runMorningPrepJob } = require('./jobs/cron')

const app = express()

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(requestLogger)

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV
  })
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
app.use('/webhook/whatsapp', webhookRouter)

if (process.env.NODE_ENV !== 'production') {
  app.get('/dev/trigger-prep-job', async (req, res) => {
    try {
      await runMorningPrepJob()
      res.json({ success: true })
    } catch (err) {
      console.error('[DEV] Prep job trigger failed', err)
      res.status(500).json({ success: false })
    }
  })
}

app.use(errorHandler)

// Start cron jobs
require('./jobs/cron')

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`[CafeOS] Backend running on port ${PORT} (${process.env.NODE_ENV || 'development'})`)
})
