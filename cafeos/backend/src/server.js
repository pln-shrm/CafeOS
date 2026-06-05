require('dotenv').config()
require('express-async-errors')

const express = require('express')
const cors = require('cors')

const requestLogger = require('./middleware/requestLogger')
const errorHandler = require('./middleware/errorHandler')

const menuRouter = require('./routes/menu')
const ordersRouter = require('./routes/orders')
const staffRouter = require('./routes/staff')
const vendorRouter = require('./routes/vendor')
const billingRouter = require('./routes/billing')
const predictionsRouter = require('./routes/predictions')
const webhookRouter = require('./bot/webhook')

const app = express()

app.use(cors())
app.use(express.json())
app.use(requestLogger)

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV
  })
})

app.use('/api/menu', menuRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/staff', staffRouter)
app.use('/api/vendor', vendorRouter)
app.use('/api/billing', billingRouter)
app.use('/api/predictions', predictionsRouter)
app.use('/webhook/whatsapp', webhookRouter)

app.use(errorHandler)

// Start cron jobs
require('./jobs/cron')

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`[CafeOS] Backend running on port ${PORT} (${process.env.NODE_ENV || 'development'})`)
})
