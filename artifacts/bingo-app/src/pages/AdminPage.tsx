import { useState, useEffect, useCallback } from 'react'

const TOKEN_KEY = 'admin_session_token'

function getToken() {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}
function saveToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t)
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-admin-token': getToken(), ...extra }
}

async function apiPost(path: string, body: object) {
  const res = await fetch(path, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  return res.json()
}

async function apiGet(path: string) {
  const res = await fetch(path, { headers: authHeaders() })
  return res.json()
}

// ──────────────────────────────────────────────
// Login screen
// ──────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErr('')
    try {
      const res = await fetch('/api/admin/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      const data = await res.json()
      if (data.ok && data.token) {
        saveToken(data.token)
        onLogin()
      } else {
        setErr('❌ ፓስወርድ ትክክል አይደለም')
      }
    } catch {
      setErr('❌ ሰርቨር ምላሽ አልሰጠም')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(ellipse at 50% 30%, #0d1a2e 0%, #07080f 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 18,
          padding: '36px 28px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔐</div>
        <h1
          className="font-condensed"
          style={{ fontSize: 26, fontWeight: 800, color: '#D4A017', letterSpacing: '0.06em', marginBottom: 6 }}
        >
          ADMIN PANEL
        </h1>
        <p style={{ fontSize: 12, color: '#666', marginBottom: 28 }}>መልካም Bingo · አስተዳዳሪ</p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            type="password"
            placeholder="ፓስወርድ ያስገቡ…"
            value={pw}
            onChange={e => setPw(e.target.value)}
            autoFocus
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              border: '1.5px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.07)',
              color: '#fff',
              fontSize: 15,
              outline: 'none',
              textAlign: 'center',
              letterSpacing: '0.15em',
            }}
          />
          {err && (
            <div style={{ fontSize: 13, color: '#f87171', marginTop: -4 }}>{err}</div>
          )}
          <button
            type="submit"
            disabled={loading || !pw}
            className="btn-enter"
            style={{
              padding: '14px 0',
              fontSize: 15,
              fontWeight: 700,
              border: 'none',
              cursor: loading || !pw ? 'not-allowed' : 'pointer',
              opacity: !pw ? 0.5 : 1,
            }}
          >
            {loading ? 'እየገባ…' : 'ግባ'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// Stat card
// ──────────────────────────────────────────────
function StatCard({ label, value, sub, color = '#D4A017' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div
      className="game-card"
      style={{ padding: '14px 16px', flex: 1, minWidth: 0, textAlign: 'center' }}
    >
      <div style={{ fontSize: 10, color: '#888', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div className="font-condensed" style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ──────────────────────────────────────────────
// Shared types
// ──────────────────────────────────────────────
interface Deposit {
  id: number
  telegramId: number
  amount: string
  phone?: string
  note?: string
  screenshotUrl?: string
  createdAt: string
  status: string
}

interface Withdrawal {
  id: number
  telegramId: number
  amount: string
  phone: string
  note?: string
  createdAt: string
  status: string
}

// ──────────────────────────────────────────────
// Deposits tab
// ──────────────────────────────────────────────
function DepositsTab() {
  const [items, setItems] = useState<Deposit[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet(`/api/admin/deposits?status=${tab}&telegramId=0`)
      setItems(data.deposits ?? [])
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { void load() }, [load])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  async function approve(id: number) {
    setBusy(id)
    try {
      const res = await apiPost(`/api/admin/deposit/${id}/approve`, { telegramId: 0 })
      if (res.success) {
        showToast('✅ ዲፖዚት ተፈቅዷል')
        setItems(prev => prev.filter(d => d.id !== id))
      } else {
        showToast(`❌ ${res.error ?? 'ስህተት'}`)
      }
    } finally {
      setBusy(null)
    }
  }

  async function reject(id: number) {
    setBusy(id)
    try {
      const res = await apiPost(`/api/admin/deposit/${id}/reject`, { telegramId: 0 })
      if (res.success) {
        showToast('🚫 ዲፖዚት ተሰርዟል')
        setItems(prev => prev.filter(d => d.id !== id))
      } else {
        showToast(`❌ ${res.error ?? 'ስህተት'}`)
      }
    } finally {
      setBusy(null)
    }
  }

  const tabStyle = (active: boolean) => ({
    padding: '7px 16px',
    fontSize: 12,
    fontWeight: 700,
    border: 'none',
    borderRadius: 20,
    cursor: 'pointer',
    background: active ? '#D4A017' : 'rgba(255,255,255,0.07)',
    color: active ? '#000' : '#aaa',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: '#1a1a1a', border: '1px solid #333', borderRadius: 10,
          padding: '10px 20px', color: '#fff', fontSize: 13, zIndex: 999, whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(['pending', 'approved', 'rejected'] as const).map(s => (
          <button key={s} style={tabStyle(tab === s)} onClick={() => setTab(s)}>
            {s === 'pending' ? '⏳ ያልተፈቀዱ' : s === 'approved' ? '✅ የተፈቀዱ' : '❌ የተሰረዙ'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#666', padding: 24 }}>እየጫነ…</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#555', padding: 32, fontSize: 13 }}>
          {tab === 'pending' ? 'ምንም ያልተፈቀደ ዲፖዚት የለም ✓' : 'ምንም ዝርዝር የለም'}
        </div>
      ) : (
        items.map(dep => (
          <div
            key={dep.id}
            className="game-card"
            style={{ padding: '14px 16px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, color: '#D4A017', fontWeight: 700 }}>
                  #{dep.id} · {Number(dep.amount).toFixed(0)} ብር
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  Telegram: {dep.telegramId}
                </div>
                {dep.phone && (
                  <div style={{ fontSize: 11, color: '#aaa' }}>📞 {dep.phone}</div>
                )}
                {dep.note && (
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>💬 {dep.note}</div>
                )}
                <div style={{ fontSize: 10, color: '#555', marginTop: 3 }}>
                  {new Date(dep.createdAt).toLocaleString('am-ET')}
                </div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#f97316' }}>
                {Number(dep.amount).toFixed(0)}
                <span style={{ fontSize: 10, color: '#888', marginLeft: 2 }}>ETB</span>
              </div>
            </div>

            {dep.screenshotUrl && (
              <a
                href={dep.screenshotUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'block', fontSize: 11, color: '#60a5fa', marginBottom: 8 }}
              >
                📷 Screenshot ይመልከቱ
              </a>
            )}

            {tab === 'pending' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={() => approve(dep.id)}
                  disabled={busy === dep.id}
                  style={{
                    flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700,
                    background: busy === dep.id ? '#333' : 'linear-gradient(135deg, #16a34a, #15803d)',
                    color: '#fff', border: 'none', borderRadius: 10, cursor: busy === dep.id ? 'wait' : 'pointer',
                  }}
                >
                  {busy === dep.id ? '…' : '✅ ፍቀድ'}
                </button>
                <button
                  onClick={() => reject(dep.id)}
                  disabled={busy === dep.id}
                  style={{
                    flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700,
                    background: busy === dep.id ? '#333' : 'rgba(220,38,38,0.15)',
                    color: '#f87171', border: '1px solid rgba(220,38,38,0.4)',
                    borderRadius: 10, cursor: busy === dep.id ? 'wait' : 'pointer',
                  }}
                >
                  ❌ ሰርዝ
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

// ──────────────────────────────────────────────
// Withdrawals tab
// ──────────────────────────────────────────────
function WithdrawalsTab() {
  const [items, setItems] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet(`/api/admin/withdrawals?status=${tab}&telegramId=0`)
      setItems(data.withdrawals ?? [])
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { void load() }, [load])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  async function approve(id: number) {
    setBusy(id)
    try {
      const res = await apiPost(`/api/admin/withdrawal/${id}/approve`, { telegramId: 0 })
      if (res.success) {
        showToast('✅ ዊዝድሮው ተፈቅዷል')
        setItems(prev => prev.filter(w => w.id !== id))
      } else {
        showToast(`❌ ${res.error ?? 'ስህተት'}`)
      }
    } finally {
      setBusy(null)
    }
  }

  async function reject(id: number) {
    setBusy(id)
    try {
      const res = await apiPost(`/api/admin/withdrawal/${id}/reject`, { telegramId: 0 })
      if (res.success) {
        showToast('🚫 ዊዝድሮው ተሰርዟል')
        setItems(prev => prev.filter(w => w.id !== id))
      } else {
        showToast(`❌ ${res.error ?? 'ስህተት'}`)
      }
    } finally {
      setBusy(null)
    }
  }

  const tabStyle = (active: boolean) => ({
    padding: '7px 16px',
    fontSize: 12,
    fontWeight: 700,
    border: 'none',
    borderRadius: 20,
    cursor: 'pointer',
    background: active ? '#D4A017' : 'rgba(255,255,255,0.07)',
    color: active ? '#000' : '#aaa',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: '#1a1a1a', border: '1px solid #333', borderRadius: 10,
          padding: '10px 20px', color: '#fff', fontSize: 13, zIndex: 999, whiteSpace: 'nowrap',
        }}>{toast}</div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(['pending', 'approved', 'rejected'] as const).map(s => (
          <button key={s} style={tabStyle(tab === s)} onClick={() => setTab(s)}>
            {s === 'pending' ? '⏳ ያልተፈቀዱ' : s === 'approved' ? '✅ የተፈቀዱ' : '❌ የተሰረዙ'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#666', padding: 24 }}>እየጫነ…</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#555', padding: 32, fontSize: 13 }}>
          {tab === 'pending' ? 'ምንም ያልተፈቀደ ዊዝድሮው የለም ✓' : 'ምንም ዝርዝር የለም'}
        </div>
      ) : (
        items.map(w => (
          <div key={w.id} className="game-card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, color: '#D4A017', fontWeight: 700 }}>
                  #{w.id} · {Number(w.amount).toFixed(0)} ብር
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  Telegram: {w.telegramId}
                </div>
                <div style={{ fontSize: 11, color: '#aaa' }}>📞 Telebirr: {w.phone}</div>
                {w.note && (
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>💬 {w.note}</div>
                )}
                <div style={{ fontSize: 10, color: '#555', marginTop: 3 }}>
                  {new Date(w.createdAt).toLocaleString('am-ET')}
                </div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#60a5fa' }}>
                {Number(w.amount).toFixed(0)}
                <span style={{ fontSize: 10, color: '#888', marginLeft: 2 }}>ETB</span>
              </div>
            </div>

            {tab === 'pending' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={() => approve(w.id)}
                  disabled={busy === w.id}
                  style={{
                    flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700,
                    background: busy === w.id ? '#333' : 'linear-gradient(135deg, #16a34a, #15803d)',
                    color: '#fff', border: 'none', borderRadius: 10, cursor: busy === w.id ? 'wait' : 'pointer',
                  }}
                >
                  {busy === w.id ? '…' : '✅ ፍቀድ'}
                </button>
                <button
                  onClick={() => reject(w.id)}
                  disabled={busy === w.id}
                  style={{
                    flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700,
                    background: busy === w.id ? '#333' : 'rgba(220,38,38,0.15)',
                    color: '#f87171', border: '1px solid rgba(220,38,38,0.4)',
                    borderRadius: 10, cursor: busy === w.id ? 'wait' : 'pointer',
                  }}
                >
                  ❌ ሰርዝ
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

// ──────────────────────────────────────────────
// Stats tab
// ──────────────────────────────────────────────
function StatsTab() {
  const [stats, setStats] = useState<{
    deposits: { pending: number; approved: number; rejected: number; total: number }
    withdrawals: { pending: number; approved: number; rejected: number; total: number }
    players: { total: number; totalBalance: number }
    invites: { totalReferred: number; totalAgents: number; joinBonusPaid: number; commissionPaid: number }
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiGet('/api/admin/stats?telegramId=0').then(d => {
      setStats(d)
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', color: '#666', padding: 32 }}>እየጫነ…</div>
  if (!stats) return <div style={{ textAlign: 'center', color: '#f87171', padding: 32 }}>ስህተት ተከሰተ</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 600, letterSpacing: '0.05em' }}>💰 ዲፖዚቶች</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <StatCard label="ያልተፈቀዱ" value={stats.deposits.pending} color="#f97316" />
          <StatCard label="የተፈቀዱ" value={stats.deposits.approved} color="#22c55e" sub={`${stats.deposits.total.toFixed(0)} ETB`} />
          <StatCard label="የተሰረዙ" value={stats.deposits.rejected} color="#f87171" />
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 600, letterSpacing: '0.05em' }}>🏦 ዊዝድሮዎች</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <StatCard label="ያልተፈቀዱ" value={stats.withdrawals.pending} color="#f97316" />
          <StatCard label="የተፈቀዱ" value={stats.withdrawals.approved} color="#22c55e" sub={`${stats.withdrawals.total.toFixed(0)} ETB`} />
          <StatCard label="የተሰረዙ" value={stats.withdrawals.rejected} color="#f87171" />
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 600, letterSpacing: '0.05em' }}>👥 ተጫዋቾች</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <StatCard label="ጠቅላላ" value={stats.players.total} color="#D4A017" />
          <StatCard label="ጠቅላላ ባላንስ" value={`${stats.players.totalBalance.toFixed(0)} ETB`} color="#60a5fa" />
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 600, letterSpacing: '0.05em' }}>🤝 ሪፈራሎች</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <StatCard label="ጠቅላላ ሪፈሮች" value={stats.invites.totalReferred} color="#a78bfa" />
          <StatCard label="Agents" value={stats.invites.totalAgents} color="#fb923c" />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <StatCard label="Join Bonus ወጪ" value={`${stats.invites.joinBonusPaid.toFixed(0)} ETB`} color="#e879f9" />
          <StatCard label="Commission ወጪ" value={`${stats.invites.commissionPaid.toFixed(0)} ETB`} color="#34d399" />
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// Main dashboard
// ──────────────────────────────────────────────
type Tab = 'deposits' | 'withdrawals' | 'stats'

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('deposits')

  const tabBtn = (t: Tab, label: string) => ({
    style: {
      padding: '9px 0',
      flex: 1,
      fontSize: 12,
      fontWeight: 700,
      border: 'none',
      borderBottom: tab === t ? '2px solid #D4A017' : '2px solid transparent',
      background: 'transparent',
      color: tab === t ? '#D4A017' : '#666',
      cursor: 'pointer',
    },
    onClick: () => setTab(t),
    children: label,
  })

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(ellipse at 50% 20%, #0d1a2e 0%, #07080f 100%)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 16px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h1
            className="font-condensed"
            style={{ fontSize: 22, fontWeight: 800, color: '#D4A017', margin: 0, letterSpacing: '0.06em' }}
          >
            🛡 ADMIN PANEL
          </h1>
          <p style={{ fontSize: 11, color: '#555', margin: 0 }}>መልካም Bingo</p>
        </div>
        <button
          onClick={onLogout}
          style={{
            padding: '7px 14px',
            fontSize: 12,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            color: '#aaa',
            cursor: 'pointer',
          }}
        >
          ውጣ
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <button {...tabBtn('deposits', '⬇️ ዲፖዚት')} />
        <button {...tabBtn('withdrawals', '⬆️ ዊዝድሮው')} />
        <button {...tabBtn('stats', '📊 Stats')} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '16px', overflowY: 'auto' }}>
        {tab === 'deposits' && <DepositsTab />}
        {tab === 'withdrawals' && <WithdrawalsTab />}
        {tab === 'stats' && <StatsTab />}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// Root export
// ──────────────────────────────────────────────
export default function AdminPage() {
  const [authed, setAuthed] = useState(false)

  // Check if existing token is valid
  useEffect(() => {
    const token = getToken()
    if (!token) return
    fetch('/api/admin/check?telegramId=0', {
      headers: { 'x-admin-token': token },
    })
      .then(r => r.json())
      .then(d => { if (d.isAdmin) setAuthed(true) })
      .catch(() => { /* ignore */ })
  }, [])

  function handleLogout() {
    clearToken()
    setAuthed(false)
  }

  if (!authed) {
    return <LoginScreen onLogin={() => setAuthed(true)} />
  }
  return <Dashboard onLogout={handleLogout} />
}
