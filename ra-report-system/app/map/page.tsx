'use client'

import dynamic from 'next/dynamic'

const MapComponent = dynamic(() => import('@/components/MapComponent'), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p className="mono" style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
        Loading map...
      </p>
    </div>
  ),
})

export default function MapPage() {
  return <MapComponent />
}