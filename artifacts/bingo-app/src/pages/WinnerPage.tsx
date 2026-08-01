import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'

interface WinnerData {
  roundId: string
  winners: { telegramId: number; firstName: string; cardId: number; card: number[][], winPattern: number[] }[]
  prizePerWinner: number
}

const FALLBACK_CARD = {
  numbers: [
    [4,  17, 32, 47, 62],
    [10, 20, 39, 51, 66],
    [11, 25,  0, 52, 67],
    [13, 26, 41, 53, 69],
    [14, 27, 45, 54, 70],
  ],
  called: new Set([4, 62, 39, 25, 14, 70]),
}

const CONFETTI = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  left: `${Math.random() * 100}%`,
  top: `${Math.random() * 90}%`,
  color: i % 3 === 0 ? '#D4A017' : i % 3 === 1 ? '#22c55e' : '#e53e3e',
  size: 4 + Math.random() * 5,
  delay: `${Math.random() * 3}s`,
  duration: `${2.5 + Math.random() * 2}s`,
}))

const TOTAL_COUNTDOWN = 8

export default function WinnerPage() {
  const [, navigate] = useLocation()
  const [countdown, setCountdown] = useState(TOTAL_COUNTDOWN)

  // Load winner data from sessionStorage (set by GamePage)
  const [winnerData] = useState<WinnerData | null>(() => {
    try {
      const raw = sessionStorage.getItem('winnerData')
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })

  const winner = winnerData?.winners?.[0]
  const cardNumbers = winner?.card ?? FALLBACK_CARD.numbers
  const winPattern = new Set(winner?.winPattern ?? [])
  const prizePer = winnerData?.prizePerWinner ?? 0

  useEffect(() => {
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(t); navigate('/'); return 0 }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [navigate])

  return (
    <div style={{
      height: '100vh', overflow: 'hidden',
      background: 'radial-gradient(ellipse at 50% 30%, #2e0d10 0%, #180608 70%)',
      display: 'flex', flexDirection: 'column',
      padding: '10px 12px 12px', position: 'relative', boxSizing: 'border-box',
    }}>
      {CONFETTI.map(c => (
        <div key={c.id} style={{
          position: 'fixed', left: c.left, top: c.top,
          width: c.size, height: c.size, borderRadius: '50%',
          background: c.color, opacity: 0.6, pointerEvents: 'none', zIndex: 0,
          animation: `confetti-fall ${c.duration} ${c.delay} linear infinite`,
        }} />
      ))}

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>

        {/* Trophy + Title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexShrink: 0 }}>
          <svg width="34" height="34" viewBox="0 0 52 52" fill="none">
            <path d="M16 6 L36 6 L36 28 C36 36 26 42 26 42 C26 42 16 36 16 28 Z" fill="#c0392b" stroke="#E91E8C" strokeWidth="1.5"/>
            <path d="M8 8 L16 8 L16 22 C8 22 4 16 8 8 Z" fill="#b91c1c" stroke="#E91E8C" strokeWidth="1"/>
            <path d="M44 8 L36 8 L36 22 C44 22 48 16 44 8 Z" fill="#b91c1c" stroke="#E91E8C" strokeWidth="1"/>
            <rect x="20" y="42" width="12" height="4" rx="1" fill="#E91E8C"/>
            <rect x="15" y="46" width="22" height="4" rx="2" fill="#E91E8C"/>
            <path d="M22 20 L24 24 L28 24 L25 27 L26 31 L22 28 L20 31 L21 27 L18 24 L22 24 Z" fill="#FFD700"/>
          </svg>
          <div>
            <div className="font-condensed" style={{ fontSize: 22, fontWeight: 900, color: '#D4A017', letterSpacing: '0.06em', lineHeight: 1.1 }}>
              BEHERAWI CHAMPION
            </div>
            <div style={{ fontSize: 9, color: '#888', letterSpacing: '0.08em', fontWeight: 500, textAlign: 'center' }}>
              TOTAL DERASH PRIZE POOL
            </div>
          </div>
        </div>

        {/* Grand pool + Winner side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, flexShrink: 0 }}>
          <div className="game-card" style={{ padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#888', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 2 }}>GRAND POOL</div>
            <div className="font-condensed" style={{ fontSize: 20, fontWeight: 900, color: '#D4A017' }}>
              {prizePer > 0 ? `${prizePer} ETB` : '— ETB'}
            </div>
          </div>
          <div className="game-card" style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: '#c0392b', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 800,
              border: '1.5px solid #D4A017',
            }}>🏆</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                {winner?.firstName ?? '@WINNER'}
              </div>
              <div style={{ fontSize: 9, color: '#D4A017', fontWeight: 700 }}>
                {prizePer > 0 ? `${prizePer} ETB` : 'WINNER'}
              </div>
            </div>
          </div>
        </div>

        {/* Winning cartela */}
        <div className="game-card" style={{ padding: '8px 10px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 11 }}>👑</span>
            <span className="font-condensed" style={{ fontSize: 12, fontWeight: 700, color: '#D4A017', letterSpacing: '0.05em' }}>
              Cartela #{winner?.cardId ?? '—'}
            </span>
            <span style={{ background: '#7c3aed', borderRadius: 4, padding: '1px 6px', fontSize: 8, fontWeight: 700, color: '#fff' }}>WIN</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3, marginBottom: 3 }}>
            {['B','I','N','G','O'].map(c => (
              <div key={c} style={{
                background: '#1a1a2e', borderRadius: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '3px 0', fontSize: 11, fontWeight: 900, color: '#fff',
              }}>{c}</div>
            ))}
          </div>
          {cardNumbers.map((row, ri) => (
            <div key={ri} style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3, marginBottom: 3 }}>
              {row.map((num, ci) => {
                const isFree = num === 0
                const isWin = !isFree && winPattern.has(num)
                const isMatched = !isFree && (FALLBACK_CARD.called.has(num) || isWin)
                return (
                  <div key={ci} className={`bingo-cell${isFree ? ' free' : (isWin || isMatched) ? ' matched' : ''}`} style={{ height: 30 }}>
                    {isFree ? '👑' : num}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, flexShrink: 0 }}>
          {[
            { value: String(winnerData?.winners?.length ?? 1), label: 'WINNERS' },
            { value: String(winner?.winPattern?.length ?? '—'), label: 'WIN PATTERN' },
            { value: prizePer > 0 ? `${prizePer}` : '—', label: 'PRIZE ETB' },
          ].map((s, i) => (
            <div key={i} className="game-card" style={{ padding: '6px 8px', textAlign: 'center' }}>
              <div className="font-condensed" style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>{s.value}</div>
              <div style={{ fontSize: 8, color: '#888', letterSpacing: '0.06em', fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Countdown */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ textAlign: 'center', marginBottom: 6 }}>
            <span className="font-condensed" style={{ fontSize: 13, fontWeight: 700, color: '#e53e3e', letterSpacing: '0.08em' }}>
              NEXT MATCH STARTS IN {countdown}S
            </span>
          </div>
          <div style={{ height: 5, background: '#2a0e0e', borderRadius: 4, overflow: 'hidden' }}>
            <div className="progress-fill" style={{ width: `${(countdown / TOTAL_COUNTDOWN) * 100}%` }} />
          </div>
        </div>

        <button
          className="btn-enter"
          onClick={() => navigate('/')}
          style={{ flexShrink: 0, width: '100%', padding: '11px 0', border: 'none', cursor: 'pointer' }}
        >
          <span className="font-condensed" style={{ letterSpacing: '0.1em', fontSize: 16, fontWeight: 800 }}>BACK TO LOBBY</span>
        </button>
      </div>
    </div>
  )
}
