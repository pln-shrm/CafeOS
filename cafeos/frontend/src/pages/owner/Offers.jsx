import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../lib/api'

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[Number(m) - 1]} ${y}`
}

function offerStatus(offer) {
  const today = todayIST()
  if (!offer.active) return { label: 'Inactive', color: 'text-gray-400 bg-gray-100' }
  if (offer.end_date < today) return { label: 'Expired', color: 'text-red-600 bg-red-50' }
  if (offer.start_date > today) return { label: 'Upcoming', color: 'text-blue-600 bg-blue-50' }
  return { label: 'Live', color: 'text-green-700 bg-green-50' }
}

const BLANK_FORM = {
  name: '',
  scope: 'all',
  category: '',
  item_ids: [],
  discount_type: 'percentage',
  discount_value: '',
  start_date: todayIST(),
  end_date: todayIST()
}

export default function Offers() {
  const navigate = useNavigate()
  const [offers, setOffers] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState('')

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [offersRes, menuRes] = await Promise.all([
          api.get('/api/offers'),
          api.get('/api/menu', { params: { include_inactive: 'false' } })
        ])
        const items = menuRes.data.data.items || []
        setOffers(offersRes.data.data.offers || [])
        setMenuItems(items)
        setCategories([...new Set(items.map(i => i.category).filter(Boolean))].sort())
      } catch {
        // non-fatal
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function setField(key, value) {
    setForm(f => ({ ...f, [key]: value }))
    setFormError('')
  }

  function toggleItemId(id) {
    setForm(f => ({
      ...f,
      item_ids: f.item_ids.includes(id) ? f.item_ids.filter(x => x !== id) : [...f.item_ids, id]
    }))
    setFormError('')
  }

  async function handleSave() {
    setSaving(true)
    setFormError('')
    try {
      const payload = {
        name: form.name,
        scope: form.scope,
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
        start_date: form.start_date,
        end_date: form.end_date,
        ...(form.scope === 'category' ? { category: form.category } : {}),
        ...(form.scope === 'item' ? { item_ids: form.item_ids } : {})
      }
      const res = await api.post('/api/offers', payload)
      setOffers(prev => [res.data.data, ...prev])
      setShowForm(false)
      setForm(BLANK_FORM)
      showToast('Offer created')
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to save offer')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(offer) {
    try {
      const res = await api.patch(`/api/offers/${offer.id}`, { active: !offer.active })
      setOffers(prev => prev.map(o => o.id === offer.id ? res.data.data : o))
    } catch {
      showToast('Failed to update offer')
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this offer?')) return
    try {
      await api.delete(`/api/offers/${id}`)
      setOffers(prev => prev.filter(o => o.id !== id))
      showToast('Offer deleted')
    } catch {
      showToast('Failed to delete offer')
    }
  }

  function discountLabel(offer) {
    return offer.discount_type === 'percentage'
      ? `${offer.discount_value}% off`
      : `₹${offer.discount_value} off`
  }

  function scopeLabel(offer) {
    if (offer.scope === 'all') return 'Entire menu'
    if (offer.scope === 'category') return `Category: ${offer.category}`
    return `${offer.item_ids?.length || 0} item(s)`
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-gray-50">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/owner/home')} className="p-1 text-gray-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="flex-1 text-center font-semibold text-gray-900">Offers & Discounts</h2>
        <button
          onClick={() => { setShowForm(true); setForm(BLANK_FORM); setFormError('') }}
          className="text-sm font-semibold text-gray-900"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-8">
        {loading ? (
          <p className="text-center text-gray-400 text-sm mt-10">Loading...</p>
        ) : offers.length === 0 ? (
          <div className="text-center mt-16">
            <p className="text-gray-400 text-sm">No offers yet</p>
            <button
              onClick={() => { setShowForm(true); setForm(BLANK_FORM) }}
              className="mt-3 text-sm text-gray-900 font-semibold underline"
            >
              Create your first offer
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {offers.map(offer => {
              const status = offerStatus(offer)
              return (
                <div key={offer.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 text-sm">{offer.name}</p>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.color}`}>
                          {status.label}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 mt-1 font-medium">{discountLabel(offer)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{scopeLabel(offer)}</p>
                      <p className="text-xs text-gray-400 mt-1">{formatDate(offer.start_date)} – {formatDate(offer.end_date)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleToggle(offer)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${offer.active ? 'bg-gray-900' : 'bg-gray-300'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${offer.active ? 'left-5' : 'left-0.5'}`} />
                      </button>
                      <button onClick={() => handleDelete(offer.id)} className="text-gray-400 p-1">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create offer bottom sheet */}
      {showForm && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowForm(false)} />
          <div className="relative bg-white rounded-t-2xl px-4 pt-5 pb-8 max-h-[90vh] overflow-y-auto z-10">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-semibold text-gray-900">New Offer</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-lg leading-none">✕</button>
            </div>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Offer Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setField('name', e.target.value)}
                  placeholder="e.g. Weekend Special, Happy Hour"
                  className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-gray-900"
                />
              </div>

              {/* Scope */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Applies To</label>
                <div className="mt-1 flex gap-2 flex-wrap">
                  {[{ key: 'all', label: 'Entire Menu' }, { key: 'category', label: 'Category' }, { key: 'item', label: 'Specific Items' }].map(s => (
                    <button
                      key={s.key}
                      onClick={() => setField('scope', s.key)}
                      className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${form.scope === s.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category picker */}
              {form.scope === 'category' && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</label>
                  <select
                    value={form.category}
                    onChange={e => setField('category', e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-gray-900 bg-white"
                  >
                    <option value="">Select category</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}

              {/* Item multi-select */}
              {form.scope === 'item' && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Select Items</label>
                  <div className="mt-1 max-h-40 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-100">
                    {menuItems.map(item => (
                      <label key={item.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.item_ids.includes(item.id)}
                          onChange={() => toggleItemId(item.id)}
                          className="w-4 h-4 accent-gray-900"
                        />
                        <span className="text-sm text-gray-700 flex-1">{item.name}</span>
                        <span className="text-xs text-gray-400">₹{item.price}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Discount type + value */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Discount</label>
                <div className="mt-1 flex gap-2">
                  <div className="flex gap-1">
                    {[{ key: 'percentage', label: '%' }, { key: 'flat', label: '₹' }].map(dt => (
                      <button
                        key={dt.key}
                        onClick={() => setField('discount_type', dt.key)}
                        className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${form.discount_type === dt.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}
                      >
                        {dt.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.discount_value}
                    onChange={e => setField('discount_value', e.target.value)}
                    placeholder={form.discount_type === 'percentage' ? '0–100' : 'Amount'}
                    className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-gray-900"
                  />
                </div>
              </div>

              {/* Date range */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Start Date</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={e => setField('start_date', e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-gray-900"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">End Date</label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={e => setField('end_date', e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-gray-900"
                  />
                </div>
              </div>

              {formError && (
                <p className="text-red-600 text-sm">{formError}</p>
              )}

              <button
                onClick={handleSave}
                disabled={saving}
                className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-colors ${saving ? 'bg-gray-200 text-gray-400' : 'bg-gray-900 text-white active:bg-gray-700'}`}
              >
                {saving ? 'Saving...' : 'Create Offer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
