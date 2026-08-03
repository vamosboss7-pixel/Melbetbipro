export interface Player {
  id: number
  telegramId: number
  firstName: string
  lastName: string | null
  username: string | null
  photoUrl: string | null
  balance: string
  mainBalance: string
  bonusBalance: string
  wageringRequired?: string
  wageringCompleted?: string
  hasActiveWagering?: boolean
  role: string
}

/**
 * Authenticates with the API server using Telegram WebApp initData.
 * Returns the player record on success, null if Telegram context is unavailable.
 * Throws on server/network errors.
 */
export async function fetchTelegramPlayer(): Promise<Player | null> {
  const twa = (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp
  if (!twa?.initData) return null

  const res = await fetch('/api/auth/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: twa.initData }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Auth failed: ${res.status}`)
  }

  const data = await res.json() as { player?: Player }
  return data.player ?? null
}
