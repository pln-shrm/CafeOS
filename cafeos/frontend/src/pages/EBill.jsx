import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import api from '../lib/api'

function formatBillText(bill) {
  const divider = '─'.repeat(32)
  const lines = [
    bill.cafe_name,
    bill.cafe_address,
    divider,
    `${bill.date}  ${bill.time}`,
    `${bill.order_type === 'dine_in' ? 'Dine In' : 'Takeaway'} | ${bill.payment_method?.toUpperCase()}`,
    divider,
    ...bill.items.map(i => `${i.name} x${i.quantity}  ₹${i.subtotal}`),
    divider,
    `TOTAL: ₹${bill.total}`,
    divider,
    bill.footer
  ]
  return lines.join('\n')
}

export default function EBill() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [bill, setBill] = useState(location.state?.bill || null)
  const [loading, setLoading] = useState(!bill)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (bill) return
    // Try fetching from API if no state (e.g. page refresh)
    async function fetchBill() {
      try {
        const res = await api.get(`/api/orders/${id}/bill`)
        setBill(res.data.data)
      } catch {
        setError('Bill not available.')
      } finally {
        setLoading(false)
      }
    }
    fetchBill()
  }, [id, bill])

  async function handleShare() {
    if (!bill) return
    const text = formatBillText(bill)
    if (navigator.share) {
      try {
        await navigator.share({ text, title: `Bill` })
      } catch { /* user cancelled share */ }
    } else {
      try {
        await navigator.clipboard.writeText(text)
        setToast('Copied to clipboard!')
        setTimeout(() => setToast(''), 2500)
      } catch {
        setToast('Share not available.')
        setTimeout(() => setToast(''), 2500)
      }
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400">Loading bill…</p>
      </div>
    )
  }

  if (error || !bill) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-gray-500">{error || 'Bill not available.'}</p>
        <button onClick={() => navigate('/staff/home')} className="text-sm text-gray-700 underline">
          Go Home
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 px-4 pt-4 pb-8 min-h-0">
      {/* Receipt */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 font-mono text-sm mb-6">
        <div className="text-center mb-3">
          <p className="font-bold text-xl text-gray-900">{bill.cafe_name}</p>
          <p className="text-gray-500 text-xs">{bill.cafe_address}</p>
        </div>

        <div className="border-t border-dashed border-gray-300 pt-3 mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{bill.date}</span>
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span className="capitalize">{bill.order_type === 'dine_in' ? 'Dine In' : 'Takeaway'}</span>
            <span>{bill.time}</span>
          </div>
          {bill.payment_method && (
            <div className="text-xs text-gray-400 mt-1 capitalize">
              Payment: {bill.payment_method}
              {bill.offline && <span className="ml-2 text-amber-500">(saved offline)</span>}
            </div>
          )}
        </div>

        {/* Item table */}
        <div className="border-t border-dashed border-gray-300 pt-3 space-y-2 mb-3">
          <div className="flex text-xs text-gray-400 font-sans">
            <span className="flex-1">Item</span>
            <span className="w-8 text-right">Qty</span>
            <span className="w-16 text-right">Price</span>
            <span className="w-16 text-right">Sub</span>
          </div>
          {bill.items.map((item, i) => (
            <div key={i} className="flex text-xs items-start">
              <span className="flex-1 text-gray-800">{item.name}</span>
              <span className="w-8 text-right text-gray-500">{item.quantity}</span>
              <span className="w-16 text-right text-gray-500">₹{item.unit_price}</span>
              <span className="w-16 text-right font-semibold text-gray-900">₹{item.subtotal}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-dashed border-gray-300 pt-3 flex justify-between items-center mb-3">
          <span className="font-bold text-gray-900">TOTAL</span>
          <span className="font-bold text-xl text-gray-900">₹{bill.total}</span>
        </div>

        <p className="text-center text-xs text-gray-400 mt-2">{bill.footer}</p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-3 mt-auto">
        <button
          onClick={handleShare}
          className="w-full py-4 rounded-2xl bg-green-500 text-white font-bold text-base active:bg-green-600"
        >
          Share via WhatsApp
        </button>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/staff/order/new')}
            className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm active:bg-gray-50"
          >
            New Order
          </button>
          <button
            onClick={() => navigate('/staff/home')}
            className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm active:bg-gray-50"
          >
            Home
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
