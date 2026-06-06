import { useEffect, useMemo, useState } from 'react'
import api from '../../lib/api'

const IST = 'Asia/Kolkata'

function istNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: IST }))
}

function toYmd(date) {
  return date.toLocaleDateString('en-CA', { timeZone: IST })
}

function startOfWeek(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day + 6) % 7
  d.setDate(d.getDate() - diff)
  return d
}

function startOfMonth(date) {
  const d = new Date(date)
  d.setDate(1)
  return d
}

function formatShortDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('en-GB', { timeZone: IST, day: 'numeric', month: 'short' })
}

export default function Reports() {
  const [rangeType, setRangeType] = useState('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')

  const { from, to } = useMemo(() => {
    const now = istNow()
    if (rangeType === 'yesterday') {
      const y = new Date(now)
      y.setDate(now.getDate() - 1)
      const date = toYmd(y)
      return { from: date, to: date }
    }
    if (rangeType === 'week') {
      const start = startOfWeek(now)
      return { from: toYmd(start), to: toYmd(now) }
    }
    if (rangeType === 'month') {
      const start = startOfMonth(now)
      return { from: toYmd(start), to: toYmd(now) }
    }
    if (rangeType === 'custom') {
      return { from: customFrom, to: customTo }
    }
    const today = toYmd(now)
    return { from: today, to: today }
  }, [rangeType, customFrom, customTo])

  useEffect(() => {
    async function load() {
      if (!from || !to) return
      setLoading(true)
      setError('')
      try {
        const res = await api.get('/api/orders', { params: { from, to, limit: 200 } })
        setOrders(res.data.data.orders || [])
      } catch {
        setError('Could not load reports.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [from, to])

  const summary = useMemo(() => {
    let totalRevenue = 0
    let cashRevenue = 0
    let upiRevenue = 0
    let pendingRevenue = 0

    for (const order of orders) {
      const amount = Number(order.total) || 0
      totalRevenue += amount
      if (order.payment_method === 'cash') cashRevenue += amount
      if (order.payment_method === 'upi') upiRevenue += amount
      if (order.payment_method === 'pending') pendingRevenue += amount
    }

    return {
      totalOrders: orders.length,
      totalRevenue,
      cashRevenue,
      upiRevenue,
      pendingRevenue,
      pendingCount: orders.filter(o => o.payment_method === 'pending').length
    }
  }, [orders])

  const revenueRows = useMemo(() => {
    const map = new Map()
    for (const order of orders) {
      const dateKey = order.bill_date
      if (!map.has(dateKey)) {
        map.set(dateKey, { date: dateKey, orders: 0, revenue: 0, cash: 0, upi: 0, pending: 0 })
      }
      const row = map.get(dateKey)
      row.orders += 1
      row.revenue += Number(order.total) || 0
      if (order.payment_method === 'cash') row.cash += Number(order.total) || 0
      if (order.payment_method === 'upi') row.upi += Number(order.total) || 0
      if (order.payment_method === 'pending') row.pending += Number(order.total) || 0
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date))
  }, [orders])

  const itemRows = useMemo(() => {
    const map = new Map()
    for (const order of orders) {
      for (const item of order.order_items || []) {
        const name = item.menu_items?.name || 'Unknown'
        if (!map.has(name)) {
          map.set(name, { name, units: 0, revenue: 0 })
        }
        const row = map.get(name)
        row.units += Number(item.quantity) || 0
        row.revenue += (Number(item.quantity) || 0) * (Number(item.unit_price) || 0)
      }
    }
    return Array.from(map.values()).sort((a, b) => b.units - a.units)
  }, [orders])

  async function handleExport() {
    setExporting(true)
    setExportMessage('')
    try {
      await api.post('/api/sheets/sync')
      setExportMessage('Exported to Google Sheets ✓')
    } catch {
      setExportMessage('Export failed — try again')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 px-5 pt-6 pb-8 gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60"
        >
          {exporting ? 'Exporting…' : 'Export to Sheets'}
        </button>
      </div>

      {exportMessage && (
        <div className={`text-sm rounded-xl px-3 py-2 border ${
          exportMessage.includes('failed')
            ? 'text-amber-700 bg-amber-50 border-amber-200'
            : 'text-green-700 bg-green-50 border-green-200'
        }`}>
          {exportMessage}
        </div>
      )}

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col gap-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Date Range</h2>
        <div className="flex gap-2 flex-wrap">
          {[
            { id: 'today', label: 'Today' },
            { id: 'yesterday', label: 'Yesterday' },
            { id: 'week', label: 'This Week' },
            { id: 'month', label: 'This Month' }
          ].map(option => (
            <button
              key={option.id}
              onClick={() => setRangeType(option.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                rangeType === option.id
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-700 border-gray-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="date"
            value={customFrom}
            onChange={e => { setCustomFrom(e.target.value); setRangeType('custom') }}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={customTo}
            onChange={e => { setCustomTo(e.target.value); setRangeType('custom') }}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-400">Total Orders</p>
          <p className="text-xl font-bold text-gray-900">{loading ? '…' : summary.totalOrders}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-400">Total Revenue</p>
          <p className="text-xl font-bold text-gray-900">{loading ? '…' : `₹${summary.totalRevenue.toFixed(0)}`}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-400">Cash</p>
          <p className="text-xl font-bold text-gray-900">{loading ? '…' : `₹${summary.cashRevenue.toFixed(0)}`}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-400">UPI</p>
          <p className="text-xl font-bold text-gray-900">{loading ? '…' : `₹${summary.upiRevenue.toFixed(0)}`}</p>
        </div>
      </div>

      {summary.pendingRevenue > 0 && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          ₹{summary.pendingRevenue.toFixed(0)} in {summary.pendingCount} orders pending
        </div>
      )}

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Revenue Breakdown</h2>
        <div className="text-xs text-gray-400 grid grid-cols-6 gap-2 mb-2">
          <span>Date</span>
          <span>Orders</span>
          <span>Revenue</span>
          <span>Cash</span>
          <span>UPI</span>
          <span>Pending</span>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          {revenueRows.map(row => (
            <div key={row.date} className="grid grid-cols-6 gap-2 text-gray-700">
              <span>{formatShortDate(row.date)}</span>
              <span>{row.orders}</span>
              <span>₹{row.revenue.toFixed(0)}</span>
              <span>₹{row.cash.toFixed(0)}</span>
              <span>₹{row.upi.toFixed(0)}</span>
              <span>₹{row.pending.toFixed(0)}</span>
            </div>
          ))}
          {!loading && revenueRows.length === 0 && (
            <p className="text-gray-400 text-sm">No data in this range.</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Item Sales</h2>
        <div className="text-xs text-gray-400 grid grid-cols-3 gap-2 mb-2">
          <span>Item</span>
          <span>Units Sold</span>
          <span>Revenue</span>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          {itemRows.map(row => (
            <div key={row.name} className="grid grid-cols-3 gap-2 text-gray-700">
              <span className="truncate">{row.name}</span>
              <span>{row.units}</span>
              <span>₹{row.revenue.toFixed(0)}</span>
            </div>
          ))}
          {!loading && itemRows.length === 0 && (
            <p className="text-gray-400 text-sm">No item sales yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}
