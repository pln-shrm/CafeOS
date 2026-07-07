import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../lib/api'

export default function Analytics() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState(null)
  const [business, setBusiness] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchAnalytics() {
      try {
        const [sumRes, busRes] = await Promise.all([
          api.get('/api/analytics/summary'),
          api.get('/api/analytics/business')
        ])
        setSummary(sumRes.data.data)
        setBusiness(busRes.data.data)
      } catch (err) {
        setError('Failed to load analytics.')
      } finally {
        setLoading(false)
      }
    }
    fetchAnalytics()
  }, [])

  return (
    <div className="flex flex-col flex-1 px-5 pt-6 pb-8 gap-5 max-w-2xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={() => navigate(-1)}
          className="p-2 -ml-2 rounded-xl text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Business Analytics</h1>
          <p className="text-gray-500 text-sm mt-1">Last 30 Days Overview</p>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">Loading...</div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-red-500">{error}</div>
      ) : (
        <div className="flex flex-col gap-6">
          
          {/* Business KPIs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl p-5 text-white shadow-md">
              <p className="text-indigo-100 font-medium text-sm mb-1">Total Revenue</p>
              <p className="text-3xl font-bold">₹{business?.totalRevenue?.toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <p className="text-gray-500 font-medium text-sm mb-1">Total Orders</p>
              <p className="text-3xl font-bold text-gray-900">{business?.totalOrders}</p>
            </div>
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <p className="text-gray-500 font-medium text-sm mb-1">Expenses (Procurement)</p>
              <p className="text-2xl font-bold text-red-600">₹{business?.totalExpenses?.toLocaleString()}</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-5 text-white shadow-md">
              <p className="text-emerald-100 font-medium text-sm mb-1">Estimated Profit</p>
              <p className="text-2xl font-bold">₹{business?.profit?.toLocaleString()}</p>
            </div>
          </div>

          {/* Top Selling Items */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-50">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span>🔥</span> Top Selling Items
              </h2>
            </div>
            <div className="divide-y divide-gray-50">
              {business?.topItems?.length > 0 ? (
                business.topItems.map((item, idx) => (
                  <div key={idx} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-bold text-sm">
                        #{idx + 1}
                      </div>
                      <p className="font-medium text-gray-800">{item.name}</p>
                    </div>
                    <div className="text-sm font-semibold text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                      {item.count} sold
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-gray-400">No items sold recently</div>
              )}
            </div>
          </div>

          {/* App Usage Stats */}
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-4 px-1">App Usage Streaks</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <span>🤖</span> Bot (Staff)
                </h3>
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Streak</p>
                    <p className="text-2xl font-bold text-amber-500">{summary?.bot?.currentStreak || 0} 🔥</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Days</p>
                    <p className="text-xl font-bold text-gray-700">{summary?.bot?.totalDays || 0}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <span>💻</span> WebApp (Owner)
                </h3>
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Streak</p>
                    <p className="text-2xl font-bold text-purple-500">{summary?.webapp?.currentStreak || 0} 🔥</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">Days</p>
                    <p className="text-xl font-bold text-gray-700">{summary?.webapp?.totalDays || 0}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
