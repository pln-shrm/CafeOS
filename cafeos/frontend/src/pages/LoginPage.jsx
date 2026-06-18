import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { supabase } from '../lib/supabaseClient'

const STAFF_TOKEN_KEY = 'cafeos_staff_token'
const STAFF_INFO_KEY = 'cafeos_staff_info'
const LOGIN_TS_KEY = 'cafeos_login_timestamp'

export default function LoginPage() {
  const navigate = useNavigate()
  const [staffList, setStaffList] = useState([])
  const [loadingStaff, setLoadingStaff] = useState(true)
  const [staffLoadError, setStaffLoadError] = useState('')
  const [selectedStaff, setSelectedStaff] = useState(null)
  const [pin, setPin] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showOwnerLogin, setShowOwnerLogin] = useState(false)
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [ownerError, setOwnerError] = useState('')
  const [ownerLoading, setOwnerLoading] = useState(false)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    async function loadStaff() {
      setLoadingStaff(true)
      try {
        const res = await api.get('/api/staff/public')
        setStaffList(res.data.data.staff || [])
      } catch (err) {
        setStaffLoadError(`Error: ${err.message} | URL: ${import.meta.env.VITE_API_BASE_URL || 'localhost'}`)
      } finally {
        setLoadingStaff(false)
      }
    }
    loadStaff()
  }, [])

  function handleDigit(d) {
    if (pin.length < 4) {
      setPin(p => p + d)
      setLoginError('')
    }
  }

  function handleBackspace() {
    setPin(p => p.slice(0, -1))
    setLoginError('')
  }

  async function handleStaffLogin() {
    if (!selectedStaff || pin.length !== 4 || !isOnline) return
    setLoading(true)
    setLoginError('')
    try {
      await supabase.auth.signOut() // Sign out of any active owner session
      const res = await api.post('/api/auth/staff/login', {
        staff_id: selectedStaff.id,
        pin
      })
      const { token, staff } = res.data.data
      localStorage.setItem(STAFF_TOKEN_KEY, token)
      localStorage.setItem(STAFF_INFO_KEY, JSON.stringify(staff))
      localStorage.setItem(LOGIN_TS_KEY, String(Date.now()))
      navigate('/staff/home', { replace: true })
    } catch (err) {
      const code = err.response?.data?.error?.code
      setLoginError(code === 'INVALID_PIN' ? 'Wrong PIN. Try again.' : 'Login failed. Try again.')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  async function handleOwnerLogin(e) {
    e.preventDefault()
    setOwnerLoading(true)
    setOwnerError('')
    try {
      localStorage.removeItem(STAFF_TOKEN_KEY)
      localStorage.removeItem(STAFF_INFO_KEY)
      localStorage.removeItem(LOGIN_TS_KEY)
      const { error } = await supabase.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword })
      if (error) throw error
      navigate('/owner/home', { replace: true })
    } catch {
      setOwnerError('Wrong email or password.')
    } finally {
      setOwnerLoading(false)
    }
  }

  const loginDisabled = !selectedStaff || pin.length !== 4 || loading || !isOnline

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-10">
      {/* App header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-900">{import.meta.env.VITE_CAFE_NAME || 'BistroBot21'}</h1>
        <p className="text-gray-500 mt-1">{import.meta.env.VITE_CAFE_SUBTITLE || ''}</p>
      </div>

      {/* Login card container */}
      <div className="w-full max-w-sm">
        {!showOwnerLogin ? (
          /* Staff Login Section */
          <>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Staff Login</h2>

            {/* Staff name selector */}
            {staffLoadError ? (
              <p className="text-amber-600 text-sm mb-4">{staffLoadError}</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-2 mb-5 -mx-1 px-1">
                {loadingStaff ? (
                  <p className="text-gray-400 text-sm">Loading staff…</p>
                ) : staffList.length === 0 ? (
                  <p className="text-gray-400 text-sm">No active staff profiles. Owner login can add staff.</p>
                ) : (
                  staffList.map(s => (
                    <button
                      key={s.id}
                      onClick={() => { setSelectedStaff(s); setPin(''); setLoginError('') }}
                      className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                        selectedStaff?.id === s.id
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-700 border-gray-300'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))
                )}
              </div>
            )}

            {/* PIN dots */}
            <div className="flex justify-center gap-4 mb-5">
              {[0, 1, 2, 3].map(i => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full transition-colors ${
                    i < pin.length ? 'bg-gray-900' : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>

            {/* PIN pad */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                <button
                  key={d}
                  onClick={() => handleDigit(String(d))}
                  className="h-16 rounded-2xl bg-gray-100 text-xl font-semibold text-gray-800 active:bg-gray-200 transition-colors"
                >
                  {d}
                </button>
              ))}
              {/* Bottom row: backspace, 0, empty */}
              <button
                onClick={handleBackspace}
                className="h-16 rounded-2xl bg-gray-100 text-xl font-semibold text-gray-800 active:bg-gray-200 transition-colors flex items-center justify-center"
              >
                ⌫
              </button>
              <button
                onClick={() => handleDigit('0')}
                className="h-16 rounded-2xl bg-gray-100 text-xl font-semibold text-gray-800 active:bg-gray-200 transition-colors"
              >
                0
              </button>
              <div /> {/* empty cell */}
            </div>

            {/* Login error */}
            {loginError && (
              <p className="text-red-500 text-sm text-center mb-3">{loginError}</p>
            )}

            {/* Offline notice */}
            {!isOnline && (
              <p className="text-amber-600 text-sm text-center mb-3">No internet — can't log in.</p>
            )}

            {/* Login button */}
            <button
              onClick={handleStaffLogin}
              disabled={loginDisabled}
              className={`w-full py-4 rounded-2xl text-base font-semibold transition-colors ${
                loginDisabled
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-900 text-white active:bg-gray-700'
              }`}
            >
              {loading ? 'Logging in…' : 'Login'}
            </button>
          </>
        ) : (
          /* Owner Login Section */
          <>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Owner Login</h2>
            <form onSubmit={handleOwnerLogin} className="space-y-4">
              <div className="flex flex-col gap-1">
                <input
                  type="email"
                  placeholder="Email"
                  value={ownerEmail}
                  onChange={e => setOwnerEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-sm outline-none focus:border-gray-600 transition-colors"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <input
                  type="password"
                  placeholder="Password"
                  value={ownerPassword}
                  onChange={e => setOwnerPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-sm outline-none focus:border-gray-600 transition-colors"
                  required
                />
              </div>

              {ownerError && (
                <p className="text-red-500 text-sm text-center">{ownerError}</p>
              )}

              <button
                type="submit"
                disabled={ownerLoading}
                className="w-full py-4 rounded-2xl bg-gray-900 text-white text-base font-semibold hover:bg-gray-800 active:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {ownerLoading ? 'Logging in…' : 'Owner Login'}
              </button>
            </form>
          </>
        )}

        {/* Toggle between Staff and Owner login forms */}
        <div className="mt-8 text-center">
          <button
            onClick={() => {
              setShowOwnerLogin(v => !v)
              setOwnerError('')
              setLoginError('')
              setPin('')
            }}
            className="text-sm text-gray-400 underline font-medium hover:text-gray-600 transition-colors"
          >
            {showOwnerLogin ? 'Staff? Login here' : 'Owner? Login here'}
          </button>
        </div>
      </div>
    </div>
  )
}
