import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchTelegramPlayer, type Player } from '../hooks/useTelegramAuth'

interface PlayerContextValue {
  player: Player | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const PlayerContext = createContext<PlayerContextValue>({
  player: null,
  loading: true,
  error: null,
  refresh: async () => {},
})

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(() => {
    // Restore from sessionStorage so navigating between pages doesn't re-fetch
    try {
      const cached = sessionStorage.getItem('player')
      return cached ? (JSON.parse(cached) as Player) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(!player) // skip loading if already cached
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const p = await fetchTelegramPlayer()
      if (p) {
        setPlayer(p)
        sessionStorage.setItem('player', JSON.stringify(p))
      } else {
        // No Telegram WebApp context (e.g. opened in browser during dev)
        setError('Open this app through your Telegram bot to play.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Always re-fetch on mount to get fresh balance; cached value is shown immediately
    void load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <PlayerContext.Provider value={{ player, loading, error, refresh: load }}>
      {children}
    </PlayerContext.Provider>
  )
}

export function usePlayer() {
  return useContext(PlayerContext)
}
