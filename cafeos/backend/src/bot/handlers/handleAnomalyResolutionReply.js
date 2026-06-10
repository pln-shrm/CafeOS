const supabase = require('../../services/supabaseClient')
const { resumePostWastageFlow } = require('./handleWastageReply')

async function handleAnomalyResolutionReply(phoneNumber, message, context) {
  const anomalies = context?.anomalies || []
  const date = context?.date

  if (date && anomalies.length > 0) {
    try {
      await supabase.from('anomaly_logs').insert(
        anomalies.map(a => ({
          date,
          menu_item_id: a.item_id,
          item_name: a.name,
          implied_consumption: a.wastage,
          sold_qty: a.sold,
          resolution_reason: message.trim()
        }))
      )
    } catch (err) {
      console.warn('[AnomalyResolution] anomaly_logs insert failed (table may not exist yet):', err.message)
    }
  }

  await resumePostWastageFlow(phoneNumber)
}

module.exports = handleAnomalyResolutionReply
