const supabase = require('../../services/supabaseClient')
const { twilioReply, setBotState } = require('./helpers')

const WELCOME_MESSAGE = [
  "Hi Sam! 👋 Welcome to CafeOS — your cafe assistant.",
  '',
  "I'll help you with:",
  '📋 Morning prep suggestions (every day at 8am)',
  '📦 Vendor orders — just tell me what you need',
  '🌙 Evening check-ins (7pm daily)',
  '🗑️ Wastage logging (10pm daily)',
  '💰 Vendor credit and payments',
  '📊 Daily and weekly summaries',
  '',
  'You can also ask me anytime:',
  '• "summary" — today\'s sales',
  '• "stock" — inventory status',
  '• "owe rice vendor" — what you owe a vendor',
  '',
  "I'll message you at 8am tomorrow with today's prep sheet.",
  "You're all set! ✓"
].join('\n')

async function handleOnboarding(phoneNumber) {
  try {
    await setBotState(phoneNumber, 'idle', null)

    const [{ count: menuCount }, { count: vendorCount }] = await Promise.all([
      supabase.from('menu_items').select('id', { count: 'exact', head: true }),
      supabase.from('vendor_contacts').select('id', { count: 'exact', head: true })
    ])

    let message = WELCOME_MESSAGE
    if ((menuCount || 0) > 0 && (vendorCount || 0) > 0) {
      message = `${message}\n\nMenu and vendor list look ready ✅`
    }

    await twilioReply(phoneNumber, message)
  } catch (err) {
    console.error('[Bot] Onboarding failed', err)
    await twilioReply(phoneNumber, 'Hi Sam! Something went wrong getting started. Please message again in a minute.')
  }
}

module.exports = handleOnboarding
