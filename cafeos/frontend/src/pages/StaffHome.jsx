import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function formatDateIST() {
  const now = new Date()
  const weekday = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long' })
  const day = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric' })
  const month = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', month: 'short' })
  return `${weekday}, ${day} ${month}`
}

export default function StaffHome() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [attendance, setAttendance] = useState(null) // null = loading, false = none, object = record
  const [checkingIn, setCheckingIn] = useState(false)
  const [orderCount, setOrderCount] = useState(0)
  const [showLateModal, setShowLateModal] = useState(false)
  const [lateNote, setLateNote] = useState('')
  const [lateRecord, setLateRecord] = useState(null)
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    async function load() {
      const today = todayIST()
      try {
        const [attRes, summaryRes] = await Promise.all([
          api.get('/api/attendance', { params: { staff_id: user.id, from: today, to: today } }),
          api.get('/api/billing/summary', { params: { date: today } })
        ])
        const records = attRes.data.data.records || []
        setAttendance(records.length > 0 ? records[0] : false)
        setOrderCount(summaryRes.data.data.total_orders || 0)
      } catch {
        setAttendance(false)
      }
    }
    load()
  }, [user?.id])

  async function handleCheckIn() {
    setCheckingIn(true)
    try {
      const res = await api.post('/api/attendance/checkin', {})
      const record = res.data.data
      setAttendance(record)
      if (record.late) {
        setLateRecord(record)
        setShowLateModal(true)
      }
    } catch (err) {
      const code = err.response?.data?.error?.code
      if (code === 'ALREADY_CHECKED_IN') {
        // refresh to get the record
        const today = todayIST()
        const attRes = await api.get('/api/attendance', { params: { staff_id: user.id, from: today, to: today } })
        const records = attRes.data.data.records || []
        setAttendance(records.length > 0 ? records[0] : false)
      }
    } finally {
      setCheckingIn(false)
    }
  }

  async function handleSaveNote() {
    if (!lateRecord) return
    setSavingNote(true)
    try {
      await api.patch(`/api/attendance/${lateRecord.id}`, { note: lateNote })
    } catch { /* silently ignore */ }
    setSavingNote(false)
    setShowLateModal(false)
  }

  function formatCheckInTime(record) {
    if (!record?.check_in_time_ist) {
      // fallback: format from check_in_time UTC
      if (!record?.check_in_time) return ''
      const d = new Date(record.check_in_time)
      return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })
    }
    return record.check_in_time_ist
  }

  return (
    <div className="flex flex-col flex-1 px-5 pt-6 pb-8 gap-5">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Hey {user?.name} 👋</h1>
        <p className="text-gray-500 text-sm mt-1">{formatDateIST()}</p>
      </div>

      {/* Attendance section */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Attendance</h2>

        {attendance === null && (
          <p className="text-gray-400 text-sm">Loading…</p>
        )}

        {attendance === false && (
          <button
            onClick={handleCheckIn}
            disabled={checkingIn}
            className="w-full py-4 rounded-xl bg-green-500 text-white font-semibold text-base active:bg-green-600 disabled:opacity-60 transition-colors"
          >
            {checkingIn ? 'Checking in…' : 'Check In'}
          </button>
        )}

        {attendance && attendance !== null && (
          <div className={`flex items-center gap-2 ${attendance.late ? 'text-amber-600' : 'text-green-600'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium text-sm">
              Checked in at {formatCheckInTime(attendance)}
              {attendance.late ? ' — Late' : ' ✓'}
            </span>
          </div>
        )}
      </div>

      {/* Today's stats */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Today</h2>
        <p className="text-gray-800 text-sm">Your orders today: <span className="font-bold text-gray-900">{orderCount}</span></p>
      </div>

      {/* New Order & My Orders — primary CTAs */}
      <div className="mt-auto flex flex-col gap-3">
        <button
          onClick={() => navigate('/staff/order/new')}
          className="w-full py-5 rounded-2xl bg-gray-900 text-white text-lg font-bold active:bg-gray-700 transition-colors"
        >
          New Order
        </button>
        <button
          onClick={() => navigate('/staff/orders')}
          className="w-full py-5 rounded-2xl bg-white border-2 border-gray-900 text-gray-900 text-lg font-bold active:bg-gray-100 transition-colors"
        >
          My Orders
        </button>
      </div>

      {/* Late check-in modal */}
      {showLateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-end z-50" onClick={() => setShowLateModal(false)}>
          <div
            className="bg-white w-full rounded-t-3xl p-6 pb-10"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 mb-1">You're a bit late today</h3>
            <p className="text-gray-500 text-sm mb-4">Add a reason? (optional)</p>
            <textarea
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400 resize-none"
              rows={3}
              placeholder="E.g. Traffic, doctor's appointment…"
              value={lateNote}
              onChange={e => setLateNote(e.target.value)}
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowLateModal(false)}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-600 font-medium text-sm"
              >
                Skip
              </button>
              <button
                onClick={handleSaveNote}
                disabled={savingNote}
                className="flex-1 py-3 rounded-xl bg-gray-900 text-white font-medium text-sm disabled:opacity-60"
              >
                {savingNote ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
