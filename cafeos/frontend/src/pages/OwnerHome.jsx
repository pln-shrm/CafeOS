import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'

const IST = 'Asia/Kolkata'
const CACHE_KEY = 'cafeos_owner_summary_cache'

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST })
}

function formatDateIST() {
  return new Date().toLocaleDateString('en-GB', {
    timeZone: IST,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

function greetingForNow(name) {
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: IST, hour: '2-digit', hour12: false }))
  const display = name ? `, ${name}` : ''
  if (hour < 12) return `Good morning${display} ☀️`
  if (hour < 17) return `Good afternoon${display}`
  return `Good evening${display} 🌙`
}

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'
  return `₹${Number(value).toFixed(0)}`
}

function formatCount(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'
  return value
}

export default function OwnerHome() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [summary, setSummary] = useState(null)
  const [topItems, setTopItems] = useState([])
  const [dineInCount, setDineInCount] = useState(null)
  const [takeawayCount, setTakeawayCount] = useState(null)
  const [pendingOrderCount, setPendingOrderCount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [lastSyncedAt, setLastSyncedAt] = useState(null)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    const cachedRaw = localStorage.getItem(CACHE_KEY)
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw)
        setSummary(cached.summary || null)
        setTopItems(cached.topItems || [])
        setDineInCount(cached.dineInCount ?? null)
        setTakeawayCount(cached.takeawayCount ?? null)
        setPendingOrderCount(cached.pendingOrderCount ?? null)
        setLastSyncedAt(cached.syncedAt || null)
      } catch {
        localStorage.removeItem(CACHE_KEY)
      }
    }
  }, [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      const date = todayIST()
      try {
        const [summaryRes, ordersRes] = await Promise.all([
          api.get('/api/billing/summary', { params: { date } }),
          api.get('/api/orders', { params: { from: date, to: date, limit: 200 } })
        ])

        const summaryData = summaryRes.data.data
        const orders = ordersRes.data.data.orders || []
        const dineIn = orders.filter(o => o.order_type === 'dine_in').length
        const takeaway = orders.filter(o => o.order_type === 'takeaway').length
        const pendingCount = orders.filter(o => o.payment_method === 'pending').length

        setSummary(summaryData)
        setTopItems(summaryData.top_items || [])
        setDineInCount(dineIn)
        setTakeawayCount(takeaway)
        setPendingOrderCount(pendingCount)
        const syncedAt = new Date().toISOString()
        setLastSyncedAt(syncedAt)
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          summary: summaryData,
          topItems: summaryData.top_items || [],
          dineInCount: dineIn,
          takeawayCount: takeaway,
          pendingOrderCount: pendingCount,
          syncedAt
        }))
      } catch {
        if (!summary) {
          setSummary(null)
        }
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const pendingNote = useMemo(() => {
    const pendingRevenue = summary?.pending_revenue
    if (!pendingRevenue || pendingRevenue <= 0) return ''
    if (pendingOrderCount) {
      return `${pendingOrderCount} orders pending payment`
    }
    return 'Orders pending payment'
  }, [summary, pendingOrderCount])

  const lastSyncedLabel = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' })
    : null

  const topItemsDisplay = topItems.length > 0
    ? topItems
    : Array.from({ length: 5 }, () => ({ name: '-', units_sold: '-' }))

  return (
    <div className="flex flex-col flex-1 px-5 pt-6 pb-8 gap-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{greetingForNow(user?.name)}</h1>
        <p className="text-gray-500 text-sm mt-1">{formatDateIST()}</p>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Today's Summary</h2>
          {loading && <span className="text-xs text-gray-400">Loading…</span>}
        </div>
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-gray-500 text-xs">Total Orders</p>
            <p className="text-2xl font-bold text-gray-900">{formatCount(summary?.total_orders)}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-500 text-xs">Total Revenue</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(summary?.total_revenue)}</p>
          </div>
        </div>
        <div className="mt-4 text-sm text-gray-600 flex flex-wrap gap-2">
          <span className="bg-gray-100 rounded-full px-3 py-1">Cash {formatCurrency(summary?.cash_revenue)}</span>
          <span className="bg-gray-100 rounded-full px-3 py-1">UPI {formatCurrency(summary?.upi_revenue)}</span>
          <span className="bg-gray-100 rounded-full px-3 py-1">Pending {formatCurrency(summary?.pending_revenue)}</span>
        </div>
        {summary?.pending_revenue > 0 && (
          <div className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            {pendingNote}
          </div>
        )}
        {!isOnline && lastSyncedLabel && (
          <p className="mt-3 text-xs text-gray-400">Last synced {lastSyncedLabel}.</p>
        )}
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Quick Stats</h2>
        <div className="flex items-center justify-between text-sm text-gray-700">
          <span>Dine In today: <strong className="text-gray-900">{formatCount(dineInCount)}</strong></span>
          <span>Takeaway today: <strong className="text-gray-900">{formatCount(takeawayCount)}</strong></span>
        </div>
      </div>

      <button
        onClick={() => navigate('/owner/reports')}
        className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 text-left"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Top Items Today</h2>
          <span className="text-xs text-gray-400">Tap to view reports</span>
        </div>
        <div className="space-y-2">
          {topItemsDisplay.map((item, index) => (
            <div key={`${item.name}-${index}`} className="flex items-center justify-between text-sm text-gray-700">
              <span className="font-medium text-gray-900">{item.name}</span>
              <span className="text-gray-500">{item.units_sold} sold</span>
            </div>
          ))}
        </div>
      </button>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/owner/menu')} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm text-left">
          <p className="text-lg">Menu 🍽️</p>
          <p className="text-xs text-gray-500 mt-1">Edit items</p>
        </button>
        <button onClick={() => navigate('/owner/staff')} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm text-left">
          <p className="text-lg">Staff 👤</p>
          <p className="text-xs text-gray-500 mt-1">Manage team</p>
        </button>
        <button onClick={() => navigate('/owner/inventory')} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm text-left">
          <p className="text-lg">Inventory 📦</p>
          <p className="text-xs text-gray-500 mt-1">Prep overview</p>
        </button>
        <button onClick={() => navigate('/owner/attendance')} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm text-left">
          <p className="text-lg">Attendance 🗓️</p>
          <p className="text-xs text-gray-500 mt-1">Check-ins</p>
        </button>
        <button onClick={() => navigate('/owner/reports')} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm text-left">
          <p className="text-lg">Reports 📊</p>
          <p className="text-xs text-gray-500 mt-1">Sales stats</p>
        </button>
        <button onClick={() => navigate('/owner/credit')} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm text-left">
          <p className="text-lg">Vendor Credit 💰</p>
          <p className="text-xs text-gray-500 mt-1">Ledger</p>
        </button>
        <button onClick={() => navigate('/owner/offers')} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm text-left">
          <p className="text-lg">Offers 🏷️</p>
          <p className="text-xs text-gray-500 mt-1">Discounts</p>
        </button>
        <button onClick={() => navigate('/owner/analytics')} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm text-left">
          <p className="text-lg">Analytics 📈</p>
          <p className="text-xs text-gray-500 mt-1">App usage</p>
        </button>
      </div>
    </div>
  )
}
