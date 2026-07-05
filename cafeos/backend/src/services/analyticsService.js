const supabase = require('./supabaseClient')
const logger = require('../utils/logger')

// Function to track usage for a source on a given day
// dateStr should be YYYY-MM-DD
async function trackUsage(source, userIdentifier, dateStr) {
  if (!source || !userIdentifier || !dateStr) return

  try {
    const { error } = await supabase.from('app_usage_logs').insert({
      source,
      user_identifier: userIdentifier,
      date_used: dateStr
    })

    if (error && error.code !== '23505') {
      // 23505 is unique violation, which means already logged for today, so we ignore it
      logger.error({ err: error }, '[AnalyticsService] Failed to insert usage log')
    }
  } catch (err) {
    logger.error({ err }, '[AnalyticsService] Exception inserting usage log')
  }
}

module.exports = {
  trackUsage
}
