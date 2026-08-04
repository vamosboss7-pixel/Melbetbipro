import { useState } from 'react'
import { usePlayer } from '../context/PlayerContext'

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

type BalancePref = 'main_first' | 'bonus_first'

function BalanceOption({
  value,
  selected,
  title,
  subtitle,
  badge,
  badgeColor,
  onSelect,
  saving,
}: {
  value: BalancePref
  selected: boolean
  title: string
  subtitle: string
  badge: string
  badgeColor: string
  onSelect: (v: BalancePref) => void
  saving: boolean
}) {
  return (
    <div
      onClick={() => !saving && onSelect(value)}
      style={{
        flex: 1,
        padding: '12px 10px',
        borderRadius: 10,
        border: `2px solid ${selected ? '#E91E8C' : '#2a0a0a'}`,
        background: selected ? 'rgba(233,30,140,0.10)' : 'rgba(255,255,255,0.03)',
        cursor: saving ? 'default' : 'pointer',
        transition: 'border-color 0.2s, background 0.2s',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        opacity: saving ? 0.7 : 1,
      }}
    >
      {/* Badge */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: badgeColor,
          background: `${badgeColor}22`,
          borderRadius: 4,
          padding: '2px 7px',
        }}
      >
        {badge}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: selected ? '#fff' : '#aaa', textAlign: 'center' }}>
        {title}
      </div>
      <div style={{ fontSize: 10, color: '#666', textAlign: 'center', lineHeight: 1.4 }}>{subtitle}</div>
      {/* Radio dot */}
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: `2px solid ${selected ? '#E91E8C' : '#555'}`,
          background: selected ? '#E91E8C' : 'transparent',
          marginTop: 2,
          transition: 'background 0.2s, border-color 0.2s',
        }}
      />
    </div>
  )
}

export default function SettingsPage() {
  const { player, updatePlayer } = usePlayer()
  const [sound, setSound] = useState(true)
  const [vibration, setVibration] = useState(true)
  const [notifications, setNotifications] = useState(false)

  const currentPref: BalancePref = (player?.preferredBalance as BalancePref) ?? 'main_first'
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const handleBalancePref = async (pref: BalancePref) => {
    if (!player || pref === currentPref || saving) return
    const initData = (window as Window & { Telegram?: { WebApp?: { initData?: string } } })
      .Telegram?.WebApp?.initData
    if (!initData) {
      setSaveError('Telegram context unavailable')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/player/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData, preferredBalance: pref }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setSaveError(body.error ?? 'ስህተት ተፈጥሯል')
        return
      }
      updatePlayer({ preferredBalance: pref })
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1800)
    } catch {
      setSaveError('ኔትወርክ ስህተት ተፈጥሯል')
    } finally {
      setSaving(false)
    }
  }

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

      {/* Balance Preference */}
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
          የባላንስ ምርጫ
        </div>
        <div className="game-card" style={{ margin: '0 16px', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div className="icon-sq" style={{ width: 38, height: 38, fontSize: 18 }}>💳</div>
            <div>
              <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>መጫወቻ ባላንስ</div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>
                ለስቴክ ክፍያ ከየትኛው ባላንስ ቀድሞ ይቀነስ
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <BalanceOption
              value="main_first"
              selected={currentPref === 'main_first'}
              title="ዋና ባላንስ አስቀድሞ"
              subtitle="ዲፖዚት ETB ቀድሞ ይቀነሳል"
              badge="Main"
              badgeColor="#4CAF50"
              onSelect={handleBalancePref}
              saving={saving}
            />
            <BalanceOption
              value="bonus_first"
              selected={currentPref === 'bonus_first'}
              title="ቦነስ ባላንስ አስቀድሞ"
              subtitle="ቦነስ ሂሳብ ቀድሞ ይቀነሳል"
              badge="Bonus"
              badgeColor="#FF9800"
              onSelect={handleBalancePref}
              saving={saving}
            />
          </div>

          {/* Status messages */}
          {saving && (
            <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: '#888' }}>
              በማስቀመጥ ላይ...
            </div>
          )}
          {savedFlash && !saving && (
            <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: '#4CAF50', fontWeight: 600 }}>
              ✓ ተቀምጧል
            </div>
          )}
          {saveError && !saving && (
            <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: '#f44336' }}>
              {saveError}
            </div>
          )}
        </div>
      </div>

      {/* Sound & Display */}
      <div style={{ marginBottom: 8, marginTop: 8 }}>
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
