const logger = require('../utils/logger')

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500
  
  logger.error({ err, status }, err.message || 'Internal Server Error')

  const isProduction = process.env.NODE_ENV === 'production'
  res.status(status).json({
    error: isProduction && status >= 500 ? 'Internal Server Error' : (err.message || 'Internal Server Error')
  })
}

module.exports = errorHandler
