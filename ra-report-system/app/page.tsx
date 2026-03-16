'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Role = 'RA' | 'ARLC/RLC'

export default function LoginPage() {
  const router = useRouter()
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)

  function handleContinue() {
    if (!selectedRole) return
    localStorage.setItem('ru_role', selectedRole)
    if (selectedRole === 'RA') {
      router.push('/submit')
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      {/* Background grid */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        backgroundImage: `
          linear-gradient(var(--border) 1px, transparent 1px),
          linear-gradient(90deg, var(--border) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px',
        opacity: 0.3,
      }} />

      <div className="fade-in" style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '400px' }}>

        {/* Logo */}
        <div style={{ marginBottom: '40px', textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '10px',
            marginBottom: '12px',
          }}>
            <div style={{
              width: '36px', height: '36px',
              background: 'var(--accent)', borderRadius: '6px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span className="mono" style={{ color: '#fff', fontSize: '16px', fontWeight: 700 }}>R</span>
            </div>
            <span className="mono" style={{ fontSize: '20px', fontWeight: 600, letterSpacing: '-0.02em' }}>
              RUTrending
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Residence Life Incident Intelligence
          </p>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: '32px' }}>
          <p className="mono" style={{
            fontSize: '11px', letterSpacing: '0.1em',
            color: 'var(--text-muted)', marginBottom: '24px',
            textTransform: 'uppercase',
          }}>
            Select your role to continue
          </p>

          <div style={{ marginBottom: '24px' }}>
            <label className="field-label">Role</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {([
                {
                  role: 'RA' as Role,
                  desc: 'Report submission only',
                },
                {
                  role: 'ARLC/RLC' as Role,
                  desc: 'Report submission + trend dashboard + analytics',
                },
              ]).map(({ role, desc }) => (
                <button
                  key={role}
                  onClick={() => setSelectedRole(role)}
                  style={{
                    padding: '14px 16px',
                    border: `1px solid ${selectedRole === role ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '4px',
                    background: selectedRole === role ? 'var(--accent-glow)' : 'var(--bg-secondary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left',
                  }}
                >
                  <div>
                    <p className="mono" style={{
                      fontSize: '13px', fontWeight: 600,
                      color: selectedRole === role ? 'var(--accent)' : 'var(--text-primary)',
                      marginBottom: '2px',
                    }}>{role}</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{desc}</p>
                  </div>
                  {selectedRole === role && (
                    <div style={{
                      width: '18px', height: '18px', borderRadius: '50%',
                      background: 'var(--accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <span style={{ color: '#fff', fontSize: '10px' }}>✓</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <button
            className="btn-primary"
            style={{ width: '100%' }}
            disabled={!selectedRole}
            onClick={handleContinue}
          >
            Continue
          </button>
        </div>

        <p className="mono" style={{
          textAlign: 'center', marginTop: '24px',
          fontSize: '11px', color: 'var(--text-muted)',
          letterSpacing: '0.05em',
        }}>
          RUTGERS UNIVERSITY — RESIDENCE LIFE
        </p>
      </div>
    </div>
  )
}