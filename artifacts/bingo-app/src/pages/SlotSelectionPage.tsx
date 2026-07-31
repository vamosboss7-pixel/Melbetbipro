import { useState } from 'react'
import { useLocation } from 'wouter'

// Numbers 1-500, some highlighted as drawn
const HIGHLIGHTED = new Set([146, 147, 153, 158, 160, 168, 174, 180, 23, 45, 67, 89, 112, 134, 200, 215, 230, 250, 278, 310, 340, 360, 390, 420, 450, 480])

export default function SlotSelectionPage() {
  const [, navigate] = useLocation()
  const [selectedSlots, setSelectedSlots] = useState<number[]>([])
  const [timeLeft, setTimeLeft] = useState(31)

  const toggleSlot = (n: number) => {
    setSelectedSlots(prev => {
      if (prev.includes(n)) return prev.filter(x => x !== n)
      if (prev.length >= 2) return prev
      return [...prev, n]
    })
  }

  const autoAssign = () => {
    const available = Array.from({ length: 500 }, (_, i) => i + 1).filter(n => !HIGHLIGHTED.has(n))
    const shuffled = available.sort(() => Math.random() - 0.5).slice(0, 2)
    setSelectedSlots(shuffled)
  }

  const clearSlots = () => setSelectedSlots([])

  const formatTime = (s: number) => `00:${String(s).padStart(2, '0')}`

  // Render 500 numbers in rows of 8
  const numbers = Array.from({ length: 500 }, (_, i) => i + 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'radial-gradient(ellipse at 50% 30%, #2e0d10 0%, #180608 70%)' }}>

      {/* Header */}
      <div style={{ background: '#1e0909', borderBottom: '1px solid #5c1a1a', padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* User info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'linear-gradient(135deg, #c0392b, #ff6b00)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0,
              border: '2px solid #d4a017'
            }}>
              🪙
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#D4A017', letterSpacing: '0.04em' }}>@MANZU9Y8</div>
              <div style={{ fontSize: 10, color: '#999', letterSpacing: '0.02em' }}>BEHERAWI ROUND #2258</div>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 6 }}>
            <div className="stat-chip">
              <span style={{ fontSize: 9, color: '#999', letterSpacing: '0.05em', fontWeight: 600 }}>CLOSES IN</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#e53e3e', fontFamily: 'monospace' }}>{formatTime(timeLeft)}</span>
            </div>
            <div className="stat-chip">
              <span style={{ fontSize: 9, color: '#999', letterSpacing: '0.05em', fontWeight: 600 }}>PLAYERS</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>38</span>
            </div>
            <div className="stat-chip">
              <span style={{ fontSize: 9, color: '#999', letterSpacing: '0.05em', fontWeight: 600 }}>BALANCE</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>0</span>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable grid only */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 8px' }}>

        {/* Grand Slots label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="6" height="6" rx="1" stroke="#D4A017" strokeWidth="1.5"/>
            <rect x="9" y="1" width="6" height="6" rx="1" stroke="#D4A017" strokeWidth="1.5"/>
            <rect x="1" y="9" width="6" height="6" rx="1" stroke="#D4A017" strokeWidth="1.5"/>
            <rect x="9" y="9" width="6" height="6" rx="1" stroke="#D4A017" strokeWidth="1.5"/>
          </svg>
          <span className="font-condensed" style={{ fontSize: 14, fontWeight: 700, color: '#D4A017', letterSpacing: '0.06em' }}>
            GRAND SLOTS (1 - 500)
          </span>
        </div>

        {/* Number Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 5 }}>
          {numbers.map(n => (
            <div
              key={n}
              className={`slot-cell${HIGHLIGHTED.has(n) ? ' highlighted' : ''}${selectedSlots.includes(n) ? ' highlighted' : ''}`}
              onClick={() => toggleSlot(n)}
              style={{
                ...(selectedSlots.includes(n) ? { background: '#4a1a00', boxShadow: '0 0 8px rgba(255,140,0,0.5)' } : {}),
              }}
            >
              {n}
            </div>
          ))}
        </div>
      </div>

      {/* MY CARTELAS — fixed, never scrolls */}
      <div style={{
        flexShrink: 0,
        background: '#180608',
        borderTop: '1px solid #3a1212',
        padding: '10px 12px 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 15 }}>🎴</span>
            <span className="font-condensed" style={{ fontSize: 14, fontWeight: 700, color: '#D4A017', letterSpacing: '0.06em' }}>
              MY CARTELAS ({selectedSlots.length}/2)
            </span>
          </div>
          <div style={{
            background: '#1e0909', border: '1px solid #5c1a1a',
            borderRadius: 8, padding: '3px 10px',
            fontSize: 11, fontWeight: 700, color: '#fff'
          }}>
            0 ETB
          </div>
        </div>

        {/* Two cartela slot previews */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          {[0, 1].map(i => (
            <div
              key={i}
              className="cartela-placeholder"
              style={{ padding: '18px 10px', minHeight: 100 }}
              onClick={autoAssign}
            >
              {selectedSlots[i] ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#D4A017' }}>{selectedSlots[i]}</div>
                  <div style={{ fontSize: 10, color: '#888' }}>SLOT #{i + 1} SELECTED</div>
                </div>
              ) : (
                <>
                  <div style={{
                    width: 34, height: 34, borderRadius: '50%',
                    border: '1.5px dashed #5c1a1a',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, color: '#5c1a1a'
                  }}>+</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.04em' }}>SLOT #{i + 1} EMPTY</div>
                  <div style={{ fontSize: 9, color: '#555', textAlign: 'center', letterSpacing: '0.03em' }}>TAP GRID (1-500) OR AUTO ASSIGN</div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, paddingBottom: 20 }}>
          <button
            className="btn-enter"
            onClick={() => { autoAssign(); navigate('/game'); }}
            style={{
              flex: 1, padding: '13px 0',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              border: 'none', cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 14 }}>🎲</span>
            <span className="font-condensed" style={{ letterSpacing: '0.1em', fontSize: 17, fontWeight: 700 }}>AUTO ASSIGN</span>
          </button>
          <button
            onClick={clearSlots}
            style={{
              padding: '13px 20px',
              background: '#250d0d', border: '1px solid #5c1a1a',
              borderRadius: 50, color: '#aaa', fontWeight: 700,
              fontSize: 14, cursor: 'pointer',
              fontFamily: 'Oswald, sans-serif', letterSpacing: '0.06em',
            }}
          >
            CLEAR
          </button>
        </div>
      </div>
    </div>
  )
}
