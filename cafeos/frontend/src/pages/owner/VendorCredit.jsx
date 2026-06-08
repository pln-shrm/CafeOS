import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../lib/api'

const IST = 'Asia/Kolkata'

function formatCurrency(val) {
  if (val === undefined || val === null || isNaN(Number(val))) return '₹0'
  return `₹${Number(val).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function formatShortDateTime(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: IST
  })
}

export default function VendorCredit() {
  const navigate = useNavigate()
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Contacts List
  const [contacts, setContacts] = useState([])

  // Modal / View Controls
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [ledgerEntries, setLedgerEntries] = useState([])
  const [loadingLedger, setLoadingLedger] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [showContactModal, setShowContactModal] = useState(false)

  // Log Transaction Form State
  const [txVendor, setTxVendor] = useState('')
  const [txType, setTxType] = useState('credit')
  const [txAmount, setTxAmount] = useState('')
  const [txDescription, setTxDescription] = useState('')
  const [submittingTx, setSubmittingTx] = useState(false)

  // Add Contact Form State
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactNotes, setContactNotes] = useState('')
  const [submittingContact, setSubmittingContact] = useState(false)

  const loadBalances = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/api/credit/balances')
      setVendors(res.data.data.vendors || [])
    } catch (err) {
      setError('Could not load vendor balances.')
    } finally {
      setLoading(false)
    }
  }

  const loadContacts = async () => {
    try {
      const res = await api.get('/api/vendor/contacts')
      setContacts(res.data.data.vendors || [])
    } catch (err) {
      console.warn('Failed to load contacts', err)
    }
  }

  useEffect(() => {
    loadBalances()
    loadContacts()
  }, [])

  const totalOutstanding = useMemo(() => {
    return vendors.reduce((sum, v) => sum + (v.outstanding || 0), 0)
  }, [vendors])

  const handleOpenLedger = async (vendorName) => {
    setSelectedVendor(vendorName)
    setLoadingLedger(true)
    try {
      const res = await api.get('/api/credit', { params: { vendor_name: vendorName, limit: 100 } })
      setLedgerEntries(res.data.data.entries || [])
    } catch (err) {
      alert('Could not load ledger entries.')
    } finally {
      setLoadingLedger(false)
    }
  }

  const handleSettleQuick = async (vendorName, outstanding) => {
    if (outstanding <= 0) return
    const confirmSettle = window.confirm(`Confirm logging a payment of ${formatCurrency(outstanding)} to settle balance with ${vendorName}?`)
    if (!confirmSettle) return

    try {
      await api.post('/api/credit', {
        vendor_name: vendorName,
        type: 'payment',
        amount: outstanding,
        item_description: 'Full settlement'
      })
      await loadBalances()
      if (selectedVendor === vendorName) {
        handleOpenLedger(vendorName)
      }
    } catch (err) {
      alert('Failed to settle balance.')
    }
  }

  const handleSaveTransaction = async (e) => {
    e.preventDefault()
    const amount = Number(txAmount)
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount.')
      return
    }

    setSubmittingTx(true)
    try {
      await api.post('/api/credit', {
        vendor_name: txVendor,
        type: txType,
        amount,
        item_description: txDescription
      })

      // Reset
      setTxVendor('')
      setTxAmount('')
      setTxDescription('')
      setShowLogModal(false)

      // Reload
      await loadBalances()
      await loadContacts()
      if (selectedVendor) {
        await handleOpenLedger(selectedVendor)
      }
    } catch (err) {
      alert('Failed to log credit ledger entry.')
    } finally {
      setSubmittingTx(false)
    }
  }

  const handleSaveContact = async (e) => {
    e.preventDefault()
    if (!contactName.trim()) return

    setSubmittingContact(true)
    try {
      await api.post('/api/vendor/contacts', {
        name: contactName,
        whatsapp_number: contactPhone,
        notes: contactNotes
      })

      setContactName('')
      setContactPhone('')
      setContactNotes('')
      setShowContactModal(false)

      await loadContacts()
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to create vendor contact.')
    } finally {
      setSubmittingContact(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 px-5 pt-6 pb-8 gap-5 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/owner/home')}
          className="w-10 h-10 rounded-xl bg-white border border-gray-100 flex items-center justify-center shadow-sm text-gray-600 active:bg-gray-100 transition-colors"
        >
          ←
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendor Credit Ledger</h1>
          <p className="text-gray-500 text-xs mt-0.5">Track and settle credit balances with suppliers</p>
        </div>
      </div>

      {/* Debt Card */}
      <div className="bg-gray-900 text-white rounded-3xl p-6 shadow-md border border-gray-800 flex flex-col gap-1.5">
        <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Total Outstanding Balance</p>
        <h2 className="text-4xl font-extrabold">{formatCurrency(totalOutstanding)}</h2>
      </div>

      {/* Action panel triggers */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setShowLogModal(true)}
          className="py-3 bg-white text-gray-800 border border-gray-200 rounded-xl text-xs font-bold hover:bg-gray-50 active:bg-gray-100 transition-colors shadow-sm flex items-center justify-center gap-1.5"
        >
          ➕ Log Transaction
        </button>
        <button
          onClick={() => setShowContactModal(true)}
          className="py-3 bg-white text-gray-800 border border-gray-200 rounded-xl text-xs font-bold hover:bg-gray-50 active:bg-gray-100 transition-colors shadow-sm flex items-center justify-center gap-1.5"
        >
          👤 Add Supplier
        </button>
      </div>

      {error && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      {/* Balances List */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col gap-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Suppliers</h3>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Loading ledger balances…</div>
        ) : vendors.length === 0 ? (
          <div className="py-12 text-center flex flex-col gap-1.5">
            <p className="text-sm text-gray-400">No active vendor accounts found.</p>
            <p className="text-xs text-gray-400">Log a transaction to create a supplier profile automatically.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {vendors.map((v) => (
              <div key={v.vendor_name} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-gray-900 text-sm md:text-base">{v.vendor_name}</span>
                  <span className="text-[10px] text-gray-400">
                    Last transacted: {formatShortDateTime(v.last_transaction)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-6 sm:justify-end">
                  <div className="text-right">
                    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Outstanding</p>
                    <p className={`text-base font-bold ${v.outstanding > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                      {formatCurrency(v.outstanding)}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleOpenLedger(v.vendor_name)}
                      className="px-3.5 py-2 rounded-xl bg-gray-100 text-xs font-semibold text-gray-700 active:bg-gray-200 transition-colors"
                    >
                      Ledger
                    </button>
                    {v.outstanding > 0 && (
                      <button
                        onClick={() => handleSettleQuick(v.vendor_name, v.outstanding)}
                        className="px-3.5 py-2 rounded-xl bg-green-50 border border-green-200 text-xs font-bold text-green-700 hover:bg-green-100 transition-colors"
                      >
                        Settle
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ledger History Modal Drawer */}
      {selectedVendor && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-end z-50 animate-fade-in">
          <div className="bg-white h-full w-full max-w-md flex flex-col shadow-2xl border-l border-gray-100 z-50 animate-slide-left">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{selectedVendor}</h3>
                <p className="text-xs text-gray-400">Transaction log history</p>
              </div>
              <button
                onClick={() => setSelectedVendor(null)}
                className="w-10 h-10 rounded-xl bg-gray-100 text-sm font-bold text-gray-500 hover:bg-gray-200 flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loadingLedger ? (
                <div className="py-20 text-center text-sm text-gray-400">Loading history…</div>
              ) : ledgerEntries.length === 0 ? (
                <div className="py-20 text-center text-sm text-gray-400">No ledger transactions found.</div>
              ) : (
                <div className="flex flex-col gap-4">
                  {ledgerEntries.map((entry) => {
                    const isCredit = entry.type === 'credit'
                    return (
                      <div
                        key={entry.id}
                        className={`rounded-2xl p-4 border flex justify-between items-start ${
                          isCredit
                            ? 'bg-amber-50/40 border-amber-100/70 text-amber-900'
                            : 'bg-green-50/40 border-green-100/70 text-green-900'
                        }`}
                      >
                        <div className="flex flex-col gap-1 pr-3 max-w-[70%]">
                          <span className="font-semibold text-sm">
                            {isCredit ? '📥 Credit Extended' : '📤 Payment Sent'}
                          </span>
                          {entry.item_description && (
                            <span className="text-xs opacity-75 font-medium">{entry.item_description}</span>
                          )}
                          <span className="text-[10px] opacity-60">
                            {formatShortDateTime(entry.timestamp)}
                          </span>
                        </div>

                        <div className="text-right flex flex-col items-end gap-1">
                          <span className="font-extrabold text-base">
                            {isCredit ? '+' : '-'}{formatCurrency(entry.amount)}
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            entry.settled 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {entry.settled ? 'Settled' : 'Unpaid'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Log Transaction Modal */}
      {showLogModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 shadow-xl w-full max-w-sm flex flex-col gap-4 border border-gray-100">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Log Transaction</h3>
              <p className="text-xs text-gray-500 mt-1">Record credits or payments to a supplier ledger</p>
            </div>

            <form onSubmit={handleSaveTransaction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Supplier</label>
                <input
                  type="text"
                  list="vendor-options"
                  value={txVendor}
                  onChange={(e) => setTxVendor(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-gray-900 focus:outline-none"
                  placeholder="e.g. Rice Vendor"
                  required
                />
                <datalist id="vendor-options">
                  {contacts.map(c => <option key={c.id} value={c.name} />)}
                  {vendors.map(v => <option key={v.vendor_name} value={v.vendor_name} />)}
                </datalist>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Transaction Type</label>
                <div className="flex border border-gray-200 rounded-xl overflow-hidden p-1 bg-gray-50">
                  <button
                    type="button"
                    onClick={() => setTxType('credit')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
                      txType === 'credit'
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    Credit (Log Bill)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTxType('payment')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
                      txType === 'payment'
                        ? 'bg-green-600 text-white shadow-sm'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    Payment (Paid)
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Amount (₹)</label>
                <input
                  type="number"
                  pattern="\d*"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-gray-900 focus:outline-none font-bold"
                  placeholder="e.g. 4500"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Description (optional)</label>
                <input
                  type="text"
                  value={txDescription}
                  onChange={(e) => setTxDescription(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-gray-900 focus:outline-none"
                  placeholder="e.g. Rice 50kg bag"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowLogModal(false)}
                  disabled={submittingTx}
                  className="flex-1 py-3 text-sm font-semibold text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingTx}
                  className="flex-1 py-3 text-sm font-semibold text-white bg-gray-900 rounded-xl hover:bg-gray-800 active:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {submittingTx ? 'Logging...' : 'Confirm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Contact Modal */}
      {showContactModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 shadow-xl w-full max-w-sm flex flex-col gap-4 border border-gray-100">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Add Supplier Profile</h3>
              <p className="text-xs text-gray-500 mt-1">Create a vendor profile to save details</p>
            </div>

            <form onSubmit={handleSaveContact} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Name</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-gray-900 focus:outline-none"
                  placeholder="e.g. Meat Vendor"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">WhatsApp Number</label>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-gray-900 focus:outline-none"
                  placeholder="e.g. +919876543210"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Notes (optional)</label>
                <input
                  type="text"
                  value={contactNotes}
                  onChange={(e) => setContactNotes(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-gray-900 focus:outline-none"
                  placeholder="e.g. Delivers early mornings"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowContactModal(false)}
                  disabled={submittingContact}
                  className="flex-1 py-3 text-sm font-semibold text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingContact}
                  className="flex-1 py-3 text-sm font-semibold text-white bg-gray-900 rounded-xl hover:bg-gray-800 active:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {submittingContact ? 'Saving...' : 'Add Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
