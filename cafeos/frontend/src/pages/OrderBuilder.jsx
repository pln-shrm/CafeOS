import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import api from '../lib/api'

function groupByCategory(items) {
  const map = {}
  for (const item of items) {
    const cat = item.category || 'Other'
    if (!map[cat]) map[cat] = []
    map[cat].push(item)
  }
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
}

export default function OrderBuilder() {
  const navigate = useNavigate()
  const location = useLocation()

  // Restore cart if navigating back from BillPreview
  const restoredState = location.state?.orderState

  const [localUuid] = useState(() => restoredState?.local_uuid || crypto.randomUUID())
  const [orderType, setOrderType] = useState(restoredState?.order_type || 'dine_in')
  const [quantities, setQuantities] = useState(restoredState?.quantities || {}) // { menu_item_id: quantity }
  const [menuItems, setMenuItems] = useState([])
  const [menuLoading, setMenuLoading] = useState(true)
  const [menuError, setMenuError] = useState('')
  const [showDiscardModal, setShowDiscardModal] = useState(false)

  useEffect(() => {
    async function fetchMenu() {
      try {
        const res = await api.get('/api/menu')
        setMenuItems(res.data.data.items || [])
      } catch {
        setMenuError('Menu couldn\'t load. No internet.')
      } finally {
        setMenuLoading(false)
      }
    }
    fetchMenu()
  }, [])

  function setQty(itemId, delta) {
    setQuantities(prev => {
      const current = prev[itemId] || 0
      const next = Math.max(0, current + delta)
      if (next === 0) {
        const { [itemId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [itemId]: next }
    })
  }

  const cartItems = menuItems
    .filter(m => quantities[m.id] > 0)
    .map(m => ({ menu_item_id: m.id, name: m.name, unit_price: m.price, quantity: quantities[m.id] }))

  const total = cartItems.reduce((sum, i) => sum + i.unit_price * i.quantity, 0)
  const itemCount = cartItems.reduce((sum, i) => sum + i.quantity, 0)
  const cartEmpty = cartItems.length === 0

  function handleBack() {
    if (cartEmpty) {
      navigate('/staff/home')
    } else {
      setShowDiscardModal(true)
    }
  }

  function handleReviewBill() {
    navigate('/staff/order/new/bill', {
      state: {
        orderState: { local_uuid: localUuid, order_type: orderType, quantities },
        order: { local_uuid: localUuid, order_type: orderType, items: cartItems, total }
      }
    })
  }

  const categories = groupByCategory(menuItems)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Sub-header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={handleBack} className="p-1 text-gray-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="flex-1 text-center font-semibold text-gray-900">New Order</h2>
        {!cartEmpty && (
          <span className="text-xs font-semibold text-gray-600 bg-gray-100 rounded-full px-3 py-1">
            {itemCount} · ₹{total}
          </span>
        )}
      </div>

      {/* Order type toggle */}
      <div className="flex gap-0 px-4 pt-4 pb-2">
        {['dine_in', 'takeaway'].map(type => (
          <button
            key={type}
            onClick={() => setOrderType(type)}
            className={`flex-1 py-2 text-sm font-medium border transition-colors first:rounded-l-xl last:rounded-r-xl ${
              orderType === type
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-300'
            }`}
          >
            {type === 'dine_in' ? 'Dine In' : 'Takeaway'}
          </button>
        ))}
      </div>

      {/* Menu list */}
      <div className="flex-1 overflow-y-auto px-4 pb-32">
        {menuLoading && <p className="text-gray-400 text-sm py-6 text-center">Loading menu…</p>}
        {menuError && (
          <div className="py-10 text-center">
            <p className="text-gray-500 text-sm mb-3">{menuError}</p>
            <button
              onClick={() => window.location.reload()}
              className="text-sm text-gray-700 underline"
            >
              Retry
            </button>
          </div>
        )}
        {categories.map(([cat, items]) => (
          <div key={cat} className="mb-4">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider py-3">{cat}</h3>
            <div className="flex flex-col gap-2">
              {items.map(item => {
                const qty = quantities[item.id] || 0
                return (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                      qty > 0 ? 'bg-gray-50 border-gray-300' : 'bg-white border-gray-100'
                    }`}
                  >
                    <div>
                      <p className={`font-semibold text-sm ${qty > 0 ? 'text-gray-900' : 'text-gray-700'}`}>{item.name}</p>
                      <p className="text-gray-400 text-xs mt-0.5">₹{item.price}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setQty(item.id, -1)}
                        disabled={qty === 0}
                        className="w-8 h-8 rounded-full bg-gray-200 text-gray-700 font-bold text-lg flex items-center justify-center disabled:opacity-30 active:bg-gray-300"
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-sm font-semibold text-gray-900">{qty}</span>
                      <button
                        onClick={() => setQty(item.id, 1)}
                        className="w-8 h-8 rounded-full bg-gray-900 text-white font-bold text-lg flex items-center justify-center active:bg-gray-700"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Sticky bottom cart panel */}
      {!cartEmpty && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-4 safe-area-pb">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-600">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
            <span className="font-bold text-gray-900">₹{total}</span>
          </div>
          <button
            onClick={handleReviewBill}
            className="w-full py-4 rounded-2xl bg-gray-900 text-white font-bold text-base active:bg-gray-700"
          >
            Review Bill →
          </button>
        </div>
      )}

      {/* Discard modal */}
      {showDiscardModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-xs">
            <h3 className="font-bold text-gray-900 text-lg mb-2">Discard order?</h3>
            <p className="text-gray-500 text-sm mb-6">Your current cart will be cleared.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDiscardModal(false)}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-medium text-sm"
              >
                Keep editing
              </button>
              <button
                onClick={() => navigate('/staff/home')}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-medium text-sm"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
