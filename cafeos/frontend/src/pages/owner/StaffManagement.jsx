import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import api from '../../lib/api'

const IST = 'Asia/Kolkata'

function formatDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('en-GB', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' })
}

export default function StaffManagement() {
  const navigate = useNavigate()
  const location = useLocation()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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
        const res = await api.get('/api/staff')
        setStaff(res.data.data.staff || [])
      } catch {
        setError('Unable to load staff list.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div className="flex flex-col flex-1 px-5 pt-6 pb-8 gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Staff</h1>
        <button
          onClick={() => navigate('/owner/staff/new')}
          className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold"
        >
          Add Staff
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

      {loading && <p className="text-gray-400 text-sm">Loading staff…</p>}

      <div className="flex flex-col gap-3">
        {staff.map(member => (
          <div key={member.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center justify-between gap-3">
            <div className="flex-1">
              <p className="font-semibold text-gray-900 text-sm">{member.name}</p>
              <p className="text-xs text-gray-400">{member.role || 'Role not set'}</p>
              <p className="text-xs text-gray-400 mt-1">Last check-in: {formatDate(member.last_check_in_date)}</p>
            </div>
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
              member.active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
            }`}>
              {member.active ? 'Active' : 'Inactive'}
            </span>
            <button
              onClick={() => navigate(`/owner/staff/${member.id}/edit`, { state: { staff: member } })}
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
