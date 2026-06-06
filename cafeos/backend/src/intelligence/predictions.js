const axios = require('axios')
const { formatInTimeZone } = require('date-fns-tz')
const supabase = require('../services/supabaseClient')

const IST = 'Asia/Kolkata'

function isoYMD(d) {
  return formatInTimeZone(d, IST, 'yyyy-MM-dd')
}

function daysBefore(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  return isoYMD(d)
}

function dowOf(dateStr) {
  // 0 = Sunday … 6 = Saturday
  return new Date(dateStr + 'T12:00:00Z').getUTCDay()
}

async function fetchWeather() {
  try {
    const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: 15.3961,
        longitude: 73.8173,
        daily: 'precipitation_sum,temperature_2m_max',
        timezone: 'Asia/Kolkata',
        forecast_days: 1
      },
      timeout: 8000
    })
    return {
      precipitation: res.data?.daily?.precipitation_sum?.[0] ?? 0,
      maxTemp: res.data?.daily?.temperature_2m_max?.[0] ?? 0
    }
  } catch (err) {
    console.warn('[Predictions] Weather fetch failed:', err.message)
    return { precipitation: 0, maxTemp: 0 }
  }
}

async function generatePredictions(date) {
  const targetDow = dowOf(date)
  const fourteenDaysAgo = daysBefore(date, 14)
  const yesterday = daysBefore(date, 1)

  // ── Menu items ──────────────────────────────────────────────────────
  const { data: menuItems, error: menuErr } = await supabase
    .from('menu_items')
    .select('id, name, seed_qty, category, is_perishable')
    .eq('active', true)
  if (menuErr) throw menuErr

  // ── Weather ──────────────────────────────────────────────────────────
  const { precipitation, maxTemp } = await fetchWeather()

  // ── Festival multiplier ──────────────────────────────────────────────
  let festivalMultiplier = 1.0
  let festivalName = null
  const { data: festival } = await supabase
    .from('festival_calendar')
    .select('demand_multiplier, name')
    .lte('start_date', date)
    .gte('end_date', date)
    .maybeSingle()
  if (festival) {
    festivalMultiplier = Number(festival.demand_multiplier)
    festivalName = festival.name
  }

  // ── Yesterday's check-in signals ─────────────────────────────────────
  const { data: checkin } = await supabase
    .from('checkins')
    .select('parsed_signals_json')
    .eq('date', yesterday)
    .maybeSingle()

  const stockouts = checkin?.parsed_signals_json?.stockouts || []
  const powerDisruption = checkin?.parsed_signals_json?.power_disruption ?? null

  // ── Yesterday's wastage ───────────────────────────────────────────────
  const { data: wastageRows } = await supabase
    .from('wastage_logs')
    .select('menu_item_id, quantity_left')
    .eq('logged_at', yesterday)

  const wastageMap = new Map()
  for (const w of wastageRows || []) {
    if (w.menu_item_id) wastageMap.set(w.menu_item_id, w.quantity_left)
  }

  // ── Historical actual_qty (last 14 days) ──────────────────────────────
  const { data: historical } = await supabase
    .from('predictions')
    .select('menu_item_id, date, actual_qty')
    .gte('date', fourteenDaysAgo)
    .lt('date', date)
    .not('actual_qty', 'is', null)
    .order('date', { ascending: true })

  const historyByItem = new Map()
  for (const row of historical || []) {
    if (!historyByItem.has(row.menu_item_id)) historyByItem.set(row.menu_item_id, [])
    historyByItem.get(row.menu_item_id).push({ date: row.date, actual_qty: row.actual_qty })
  }

  // ── Compute per-item predictions ──────────────────────────────────────
  const upsertRows = []

  for (const item of menuItems || []) {
    const history = historyByItem.get(item.id) || []
    const lowName = item.name.toLowerCase()

    // Step 1–2: baseline from seed if insufficient data
    let baseline
    if (history.length < 3) {
      baseline = item.seed_qty
    } else {
      // Step 3: day-of-week average
      const sameDow = history.filter(h => dowOf(h.date) === targetDow)
      const dowAvg = sameDow.length > 0
        ? sameDow.reduce((s, h) => s + h.actual_qty, 0) / sameDow.length
        : history.reduce((s, h) => s + h.actual_qty, 0) / history.length

      // Step 4: EWMA (α=0.3) over last 7 days
      const last7 = history.slice(-7)
      let ewma = item.seed_qty
      for (const h of last7) {
        ewma = 0.3 * h.actual_qty + 0.7 * ewma
      }

      // Step 5: final baseline
      baseline = dowAvg * 0.5 + ewma * 0.5
    }

    // Step 6: multipliers ─────────────────────────────────────────────
    const isChai = lowName.includes('chai') || lowName.includes('coffee')
    const isCold = lowName.includes('cold')
    const isHotFood = item.is_perishable && !isCold

    let weatherMult = 1.0
    if (precipitation > 5) {
      weatherMult *= isChai ? 1.25 : 0.85
    }
    if (maxTemp > 35) {
      if (isCold) weatherMult *= 1.20
      else if (isHotFood) weatherMult *= 0.90
    }

    let qty = baseline * weatherMult * festivalMultiplier

    // Stockout signal: yesterday this item ran out → bump +20%
    const wasStockout = stockouts.some(s => {
      const sItem = (s.item || '').toLowerCase()
      return sItem && (lowName.includes(sItem) || sItem.includes(lowName.split(' ')[0]))
    })
    if (wasStockout) qty *= 1.20

    // Wastage signal: qty_left > 3 → reduce by surplus × 0.5
    const qtyLeft = wastageMap.get(item.id) ?? 0
    if (qtyLeft > 3) qty -= qtyLeft * 0.5

    // Power cut: perishables × 0.75
    if (powerDisruption && item.is_perishable) qty *= 0.75

    // Step 7: round, minimum 1
    const predictedQty = Math.max(1, Math.round(qty))

    upsertRows.push({
      date,
      menu_item_id: item.id,
      predicted_qty: predictedQty,
      weather_multiplier_applied: weatherMult !== 1.0 ? Number(weatherMult.toFixed(3)) : null,
      festival_multiplier_applied: festivalMultiplier !== 1.0 ? Number(festivalMultiplier.toFixed(2)) : null,
      confirmed: false
    })
  }

  if (upsertRows.length > 0) {
    const { error } = await supabase
      .from('predictions')
      .upsert(upsertRows, { onConflict: 'date,menu_item_id', ignoreDuplicates: false })
    if (error) throw error
  }

  console.log(`[Predictions] Generated ${upsertRows.length} predictions for ${date}`)
  return { rows: upsertRows, weather: { precipitation, maxTemp }, festivalName }
}

async function confirmPredictions(date) {
  // Aggregate sold quantities for the day
  const { data: todayOrders } = await supabase
    .from('orders')
    .select('id')
    .eq('bill_date', date)

  const orderIds = (todayOrders || []).map(o => o.id)

  const soldMap = new Map()
  if (orderIds.length > 0) {
    const { data: items } = await supabase
      .from('order_items')
      .select('menu_item_id, quantity')
      .in('order_id', orderIds)

    for (const row of items || []) {
      soldMap.set(row.menu_item_id, (soldMap.get(row.menu_item_id) || 0) + row.quantity)
    }
  }

  // Fetch all predictions for the date to get menu_item_ids
  const { data: predictions } = await supabase
    .from('predictions')
    .select('id, menu_item_id')
    .eq('date', date)

  const updates = (predictions || []).map(pred =>
    supabase
      .from('predictions')
      .update({
        confirmed: true,
        actual_qty: soldMap.get(pred.menu_item_id) ?? 0
      })
      .eq('id', pred.id)
  )

  await Promise.all(updates)
  console.log(`[Predictions] Confirmed ${updates.length} predictions for ${date}`)
}

module.exports = { generatePredictions, confirmPredictions }
