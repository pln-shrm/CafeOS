import { openDB } from 'idb'

const DB_NAME = 'cafeos'
const DB_VERSION = 1

export const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('pendingOrders')) {
      const store = db.createObjectStore('pendingOrders', { keyPath: 'localUuid' })
      store.createIndex('synced', 'synced')
    }
  }
})

export async function queueOrder(order) {
  const db = await dbPromise
  await db.add('pendingOrders', { ...order, synced: false })
}

export async function getPendingOrders() {
  const db = await dbPromise
  return db.getAllFromIndex('pendingOrders', 'synced', false)
}

export async function markOrderSynced(localUuid) {
  const db = await dbPromise
  const tx = db.transaction('pendingOrders', 'readwrite')
  const record = await tx.store.get(localUuid)
  if (record) {
    record.synced = true
    await tx.store.put(record)
  }
  await tx.done
}
