import { useLocation } from 'wouter'
import { usePlayer } from '../context/PlayerContext'
import { useGameReconnect } from '../hooks/useGameReconnect'

const INFO_CARDS = [
  ['🪙', 'ENTRY STAKE', '10 ETB'],
  ['✉', 'CARTELAS', 'UP TO 2'],
  ['ϟ', 'BALL DRAW', '2.0 SECS'],
  ['♛', 'PRIZE POOL', '80%'],
]

const RULES = [
  '5-IN-A-ROW (ROW, COL, DIAG)',
  'AUTOMATIC BINGO DETECTION',
  '500 GRAND SLOTS PER ROUND',
  'INSTANT WALLET PAYOUTS',
]

export default function LobbyPage() {
  const [, navigate] = useLocation()
  const { player } = usePlayer()
  useGameReconnect(player)

  return (
    <main className="landing-page">
      <section className="landing-hero" aria-label="Melbit Bingo welcome">
        <div className="landing-topbar">
          <div className="landing-wordmark"><span className="wordmark-crown">♛</span><span>MELBIT</span> <strong>BINGO</strong></div>
          <div className="safe-badge"><span>◆</span> SAFE &amp; FAIR PLAY</div>
        </div>
        <div className="landing-art" aria-hidden="true" />
        <div className="landing-copy">
          <p className="landing-kicker">MELBIT VELVET GRAND CASINO</p>
          <h1>PLAY <em>WIN</em> BIG</h1>
          <p className="landing-subtitle">Fast rounds. Real rewards. Every number counts.</p>
        </div>
      </section>

      <section className="landing-content">
        <div className="landing-info-grid">
          {INFO_CARDS.map(([icon, label, value]) => (
            <article className="landing-info-card" key={label}>
              <div className="landing-info-icon" aria-hidden="true">{icon}</div>
              <div><span>{label}</span><strong>{value}</strong><small>{label === 'ENTRY STAKE' ? 'Join with just 10 Birr' : label === 'CARTELAS' ? 'Play with up to 2 cards' : label === 'BALL DRAW' ? 'Fast & exciting play' : 'Big wins every round'}</small></div>
            </article>
          ))}
        </div>

        <article className="landing-rules">
          <div><span className="rules-trophy">♛</span><h2>WINNING <b>RULES &amp; PATTERNS</b></h2></div>
          <ul>{RULES.map((rule) => <li key={rule}><span>✓</span>{rule}</li>)}</ul>
        </article>

        <button className="landing-cta" onClick={() => navigate('/slots')} aria-label="Enter bingo game">
          <span aria-hidden="true">▶</span> ENTER GAME
        </button>
      </section>
    </main>
  )
}
