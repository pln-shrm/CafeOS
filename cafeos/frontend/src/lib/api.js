import axios from 'axios'
import { supabase } from './supabaseClient'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
})

api.interceptors.request.use(async (config) => {
  const staffToken = localStorage.getItem('cafeos_staff_token')
  if (staffToken) {
    config.headers.Authorization = `Bearer ${staffToken}`
    return config
  }
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('cafeos_staff_token')
      localStorage.removeItem('cafeos_staff_info')
      localStorage.removeItem('cafeos_login_timestamp')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
