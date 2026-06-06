import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import router from './router'
import api from './lib/api'
import { getPendingOrders, markOrderSynced } from './lib/db'

async function triggerSync() {
  try {
    const pending = await getPendingOrders()
    if (pending.length === 0) return

    const orders = pending.map(o => ({
      local_uuid: o.localUuid,
      order_type: o.order_type,
      payment_method: o.payment_method,
      items: o.items
    }))

    const res = await api.post('/api/orders/sync', { orders })
    const { synced } = res.data.data

    if (synced > 0) {
      for (const order of pending) {
        await markOrderSynced(order.localUuid)
      }
      window.dispatchEvent(new Event('cafeos:orders-synced'))
    }
  } catch {
    // Sync will retry on next online event
  }
}

export default function App() {
  useEffect(() => {
    // Attempt sync on startup if online
    if (navigator.onLine) triggerSync()

    window.addEventListener('online', triggerSync)
    return () => window.removeEventListener('online', triggerSync)
  }, [])

  return <RouterProvider router={router} />
}
