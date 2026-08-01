import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'wouter'
import { CARTELAS } from '../data/cartelas'

// 75-ball matrix columns
const BINGO_COLS = ['B', 'I', 'N', 'G', 'O'] as const
const COL_RANGES: Record<string, [number, number]> = {
  B: [1, 15], I: [16, 30], N: [31, 45], G: [46, 60], O: [61, 75],
}

// Demo: called balls
const CALLED_BALLS = [5, 4, 15, 29, 25, 14, 62]
const LATEST_BALL = 62

// Build matrix: rows 1-15, cols B-I-N-G-O
function getMatrixCell(col: string, row: number) {
  const [start] = COL_RANGES[col]
  return start + row - 1
}

// Recent balls with their column letter
function getBallCol(n: number): string {
  for (const [col, [start, end]] of Object.entries(COL_RANGES)) {
    if (n >= start && n <= end) return col
  }
  return 'B'
}

const RECENT_BALLS = [14, 25, 29, 15, 4, 5, 62].map(n => ({ n, col: getBallCol(n) }))

const COL_BADGE_COLORS: Record<string, string> = {
  B: '#1565c0', I: '#6a0dad', N: '#b71c1c', G: '#e65100', O: '#880e4f',
}

const COL_COLORS: Record<string, string> = {
  B: '#1a1a1a', I: '#1a1a1a', N: '#1a1a1a', G: '#1a1a1a', O: '#1a1a1a',
}

export default function GamePage() {
  const [, navigate] = useLocation()
  const [phase, setPhase] = useState<'waiting' | 'active'>('active')
  const [muted, setMuted] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Read selected slots from sessionStorage
  const [selectedSlots] = useState<number[]>(() => {
    try {
      const stored = sessionStorage.getItem('selectedSlots')
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })

  // Audio setup
  useEffect(() => {
    const audio = new Audio('/audio/bg-music.mp3')
    audio.loop = true
    audio.volume = 0.4
    audioRef.current = audio
    audio.play().catch(() => { /* autoplay may be blocked */ })
    return () => { audio.pause(); audio.src = '' }
  }, [])

  // Mute/unmute
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted
  }, [muted])

  const calledSet = new Set(CALLED_BALLS)
  const COLS = ['B', 'I', 'N', 'G', 'O']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'radial-gradient(ellipse at 50% 25%, #2e0d10 0%, #180608 70%)', overflow: 'hidden' }}>

      {/* Top Header */}
      <div style={{ background: '#1a0708', borderBottom: '1px solid #5c1a1a', padding: '8px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Logo */}
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: 'linear-gradient(135deg, #c0392b, #ff6b00)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, color: '#D4A017', flexShrink: 0,
            border: '1.5px solid #d4a017'
          }}>
            🎲
          </div>
          <div style={{ flex: 1 }}>
            <div className="font-condensed" style={{ fontSize: 12, fontWeight: 800, color: '#D4A017', letterSpacing: '0.06em', lineHeight: 1.1 }}>
              BEHERAWI BINGO
            </div>
            <div style={{ fontSize: 9, color: '#888' }}>#2268 &nbsp;·&nbsp; @MANZU9...</div>
          </div>
          {/* Stat chips */}
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <StatChip label="CALLED" value={phase === 'waiting' ? '0/75' : '7/75'} />
            <StatChip label="BALANC..." value="0" />
            <StatChip label="PRIZE P..." value="656" accent="#D4A017" />
            <button
              onClick={() => setMuted(m => !m)}
              title={muted ? 'Unmute' : 'Mute'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted ? '#e53e3e' : '#888', fontSize: 16, padding: '2px 4px' }}
            >
              {muted ? '🔇' : '🔊'}
            </button>
          </div>
        </div>
      </div>

      {/* Drawn Ball Section */}
      <div style={{ flexShrink: 0, padding: '10px 12px 0' }}>
        <div className="game-card" style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Ball circle */}
            <div
              className="dashed-circle"
              style={{
                width: 62, height: 62, flexShrink: 0,
                ...(phase === 'active' && LATEST_BALL ? {
                  background: 'linear-gradient(135deg, #c0392b, #ff6b00)',
                  border: '2px solid #ff8c00',
                  boxShadow: '0 0 16px rgba(255,107,0,0.5)',
                } : {}),
              }}
            >
              {phase === 'active' && LATEST_BALL ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{LATEST_BALL}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>O</div>
                </div>
              ) : (
                <div style={{ width: 16, height: 3, background: '#5c1a1a', borderRadius: 2 }} />
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <span style={{ fontSize: 12 }}>⚙️</span>
                <span className="font-condensed" style={{ fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>DRAWN BALL</span>
              </div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                {phase === 'active' ? `Column O • #${LATEST_BALL}` : 'Awaiting draw...'}
              </div>
              {/* Recent balls */}
              {phase === 'active' && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {RECENT_BALLS.slice(0, -1).reverse().map((b, i) => (
                    <div key={i} style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: COL_BADGE_COLORS[b.col] || '#333',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0,
                    }}>
                      {b.n}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main game area — two columns */}
      <div style={{ flex: 1, display: 'flex', gap: 8, padding: '10px 12px 12px', overflow: 'hidden' }}>

        {/* Left: Your Cartelas */}
        <div style={{ flex: 1.1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="game-card" style={{ flex: 1, padding: '10px 10px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12 }}>🎴</span>
              <span className="font-condensed" style={{ fontSize: 11, fontWeight: 700, color: '#D4A017', letterSpacing: '0.04em' }}>
                YOUR CARTELAS ({selectedSlots.length})
              </span>
              {selectedSlots.length > 0 && (
                <span style={{
                  background: '#166534', border: '1px solid #22c55e',
                  borderRadius: 4, padding: '1px 6px',
                  fontSize: 9, fontWeight: 700, color: '#22c55e', letterSpacing: '0.04em'
                }}>IN PLAY</span>
              )}
            </div>

            {selectedSlots.length === 0 ? (
              /* Empty state */
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 8 }}>
                <svg width="38" height="32" viewBox="0 0 56 46" fill="none">
                  <path d="M4 38 L10 14 L20 26 L28 6 L36 26 L46 14 L52 38 Z" fill="none" stroke="#5c1a1a" strokeWidth="2" strokeLinejoin="round"/>
                  <rect x="2" y="38" width="52" height="6" rx="2" fill="#5c1a1a" />
                </svg>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#D4A017', lineHeight: 1.4 }}>
                  እባክዎን ዙሩ<br />እስኪጠናቀቅ ድረስ<br />ይጠብቁ
                </div>
                <div style={{ fontSize: 10, color: '#888', lineHeight: 1.5 }}>
                  ጨዋታዎ እንዲሳቅ የሚቀጠለወን ዙሩ<br />መጫወት ይችላሉ።
                </div>
              </div>
            ) : (
              /* Show selected cartelas */
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {selectedSlots.map((slotNum, idx) => {
                  const card = CARTELAS[slotNum - 1]
                  if (!card) return null
                  return (
                    <div key={slotNum} style={{ flexShrink: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#888', letterSpacing: '0.04em' }}>CARTELA {idx + 1}</span>
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#D4A017' }}>#{slotNum}</span>
                      </div>
                      {/* Column headers */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 2, marginBottom: 2 }}>
                        {COLS.map(c => (
                          <div key={c} style={{
                            textAlign: 'center', fontSize: 8, fontWeight: 800,
                            color: '#D4A017', letterSpacing: '0.04em',
                          }}>{c}</div>
                        ))}
                      </div>
                      {/* 5x5 grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 2 }}>
                        {card.map((row, r) =>
                          row.map((num, c) => {
                            const isFree = num === 0
                            const isCalled = !isFree && calledSet.has(num)
                            return (
                              <div key={`${r}-${c}`} style={{
                                aspectRatio: '1',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                borderRadius: 3,
                                background: isFree
                                  ? 'linear-gradient(135deg,#c0392b,#ff6b00)'
                                  : isCalled
                                  ? 'linear-gradient(135deg,#166534,#22c55e)'
                                  : '#1e0909',
                                border: (isFree || isCalled) ? 'none' : '1px solid #3a1212',
                                fontSize: isFree ? 9 : 7,
                                fontWeight: 700,
                                color: '#fff',
                                lineHeight: 1,
                              }}>
                                {isFree ? '★' : num}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: 75-Ball Matrix */}
        <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="game-card" style={{ flex: 1, padding: '8px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="0.5" y="0.5" width="4" height="4" rx="0.5" stroke="#D4A017" strokeWidth="1"/>
                <rect x="7.5" y="0.5" width="4" height="4" rx="0.5" stroke="#D4A017" strokeWidth="1"/>
                <rect x="0.5" y="7.5" width="4" height="4" rx="0.5" stroke="#D4A017" strokeWidth="1"/>
                <rect x="7.5" y="7.5" width="4" height="4" rx="0.5" stroke="#D4A017" strokeWidth="1"/>
              </svg>
              <span className="font-condensed" style={{ fontSize: 11, fontWeight: 700, color: '#D4A017', letterSpacing: '0.04em' }}>
                75-BALL MATRIX
              </span>
            </div>

            {/* BINGO header row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 2, marginBottom: 2 }}>
              {BINGO_COLS.map(col => (
                <div key={col} style={{
                  background: COL_BADGE_COLORS[col],
                  borderRadius: 3,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '3px 0',
                  fontSize: 11, fontWeight: 900, color: '#fff',
                  letterSpacing: '0.04em',
                }}>
                  {col}
                </div>
              ))}
            </div>

            {/* Number grid — 15 rows */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'grid', gridTemplateRows: 'repeat(15, 1fr)', gap: 2 }}>
              {Array.from({ length: 15 }, (_, row) => (
                <div key={row} style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 2 }}>
                  {BINGO_COLS.map(col => {
                    const num = getMatrixCell(col, row + 1)
                    const isCalled = calledSet.has(num)
                    const isLatest = num === LATEST_BALL
                    return (
                      <div
                        key={col}
                        className={`ball-cell${isCalled ? (isLatest ? ' latest' : ' called') : ''}`}
                        style={{ fontSize: 10 }}
                      >
                        {num}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Toggle demo button */}
      <div style={{ padding: '0 12px 24px', flexShrink: 0 }}>
        <button
          onClick={() => setPhase(p => p === 'waiting' ? 'active' : 'waiting')}
          style={{
            width: '100%', padding: '12px', borderRadius: 50,
            background: '#250d0d', border: '1px solid #5c1a1a',
            color: '#888', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'Oswald, sans-serif', letterSpacing: '0.06em',
          }}
        >
          TOGGLE: {phase === 'waiting' ? 'WAITING → ACTIVE' : 'ACTIVE → WAITING'}
        </button>

        <button
          onClick={() => navigate('/winner')}
          style={{
            width: '100%', marginTop: 8, padding: '12px',
            background: 'linear-gradient(to right, #c0392b, #ff6b00)',
            border: 'none', borderRadius: 50,
            color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer',
            fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.1em',
          }}
        >
          → SEE WINNER SCREEN
        </button>
      </div>
    </div>
  )
}

function StatChip({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{
      background: '#1e0909', border: '1px solid #5c1a1a',
      borderRadius: 6, padding: '3px 7px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <span style={{ fontSize: 8, color: '#777', letterSpacing: '0.04em', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 800, color: accent || '#fff' }}>{value}</span>
    </div>
  )
}
