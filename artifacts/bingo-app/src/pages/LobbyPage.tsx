import { useLocation } from 'wouter'
import { usePlayer } from '../context/PlayerContext'
import { useGameReconnect } from '../hooks/useGameReconnect'

export default function LobbyPage() {
  const [, navigate] = useLocation()
  const { player } = usePlayer()
  useGameReconnect(player)

  return (
    <main className="landing-page">
      <section className="landing-poster" aria-label="Melbit Bingo welcome">
        <img src="/melbit-bingo-landing.png" alt="Melbit Bingo: play, win big" />
        <button className="landing-cta" onClick={() => navigate('/slots')} aria-label="Enter bingo game">
          <span aria-hidden="true">▶</span> ENTER GAME
        </button>
      </section>
    </main>
  )
}
