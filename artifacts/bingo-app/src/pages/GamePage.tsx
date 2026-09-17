import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { CARTELAS } from '../data/cartelas'
import { useGame } from '../hooks/useGame'
import { usePlayer } from '../context/PlayerContext'
import { useSoundSettings } from '../context/SoundContext'

const BINGO_COLS = ['B', 'I', 'N', 'G', 'O'] as const
const COL_RANGES: Record<string, [number, number]> = {
  B: [1, 15], I: [16, 30], N: [31, 45], G: [46, 60], O: [61, 75],
}
const COL_BADGE_COLORS: Record<string, string> = {
  B: '#aebf25', I: '#aebf25', N: '#aebf25', G: '#aebf25', O: '#aebf25',
}

function getBallCol(n: number): string {
  for (const [col, [start, end]] of Object.entries(COL_RANGES)) {
    if (n >= start && n <= end) return col
  }
  return 'B'
}

function getMatrixCell(col: string, row: number) {
  const [start] = COL_RANGES[col]
  return start + row - 1
}

function formatCountdown(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}S`
}

export default function GamePage() {
  const [, navigate] = useLocation()
  const { bgMusicEnabled, ballSoundEnabled, setBgMusic } = useSoundSettings()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ballAudioRef = useRef<HTMLAudioElement | null>(null)

  const [selectedSlots] = useState<number[]>(() => {
    try {
      const stored = sessionStorage.getItem('selectedSlots')
      return stored ? JSON.parse(stored) : []
    } catch { return [] }
  })

  const [jackpotGame, setJackpotGame] = useState<number>(0)
  const bingoAudioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    fetch('/api/jackpot/status')
      .then(r => r.json())
      .then((data: { pool: number; gameNumber: number }) => {
        setJackpotGame(Number(data.gameNumber ?? 0))
      })
      .catch(() => {/* ignore */})
  }, [])

  const { player } = usePlayer()
  const identity = player ? { telegramId: player.telegramId, firstName: player.firstName } : null
  const { connected, gameState, winner } = useGame(selectedSlots, identity)
  const calledSet = new Set(gameState.calledBalls)
  const COLS = ['B', 'I', 'N', 'G', 'O']

  // Navigate to winner page when winner is declared + play bingo sound
  useEffect(() => {
    if (winner) {
      // Stop background music
      if (audioRef.current) audioRef.current.muted = true
      // Play bingo claim sound
      const audio = new Audio('/audio/bingo-claim.mp3')
      audio.volume = 1.0
      bingoAudioRef.current = audio
      audio.play().catch(() => {})
      setTimeout(() => navigate('/winner'), 1500)
    }
  }, [winner, navigate])

  // Background music — react to bgMusicEnabled toggle
  useEffect(() => {
    const audio = new Audio('/audio/bg-music.mp3')
    audio.loop = true
    audio.volume = 0.35
    audio.muted = !bgMusicEnabled
    audioRef.current = audio
    audio.play().catch(() => {})
    return () => { audio.pause(); audio.src = '' }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = !bgMusicEnabled
  }, [bgMusicEnabled])

  // Ball call audio — plays /audio/balls/{COL}{NUMBER}.mp3 on each new draw
  useEffect(() => {
    if (!gameState.currentBall) return
    const col = getBallCol(gameState.currentBall)
    const src = `/audio/balls/${col}${gameState.currentBall}.mp3`

    // Stop previous ball audio if still playing
    if (ballAudioRef.current) {
      ballAudioRef.current.pause()
      ballAudioRef.current.src = ''
    }

    if (!ballSoundEnabled) return

    const audio = new Audio(src)
    audio.volume = 1.0
    ballAudioRef.current = audio
    audio.play().catch(() => {/* file may not exist yet */})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.currentBall, ballSoundEnabled])

  const recentBalls = [...gameState.calledBalls]
    .slice(-7)
    .reverse()
    .slice(1) // exclude the latest
    .map(n => ({ n, col: getBallCol(n) }))

  const latestBall = gameState.currentBall

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'radial-gradient(ellipse at 50% 25%, #123b2e 0%, #071a16 70%)', overflow: 'hidden' }}>

      {/* Top Header */}
      <header className="game-header">
        <div className="game-header-main">
          <button className="header-back-button" onClick={() => navigate('/slots')} title="ወደ ሎቢ ተመለስ" aria-label="ወደ ሎቢ ተመለስ">
            <span aria-hidden="true">←</span>
          </button>
          <div className="header-brand-mark" aria-hidden="true">MB</div>
          <div className="header-brand-copy">
            <div className="font-condensed header-brand-title">MELBIT BINGO</div>
            <div className="header-status-row">
              <span className={connected ? 'header-live-dot is-live' : 'header-live-dot'} aria-hidden="true" />
              <span>{connected ? 'LIVE' : 'CONNECTING...'}</span>
              <span className="header-divider" aria-hidden="true">·</span>
              <span>
                {gameState.phase === 'waiting'
                  ? 'ጨዋታ ይጀምራል...'
                  : gameState.phase === 'playing'
                  ? `${gameState.calledBalls.length}/75 BALLS`
                  : 'ROUND OVER'}
              </span>
            </div>
          </div>
          <div className="header-stats">
            <StatChip label="CARDS" value={String(gameState.playersWithCards)} />
            <StatChip label="CALLED" value={`${gameState.calledBalls.length}/75`} />
            <StatChip label="PRIZE" value={`${gameState.netPrizePool}`} accent="#e4e72b" />
          </div>
          <button className={`header-sound-button ${bgMusicEnabled ? 'is-on' : ''}`} onClick={() => setBgMusic(!bgMusicEnabled)} aria-label={bgMusicEnabled ? 'ድምፅ አጥፋ' : 'ድምፅ አብራ'}>
            <span aria-hidden="true">{bgMusicEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      </header>

      {/* Drawn Ball Section */}
      <div style={{ flexShrink: 0, padding: '10px 12px 0' }}>
        <div className="game-card" style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Ball circle */}
            <div
              className="dashed-circle"
              style={{
                width: 62, height: 62, flexShrink: 0,
                ...(latestBall ? {
                  background: 'linear-gradient(135deg, #2d6b57, #f4d52b)',
                  border: '2px solid #e4e72b',
                  boxShadow: '0 0 16px rgba(241,216,42,0.45)',
                } : {}),
              }}
            >
              {latestBall ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{latestBall}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{getBallCol(latestBall)}</div>
                </div>
              ) : (
                <div style={{ width: 16, height: 3, background: '#2b624e', borderRadius: 2 }} />
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <span style={{ fontSize: 12 }}>⚙️</span>
                <span className="font-condensed" style={{ fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>
                  {gameState.phase === 'waiting' ? 'WAITING FOR PLAYERS' : 'DRAWN BALL'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                {gameState.phase === 'waiting'
                  ? `ዙር ይጀምራል... ${formatCountdown(gameState.countdown)}`
                  : latestBall
                  ? `Column ${getBallCol(latestBall)} • #${latestBall}`
                  : 'Awaiting draw...'}
              </div>
              {/* Recent balls */}
              {recentBalls.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {recentBalls.map((b, i) => (
                    <div key={i} style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: COL_BADGE_COLORS[b.col] || '#333',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0,
                    }}>{b.n}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main game area */}
      <div style={{ flex: 1, display: 'flex', gap: 8, padding: '10px 12px 12px', overflow: 'hidden' }}>

        {/* Left: Your Cartelas */}
        <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="game-card" style={{ flex: 1, padding: '10px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 12 }}>🎴</span>
              <span className="font-condensed" style={{ fontSize: 11, fontWeight: 700, color: '#e4e72b', letterSpacing: '0.04em' }}>
                YOUR CARTELAS ({selectedSlots.length})
              </span>
              {selectedSlots.length > 0 && gameState.phase === 'playing' && (
                <span style={{
                  background: '#166534', border: '1px solid #22c55e',
                  borderRadius: 4, padding: '1px 6px',
                  fontSize: 9, fontWeight: 700, color: '#22c55e', letterSpacing: '0.04em'
                }}>IN PLAY</span>
              )}
            </div>

            {selectedSlots.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e4e72b', lineHeight: 1.4 }}>
                  ካርቴላ አልተመረጠም
                </div>
                <div style={{ fontSize: 10, color: '#888' }}>ወደ ስሎት ይሂዱ</div>
              </div>
            ) : (
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {selectedSlots.map((slotNum, idx) => {
                  const card = CARTELAS[slotNum - 1]
                  if (!card) return null
                  return (
                    <div key={slotNum} style={{
                      flex: 1,
                      minHeight: 0,
                      border: '1.5px solid #2d6b57',
                      borderRadius: 10,
                      padding: '5px 7px 4px',
                      boxShadow: '0 0 8px rgba(45,156,113,0.28), inset 0 0 4px rgba(45,156,113,0.08)',
                      background: '#102d24',
                      display: 'flex',
                      flexDirection: 'column',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3, flexShrink: 0 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#888' }}>CARTELA {idx + 1}</span>
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#e4e72b' }}>#{slotNum}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 2, marginBottom: 2, flexShrink: 0 }}>
                        {COLS.map(c => (
                          <div key={c} style={{ textAlign: 'center', fontSize: 8, fontWeight: 800, color: '#e4e72b' }}>{c}</div>
                        ))}
                      </div>
                      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gridTemplateRows: 'repeat(5, 1fr)', gap: 2 }}>
                        {card.map((row, r) =>
                          row.map((num, c) => {
                            const isFree = num === 0
                            const isCalled = !isFree && calledSet.has(num)
                            return (
                              <div key={`${r}-${c}`} style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                borderRadius: 3,
                                background: isFree
                                  ? 'linear-gradient(135deg,#2d6b57,#f4d52b)'
                                  : isCalled
                                  ? 'linear-gradient(135deg,#166534,#22c55e)'
                                  : '#102d24',
                                border: (isFree || isCalled) ? 'none' : '1px solid #214b3e',
                                fontSize: isFree ? 9 : 7,
                                fontWeight: 700,
                                color: '#fff',
                                lineHeight: 1,
                                transition: 'background 0.3s',
                                overflow: 'hidden',
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

          {/* Jackpot Banner */}
          <div style={{
            marginTop: 6,
            flexShrink: 0,
            borderRadius: 10,
            overflow: 'hidden',
            border: '1.5px solid #b8860b',
            background: 'linear-gradient(135deg, #0f2f25 0%, #174738 50%, #0f2f25 100%)',
            boxShadow: '0 0 12px rgba(212,160,23,0.25)',
            padding: '8px 10px',
          }}>
            {/* Top row: trophy + JACKPOT label + amount */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 14 }}>🏆</span>
                <span className="font-condensed" style={{
                  fontSize: 11, fontWeight: 900, letterSpacing: '0.1em',
                  background: 'linear-gradient(90deg, #FFD700, #FFA500)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>JACKPOT</span>
                <span style={{
                  background: '#536115', border: '1px solid #e4e72b',
                  borderRadius: 3, padding: '0px 5px',
                  fontSize: 8, fontWeight: 700, color: '#FFD700', letterSpacing: '0.05em',
                }}>ACTIVE</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontSize: 14, fontWeight: 900,
                  background: 'linear-gradient(90deg, #FFD700, #FFA500)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  lineHeight: 1,
                }}>{gameState.jackpotPool.toFixed(2)} ETB</div>
                <div style={{ fontSize: 8, color: '#888', marginTop: 1 }}>Game #{jackpotGame}</div>
              </div>
            </div>
            {/* Divider */}
            <div style={{ borderTop: '1px solid #255643', margin: '4px 0' }} />
            {/* Promo text */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: '#FFD700', letterSpacing: '0.04em', lineHeight: 1.4 }}>
                በየአስር ጨዋታ ድርብ ድል
              </div>
              <div style={{ fontSize: 8, color: '#aaa', letterSpacing: '0.03em' }}>
                Double Win Every 10 Games
              </div>
            </div>
          </div>
        </div>

        {/* Right: 75-Ball Matrix */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="game-card" style={{ flex: 1, padding: '6px 5px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <rect x="0.5" y="0.5" width="4" height="4" rx="0.5" stroke="#e4e72b" strokeWidth="1"/>
                <rect x="7.5" y="0.5" width="4" height="4" rx="0.5" stroke="#e4e72b" strokeWidth="1"/>
                <rect x="0.5" y="7.5" width="4" height="4" rx="0.5" stroke="#e4e72b" strokeWidth="1"/>
                <rect x="7.5" y="7.5" width="4" height="4" rx="0.5" stroke="#e4e72b" strokeWidth="1"/>
              </svg>
              <span className="font-condensed" style={{ fontSize: 10, fontWeight: 700, color: '#e4e72b', letterSpacing: '0.04em' }}>
                75-BALL MATRIX
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, marginBottom: 1 }}>
              {BINGO_COLS.map(col => (
                <div key={col} style={{
                  background: COL_BADGE_COLORS[col],
                  borderRadius: 2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '2px 0', fontSize: 10, fontWeight: 900, color: '#fff',
                }}>{col}</div>
              ))}
            </div>

            <div style={{ flex: 1, overflow: 'hidden', display: 'grid', gridTemplateRows: 'repeat(15, 1fr)', gap: 1 }}>
              {Array.from({ length: 15 }, (_, row) => (
                <div key={row} style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, minWidth: 0 }}>
                  {BINGO_COLS.map(col => {
                    const num = getMatrixCell(col, row + 1)
                    const isCalled = calledSet.has(num)
                    const isLatest = num === latestBall
                    return (
                      <div
                        key={col}
                        className={`ball-cell${isCalled ? (isLatest ? ' latest' : ' called') : ''}`}
                        style={{ fontSize: 9, minWidth: 0 }}
                      >{num}</div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Winner overlay */}
      {winner && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
        }}>
          <div style={{ fontSize: 52 }}>🏆</div>
          <div className="font-condensed" style={{ fontSize: 28, fontWeight: 900, color: '#e4e72b', textAlign: 'center' }}>
            BINGO!
          </div>
          <div style={{ fontSize: 14, color: '#fff', fontWeight: 700 }}>
            {winner.winners[0]?.firstName ?? 'Winner'} wins {winner.prizePerWinner} ETB
          </div>
          <div style={{ fontSize: 11, color: '#888' }}>ወደ ዊነር ስክሪን እየሄደ ነው...</div>
        </div>
      )}
    </div>
  )
}

function StatChip({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{
      background: '#102d24', border: '1px solid #2b624e',
      borderRadius: 6, padding: '3px 7px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <span style={{ fontSize: 8, color: '#777', letterSpacing: '0.04em', fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 800, color: accent || '#fff' }}>{value}</span>
    </div>
  )
}
