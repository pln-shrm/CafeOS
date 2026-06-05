const cron = require('node-cron')

const IST = { timezone: 'Asia/Kolkata' }

// 8:00 AM Tue–Sun
cron.schedule('0 8 * * 2-7', () => {
  console.log(`[CRON] MORNING_PREP_SHEET fired at ${new Date().toISOString()}`)
}, IST)

// 9:15 AM Tue–Sun
cron.schedule('15 9 * * 2-7', () => {
  console.log(`[CRON] PREP_SHEET_FOLLOWUP fired at ${new Date().toISOString()}`)
}, IST)

// 9:30 AM Tue–Sun
cron.schedule('30 9 * * 2-7', () => {
  console.log(`[CRON] PREP_SHEET_AUTOCONFIRM fired at ${new Date().toISOString()}`)
}, IST)

// 7:00 PM Tue–Sun
cron.schedule('0 19 * * 2-0', () => {
  console.log(`[CRON] EVENING_CHECKIN_PROMPT fired at ${new Date().toISOString()}`)
}, IST)

// 10:00 PM Tue–Sun + Sunday
cron.schedule('0 22 * * 0,2-7', () => {
  console.log(`[CRON] WASTAGE_PROMPT fired at ${new Date().toISOString()}`)
}, IST)

// 10:15 PM Tue–Sun + Sunday
cron.schedule('15 22 * * 0,2-7', () => {
  console.log(`[CRON] WASTAGE_AUTOPROCEED fired at ${new Date().toISOString()}`)
}, IST)

// 9:00 PM Sunday
cron.schedule('0 21 * * 0', () => {
  console.log(`[CRON] WEEKLY_SUMMARY fired at ${new Date().toISOString()}`)
}, IST)

// 11:00 PM Daily
cron.schedule('0 23 * * *', () => {
  console.log(`[CRON] SHEETS_SYNC fired at ${new Date().toISOString()}`)
}, IST)

console.log('[CRON] All jobs scheduled (Asia/Kolkata)')
