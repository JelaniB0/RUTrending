'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import Nav from '@/components/Nav'
import { CAMPUS_CENTERS, CAMPUS_DISPLAY } from '@/lib/rutgers-buildings'

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface BuildingData {
  building_name:     string
  campus:            string
  lat:               number
  lng:               number
  total:             number
  title_ix:          number
  mental_health:     number
  policy_violation:  number
  roommate_conflict: number
  general_concern:   number
  facilities:        number
  rupd_called:       number
  ems_present:       number
  last_incident:     string | null
}

type FilterType = 'total' | 'title_ix' | 'mental_health' | 'policy_violation' | 'roommate_conflict' | 'general_concern' | 'facilities'
type CampusView = 'All' | 'Busch' | 'College Ave' | 'Cook/Douglass' | 'Livingston'

const CAMPUS_TO_KEY: Record<CampusView, string> = {
  'All':           'All',
  'Busch':         'BUSCH',
  'College Ave':   'COLLEGE_AVE',
  'Cook/Douglass': 'COOK_DOUGLASS',
  'Livingston':    'LIVINGSTON',
}

const FILTER_LABELS: Record<FilterType, string> = {
  total:             'All Incidents',
  title_ix:          'Title IX',
  mental_health:     'Mental Health',
  policy_violation:  'Policy Violation',
  roommate_conflict: 'Roommate Conflict',
  general_concern:   'General Concern',
  facilities:        'Facilities',
}

const FILTER_COLORS: Record<FilterType, string> = {
  total:             '#cc0033',
  title_ix:          '#e74c3c',
  mental_health:     '#9b6fff',
  policy_violation:  '#f5a623',
  roommate_conflict: '#4a9eff',
  general_concern:   '#00c47a',
  facilities:        '#8888aa',
}

const CAMPUSES: CampusView[] = ['All', 'Busch', 'College Ave', 'Cook/Douglass', 'Livingston']

// ─── COLOR SCALE ──────────────────────────────────────────────────────────────

function getMarkerColor(value: number, max: number, filterType: FilterType): string {
  if (max === 0 || value === 0) return 'rgba(255,255,255,0.08)'
  const ratio = value / max
  const base = FILTER_COLORS[filterType]

  // Parse hex to RGB
  const r = parseInt(base.slice(1, 3), 16)
  const g = parseInt(base.slice(3, 5), 16)
  const b = parseInt(base.slice(5, 7), 16)

  const alpha = 0.15 + ratio * 0.85
  return `rgba(${r},${g},${b},${alpha})`
}

function getMarkerSize(value: number, max: number): number {
  if (max === 0 || value === 0) return 18
  return 18 + (value / max) * 28
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function MapPage() {
  const router = useRouter()
  const mapContainer = useRef<HTMLDivElement>(null)
  const map          = useRef<mapboxgl.Map | null>(null)
  const markers      = useRef<mapboxgl.Marker[]>([])
  const popupRef     = useRef<mapboxgl.Popup | null>(null)

  const [selectedCampus, setSelectedCampus] = useState<CampusView>('All')
  const [filterType,     setFilterType]     = useState<FilterType>('total')
  const [buildings,      setBuildings]      = useState<BuildingData[]>([])
  const [loading,        setLoading]        = useState(true)
  const [mapReady,       setMapReady]       = useState(false)
  const [hoveredBuilding,setHoveredBuilding]= useState<BuildingData | null>(null)
  const [startDate,      setStartDate]      = useState('')
  const [endDate,        setEndDate]        = useState('')

  // Auth guard
  useEffect(() => {
    const role = localStorage.getItem('ru_role')
    if (role !== 'ARLC/RLC') router.push('/')
  }, [router])

  // Init map
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style:     'mapbox://styles/mapbox/dark-v11',
      center:    [-74.448, 40.502],
      zoom:      12,
      minZoom:   11,
      maxZoom:   18,
    })

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

    map.current.on('load', () => setMapReady(true))

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  // Fetch building data
  const fetchBuildings = useCallback(async () => {
    setLoading(true)
    try {
      const campusKey = CAMPUS_TO_KEY[selectedCampus]
      const params = new URLSearchParams()
      if (campusKey !== 'All') params.set('campus', campusKey)
      if (startDate) params.set('startDate', startDate)
      if (endDate)   params.set('endDate', endDate)

      const res  = await fetch(`/api/trends/building-heatmap?${params}`)
      const data = await res.json()
      if (data.success) setBuildings(data.data)
    } catch (e) {
      console.error('Failed to fetch building data', e)
    } finally {
      setLoading(false)
    }
  }, [selectedCampus, startDate, endDate])

  useEffect(() => { fetchBuildings() }, [fetchBuildings])

  // Fly to campus when selection changes
  useEffect(() => {
    if (!map.current || !mapReady) return
    const campusKey = CAMPUS_TO_KEY[selectedCampus]
    const center    = CAMPUS_CENTERS[campusKey]
    map.current.flyTo({
      center:   [center.lng, center.lat],
      zoom:     center.zoom,
      duration: 1200,
      essential: true,
    })
  }, [selectedCampus, mapReady])

  // Render markers whenever buildings or filter changes
  useEffect(() => {
    if (!map.current || !mapReady || loading) return

    // Clear existing markers
    markers.current.forEach(m => m.remove())
    markers.current = []
    popupRef.current?.remove()

    // Filter buildings for current campus view
    const campusKey   = CAMPUS_TO_KEY[selectedCampus]
    const filtered    = campusKey === 'All'
      ? buildings
      : buildings.filter(b => b.campus === campusKey)

    const maxValue = Math.max(...filtered.map(b => b[filterType] as number), 1)

    filtered.forEach(building => {
      const value = building[filterType] as number
      const color = getMarkerColor(value, maxValue, filterType)
      const size  = getMarkerSize(value, maxValue)

      // Create custom marker element
      const el = document.createElement('div')
      el.style.cssText = `
        position: absolute;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: ${color};
        border: 1.5px solid ${value > 0 ? FILTER_COLORS[filterType] : 'rgba(255,255,255,0.15)'};
        cursor: pointer;
        transition: transform 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'IBM Plex Mono', monospace;
        font-size: ${size > 30 ? '11px' : '9px'};
        font-weight: 600;
        color: ${value > 0 ? '#fff' : 'rgba(255,255,255,0.3)'};
        box-shadow: 0 0 ${value > 0 ? Math.min(value * 2, 20) : 0}px ${value > 0 ? FILTER_COLORS[filterType] + '66' : 'transparent'};
      `
      if (value > 0) el.textContent = String(value)

      el.addEventListener('mouseenter', () => {
        el.style.outline = `2px solid ${FILTER_COLORS[filterType]}`
        el.style.zIndex    = '10'
        setHoveredBuilding(building)
      })
      el.addEventListener('mouseleave', () => {
        el.style.outline = 'none'
        el.style.zIndex    = '1'
        setHoveredBuilding(null)
      })

      // Popup on click
      el.addEventListener('click', () => {
        popupRef.current?.remove()

        const dominant = getDominantType(building)

        popupRef.current = new mapboxgl.Popup({
          closeButton:  true,
          closeOnClick: false,
          maxWidth:     '300px',
          className:    'ru-popup',
        })
          .setLngLat([building.lng, building.lat])
          .setHTML(buildPopupHTML(building, dominant))
          .addTo(map.current!)
      })

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([building.lng, building.lat])
        .addTo(map.current!)

      markers.current.push(marker)
    })
  }, [buildings, filterType, selectedCampus, mapReady, loading])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <Nav />

      {/* Popup styles injected globally */}
      <style>{`
        .ru-popup .mapboxgl-popup-content {
          background: var(--bg-card, #1a1a24);
          border: 1px solid var(--border, #2a2a3a);
          border-radius: 6px;
          padding: 0;
          color: var(--text-primary, #fff);
          font-family: 'IBM Plex Sans', sans-serif;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        .ru-popup .mapboxgl-popup-tip {
          border-top-color: var(--border, #2a2a3a);
        }
        .ru-popup .mapboxgl-popup-close-button {
          color: var(--text-muted, #666);
          font-size: 16px;
          padding: 8px 10px;
        }
        .mapboxgl-ctrl-group {
          background: var(--bg-card, #1a1a24) !important;
          border: 1px solid var(--border, #2a2a3a) !important;
        }
        .mapboxgl-ctrl-group button {
          color: var(--text-secondary, #aaa) !important;
        }
        .ru-popup {
          z-index: 999 !important;
        }
        .mapboxgl-popup {
          z-index: 999 !important;
        }
      `}</style>

      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '32px 24px' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
          <div>
            <p className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '6px' }}>
              ANALYTICS DASHBOARD
            </p>
            <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Campus Incident Map</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              className="input-base" type="date" value={startDate}
              onChange={e => setStartDate(e.target.value)}
              style={{ width: '140px' }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>to</span>
            <input
              className="input-base" type="date" value={endDate}
              onChange={e => setEndDate(e.target.value)}
              style={{ width: '140px' }}
            />
          </div>
        </div>

        {/* ── Campus tabs ── */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
          {CAMPUSES.map(c => (
            <button
              key={c}
              onClick={() => setSelectedCampus(c)}
              style={{
                padding: '6px 14px', borderRadius: '4px', border: 'none',
                background: selectedCampus === c ? 'var(--accent)' : 'var(--bg-card)',
                color: selectedCampus === c ? '#fff' : 'var(--text-secondary)',
                fontSize: '13px', cursor: 'pointer', transition: 'all 0.15s',
                fontFamily: 'IBM Plex Sans, sans-serif',
              }}
            >{c}</button>
          ))}
        </div>

        {/* ── Filter type pills ── */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px' }}>
          {(Object.entries(FILTER_LABELS) as [FilterType, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilterType(key)}
              style={{
                padding: '4px 12px', borderRadius: '20px', border: 'none',
                background: filterType === key
                  ? FILTER_COLORS[key]
                  : 'var(--bg-card)',
                color: filterType === key ? '#fff' : 'var(--text-muted)',
                fontSize: '12px', cursor: 'pointer', transition: 'all 0.15s',
                fontFamily: 'IBM Plex Sans, sans-serif',
                fontWeight: filterType === key ? 500 : 400,
              }}
            >{label}</button>
          ))}
        </div>

        {/* ── Map + sidebar layout ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '16px' }}>

          {/* Map */}
          <div className="card" style={{ position: 'relative', overflow: 'hidden', borderRadius: '6px', height: '620px' }}>
            {loading && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(10,10,16,0.7)',
              }}>
                <p className="mono" style={{ fontSize: '12px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                  Loading map data...
                </p>
              </div>
            )}
            <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

            {/* Legend */}
            <div style={{
              position: 'absolute', bottom: '16px', left: '16px',
              background: 'rgba(10,10,16,0.85)',
              border: '1px solid var(--border)',
              borderRadius: '4px', padding: '10px 14px',
              backdropFilter: 'blur(8px)',
            }}>
              <p className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.06em' }}>
                {FILTER_LABELS[filterType].toUpperCase()} FREQUENCY
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {[0.15, 0.35, 0.6, 0.85, 1.0].map((alpha, i) => {
                  const base = FILTER_COLORS[filterType]
                  const r = parseInt(base.slice(1, 3), 16)
                  const g = parseInt(base.slice(3, 5), 16)
                  const b = parseInt(base.slice(5, 7), 16)
                  return (
                    <div key={i} style={{
                      width: '20px', height: '20px', borderRadius: '50%',
                      background: `rgba(${r},${g},${b},${alpha})`,
                      border: `1px solid ${base}`,
                    }} />
                  )
                })}
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>Low → High</span>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* Hovered building card */}
            <div className="card" style={{ padding: '16px', minHeight: '160px' }}>
              {hoveredBuilding ? (
                <>
                  <p className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '8px' }}>
                    {CAMPUS_DISPLAY[hoveredBuilding.campus] ?? hoveredBuilding.campus}
                  </p>
                  <p style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', lineHeight: 1.3 }}>
                    {hoveredBuilding.building_name}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <StatRow label="Total" value={hoveredBuilding.total} color="var(--text-primary)" />
                    <StatRow label="Title IX"          value={hoveredBuilding.title_ix}          color="#e74c3c" />
                    <StatRow label="Mental Health"     value={hoveredBuilding.mental_health}     color="#9b6fff" />
                    <StatRow label="Policy Violation"  value={hoveredBuilding.policy_violation}  color="#f5a623" />
                    <StatRow label="Roommate Conflict" value={hoveredBuilding.roommate_conflict} color="#4a9eff" />
                    <StatRow label="General Concern"   value={hoveredBuilding.general_concern}   color="#00c47a" />
                    <StatRow label="Facilities"        value={hoveredBuilding.facilities}        color="#8888aa" />
                  </div>
                  {hoveredBuilding.last_incident && (
                    <p className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '10px' }}>
                      Last: {hoveredBuilding.last_incident}
                    </p>
                  )}
                </>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '8px' }}>
                  Hover a building to see details
                </p>
              )}
            </div>

            {/* Top buildings list */}
            <div className="card" style={{ padding: '16px', flex: 1, overflow: 'hidden' }}>
              <p className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '12px' }}>
                TOP BUILDINGS — {FILTER_LABELS[filterType].toUpperCase()}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto', maxHeight: '380px' }}>
                {[...buildings]
                  .filter(b => selectedCampus === 'All' || b.campus === CAMPUS_TO_KEY[selectedCampus])
                  .sort((a, b) => (b[filterType] as number) - (a[filterType] as number))
                  .slice(0, 15)
                  .map((b, i) => {
                    const val = b[filterType] as number
                    const max = Math.max(...buildings.map(x => x[filterType] as number), 1)
                    return (
                      <div key={b.building_name} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '6px 8px', borderRadius: '4px',
                        background: i === 0 ? 'rgba(204,0,51,0.08)' : 'transparent',
                      }}>
                        <span className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', width: '16px', flexShrink: 0 }}>
                          {i + 1}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: '12px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.building_name}
                          </p>
                          <div style={{
                            marginTop: '3px', height: '2px', borderRadius: '1px',
                            background: 'var(--border)', overflow: 'hidden',
                          }}>
                            <div style={{
                              height: '100%', borderRadius: '1px',
                              width: `${(val / max) * 100}%`,
                              background: FILTER_COLORS[filterType],
                              transition: 'width 0.4s',
                            }} />
                          </div>
                        </div>
                        <span className="mono" style={{ fontSize: '11px', color: FILTER_COLORS[filterType], flexShrink: 0 }}>
                          {val}
                        </span>
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getDominantType(b: BuildingData): FilterType {
  const types: FilterType[] = ['title_ix', 'mental_health', 'policy_violation', 'roommate_conflict', 'general_concern', 'facilities']
  return types.reduce((a, c) => (b[c] as number) > (b[a] as number) ? c : a, types[0])
}

function buildPopupHTML(b: BuildingData, dominant: FilterType): string {
  const campus = CAMPUS_DISPLAY[b.campus] ?? b.campus
  const rows = [
    ['Title IX',          b.title_ix,          '#e74c3c'],
    ['Mental Health',     b.mental_health,     '#9b6fff'],
    ['Policy Violation',  b.policy_violation,  '#f5a623'],
    ['Roommate Conflict', b.roommate_conflict,  '#4a9eff'],
    ['General Concern',   b.general_concern,   '#00c47a'],
    ['Facilities',        b.facilities,        '#8888aa'],
  ] as [string, number, string][]

  const rowsHTML = rows.map(([label, val, color]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <span style="font-size:12px;color:#888">${label}</span>
      <span style="font-size:12px;font-family:'IBM Plex Mono',monospace;color:${color}">${val}</span>
    </div>
  `).join('')

  return `
    <div style="padding:16px;min-width:240px">
      <p style="font-size:10px;font-family:'IBM Plex Mono',monospace;color:#666;letter-spacing:0.08em;margin-bottom:4px">${campus.toUpperCase()}</p>
      <p style="font-size:15px;font-weight:600;margin-bottom:4px;color:#fff">${b.building_name}</p>
      <p style="font-size:22px;font-family:'IBM Plex Mono',monospace;font-weight:700;color:#cc0033;margin-bottom:12px">${b.total} <span style="font-size:12px;color:#666;font-weight:400">total</span></p>
      ${rowsHTML}
      <div style="display:flex;gap:12px;margin-top:10px">
        <div>
          <p style="font-size:10px;color:#666">RUPD Called</p>
          <p style="font-size:13px;font-family:'IBM Plex Mono',monospace;color:#fff">${b.rupd_called}</p>
        </div>
        <div>
          <p style="font-size:10px;color:#666">EMS Present</p>
          <p style="font-size:13px;font-family:'IBM Plex Mono',monospace;color:#fff">${b.ems_present}</p>
        </div>
        ${b.last_incident ? `<div><p style="font-size:10px;color:#666">Last Incident</p><p style="font-size:13px;font-family:'IBM Plex Mono',monospace;color:#fff">${b.last_incident}</p></div>` : ''}
      </div>
    </div>
  `
}

function StatRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{label}</span>
      <span className="mono" style={{ fontSize: '12px', color, fontWeight: 500 }}>{value}</span>
    </div>
  )
}