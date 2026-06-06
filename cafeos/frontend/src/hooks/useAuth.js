import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

const STAFF_TOKEN_KEY = 'cafeos_staff_token'
const STAFF_INFO_KEY = 'cafeos_staff_info'
const LOGIN_TS_KEY = 'cafeos_login_timestamp'

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function clearStaffStorage() {
  localStorage.removeItem(STAFF_TOKEN_KEY)
  localStorage.removeItem(STAFF_INFO_KEY)
  localStorage.removeItem(LOGIN_TS_KEY)
}

export function useAuth() {
  const [state, setState] = useState(() => computeState())

  function computeState() {
    const token = localStorage.getItem(STAFF_TOKEN_KEY)
    const infoRaw = localStorage.getItem(STAFF_INFO_KEY)
    const loginTs = localStorage.getItem(LOGIN_TS_KEY)

    if (token && infoRaw && loginTs) {
      // Expire at midnight IST
      const loginDay = new Date(parseInt(loginTs)).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      if (loginDay !== todayIST()) {
        clearStaffStorage()
        return { isStaff: false, isOwner: false, isAuthenticated: false, user: null }
      }
      try {
        const info = JSON.parse(infoRaw)
        return { isStaff: true, isOwner: false, isAuthenticated: true, user: info }
      } catch {
        clearStaffStorage()
      }
    }

    return { isStaff: false, isOwner: false, isAuthenticated: false, user: null }
  }

  // Check for Supabase owner session on mount and auth changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setState(prev => ({
          ...prev,
          isOwner: true,
          isAuthenticated: true,
          user: { id: session.user.id, name: session.user.email, role: 'owner' }
        }))
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setState(prev => ({
          ...prev,
          isOwner: true,
          isAuthenticated: true,
          user: { id: session.user.id, name: session.user.email, role: 'owner' }
        }))
      } else if (!localStorage.getItem(STAFF_TOKEN_KEY)) {
        setState({ isStaff: false, isOwner: false, isAuthenticated: false, user: null })
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const logout = useCallback(async () => {
    clearStaffStorage()
    await supabase.auth.signOut()
    setState({ isStaff: false, isOwner: false, isAuthenticated: false, user: null })
  }, [])

  return { ...state, logout }
}
