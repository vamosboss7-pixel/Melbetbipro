import { useLocation } from 'wouter'

const INFO_CARDS = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="2"/>
        <path d="M12 6v6l4 2" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        <text x="12" y="15" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">$</text>
      </svg>
    ),
    iconEl: (
      <span style={{ fontSize: 18 }}>🪙</span>
    ),
    label: 'ENTRY STAKE',
    value: '10 ETB',
  },
  {
    iconEl: <span style={{ fontSize: 18 }}>✉️</span>,
    label: 'CARTELAS',
    value: 'UP TO 2',
  },
  {
    iconEl: <span style={{ fontSize: 18 }}>⚡</span>,
    label: 'BALL DRAW',
    value: '2.0 SECS',
  },
  {
    iconEl: <span style={{ fontSize: 18 }}>🏆</span>,
    label: 'PRIZE POOL',
    value: '80% DERASH',
  },
]

const RULES = [
  '5-IN-A-ROW (ROW, COL, DIAG)',
  'AUTOMATIC BINGO DETECTION',
  '500 GRAND SLOTS PER ROUND',
  'INSTANT WALLET PAYOUTS',
]

export default function LobbyPage() {
  const [, navigate] = useLocation()

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(ellipse at 50% 35%, #2e0d10 0%, #180608 70%)',
        display: 'flex',
        flexDirection: 'column',
        padding: '0 16px 100px',
        position: 'relative',
      }}
    >
      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 48 }}>

        {/* Crown */}
        <div style={{ marginBottom: 12 }}>
          <svg width="56" height="46" viewBox="0 0 56 46" fill="none">
            <path
              d="M4 38 L10 14 L20 26 L28 6 L36 26 L46 14 L52 38 Z"
              fill="none"
              stroke="#E91E8C"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <path
              d="M4 38 L10 14 L20 26 L28 6 L36 26 L46 14 L52 38"
              fill="#E91E8C"
              fillOpacity="0.15"
            />
            <rect x="2" y="38" width="52" height="6" rx="2" fill="#E91E8C" />
            <circle cx="4" cy="38" r="3" fill="#FF69B4" />
            <circle cx="28" cy="6" r="3" fill="#FF69B4" />
            <circle cx="52" cy="38" r="3" fill="#FF69B4" />
          </svg>
        </div>

        {/* Title */}
        <h1
          className="font-condensed"
          style={{
            fontSize: 36,
            fontWeight: 800,
            letterSpacing: '0.08em',
            color: '#D4A017',
            textAlign: 'center',
            lineHeight: 1.1,
            marginBottom: 4,
          }}
        >
          MELBIT BINGO
        </h1>

        {/* Subtitle */}
        <p
          className="font-condensed"
          style={{
            fontSize: 12,
            fontStyle: 'italic',
            color: '#C8960A',
            letterSpacing: '0.18em',
            textAlign: 'center',
            marginBottom: 32,
          }}
        >
          MELBIT VELVET GRAND CASINO
        </p>

        {/* Info Cards 2x2 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            width: '100%',
            marginBottom: 14,
          }}
        >
          {INFO_CARDS.map((card, i) => (
            <div
              key={i}
              className="game-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
              }}
            >
              <div
                className="icon-sq"
                style={{ width: 38, height: 38 }}
              >
                {card.iconEl}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: '#aaa',
                    letterSpacing: '0.06em',
                    marginBottom: 2,
                    fontWeight: 600,
                  }}
                >
                  {card.label}
                </div>
                <div
                  className="font-condensed"
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: '#D4A017',
                    letterSpacing: '0.04em',
                  }}
                >
                  {card.value}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Winning Rules */}
        <div
          className="game-card"
          style={{ width: '100%', padding: '14px 16px' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 10,
            }}
          >
            <span
              className="pulse-dot"
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#e53e3e',
                flexShrink: 0,
              }}
            />
            <span
              className="font-condensed"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#fff',
                letterSpacing: '0.06em',
              }}
            >
              WINNING RULES &amp; PATTERNS
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {RULES.map((rule, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7.5" fill="#16a34a" opacity="0.2" stroke="#16a34a" strokeWidth="1"/>
                  <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span
                  style={{
                    fontSize: 11,
                    color: '#ccc',
                    letterSpacing: '0.04em',
                    fontWeight: 500,
                  }}
                >
                  {rule}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Enter Game Button — fixed bottom */}
      <div
        style={{
          position: 'fixed',
          bottom: 68,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: 480,
          padding: '16px 16px 12px',
          background: 'linear-gradient(to top, #180608 70%, transparent)',
        }}
      >
        <button
          className="btn-enter"
          onClick={() => navigate('/slots')}
          style={{
            width: '100%',
            padding: '16px 0',
            fontSize: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <svg width="14" height="16" viewBox="0 0 14 16" fill="white">
            <path d="M0 0 L14 8 L0 16 Z" />
          </svg>
          <span className="font-condensed" style={{ letterSpacing: '0.12em', fontSize: 20, fontWeight: 800 }}>
            ENTER GAME
          </span>
        </button>
      </div>
    </div>
  )
}
