import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import api from '../lib/api'
import { queueOrder } from '../lib/db'

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

  // Support editing an existing ongoing order
  const editOrder = location.state?.editOrder

  const [localUuid] = useState(() => editOrder?.local_uuid || crypto.randomUUID())
  const [orderType, setOrderType] = useState(editOrder?.order_type || 'dine_in')
  
  // New fields
  const [tableNumber, setTableNumber] = useState(editOrder?.table_number || '')
  const [customerName, setCustomerName] = useState(editOrder?.customer_name || '')
  const [contactInfo, setContactInfo] = useState(editOrder?.contact_info || '')

  // Load existing quantities if editing
  const initialQuantities = {}
  if (editOrder?.order_items) {
    for (const item of editOrder.order_items) {
      initialQuantities[item.menu_item_id] = item.quantity
    }
  }
  const [quantities, setQuantities] = useState(initialQuantities)

  const [menuItems, setMenuItems] = useState([])
  const [menuLoading, setMenuLoading] = useState(true)
  const [menuError, setMenuError] = useState('')
  const [showDiscardModal, setShowDiscardModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

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
    if (cartEmpty && !customerName && !tableNumber) {
      navigate('/staff/orders') // changed back dest
    } else {
      setShowDiscardModal(true)
    }
  }

  async function handleSaveOrder() {
    if (!customerName.trim()) {
      setSaveError('Customer Name is required')
      return
    }
    if (orderType === 'dine_in' && !tableNumber.trim()) {
      setSaveError('Table Number is required for Dine In')
      return
    }
    if (cartEmpty) {
      setSaveError('Please add at least one item to open the table')
      return
    }

    setSaveError('')
    setSaving(true)

    try {
      if (editOrder) {
        // Just update items (backend currently doesn't update customer details on patch)
        await api.patch(`/api/orders/${editOrder.id}/items`, {
          items: cartItems
        })
      } else {
        // Create new
        await api.post('/api/orders', {
          local_uuid: localUuid,
          order_type: orderType,
          payment_method: 'pending', // Initial payment status
          table_number: tableNumber,
          customer_name: customerName,
          contact_info: contactInfo,
          items: cartItems
        })
      }
      navigate('/staff/orders')
    } catch (err) {
      if (!navigator.onLine || !err.response) {
        if (editOrder) {
          setSaveError('Cannot edit orders while offline.')
        } else {
          await queueOrder({
            localUuid,
            order_type: orderType,
            payment_method: 'pending',
            table_number: tableNumber,
            customer_name: customerName,
            contact_info: contactInfo,
            items: cartItems
          })
          window.dispatchEvent(new Event('cafeos:order-queued'))
          navigate('/staff/orders')
        }
      } else {
        setSaveError(err.response?.data?.error?.message || 'Failed to save order')
      }
    } finally {
      setSaving(false)
    }
  }

  const filteredMenuItems = menuItems.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  )
  const categories = groupByCategory(filteredMenuItems)

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gray-50">
      {/* Sub-header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={handleBack} className="p-1 text-gray-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="flex-1 text-center font-semibold text-gray-900">
          {editOrder ? 'Edit Order' : 'New Order'}
        </h2>
        {!cartEmpty && (
          <span className="text-xs font-semibold text-gray-600 bg-gray-100 rounded-full px-3 py-1">
            {itemCount} · ₹{total}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pb-32">
        
        {/* Customer Details Form */}
        <div className="bg-white p-4 border-b border-gray-200">
          <div className="flex gap-0 mb-4">
            {['dine_in', 'takeaway'].map(type => (
              <button
                key={type}
                disabled={!!editOrder} // disable changing type while editing
                onClick={() => setOrderType(type)}
                className={`flex-1 py-2 text-sm font-medium border transition-colors first:rounded-l-xl last:rounded-r-xl ${
                  orderType === type
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-300'
                } ${editOrder ? 'opacity-70' : ''}`}
              >
                {type === 'dine_in' ? 'Dine In' : 'Takeaway'}
              </button>
            ))}
          </div>

          {saveError && <p className="text-red-600 text-sm font-medium mb-3">{saveError}</p>}

          <div className="space-y-3">
            <div className="flex gap-3">
              {orderType === 'dine_in' && (
                <div className="flex-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Table *</label>
                  <input
                    type="text"
                    disabled={!!editOrder}
                    value={tableNumber}
                    onChange={e => setTableNumber(e.target.value)}
                    placeholder="E.g. T1"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 outline-none focus:border-gray-900 bg-gray-50 disabled:bg-gray-100"
                  />
                </div>
              )}
              <div className="flex-[2]">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Customer *</label>
                <input
                  type="text"
                  disabled={!!editOrder}
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="Name"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 outline-none focus:border-gray-900 bg-gray-50 disabled:bg-gray-100"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Contact (Optional)</label>
              <input
                type="text"
                disabled={!!editOrder}
                value={contactInfo}
                onChange={e => setContactInfo(e.target.value)}
                placeholder="Phone number"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 outline-none focus:border-gray-900 bg-gray-50 disabled:bg-gray-100"
              />
            </div>
          </div>
        </div>

        {/* Menu list */}
        <div className="px-4 mt-2">
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search menu..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2 outline-none focus:border-gray-900 bg-white"
            />
          </div>
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
                        qty > 0 ? 'bg-white border-gray-900 shadow-sm' : 'bg-white border-gray-100'
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
      </div>

      {/* Sticky bottom cart panel */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-4 safe-area-pb">
        {!cartEmpty && (
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-600">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
            <span className="font-bold text-gray-900">₹{total}</span>
          </div>
        )}
        <button
          onClick={handleSaveOrder}
          disabled={saving}
          className="w-full py-4 rounded-2xl bg-gray-900 text-white font-bold text-base active:bg-gray-700 disabled:opacity-70"
        >
          {saving ? 'Saving...' : (editOrder ? 'Update Order' : 'Start Order')}
        </button>
      </div>

      {/* Discard modal */}
      {showDiscardModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-xs">
            <h3 className="font-bold text-gray-900 text-lg mb-2">Discard changes?</h3>
            <p className="text-gray-500 text-sm mb-6">Your unsaved changes will be lost.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDiscardModal(false)}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-medium text-sm"
              >
                Keep editing
              </button>
              <button
                onClick={() => navigate('/staff/orders')}
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
