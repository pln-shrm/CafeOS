import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'
import { queueOrder } from '../lib/db'

const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'upi', label: 'UPI' },
  { key: 'pending', label: 'Pending' }
]

function nowIST() {
  const now = new Date()
  return {
    date: now.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }),
    time: now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })
  }
}

export default function BillPreview() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()

  const { order, orderState } = location.state || {}

  // Redirect if no order data (direct URL access)
  if (!order) {
    navigate('/staff/order/new', { replace: true })
    return null
  }

  const { local_uuid, order_type, items, total } = order
  const { date, time } = nowIST()

  const [paymentMethod, setPaymentMethod] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  async function handleConfirm() {
    if (!paymentMethod) return
    setConfirming(true)
    setConfirmError('')

    const payload = {
      local_uuid,
      order_type,
      payment_method: paymentMethod,
      items: items.map(i => ({ menu_item_id: i.menu_item_id, quantity: i.quantity }))
    }

    if (!navigator.onLine) {
      // Offline: queue to IndexedDB
      await queueOrder({
        localUuid: local_uuid,
        order_type,
        payment_method: paymentMethod,
        items: payload.items,
        total,
        staff_id: user?.id,
        timestamp: Date.now(),
        synced: false
      })
      window.dispatchEvent(new Event('cafeos:order-queued'))
      navigate(`/staff/order/${local_uuid}/ebill`, {
        state: {
          bill: {
            cafe_name: "Sam's Cafe",
            cafe_address: 'Vasco da Gama, Goa',
            bill_number: null,
            date,
            time,
            order_type,
            payment_method: paymentMethod,
            items: items.map(i => ({ name: i.name, quantity: i.quantity, unit_price: i.unit_price, subtotal: i.unit_price * i.quantity })),
            total,
            footer: "Thank you for visiting Sam's Cafe!",
            offline: true
          }
        }
      })
      return
    }

    // Online: POST to API
    try {
      const res = await api.post('/api/orders', payload)
      const { order_id, bill_number, bill_date } = res.data.data
      navigate(`/staff/order/${order_id}/ebill`, {
        state: {
          bill: {
            cafe_name: "Sam's Cafe",
            cafe_address: 'Vasco da Gama, Goa',
            bill_number,
            date,
            time,
            order_type,
            payment_method: paymentMethod,
            items: items.map(i => ({ name: i.name, quantity: i.quantity, unit_price: i.unit_price, subtotal: i.unit_price * i.quantity })),
            total,
            footer: "Thank you for visiting Sam's Cafe!"
          }
        }
      })
    } catch {
      setConfirmError('Couldn\'t save order — try again.')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Sub-header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/staff/order/new', { state: { orderState } })}
          className="p-1 text-gray-500"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="flex-1 text-center font-semibold text-gray-900">Bill Preview</h2>
        <div className="w-7" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-32">
        {/* Receipt block */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 font-mono text-sm mb-5">
          <div className="text-center mb-3">
            <p className="font-bold text-base text-gray-900">Sam's Cafe</p>
            <p className="text-gray-500 text-xs">Vasco da Gama, Goa</p>
          </div>
          <div className="text-xs text-gray-400 text-center mb-1">{date} · {time}</div>
          <div className="text-xs text-center mb-3">
            <span className="bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
              {order_type === 'dine_in' ? 'Dine In' : 'Takeaway'}
            </span>
          </div>

          <div className="border-t border-dashed border-gray-300 pt-3 space-y-2">
            {items.map((item, i) => (
              <div key={i} className="flex items-start justify-between gap-2 text-xs">
                <span className="text-gray-700 flex-1">{item.name}</span>
                <span className="text-gray-500 w-8 text-right">×{item.quantity}</span>
                <span className="text-gray-500 w-16 text-right">₹{item.unit_price}</span>
                <span className="font-semibold text-gray-900 w-16 text-right">₹{item.unit_price * item.quantity}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-gray-300 mt-3 pt-3 flex justify-between items-center">
            <span className="font-bold text-gray-900 text-sm">TOTAL</span>
            <span className="font-bold text-gray-900 text-lg">₹{total}</span>
          </div>
        </div>

        {/* Payment method */}
        <div>
          <p className="text-sm font-semibold text-gray-600 mb-3">How is the customer paying?</p>
          <div className="flex gap-3">
            {PAYMENT_METHODS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPaymentMethod(key)}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold border transition-colors ${
                  paymentMethod === key
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {confirmError && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-red-600 text-sm">{confirmError}</p>
            <button onClick={handleConfirm} className="text-red-600 text-sm underline mt-1">Retry</button>
          </div>
        )}
      </div>

      {/* Confirm button */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-4">
        <button
          onClick={handleConfirm}
          disabled={!paymentMethod || confirming}
          className={`w-full py-4 rounded-2xl font-bold text-base transition-colors ${
            !paymentMethod || confirming
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-gray-900 text-white active:bg-gray-700'
          }`}
        >
          {confirming ? 'Confirming…' : 'Confirm Order'}
        </button>
      </div>
    </div>
  )
}
