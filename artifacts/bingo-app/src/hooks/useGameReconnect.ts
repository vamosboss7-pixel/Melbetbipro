import { useEffect } from 'react'
import { useLocation } from 'wouter'
import { io } from 'socket.io-client'
import type { Player } from './useTelegramAuth'

/**
 * On app open, briefly connects to the game socket and checks whether the
 * player has an active game in progress. If so, automatically navigates them
 * back to the correct screen (/game or /slots) instead of staying on the lobby.
 *
 * Only fires when the player is on the lobby ("/") — does not interfere with
 * navigations on other pages.
 */
export function useGameReconnect(player: Player | null) {
  const [location, navigate] = useLocation()

  useEffect(() => {
    // Only run from the lobby, and only when player is authenticated
    if (location !== '/' || !player) return

    const socket = io({ path: '/api/socket.io', transports: ['websocket', 'polling'] })
    let redirected = false
    let latestPhase = 'waiting'

    socket.on('connect', () => {
      socket.emit('join_room', { telegramId: player.telegramId, firstName: player.firstName })
    })

    // game_state always arrives before my_cards — capture the phase
    socket.on('game_state', (state: { phase: string }) => {
      latestPhase = state.phase
    })

    // my_cards is only sent when the server has cards for this player
    socket.on('my_cards', (data: { cardIds: number[] }) => {
      if (redirected || data.cardIds.length === 0) {
        socket.disconnect()
        return
      }
      redirected = true
      socket.disconnect()

      if (latestPhase === 'playing' || latestPhase === 'finished') {
        // Restore cards to sessionStorage so GamePage can pick them up
        sessionStorage.setItem('selectedSlots', JSON.stringify(data.cardIds))
        navigate('/game')
      } else {
        // waiting phase — card selection is still open; go back to slots page
        navigate('/slots')
      }
    })

    // Safety timeout: if server never sends my_cards within 4 s, no active game
    const timeout = setTimeout(() => {
      if (!redirected) socket.disconnect()
    }, 4000)

    return () => {
      clearTimeout(timeout)
      socket.disconnect()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, location])
}
