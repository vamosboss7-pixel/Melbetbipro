import { useState } from 'react'

type RowProps = {
  icon: string
  label: string
  sublabel?: string
  right?: React.ReactNode
}

function Row({ icon, label, sublabel, right }: RowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px',
        borderBottom: '1px solid #2a0a0a',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="icon-sq" style={{ width: 38, height: 38, fontSize: 18 }}>
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{label}</div>
          {sublabel && <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>{sublabel}</div>}
        </div>
      </div>
      {right}
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!on)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: on ? '#E91E8C' : '#333',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        }}
      />
    </div>
  )
}

export default function SettingsPage() {
  const [sound, setSound] = useState(true)
  const [vibration, setVibration] = useState(true)
  const [notifications, setNotifications] = useState(false)

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(ellipse at 50% 35%, #2e0d10 0%, #180608 70%)',
        display: 'flex',
        flexDirection: 'column',
        padding: '0 0 100px',
      }}
    >
      {/* Header */}
      <div style={{ paddingTop: 48, marginBottom: 24, textAlign: 'center', padding: '48px 16px 24px' }}>
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 36 }}>⚙️</span>
        </div>
        <h1
          className="font-condensed"
          style={{ fontSize: 28, fontWeight: 800, letterSpacing: '0.08em', color: '#D4A017' }}
        >
          ሴቲንግ
        </h1>
        <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>ምርጫዎችዎን ያስተካክሉ</p>
      </div>

      {/* Sound & Display */}
      <div style={{ marginBottom: 8 }}>
        <div
          style={{
            fontSize: 10,
            color: '#666',
            fontWeight: 700,
            letterSpacing: '0.1em',
            padding: '0 16px',
            marginBottom: 4,
          }}
        >
          ድምፅ እና ማሳያ
        </div>
        <div className="game-card" style={{ margin: '0 16px', borderRadius: 12 }}>
          <Row
            icon="🔊"
            label="ድምፅ ተፅዕኖዎች"
            sublabel="የጨዋታ ድምፆችን ያብሩ/ያጥፉ"
            right={<Toggle on={sound} onChange={setSound} />}
          />
          <Row
            icon="📳"
            label="ንዝረት"
            sublabel="ስሜት ለምስጋናዎቹ"
            right={<Toggle on={vibration} onChange={setVibration} />}
          />
          <Row
            icon="🔔"
            label="ማሳወቂያዎች"
            sublabel="የጨዋታ ዝማኔዎችን ይቀበሉ"
            right={<Toggle on={notifications} onChange={setNotifications} />}
          />
        </div>
      </div>

      {/* About */}
      <div style={{ marginTop: 16 }}>
        <div
          style={{
            fontSize: 10,
            color: '#666',
            fontWeight: 700,
            letterSpacing: '0.1em',
            padding: '0 16px',
            marginBottom: 4,
          }}
        >
          ስለ መተግበሪያ
        </div>
        <div className="game-card" style={{ margin: '0 16px', borderRadius: 12 }}>
          <Row
            icon="ℹ️"
            label="ስሪት"
            sublabel="v1.0.0"
          />
          <Row
            icon="📜"
            label="የአጠቃቀም ደንቦች"
            right={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 4l4 4-4 4" stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
          />
          <Row
            icon="🔒"
            label="የግላዊነት ፖሊሲ"
            right={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 4l4 4-4 4" stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
          />
        </div>
      </div>
    </div>
  )
}
