import { usePlayer } from '../context/PlayerContext'

export default function ProfilePage() {
  const { player, loading } = usePlayer()

  const displayName = player
    ? [player.firstName, player.lastName].filter(Boolean).join(' ') || player.username || `Player #${player.telegramId}`
    : '—'

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(ellipse at 50% 35%, #2e0d10 0%, #180608 70%)',
        display: 'flex',
        flexDirection: 'column',
        padding: '0 16px 100px',
      }}
    >
      {/* Header */}
      <div style={{ paddingTop: 48, marginBottom: 28, textAlign: 'center' }}>
        {/* Avatar circle */}
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #c0392b, #E91E8C)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px',
            fontSize: 32,
            boxShadow: '0 0 20px rgba(233,30,140,0.4)',
          }}
        >
          {loading ? '…' : (player?.firstName?.[0] ?? player?.username?.[0] ?? '?')}
        </div>

        <h1
          className="font-condensed"
          style={{ fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '0.04em' }}
        >
          {loading ? 'በማስጀመር ላይ...' : displayName}
        </h1>
        {player?.username && (
          <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>@{player.username}</p>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'ዲፖዚት', value: `${parseFloat(player?.depositBalance ?? '0').toFixed(2)} ETB`, icon: '💳' },
          { label: 'ሜን ዋሌት', value: `${parseFloat(player?.mainBalance ?? '0').toFixed(2)} ETB`, icon: '💵' },
          { label: 'ቦነስ', value: `${parseFloat(player?.bonusBalance ?? '0').toFixed(2)} ETB`, icon: '🎁' },
          { label: 'ደረጃ', value: player?.role ?? '—', icon: '⭐' },
        ].map((stat, i) => (
          <div
            key={i}
            className="game-card"
            style={{ padding: '14px 16px', textAlign: 'center' }}
          >
            <div style={{ fontSize: 22, marginBottom: 6 }}>{stat.icon}</div>
            <div
              className="font-condensed"
              style={{ fontSize: 18, fontWeight: 700, color: '#D4A017' }}
            >
              {loading ? '...' : stat.value}
            </div>
            <div style={{ fontSize: 10, color: '#888', marginTop: 2, fontWeight: 600 }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Player ID */}
      {player && (
        <div
          className="game-card"
          style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="icon-sq" style={{ width: 36, height: 36 }}>
              <span style={{ fontSize: 16 }}>🆔</span>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#aaa', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 1 }}>
                TELEGRAM ID
              </div>
              <div className="font-condensed" style={{ fontSize: 15, color: '#fff', fontWeight: 600 }}>
                {player.telegramId}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
