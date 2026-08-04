import { useLocation } from 'wouter'

const TABS = [
  {
    path: '/',
    label: 'ጨዋታ',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="8" height="8" rx="2" fill={active ? '#E91E8C' : '#888'} />
        <rect x="13" y="3" width="8" height="8" rx="2" fill={active ? '#E91E8C' : '#888'} />
        <rect x="3" y="13" width="8" height="8" rx="2" fill={active ? '#E91E8C' : '#888'} />
        <rect x="13" y="13" width="8" height="8" rx="2" fill={active ? '#E91E8C' : '#888'} />
      </svg>
    ),
  },
  {
    path: '/wallet',
    label: 'ዋሌት',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="6" width="20" height="14" rx="3" stroke={active ? '#E91E8C' : '#888'} strokeWidth="2" />
        <path d="M2 10h20" stroke={active ? '#E91E8C' : '#888'} strokeWidth="2" />
        <circle cx="17" cy="15" r="2" fill={active ? '#E91E8C' : '#888'} />
        <path d="M7 6V5a3 3 0 0 1 6 0v1" stroke={active ? '#E91E8C' : '#888'} strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    path: '/profile',
    label: 'ፕሮፋይል',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="4" stroke={active ? '#E91E8C' : '#888'} strokeWidth="2" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={active ? '#E91E8C' : '#888'} strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    path: '/settings',
    label: 'ሴቲንግ',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3" stroke={active ? '#E91E8C' : '#888'} strokeWidth="2" />
        <path
          d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
          stroke={active ? '#E91E8C' : '#888'}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
]

export default function BottomNav() {
  const [location, navigate] = useLocation()

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 480,
        background: '#160406',
        borderTop: '1.5px solid #3a1010',
        display: 'flex',
        zIndex: 100,
        paddingBottom: 'env(safe-area-inset-bottom, 8px)',
      }}
    >
      {TABS.map((tab) => {
        const active = location === tab.path
        return (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              padding: '10px 0 8px',
              position: 'relative',
            }}
          >
            {active && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 32,
                  height: 2,
                  background: '#E91E8C',
                  borderRadius: '0 0 4px 4px',
                }}
              />
            )}
            {tab.icon(active)}
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: active ? '#E91E8C' : '#666',
                letterSpacing: '0.04em',
                fontFamily: 'inherit',
              }}
            >
              {tab.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
