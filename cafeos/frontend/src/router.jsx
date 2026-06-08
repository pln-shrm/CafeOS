import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Layout from './components/Layout'

import LoginPage from './pages/LoginPage'
import StaffHome from './pages/StaffHome'
import OrderBuilder from './pages/OrderBuilder'
import BillPreview from './pages/BillPreview'
import EBill from './pages/EBill'
import OwnerHome from './pages/OwnerHome'
import MenuManagement from './pages/owner/MenuManagement'
import MenuItemForm from './pages/owner/MenuItemForm'
import StaffManagement from './pages/owner/StaffManagement'
import StaffForm from './pages/owner/StaffForm'
import Reports from './pages/owner/Reports'
import AttendanceLog from './pages/owner/AttendanceLog'
import Inventory from './pages/owner/Inventory'
import VendorCredit from './pages/owner/VendorCredit'

function ProtectedRoute({ children, requireOwner = false }) {
  const { isAuthenticated, isStaff, isOwner, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading session…</p>
      </div>
    )
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (requireOwner && !isOwner) return <Navigate to="/staff/home" replace />

  return <Layout>{children}</Layout>
}

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: '/staff/home',
    element: (
      <ProtectedRoute>
        <StaffHome />
      </ProtectedRoute>
    )
  },
  {
    path: '/staff/order/new',
    element: (
      <ProtectedRoute>
        <OrderBuilder />
      </ProtectedRoute>
    )
  },
  {
    path: '/staff/order/new/bill',
    element: (
      <ProtectedRoute>
        <BillPreview />
      </ProtectedRoute>
    )
  },
  {
    path: '/staff/order/:id/ebill',
    element: (
      <ProtectedRoute>
        <EBill />
      </ProtectedRoute>
    )
  },
  {
    path: '/owner/home',
    element: (
      <ProtectedRoute requireOwner>
        <OwnerHome />
      </ProtectedRoute>
    )
  },
  {
    path: '/owner/menu',
    element: (
      <ProtectedRoute requireOwner>
        <MenuManagement />
      </ProtectedRoute>
    )
  },
  {
    path: '/owner/menu/new',
    element: (
      <ProtectedRoute requireOwner>
        <MenuItemForm />
      </ProtectedRoute>
    )
  },
  {
    path: '/owner/menu/:id/edit',
    element: (
      <ProtectedRoute requireOwner>
        <MenuItemForm />
      </ProtectedRoute>
    )
  },
  {
    path: '/owner/staff',
    element: (
      <ProtectedRoute requireOwner>
        <StaffManagement />
      </ProtectedRoute>
    )
  },
  {
    path: '/owner/staff/new',
    element: (
      <ProtectedRoute requireOwner>
        <StaffForm />
      </ProtectedRoute>
    )
  },
  {
    path: '/owner/staff/:id/edit',
    element: (
      <ProtectedRoute requireOwner>
        <StaffForm />
      </ProtectedRoute>
    )
  },
  {
    path: '/owner/reports',
    element: (
      <ProtectedRoute requireOwner>
        <Reports />
      </ProtectedRoute>
    )
  },
  {
    path: '/owner/attendance',
    element: (
      <ProtectedRoute requireOwner>
        <AttendanceLog />
      </ProtectedRoute>
    )
  },
  {
    path: '/owner/inventory',
    element: (
      <ProtectedRoute requireOwner>
        <Inventory />
      </ProtectedRoute>
    )
  },
  {
    path: '/owner/credit',
    element: (
      <ProtectedRoute requireOwner>
        <VendorCredit />
      </ProtectedRoute>
    )
  },
  {
    path: '*',
    element: <Navigate to="/login" replace />
  }
])

export default router
