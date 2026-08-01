import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'

const WINNING_CARD = {
  id: 318,
  numbers: [
    [4,  17, 32, 47, 62],
    [10, 20, 39, 51, 66],
    [11, 25,  0, 52, 67],  // 0 = FREE
    [13, 26, 41, 53, 69],
    [14, 27, 45, 54, 70],
  ],
  called: new Set([4, 62, 39, 25, 14, 70, 5, 15, 29]),
}

const CONFETTI = Array.from({ length: 28 }, (_, i) => ({
  id: i,
  left: `${Math.random() * 100}%`,
  top: `${Math.random() * 90}%`,
  color: i % 3 === 0 ? '#D4A017' : i % 3 === 1 ? '#22c55e' : '#e53e3e',
  size: 5 + Math.random() * 6,
  delay: `${Math.random() * 3}s`,
  duration: `${2.5 + Math.random() * 2}s`,
}))

const TOTAL_COUNTDOWN = 5

export default function WinnerPage() {
  const [, navigate] = useLocation()
  const [countdown, setCountdown] = useState(TOTAL_COUNTDOWN)

  useEffect(() => {
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(t)
          navigate('/')
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [navigate])

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 50% 30%, #2e0d10 0%, #180608 70%)',
      padding: '20px 14px 120px',
      overflowY: 'auto',
      position: 'relative',
    }}>
      {/* Confetti */}
      {CONFETTI.map(c => (
        <div key={c.id} style={{
          position: 'fixed',
          left: c.left,
          top: c.top,
          width: c.size,
          height: c.size,
          borderRadius: '50%',
          background: c.color,
          opacity: 0.7,
          pointerEvents: 'none',
          zIndex: 0,
          animation: `confetti-fall ${c.duration} ${c.delay} linear infinite`,
        }} />
      ))}

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Trophy */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
          <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
            <path d="M16 6 L36 6 L36 28 C36 36 26 42 26 42 C26 42 16 36 16 28 Z" fill="#c0392b" stroke="#E91E8C" strokeWidth="1.5"/>
            <path d="M8 8 L16 8 L16 22 C8 22 4 16 8 8 Z" fill="#b91c1c" stroke="#E91E8C" strokeWidth="1"/>
            <path d="M44 8 L36 8 L36 22 C44 22 48 16 44 8 Z" fill="#b91c1c" stroke="#E91E8C" strokeWidth="1"/>
            <rect x="20" y="42" width="12" height="4" rx="1" fill="#E91E8C"/>
            <rect x="15" y="46" width="22" height="4" rx="2" fill="#E91E8C"/>
            <path d="M22 20 L24 24 L28 24 L25 27 L26 31 L26 31 L22 28 L22 28 L20 31 L21 27 L18 24 L22 24 Z" fill="#FFD700"/>
          </svg>
        </div>

        {/* Title */}
        <h1 className="font-condensed" style={{
          textAlign: 'center', fontSize: 30, fontWeight: 900,
          color: '#D4A017', letterSpacing: '0.06em', lineHeight: 1.15, marginBottom: 4,
        }}>
          BEHERAWI CHAMPION<br />DECLARED
        </h1>
        <p style={{ textAlign: 'center', fontSize: 11, color: '#888', letterSpacing: '0.08em', marginBottom: 16, fontWeight: 500 }}>
          TOTAL DERASH PRIZE POOL
        </p>

        {/* Grand pool */}
        <div className="game-card" style={{ padding: '12px 20px', marginBottom: 12, textAlign: 'center' }}>
          <span style={{ fontSize: 14, color: '#ccc', fontWeight: 600, letterSpacing: '0.04em' }}>GRAND POOL:&nbsp;</span>
          <span className="font-condensed" style={{ fontSize: 22, fontWeight: 900, color: '#D4A017', letterSpacing: '0.04em' }}>656 ETB</span>
        </div>

        {/* Winner info */}
        <div className="game-card" style={{ padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: '#c0392b', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 14, color: '#fff', fontWeight: 800,
              flexShrink: 0, border: '2px solid #D4A017',
            }}>@</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>@LENSA</div>
              <div style={{ fontSize: 10, color: '#888' }}>PLAYER NODE: 944401</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #3a1212', paddingTop: 10 }}>
            <span style={{ fontSize: 11, color: '#888', fontWeight: 600, letterSpacing: '0.04em' }}>PAYOUT:</span>
            <span className="font-condensed" style={{ fontSize: 20, fontWeight: 900, color: '#D4A017' }}>656 ETB</span>
          </div>
        </div>

        {/* Winning cartela */}
        <div className="game-card" style={{ padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 13 }}>👑</span>
            <span className="font-condensed" style={{ fontSize: 13, fontWeight: 700, color: '#D4A017', letterSpacing: '0.05em' }}>
              Cartela #318
            </span>
            <span style={{
              background: '#7c3aed', borderRadius: 4,
              padding: '2px 8px', fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: '0.06em',
            }}>VIP TICKET</span>
          </div>

          {/* Bingo card */}
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 4 }}>
            {['B', 'I', 'N', 'G', 'O'].map(c => (
              <div key={c} style={{
                background: '#1a1a2e', borderRadius: 4,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '5px 0', fontSize: 13, fontWeight: 900, color: '#fff', letterSpacing: '0.04em',
              }}>{c}</div>
            ))}
          </div>
          {/* Rows */}
          {WINNING_CARD.numbers.map((row, ri) => (
            <div key={ri} style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 4 }}>
              {row.map((num, ci) => {
                const isFree = num === 0
                const isMatched = !isFree && WINNING_CARD.called.has(num)
                return (
                  <div key={ci} className={`bingo-cell${isFree ? ' free' : isMatched ? ' matched' : ''}`}
                    style={{ height: 40 }}>
                    {isFree ? '👑' : num}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Stats bar */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
          {[
            { value: '1', label: 'BINGO LINE' },
            { value: '16', label: 'BALLS CALLED' },
            { value: '48S', label: 'DURATION' },
          ].map((s, i) => (
            <div key={i} className="game-card" style={{ padding: '10px 8px', textAlign: 'center' }}>
              <div className="font-condensed" style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{s.value}</div>
              <div style={{ fontSize: 9, color: '#888', letterSpacing: '0.06em', fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Next match countdown */}
        <div style={{ textAlign: 'center', marginBottom: 10 }}>
          <span className="font-condensed" style={{ fontSize: 14, fontWeight: 700, color: '#e53e3e', letterSpacing: '0.08em' }}>
            NEXT MATCH STARTS IN {countdown}S
          </span>
        </div>
        <div style={{ height: 6, background: '#2a0e0e', borderRadius: 4, overflow: 'hidden', marginBottom: 20 }}>
          <div className="progress-fill" style={{ width: `${(countdown / TOTAL_COUNTDOWN) * 100}%` }} />
        </div>

        {/* Back to lobby */}
        <button
          className="btn-enter"
          onClick={() => navigate('/')}
          style={{
            width: '100%', padding: '14px 0', fontSize: 16,
            border: 'none', cursor: 'pointer',
          }}
        >
          <span className="font-condensed" style={{ letterSpacing: '0.1em', fontSize: 18, fontWeight: 800 }}>
            BACK TO LOBBY
          </span>
        </button>
      </div>
    </div>
  )
}
