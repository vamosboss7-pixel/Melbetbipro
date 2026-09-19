import { useLocation } from 'wouter'
import { usePlayer } from '../context/PlayerContext'
import { useGameReconnect } from '../hooks/useGameReconnect'

const LANDING_IMAGE = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/65f26669-43dc-4335-8306-c3da27e505c3-8MKl9kZkZK41SgVKsBhusEWi7CgtNz.png'

export default function LobbyPage() {
  const [, navigate] = useLocation()
  const { player } = usePlayer()

  useGameReconnect(player)

  return (
    <main
      style={{
        position: 'relative',
        width: '100%',
        height: '100dvh',
        minHeight: '100vh',
        overflow: 'hidden',
        background: '#031b14',
      }}
    >
      <img
        src={LANDING_IMAGE}
        alt="Kefta Bingo landing page with game features, winning rules, and an Enter Game call to action"
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center top',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '4.5%',
          left: '10%',
          width: '80%',
          height: '6.5%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f7f7f5',
          color: '#111',
          fontFamily: 'Arial, sans-serif',
          fontSize: 'clamp(20px, 7vw, 42px)',
          fontWeight: 900,
          letterSpacing: '0.02em',
          lineHeight: 1,
          zIndex: 1,
          pointerEvents: 'none',
        }}
      >
        KEFTA BINGO
      </div>
      <button
        type="button"
        aria-label="Enter game"
        onClick={() => navigate('/slots')}
        style={{
          position: 'absolute',
          top: '80.5%',
          left: '14%',
          width: '72%',
          height: '8%',
          border: 0,
          borderRadius: 999,
          background: 'transparent',
          cursor: 'pointer',
        }}
      />
    </main>
  )
}
