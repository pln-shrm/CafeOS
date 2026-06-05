// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500
  console.error('[Error]', err.message, err.stack)
  res.status(status).json({
    error: err.message || 'Internal Server Error'
  })
}

module.exports = errorHandler
