import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import api from '../../lib/api'

export default function MenuManagement() {
  const navigate = useNavigate()
  const location = useLocation()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('Active')
  const [toast, setToast] = useState(location.state?.toast || '')

  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(''), 2500)
      return () => clearTimeout(id)
    }
  }, [toast])

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        const res = await api.get('/api/menu', { params: { include_inactive: true } })
        setItems(res.data.data.items || [])
      } catch {
        setError('Menu could not load. Try again.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const categories = useMemo(() => {
    const unique = new Set()
    for (const item of items) {
      if (item.category) unique.add(item.category)
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b))
  }, [items])

  const tabs = useMemo(() => ['All', 'Active', 'Inactive', ...categories], [categories])

  const filteredItems = useMemo(() => {
    if (activeTab === 'All') return items
    if (activeTab === 'Active') return items.filter(item => item.active)
    if (activeTab === 'Inactive') return items.filter(item => !item.active)
    return items.filter(item => item.category === activeTab)
  }, [items, activeTab])

  async function handleToggle(item) {
    const nextActive = !item.active
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, active: nextActive } : i)))

    try {
      if (!nextActive) {
        await api.patch(`/api/menu/${item.id}/deactivate`)
      } else {
        await api.put(`/api/menu/${item.id}`, { active: true })
      }
    } catch {
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, active: item.active } : i)))
      setError('Could not update item status.')
    }
  }

  return (
    <div className="flex flex-col flex-1 px-5 pt-6 pb-8 gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Menu</h1>
        <button
          onClick={() => navigate('/owner/menu/new')}
          className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold"
        >
          Add Item
        </button>
      </div>

      {toast && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
          {toast}
        </div>
      )}

      {error && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-2">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors whitespace-nowrap ${
              activeTab === tab
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-700 border-gray-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading && <p className="text-gray-400 text-sm">Loading menu…</p>}

      {!loading && filteredItems.length === 0 && (
        <p className="text-gray-400 text-sm">No items in this view.</p>
      )}

      <div className="flex flex-col gap-3">
        {filteredItems.map(item => (
          <div
            key={item.id}
            className={`bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center justify-between gap-3 ${
              item.active ? '' : 'opacity-50'
            }`}
          >
            <div className="flex-1">
              <p className="font-semibold text-gray-900 text-sm">{item.name}</p>
              <p className="text-xs text-gray-400">{item.category || 'Uncategorized'} · ₹{item.price}</p>
            </div>
            <button
              onClick={() => handleToggle(item)}
              className={`w-12 h-6 rounded-full flex items-center transition-colors ${
                item.active ? 'bg-green-500 justify-end' : 'bg-gray-300 justify-start'
              }`}
            >
              <span className="w-5 h-5 bg-white rounded-full shadow-sm" />
            </button>
            <button
              onClick={() => navigate(`/owner/menu/${item.id}/edit`, { state: { item } })}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700"
            >
              Edit
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
