import { useState, useEffect } from 'react'
import { useLocation } from 'wouter'
import { CARTELAS } from '../data/cartelas'
import { usePlayer } from '../context/PlayerContext'

// Numbers that are already taken — populated from server data at runtime
const HIGHLIGHTED = new Set<number>([])

export default function SlotSelectionPage() {
  const [, navigate] = useLocation()
  const [selectedSlots, setSelectedSlots] = useState<number[]>([])
  const [timeLeft, setTimeLeft] = useState(31)
  const [jackpotPool, setJackpotPool] = useState<string>('0.00')
  const { player } = usePlayer()

  // Fetch jackpot pool on mount
  useEffect(() => {
    fetch('/api/jackpot/status')
      .then(r => r.json())
      .then((data: { pool: number }) => {
        setJackpotPool(Number(data.pool ?? 0).toFixed(2))
      })
      .catch(() => {/* ignore */})
  }, [])

  // Countdown timer — auto-enter when it hits 0
  useEffect(() => {
    if (timeLeft <= 0) {
      enterGame()
      return
    }
    const id = setInterval(() => setTimeLeft(t => t - 1), 1000)
    return () => clearInterval(id)
  }, [timeLeft])

  const toggleSlot = (n: number) => {
    if (HIGHLIGHTED.has(n)) return  // taken slots are not selectable
    setSelectedSlots(prev => {
      if (prev.includes(n)) return prev.filter(x => x !== n)
      if (prev.length >= 2) return prev
      return [...prev, n]
    })
  }

  const randomPick = (count: 1 | 2) => {
    const available = Array.from({ length: 500 }, (_, i) => i + 1).filter(n => !HIGHLIGHTED.has(n))
    const picked = available.sort(() => Math.random() - 0.5).slice(0, count)
    setSelectedSlots(picked)
  }

  const enterGame = () => {
    sessionStorage.setItem('selectedSlots', JSON.stringify(selectedSlots))
    navigate('/game')
  }

  const formatTime = (s: number) => `00:${String(Math.max(0, s)).padStart(2, '0')}`

  // Render 500 numbers in rows of 8
  const numbers = Array.from({ length: 500 }, (_, i) => i + 1)

  // Display name: prefer @username, fall back to first name
  const displayName = player
    ? (player.username ? `@${player.username}` : player.firstName)
    : '...'

  // Total playable balance = balance + playBalance
  const totalBalance = player
    ? (parseFloat(player.balance) + parseFloat(player.playBalance)).toFixed(2)
    : '—'

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
              <div style={{ fontSize: 11, fontWeight: 700, color: '#D4A017', letterSpacing: '0.04em' }}>{displayName}</div>
              <div style={{ fontSize: 10, color: '#999', letterSpacing: '0.02em' }}>BEHERAWI BINGO</div>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 6 }}>
            <div className="stat-chip">
              <span style={{ fontSize: 9, color: '#999', letterSpacing: '0.05em', fontWeight: 600 }}>CLOSES IN</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#e53e3e', fontFamily: 'monospace' }}>{formatTime(timeLeft)}</span>
            </div>
            <div className="stat-chip">
              <span style={{ fontSize: 9, color: '#999', letterSpacing: '0.05em', fontWeight: 600 }}>BALANCE</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{totalBalance}</span>
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
          {numbers.map(n => {
            const isTaken = HIGHLIGHTED.has(n)
            const isSelected = selectedSlots.includes(n)
            return (
              <div
                key={n}
                className={`slot-cell${isTaken ? ' highlighted' : ''}${isSelected ? ' highlighted' : ''}`}
                onClick={() => toggleSlot(n)}
                style={{
                  ...(isSelected ? { background: '#4a1a00', boxShadow: '0 0 8px rgba(255,140,0,0.5)' } : {}),
                  ...(isTaken ? { cursor: 'not-allowed', opacity: 0.5 } : {}),
                }}
              >
                {n}
              </div>
            )
          })}
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#D4A017', letterSpacing: '0.08em' }}>JACKPOT</span>
            <div style={{
              background: '#1e0909', border: '1px solid #5c1a1a',
              borderRadius: 8, padding: '3px 10px',
              fontSize: 11, fontWeight: 700, color: '#fff'
            }}>
              {jackpotPool} ETB
            </div>
          </div>
        </div>

        {/* Two cartela slot previews */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          {[0, 1].map(i => {
            const cardNum = selectedSlots[i]
            const card = cardNum ? CARTELAS[cardNum - 1] : null
            const COLS = ['B','I','N','G','O']
            return (
            <div
              key={i}
              className="cartela-placeholder"
              style={{ padding: card ? '8px 6px' : '18px 10px', minHeight: 100 }}
              onClick={() => { if (!card) randomPick(1) }}
            >
              {card ? (
                <div style={{ width: '100%' }}>
                  {/* Card number label */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#888', letterSpacing: '0.05em' }}>SLOT #{i+1}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#D4A017' }}>#{cardNum}</span>
                  </div>
                  {/* Column headers */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 2, marginBottom: 2 }}>
                    {COLS.map(c => (
                      <div key={c} style={{
                        textAlign: 'center', fontSize: 9, fontWeight: 800,
                        color: '#D4A017', letterSpacing: '0.04em', lineHeight: 1,
                      }}>{c}</div>
                    ))}
                  </div>
                  {/* 5x5 grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 2 }}>
                    {card.map((row, r) =>
                      row.map((num, c) => (
                        <div key={`${r}-${c}`} style={{
                          aspectRatio: '1',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          borderRadius: 3,
                          background: num === 0 ? 'linear-gradient(135deg,#c0392b,#ff6b00)' : '#1e0909',
                          border: num === 0 ? 'none' : '1px solid #3a1212',
                          fontSize: num === 0 ? 10 : 8,
                          fontWeight: 700,
                          color: num === 0 ? '#fff' : '#ccc',
                          lineHeight: 1,
                        }}>
                          {num === 0 ? '★' : num}
                        </div>
                      ))
                    )}
                  </div>
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
                  <div style={{ fontSize: 9, color: '#555', textAlign: 'center', letterSpacing: '0.03em' }}>TAP GRID (1-500) OR RANDOM PICK</div>
                </>
              )}
            </div>
          )})}

        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <button
            onClick={() => randomPick(1)}
            style={{
              flex: 1, padding: '11px 0',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              border: 'none', cursor: 'pointer', borderRadius: 50,
              background: 'linear-gradient(to right, #7c3aed, #a855f7)',
            }}
          >
            <span style={{ fontSize: 13 }}>🎲</span>
            <span className="font-condensed" style={{ letterSpacing: '0.08em', fontSize: 15, fontWeight: 700, color: '#fff' }}>RANDOM PICK 1</span>
          </button>
          <button
            onClick={() => randomPick(2)}
            style={{
              flex: 1, padding: '11px 0',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              border: 'none', cursor: 'pointer', borderRadius: 50,
              background: 'linear-gradient(to right, #c0392b, #ff6b00)',
            }}
          >
            <span style={{ fontSize: 13 }}>🎲</span>
            <span className="font-condensed" style={{ letterSpacing: '0.08em', fontSize: 15, fontWeight: 700, color: '#fff' }}>RANDOM PICK 2</span>
          </button>
        </div>
        <div style={{ paddingBottom: 20 }} />
      </div>
    </div>
  )
}
