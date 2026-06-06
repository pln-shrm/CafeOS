import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import api from '../../lib/api'

const DEFAULT_FORM = {
  name: '',
  price: '',
  category: '',
  is_perishable: true,
  active: true,
  seed_qty: 10
}

export default function MenuItemForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const location = useLocation()
  const navigate = useNavigate()

  const [form, setForm] = useState(DEFAULT_FORM)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState('')

  useEffect(() => {
    if (!isEdit) return
    const stateItem = location.state?.item
    if (stateItem) {
      setForm({
        name: stateItem.name || '',
        price: stateItem.price ?? '',
        category: stateItem.category || '',
        is_perishable: stateItem.is_perishable ?? true,
        active: stateItem.active ?? true,
        seed_qty: stateItem.seed_qty ?? 10
      })
      setLoading(false)
      return
    }

    async function load() {
      setLoading(true)
      try {
        const res = await api.get(`/api/menu/${id}`)
        const item = res.data.data
        setForm({
          name: item.name || '',
          price: item.price ?? '',
          category: item.category || '',
          is_perishable: item.is_perishable ?? true,
          active: item.active ?? true,
          seed_qty: item.seed_qty ?? 10
        })
      } catch {
        setError('Unable to load item.')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [id, isEdit, location.state])

  function updateField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function validate() {
    if (!form.name.trim()) return 'Name is required.'
    if (form.price === '' || Number(form.price) <= 0) return 'Price must be a positive number.'
    return ''
  }

  async function handleSave() {
    const validationError = validate()
    if (validationError) {
      setFieldError(validationError)
      return
    }

    setSaving(true)
    setError('')
    setFieldError('')
    try {
      const payload = {
        name: form.name.trim(),
        price: Number(form.price),
        category: form.category.trim() || null,
        is_perishable: Boolean(form.is_perishable),
        seed_qty: Number(form.seed_qty),
        active: Boolean(form.active)
      }

      if (isEdit) {
        await api.put(`/api/menu/${id}`, payload)
        navigate('/owner/menu', { state: { toast: 'Item updated.' } })
      } else {
        await api.post('/api/menu', payload)
        navigate('/owner/menu', { state: { toast: 'Item added.' } })
      }
    } catch (err) {
      const code = err.response?.data?.error?.code
      if (code === 'DUPLICATE_NAME') {
        setFieldError('An item with this name already exists.')
      } else {
        setError("Couldn't save — try again.")
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate() {
    if (!form.active) return
    const confirmed = window.confirm(`Deactivate ${form.name}? It will disappear from the staff menu.`)
    if (!confirmed) return

    try {
      await api.patch(`/api/menu/${id}/deactivate`)
      navigate('/owner/menu', { state: { toast: 'Item deactivated.' } })
    } catch {
      setError('Could not deactivate item.')
    }
  }

  return (
    <div className="flex flex-col flex-1 px-5 pt-6 pb-10 gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Item' : 'Add Item'}</h1>
        <p className="text-gray-500 text-sm mt-1">{isEdit ? 'Update details for this menu item.' : 'Create a new menu item.'}</p>
      </div>

      {loading && <p className="text-gray-400 text-sm">Loading…</p>}

      {!loading && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Item name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => updateField('name', e.target.value)}
              className="mt-2 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Price ₹</label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.price}
              onChange={e => updateField('price', e.target.value)}
              className="mt-2 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Category</label>
            <input
              type="text"
              value={form.category}
              onChange={e => updateField('category', e.target.value)}
              placeholder="e.g. Mains, Drinks, Snacks"
              className="mt-2 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Is Perishable?</p>
              <p className="text-xs text-gray-400">Used for prediction adjustments.</p>
            </div>
            <button
              onClick={() => updateField('is_perishable', !form.is_perishable)}
              className={`w-12 h-6 rounded-full flex items-center transition-colors ${
                form.is_perishable ? 'bg-green-500 justify-end' : 'bg-gray-300 justify-start'
              }`}
            >
              <span className="w-5 h-5 bg-white rounded-full shadow-sm" />
            </button>
          </div>

          {isEdit && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Active?</p>
                <p className="text-xs text-gray-400">Inactive items hide from staff.</p>
              </div>
              <button
                onClick={() => updateField('active', !form.active)}
                className={`w-12 h-6 rounded-full flex items-center transition-colors ${
                  form.active ? 'bg-green-500 justify-end' : 'bg-gray-300 justify-start'
                }`}
              >
                <span className="w-5 h-5 bg-white rounded-full shadow-sm" />
              </button>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Starting prep quantity</label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.seed_qty}
              onChange={e => updateField('seed_qty', e.target.value)}
              className="mt-2 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
            />
          </div>

          {fieldError && <p className="text-sm text-red-500">{fieldError}</p>}
          {error && <p className="text-sm text-amber-600">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>

          {isEdit && form.active && (
            <button
              onClick={handleDeactivate}
              className="w-full py-3 rounded-xl border border-red-200 text-red-600 text-sm font-semibold"
            >
              Deactivate Item
            </button>
          )}
        </div>
      )}
    </div>
  )
}
