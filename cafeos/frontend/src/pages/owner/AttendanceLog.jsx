import { useEffect, useMemo, useState } from 'react'
import api from '../../lib/api'

const IST = 'Asia/Kolkata'

function toYmd(date) {
  return date.toLocaleDateString('en-CA', { timeZone: IST })
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('en-GB', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' })
}

function formatTime(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' })
}

export default function AttendanceLog() {
  const [records, setRecords] = useState([])
  const [staffList, setStaffList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [staffFilter, setStaffFilter] = useState('all')

  const defaultTo = useMemo(() => toYmd(new Date()), [])
  const defaultFrom = useMemo(() => {
    const date = new Date()
    date.setDate(date.getDate() - 30)
    return toYmd(date)
  }, [])

  const [fromDate, setFromDate] = useState(defaultFrom)
  const [toDate, setToDate] = useState(defaultTo)

  useEffect(() => {
    async function loadStaff() {
      try {
        const res = await api.get('/api/staff')
        setStaffList(res.data.data.staff || [])
      } catch {
        setStaffList([])
      }
    }
    loadStaff()
  }, [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        const params = { from: fromDate, to: toDate }
        if (staffFilter !== 'all') params.staff_id = staffFilter
        const res = await api.get('/api/attendance', { params })
        setRecords(res.data.data.records || [])
      } catch {
        setError('Unable to load attendance records.')
      } finally {
        setLoading(false)
      }
    }

    if (fromDate && toDate) {
      load()
    }
  }, [fromDate, toDate, staffFilter])

  return (
    <div className="flex flex-col flex-1 px-5 pt-6 pb-8 gap-4">
      <h1 className="text-2xl font-bold text-gray-900">Attendance</h1>

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Staff member</label>
          <select
            value={staffFilter}
            onChange={e => setStaffFilter(e.target.value)}
            className="mt-2 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
          >
            <option value="all">All staff</option>
            {staffList.map(member => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="mt-2 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">To</label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="mt-2 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      {loading && <p className="text-gray-400 text-sm">Loading attendance…</p>}

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <div className="grid grid-cols-5 gap-2 text-xs text-gray-400 mb-2">
          <span>Date</span>
          <span>Staff</span>
          <span>Check-in</span>
          <span>Late?</span>
          <span>Note</span>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          {records.map(record => (
            <div
              key={record.id}
              className={`grid grid-cols-5 gap-2 text-gray-700 ${record.late ? 'bg-amber-50 rounded-lg px-2 py-1' : ''}`}
            >
              <span>{formatDate(record.date)}</span>
              <span>{record.staff?.name || '-'}</span>
              <span className={record.check_in_time ? '' : 'text-gray-400'}>{formatTime(record.check_in_time)}</span>
              <span>{record.late ? 'Yes' : 'No'}</span>
              <span className={record.note ? '' : 'text-gray-400'}>{record.note || '-'}</span>
            </div>
          ))}
          {!loading && records.length === 0 && (
            <p className="text-gray-400 text-sm">No attendance records.</p>
          )}
        </div>
      </div>
    </div>
  )
}
