import { createBrowserRouter, Navigate } from 'react-router-dom'
import StaffLogin from './pages/StaffLogin'
import OwnerLogin from './pages/OwnerLogin'
import StaffOrders from './pages/StaffOrders'
import OwnerDashboard from './pages/OwnerDashboard'
import NotFound from './pages/NotFound'

function RequireStaffAuth({ children }) {
  const session = localStorage.getItem('staffSession')
  return session ? children : <Navigate to="/login" replace />
}

function RequireOwnerAuth({ children }) {
  const session = localStorage.getItem('ownerSession')
  return session ? children : <Navigate to="/owner/login" replace />
}

const router = createBrowserRouter([
  { path: '/login', element: <StaffLogin /> },
  { path: '/owner/login', element: <OwnerLogin /> },
  {
    path: '/orders',
    element: (
      <RequireStaffAuth>
        <StaffOrders />
      </RequireStaffAuth>
    )
  },
  {
    path: '/owner',
    element: (
      <RequireOwnerAuth>
        <OwnerDashboard />
      </RequireOwnerAuth>
    )
  },
  { path: '*', element: <NotFound /> }
])

export default router
