import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import api from '../../lib/api'

const DEFAULT_FORM = {
  name: '',
  pin: '',
  role: '',
  daily_wage: '',
  active: true
}

export default function StaffForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const location = useLocation()

  const [form, setForm] = useState(DEFAULT_FORM)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [showPin, setShowPin] = useState(false)

  useEffect(() => {
    if (!isEdit) return
    const stateStaff = location.state?.staff
    if (stateStaff) {
      setForm(prev => ({
        ...prev,
        name: stateStaff.name || '',
        role: stateStaff.role || '',
        daily_wage: stateStaff.daily_wage ?? '',
        active: stateStaff.active ?? true
      }))
      setLoading(false)
      return
    }

    async function load() {
      setLoading(true)
      try {
        const res = await api.get(`/api/staff/${id}`)
        const staff = res.data.data
        setForm(prev => ({
          ...prev,
          name: staff.name || '',
          role: staff.role || '',
          daily_wage: staff.daily_wage ?? '',
          active: staff.active ?? true
        }))
      } catch {
        setError('Unable to load staff member.')
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
    if (!isEdit || form.pin.length > 0) {
      if (!/^\d{4}$/.test(form.pin)) return 'PIN must be exactly 4 numeric digits.'
    }
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
        role: form.role.trim() || null,
        daily_wage: form.daily_wage !== '' ? Number(form.daily_wage) : null,
        active: isEdit ? Boolean(form.active) : true
      }

      if (form.pin.length > 0) {
        payload.pin = form.pin
      }

      if (isEdit) {
        await api.put(`/api/staff/${id}`, payload)
        navigate('/owner/staff', { state: { toast: 'Staff updated.' } })
      } else {
        await api.post('/api/staff', payload)
        navigate('/owner/staff', { state: { toast: 'Staff added.' } })
      }
    } catch (err) {
      const code = err.response?.data?.error?.code
      if (code === 'DUPLICATE_PIN') {
        setFieldError('This PIN is already in use. Choose another.')
      } else {
        setError("Couldn't save — try again.")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 px-5 pt-6 pb-10 gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Staff' : 'Add Staff'}</h1>
        <p className="text-gray-500 text-sm mt-1">{isEdit ? 'Update staff details.' : 'Create a new staff profile.'}</p>
      </div>

      {loading && <p className="text-gray-400 text-sm">Loading…</p>}

      {!loading && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">First name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => updateField('name', e.target.value)}
              className="mt-2 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">PIN (4 digits)</label>
            <div className="mt-2 flex items-center gap-2">
              <input
                type={showPin ? 'text' : 'password'}
                value={form.pin}
                onChange={e => updateField('pin', e.target.value)}
                placeholder={isEdit ? 'Enter new PIN to change' : ''}
                className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
              />
              <button
                onClick={() => setShowPin(v => !v)}
                className="px-3 py-3 rounded-xl border border-gray-200 text-sm text-gray-600"
                type="button"
              >
                {showPin ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Role</label>
            <input
              type="text"
              value={form.role}
              onChange={e => updateField('role', e.target.value)}
              placeholder="e.g. Counter Staff, Kitchen"
              className="mt-2 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Daily wage ₹</label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.daily_wage}
              onChange={e => updateField('daily_wage', e.target.value)}
              className="mt-2 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
            />
          </div>

          {isEdit && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Active?</p>
                <p className="text-xs text-gray-400">Inactive staff cannot log in.</p>
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

          {fieldError && <p className="text-sm text-red-500">{fieldError}</p>}
          {error && <p className="text-sm text-amber-600">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}
