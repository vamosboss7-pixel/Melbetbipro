import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

export type GamePhase = 'waiting' | 'playing' | 'finished'

export interface GameState {
  roundId: string
  phase: GamePhase
  countdown: number
  playerCount: number
  playersWithCards: number
  prizePool: number
  netPrizePool: number
  calledBalls: number[]
  currentBall: number | null
}

export interface Winner {
  telegramId: number
  firstName: string
  cardId: number
  card: number[][]
  winPattern: number[]
}

export interface WinnerEvent {
  roundId: string
  winners: Winner[]
  prizePerWinner: number
}

const DEFAULT_STATE: GameState = {
  roundId: '',
  phase: 'waiting',
  countdown: 0,
  playerCount: 0,
  playersWithCards: 0,
  prizePool: 0,
  netPrizePool: 0,
  calledBalls: [],
  currentBall: null,
}

function getGuestIdentity() {
  let id = sessionStorage.getItem('guestId')
  if (!id) {
    id = String(Math.floor(Math.random() * 9_000_000) + 1_000_000)
    sessionStorage.setItem('guestId', id)
  }
  return { telegramId: Number(id), firstName: 'Guest' }
}

export function useGame(selectedCardIds: number[]) {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [gameState, setGameState] = useState<GameState>(DEFAULT_STATE)
  const [winner, setWinner] = useState<WinnerEvent | null>(null)
  const [myCardIds, setMyCardIds] = useState<number[]>([])
  const [takenCardIds, setTakenCardIds] = useState<number[]>([])
  const cardsSelectedRef = useRef(false)

  useEffect(() => {
    const { telegramId, firstName } = getGuestIdentity()
    cardsSelectedRef.current = false

    const socket = io({
      path: '/api/socket.io',
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join_room', { telegramId, firstName })
      // Select cards immediately after joining
      if (selectedCardIds.length > 0) {
        selectedCardIds.forEach(id => socket.emit('select_card', id))
        cardsSelectedRef.current = true
      }
    })

    socket.on('disconnect', () => setConnected(false))

    socket.on('game_state', (state: GameState) => {
      setGameState(state)
      // If we haven't sent our cards yet and it's waiting phase, send them now
      if (!cardsSelectedRef.current && state.phase === 'waiting' && selectedCardIds.length > 0) {
        selectedCardIds.forEach(id => socket.emit('select_card', id))
        cardsSelectedRef.current = true
      }
    })

    socket.on('ball_called', (data: { ball: number; col: string; calledBalls: number[] }) => {
      if (data.ball != null) {
        setGameState(prev => ({
          ...prev,
          calledBalls: data.calledBalls,
          currentBall: data.ball,
        }))
      }
    })

    socket.on('winner_declared', (data: WinnerEvent) => {
      setWinner(data)
      sessionStorage.setItem('winnerData', JSON.stringify(data))
    })

    socket.on('round_reset', () => {
      setWinner(null)
      setMyCardIds([])
      cardsSelectedRef.current = false
      setGameState(DEFAULT_STATE)
    })

    socket.on('my_cards', (data: { cardIds: number[] }) => {
      setMyCardIds(data.cardIds)
    })

    socket.on('cards_taken', (data: { cardIds: number[] }) => {
      setTakenCardIds(data.cardIds)
    })

    socket.on('player_count', (data: { count: number }) => {
      setGameState(prev => ({ ...prev, playerCount: data.count }))
    })

    return () => { socket.disconnect() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { connected, gameState, winner, myCardIds, takenCardIds }
}
