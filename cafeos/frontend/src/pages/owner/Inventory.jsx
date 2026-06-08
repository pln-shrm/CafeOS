import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../lib/api'

const IST = 'Asia/Kolkata'

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST })
}

function formatDateLabel(dateStr) {
  if (!dateStr) return ''
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    weekday: 'short'
  })
}

export default function Inventory() {
  const navigate = useNavigate()
  const [date, setDate] = useState(todayIST())
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genSuccess, setGenSuccess] = useState('')
  
  // Override Modal State
  const [activeItem, setActiveItem] = useState(null)
  const [overrideQty, setOverrideQty] = useState('')
  const [updating, setUpdating] = useState(false)

  const loadData = async (targetDate) => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/api/predictions/today', { params: { date: targetDate } })
      setItems(res.data.data.items || [])
    } catch (err) {
      setError('Could not fetch predictions for this date.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData(date)
  }, [date])

  const handleOverrideClick = (item) => {
    setActiveItem(item)
    setOverrideQty(item.owner_override !== null ? String(item.owner_override) : String(item.predicted_qty))
  }

  const handleSaveOverride = async (e) => {
    e.preventDefault()
    if (!activeItem) return
    const qty = Number(overrideQty)
    if (isNaN(qty) || qty < 0 || !Number.isInteger(qty)) {
      alert('Please enter a valid positive integer.')
      return
    }

    setUpdating(true)
    try {
      await api.patch('/api/predictions/override', [
        { menu_item_id: activeItem.menu_item_id, qty }
      ], { params: { date } })

      // Reload
      await loadData(date)
      setActiveItem(null)
    } catch (err) {
      alert('Failed to save override. Please try again.')
    } finally {
      setUpdating(false)
    }
  }

  const handleConfirmPrep = async () => {
    setConfirming(true)
    try {
      await api.post('/api/predictions/confirm', { date })
      await loadData(date)
    } catch (err) {
      alert('Failed to lock in prep sheet.')
    } finally {
      setConfirming(false)
    }
  }

  const handleGeneratePredictions = async () => {
    setGenerating(true)
    setGenSuccess('')
    try {
      // Prompt prediction for target date (e.g. tomorrow)
      const res = await api.post('/api/predictions/generate', { date })
      setGenSuccess(`Successfully generated ${res.data.data.generated} forecasts ✓`)
      await loadData(date)
    } catch (err) {
      alert('Failed to generate predictions.')
    } finally {
      setGenerating(false)
    }
  }

  const isConfirmed = items.length > 0 && items.every(item => item.confirmed)

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
          <h1 className="text-2xl font-bold text-gray-900">Inventory & Prep</h1>
          <p className="text-gray-500 text-xs mt-0.5">Predictions & daily kitchen targets</p>
        </div>
      </div>

      {/* Date & Trigger Actions */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Target Date</label>
          <div className="flex gap-3 items-center">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-800 focus:border-gray-900 focus:outline-none"
            />
            <button
              onClick={() => setDate(todayIST())}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 active:bg-gray-100 transition-colors"
            >
              Today
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleGeneratePredictions}
            disabled={generating}
            className="flex-1 py-3 rounded-xl border border-dashed border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {generating ? 'Calculating...' : '📊 Forecast/Regenerate Predictions'}
          </button>
        </div>

        {genSuccess && (
          <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
            {genSuccess}
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      {/* Main List */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Prep Target Checklist for {formatDateLabel(date)}
          </h2>
          {isConfirmed ? (
            <span className="text-xs font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-full border border-green-100">
              Locked In ✓
            </span>
          ) : (
            <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-100">
              Open to Edits
            </span>
          )}
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Loading menu forecasts…</div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center flex flex-col gap-2">
            <p className="text-sm text-gray-400">No predictions logged for this date.</p>
            <p className="text-xs text-gray-400">Tap "Forecast" above to generate recommendations using historical data.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => {
              const displayQty = item.owner_override !== null ? item.owner_override : item.predicted_qty
              const isEdited = item.owner_override !== null

              return (
                <div key={item.id} className="py-4 first:pt-0 last:pb-0 flex items-center justify-between">
                  <div className="flex flex-col gap-1 pr-3 max-w-[60%]">
                    <span className="font-semibold text-gray-900 text-sm md:text-base">{item.name}</span>
                    <span className="text-xs text-gray-400 capitalize">{item.category || 'Dishes'}</span>
                    
                    {/* Multiplier Badges */}
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {item.weather_multiplier_applied && (
                        <span className="text-[10px] font-medium bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">
                          🌧️ Weather ×{item.weather_multiplier_applied}
                        </span>
                      )}
                      {item.festival_multiplier_applied && (
                        <span className="text-[10px] font-medium bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded border border-purple-100">
                          ✨ Festival ×{item.festival_multiplier_applied}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* Quantities */}
                    <div className="text-right">
                      <p className="text-xs text-gray-400 font-medium">Target Qty</p>
                      <button
                        onClick={() => !isConfirmed && handleOverrideClick(item)}
                        disabled={isConfirmed}
                        className={`text-lg font-bold transition-colors ${
                          isConfirmed 
                            ? 'text-gray-900 cursor-default' 
                            : 'text-blue-600 hover:text-blue-800 underline decoration-dashed'
                        }`}
                      >
                        {displayQty} {isEdited && <span className="text-[10px] font-medium text-amber-500 bg-amber-50 px-1 rounded border border-amber-200">Edited</span>}
                      </button>
                      
                      {/* Sold Info */}
                      {item.actual_qty !== null && (
                        <p className="text-[10px] text-green-600 font-medium mt-0.5">
                          Sold: {item.actual_qty} portions
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Action Button */}
        {items.length > 0 && !isConfirmed && (
          <button
            onClick={handleConfirmPrep}
            disabled={confirming}
            className="w-full mt-2 py-3.5 bg-gray-900 text-white rounded-xl font-bold text-sm hover:bg-gray-800 active:bg-gray-700 transition-colors shadow-sm disabled:opacity-50"
          >
            {confirming ? 'Locking in Targets...' : 'Lock In Today\'s Prep Targets ✓'}
          </button>
        )}
      </div>

      {/* Override Modal */}
      {activeItem && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 shadow-xl w-full max-w-sm flex flex-col gap-4 border border-gray-100">
            <div>
              <h3 className="text-lg font-bold text-gray-900">Adjust Prep Qty</h3>
              <p className="text-xs text-gray-500 mt-1">{activeItem.name}</p>
            </div>

            <form onSubmit={handleSaveOverride} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Target Portions</label>
                <input
                  type="number"
                  pattern="\d*"
                  value={overrideQty}
                  onChange={(e) => setOverrideQty(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold text-gray-800 focus:border-gray-900 focus:outline-none"
                  placeholder="e.g. 20"
                  required
                  autoFocus
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveItem(null)}
                  disabled={updating}
                  className="flex-1 py-3 text-sm font-semibold text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  className="flex-1 py-3 text-sm font-semibold text-white bg-gray-900 rounded-xl hover:bg-gray-800 active:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {updating ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
