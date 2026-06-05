const morgan = require('morgan')

const format = process.env.NODE_ENV === 'production' ? 'combined' : 'dev'

module.exports = morgan(format)
