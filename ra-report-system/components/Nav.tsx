'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export default function Nav() {
  const router   = useRouter()
  const pathname = usePathname()
  const [role, setRole]   = useState<string | null>(null)
  const [name, setName]   = useState<string | null>(null)

  useEffect(() => {
    setRole(localStorage.getItem('ru_role'))
    setName(localStorage.getItem('ru_name'))
  }, [])

  function handleLogout() {
    localStorage.clear()
    router.push('/')
  }

  const canSeeDashboard = role === 'ARLC/RLC'

  return (
    <nav style={{
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border)',
      padding: '0 32px',
      height: '52px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      {/* Left — logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '24px', height: '24px',
            background: 'var(--accent)',
            borderRadius: '4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span className="mono" style={{ color: '#fff', fontSize: '11px', fontWeight: 700 }}>R</span>
          </div>
          <span className="mono" style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '-0.01em' }}>
            RUTrending
          </span>
        </div>

        {/* Nav links */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <NavLink
            label="Submit Report"
            href="/submit"
            active={pathname === '/submit'}
            onClick={() => router.push('/submit')}
          />
          {canSeeDashboard && (
            <NavLink
              label="Dashboard"
              href="/dashboard"
              active={pathname === '/dashboard'}
              onClick={() => router.push('/dashboard')}
            />
          )}
          {canSeeDashboard && (
            <NavLink
              label="Map"
              href="/map"
              active={pathname.startsWith('/map')}
              onClick={() => router.push('/map')}
            />
          )}
          {canSeeDashboard && (
            <NavLink
              label="Reports"
              href="/reports"
              active={pathname.startsWith('/reports')}
              onClick={() => router.push('/reports')}
            />
          )}
        </div>
      </div>

      {/* Right — user info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {role && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className={`badge ${
              role === 'RLC'  ? 'badge-red' :
              role === 'ARLC' ? 'badge-yellow' :
              'badge-blue'
            }`}>{role}</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{name}</span>
          </div>
        )}
        <button
          onClick={handleLogout}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '12px',
            cursor: 'pointer',
            fontFamily: 'IBM Plex Mono, monospace',
            letterSpacing: '0.05em',
            padding: '4px 8px',
            borderRadius: '3px',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          logout
        </button>
      </div>
    </nav>
  )
}

function NavLink({ label, href, active, onClick }: {
  label: string; href: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'var(--bg-hover)' : 'transparent',
        border: 'none',
        borderRadius: '4px',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer',
        fontFamily: 'IBM Plex Sans, sans-serif',
        fontSize: '13px',
        fontWeight: active ? 500 : 400,
        padding: '6px 12px',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => {
        if (!active) e.currentTarget.style.color = 'var(--text-primary)'
      }}
      onMouseLeave={e => {
        if (!active) e.currentTarget.style.color = 'var(--text-secondary)'
      }}
    >
      {label}
    </button>
  )
}