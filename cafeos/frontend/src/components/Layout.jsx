import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getPendingOrders } from '../lib/db'

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    async function refreshPending() {
      try {
        const pending = await getPendingOrders()
        setPendingCount(pending.length)
      } catch {
        setPendingCount(0)
      }
    }

    refreshPending()

    const handleOnline = () => { setIsOnline(true); refreshPending() }
    const handleOffline = () => { setIsOnline(false); refreshPending() }
    const handleQueued = () => refreshPending()

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('cafeos:order-queued', handleQueued)
    window.addEventListener('cafeos:orders-synced', handleQueued)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('cafeos:order-queued', handleQueued)
      window.removeEventListener('cafeos:orders-synced', handleQueued)
    }
  }, [])

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <span className="text-lg font-bold text-gray-900">CafeOS</span>
        <span className="text-sm font-medium text-gray-600">{user?.name || ''}</span>
        <button
          onClick={handleLogout}
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 active:bg-gray-200"
          aria-label="Logout"
        >
          {/* Logout icon */}
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1" />
          </svg>
        </button>
      </header>

      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-amber-400 text-amber-900 text-sm font-medium px-4 py-2 text-center">
          No internet — {pendingCount} order{pendingCount !== 1 ? 's' : ''} queued
        </div>
      )}

      {/* Page content */}
      <main className="flex-1 flex flex-col">
        {children}
      </main>
    </div>
  )
}
