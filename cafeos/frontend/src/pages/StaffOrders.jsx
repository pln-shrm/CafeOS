import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'

export default function StaffOrders() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('ongoing') // 'ongoing' | 'past'
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadOrders() {
      setLoading(true)
      try {
        if (tab === 'ongoing') {
          const res = await api.get('/api/orders/ongoing')
          setOrders(res.data.data.orders || [])
        } else {
          const res = await api.get('/api/orders/staff-history')
          setOrders(res.data.data.orders || [])
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    loadOrders()
  }, [tab])

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gray-50">
      {/* Sub-header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/staff/home')} className="p-1 text-gray-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="flex-1 font-semibold text-gray-900">My Orders</h2>
      </div>

      {/* Tabs */}
      <div className="flex bg-white px-4 border-b border-gray-200">
        <button
          className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${tab === 'ongoing' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400'}`}
          onClick={() => setTab('ongoing')}
        >
          Ongoing
        </button>
        <button
          className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${tab === 'past' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400'}`}
          onClick={() => setTab('past')}
        >
          Past Orders
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {loading && <p className="text-gray-400 text-sm text-center py-10">Loading orders...</p>}
        {!loading && orders.length === 0 && (
          <div className="text-center py-10">
            <p className="text-gray-400 text-sm">No orders found.</p>
          </div>
        )}
        {!loading && orders.map(order => (
          <div key={order.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-gray-900 text-lg">
                  {order.table_number ? `Table ${order.table_number}` : 'Takeaway'}
                </h3>
                <p className="text-gray-500 text-sm font-medium">{order.customer_name}</p>
              </div>
              <span className="font-bold text-gray-900 text-lg">₹{order.total}</span>
            </div>
            
            <div className="text-sm text-gray-600 line-clamp-2">
              {order.order_items.map(oi => `${oi.quantity}x ${oi.menu_items?.name}`).join(', ')}
            </div>

            {tab === 'ongoing' && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => navigate('/staff/order/new', { state: { editOrder: order } })}
                  className="flex-1 py-2 bg-gray-100 text-gray-800 rounded-xl font-bold text-sm active:bg-gray-200"
                >
                  Edit / Add
                </button>
                <button
                  onClick={() => navigate('/staff/order/new/bill', { state: { orderToClose: order } })}
                  className="flex-1 py-2 bg-green-500 text-white rounded-xl font-bold text-sm active:bg-green-600"
                >
                  Close & Pay
                </button>
              </div>
            )}
            {tab === 'past' && (
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                <span className="text-xs text-gray-400">Bill #{order.bill_number}</span>
                <span className="text-xs font-bold px-2 py-1 bg-green-100 text-green-700 rounded-full uppercase">
                  {order.payment_method}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
