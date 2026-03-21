'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Report {
  id:                number
  report_id:         string
  date:              string
  time:              string
  nature:            string
  specific_location: string
  narrative:         string
  rupd_called:       boolean
  ems_present:       boolean
  transported:       boolean
  cad_number:        string | null
  emergency_single:  string | null
  building: {
    name:   string
    campus: string
  }
  submitted_by: {
    full_name: string
    username:  string | null
    phone:     string | null
    email:     string | null
  }
  report_staff: {
    staff: { full_name: string; role: string }
  }[]
  timeline_events: {
    event_time:  string
    actor:       string
    description: string
    sequence:    number
  }[]
}

interface SearchResult {
  report:     Report
  similarity: number
}

const NATURE_LABELS: Record<string, string> = {
  'Title IX':                       'Title IX',
  'Mental Health Concern':          'Mental Health Concern',
  'Policy Violation':               'Policy Violation',
  'Roommate Conflict':              'Roommate Conflict',
  'General Residence Life Concern': 'General Residence Life Concern',
  'Facilities Issues':              'Facilities Issues',
  // keep old enum keys as fallback
  TITLE_IX:          'Title IX',
  MENTAL_HEALTH:     'Mental Health Concern',
  POLICY_VIOLATION:  'Policy Violation',
  ROOMMATE_CONFLICT: 'Roommate Conflict',
  GENERAL_CONCERN:   'General Residence Life Concern',
  FACILITIES:        'Facilities Issues',
}

const NATURE_COLORS: Record<string, string> = {
  'Title IX':                       'var(--accent)',
  'Mental Health Concern':          '#9b6fff',
  'Policy Violation':               '#f5a623',
  'Roommate Conflict':              '#4a9eff',
  'General Residence Life Concern': '#00c47a',
  'Facilities Issues':              '#8888aa',
  // keep old enum keys as fallback
  TITLE_IX:          'var(--accent)',
  MENTAL_HEALTH:     '#9b6fff',
  POLICY_VIOLATION:  '#f5a623',
  ROOMMATE_CONFLICT: '#4a9eff',
  GENERAL_CONCERN:   '#00c47a',
  FACILITIES:        '#8888aa',
}

const CAMPUSES = ['All', 'Busch', 'College Ave', 'Cook/Douglass', 'Livingston']

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const router = useRouter()

  useEffect(() => {
    const role = localStorage.getItem('ru_role')
    if (role !== 'ARLC/RLC') router.push('/')
  }, [router])

  const [reports,        setReports]        = useState<Report[]>([])
  const [loading,        setLoading]        = useState(true)
  const [selectedCampus, setSelectedCampus] = useState('All')
  const [selectedNature, setSelectedNature] = useState('All')
  const [startDate,      setStartDate]      = useState('')
  const [endDate,        setEndDate]        = useState('')

  const [query,         setQuery]         = useState('')
  const [searching,     setSearching]     = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [searchError,   setSearchError]   = useState('')

  const [selectedReport, setSelectedReport] = useState<Report | null>(null)
  const [fullscreen,     setFullscreen]     = useState(false)
  const [activeTab,      setActiveTab]      = useState<'all' | 'search'>('all')

  const queryRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchReports() }, [selectedCampus, selectedNature, startDate, endDate])

  async function fetchReports() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedCampus !== 'All') params.set('campus', selectedCampus.toUpperCase().replace(' ', '_').replace('/', '_'))
      if (selectedNature !== 'All') params.set('nature', selectedNature)
      if (startDate) params.set('startDate', startDate)
      if (endDate)   params.set('endDate',   endDate)
      params.set('limit', '100')

      const res  = await fetch(`/api/reports?${params}`)
      const data = await res.json()
      if (data.success) setReports(data.data)
    } catch (e) {
      console.error('Failed to fetch reports:', e)
    } finally {
      setLoading(false)
    }
  }

  async function runSearch() {
    if (!query.trim()) return
    setSearching(true)
    setSearchError('')
    setSearchResults(null)
    setActiveTab('search')

    try {
      const res  = await fetch('/api/reports/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query, campus: selectedCampus !== 'All' ? selectedCampus : undefined }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      setSearchResults(data.results)
    } catch (e: any) {
      setSearchError(e.message ?? 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  const displayedReports = activeTab === 'search' && searchResults
    ? searchResults.map(r => r.report)
    : reports

  const panelOpen = selectedReport !== null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <Nav />

      <div style={{
        display:    'flex',
        height:     'calc(100vh - 52px)',
        overflow:   'hidden',
        transition: 'all 0.3s ease',
      }}>

        <div style={{
          flex:       1,
          overflow:   'auto',
          padding:    '32px 24px',
          transition: 'all 0.3s ease',
        }}>
          <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
              <div>
                <p className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '6px' }}>
                  INCIDENT REPORTS
                </p>
                <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Reports</h1>
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

            {/* AI Search bar */}
            <div className="card" style={{ padding: '16px 20px', marginBottom: '20px' }}>
              <p className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '10px' }}>
                SQL SEARCH (Ideally want to do RAG search later)
              </p>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  ref={queryRef}
                  className="input-base"
                  placeholder='e.g. "residents locked out" or "noise complaints on third floor" or "mental health crisis involving transport"'
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !searching && runSearch()}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn-primary"
                  onClick={runSearch}
                  disabled={searching || !query.trim()}
                  style={{ whiteSpace: 'nowrap', minWidth: '100px' }}
                >
                  {searching ? 'Searching...' : 'Search'}
                </button>
                {activeTab === 'search' && (
                  <button
                    className="btn-secondary"
                    onClick={() => { setActiveTab('all'); setSearchResults(null); setQuery('') }}
                  >
                    Clear
                  </button>
                )}
              </div>

              {searchError && (
                <p style={{ color: 'var(--accent)', fontSize: '13px', marginTop: '10px' }}>{searchError}</p>
              )}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                {CAMPUSES.map(c => (
                  <button
                    key={c}
                    onClick={() => setSelectedCampus(c)}
                    style={{
                      padding: '6px 12px', borderRadius: '4px', border: 'none',
                      background: selectedCampus === c ? 'var(--accent)' : 'var(--bg-card)',
                      color: selectedCampus === c ? '#fff' : 'var(--text-secondary)',
                      fontSize: '12px', cursor: 'pointer',
                      fontFamily: 'IBM Plex Sans, sans-serif',
                    }}
                  >{c}</button>
                ))}
              </div>

              <select
                className="input-base"
                value={selectedNature}
                onChange={e => setSelectedNature(e.target.value)}
                style={{ width: 'auto', fontSize: '12px' }}
              >
                <option value="All">All Types</option>
                {Object.entries(NATURE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>

            {/* Tab bar */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid var(--border)' }}>
              {[
                { key: 'all',    label: `All Reports (${reports.length})` },
                ...(searchResults ? [{ key: 'search', label: `Search Results (${searchResults.length})` }] : []),
              ].map((tab: any) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    padding: '8px 14px', border: 'none', background: 'transparent',
                    color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontSize: '13px', cursor: 'pointer',
                    fontFamily: 'IBM Plex Sans, sans-serif',
                    fontWeight: activeTab === tab.key ? 500 : 400,
                    borderBottom: `2px solid ${activeTab === tab.key ? 'var(--accent)' : 'transparent'}`,
                    marginBottom: '-1px',
                  }}
                >{tab.label}</button>
              ))}
            </div>

            {/* Reports table */}
            {loading ? (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
                <p className="mono" style={{ fontSize: '13px' }}>Loading reports...</p>
              </div>
            ) : displayedReports.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
                <p style={{ fontSize: '13px' }}>No reports found.</p>
              </div>
            ) : (
              <div className="card" style={{ overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Report ID', 'Date', 'Nature', 'Building', 'Location', 'Submitted By', 'Flags'].map(h => (
                        <th key={h} style={{
                          textAlign: 'left', padding: '10px 16px',
                          borderBottom: '1px solid var(--border)',
                          fontSize: '10px', fontFamily: 'IBM Plex Mono, monospace',
                          letterSpacing: '0.08em', color: 'var(--text-muted)',
                          textTransform: 'uppercase', fontWeight: 500,
                          background: 'var(--bg-secondary)',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedReports.map((report) => {
                      const isSelected = selectedReport?.id === report.id
                      const similarity = activeTab === 'search' && searchResults
                        ? searchResults.find(r => r.report.id === report.id)?.similarity
                        : undefined

                      return (
                        <tr
                          key={report.id}
                          onClick={() => setSelectedReport(isSelected ? null : report)}
                          style={{
                            borderBottom: '1px solid var(--border)',
                            cursor: 'pointer',
                            background: isSelected ? 'var(--accent-glow)' : 'transparent',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => {
                            if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)'
                          }}
                          onMouseLeave={e => {
                            if (!isSelected) e.currentTarget.style.background = 'transparent'
                          }}
                        >
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <span className="mono" style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 600 }}>
                                {report.report_id}
                              </span>
                              {similarity !== undefined && (
                                <span className="mono" style={{ fontSize: '10px', color: 'var(--green)' }}>
                                  {Math.round(similarity * 100)}% match
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span className="mono" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                              {new Date(report.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{
                              fontSize: '11px', padding: '3px 8px', borderRadius: '3px',
                              background: `${NATURE_COLORS[report.nature] ?? '#888'}22`,
                              color: NATURE_COLORS[report.nature] ?? '#888',
                              fontFamily: 'IBM Plex Mono, monospace',
                              whiteSpace: 'nowrap',
                            }}>
                              {NATURE_LABELS[report.nature] ?? report.nature}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <div>
                              <p style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{report.building?.name}</p>
                              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{report.building?.campus}</p>
                            </div>
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                            {report.specific_location}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--text-muted)' }}>
                            {report.submitted_by?.full_name}
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {report.rupd_called && (
                                <span className="badge badge-red" style={{ fontSize: '10px' }}>RUPD</span>
                              )}
                              {report.ems_present && (
                                <span className="badge" style={{ fontSize: '10px', background: 'rgba(245,166,35,0.15)', color: '#f5a623', border: '1px solid rgba(245,166,35,0.3)' }}>EMS</span>
                              )}
                              {report.transported && (
                                <span className="badge" style={{ fontSize: '10px', background: 'rgba(74,158,255,0.15)', color: '#4a9eff', border: '1px solid rgba(74,158,255,0.3)' }}>TRANSPORT</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Side panel */}
        {panelOpen && (
          <div
            className="fade-in"
            style={{
              width:      fullscreen ? '100%' : '480px',
              position:   fullscreen ? 'fixed' : 'relative',
              top:        fullscreen ? '52px' : undefined,
              right:      fullscreen ? 0 : undefined,
              bottom:     fullscreen ? 0 : undefined,
              left:       fullscreen ? 0 : undefined,
              zIndex:     fullscreen ? 100 : undefined,
              borderLeft: '1px solid var(--border)',
              background: 'var(--bg-primary)',
              overflow:   'auto',
              flexShrink: 0,
              transition: 'width 0.2s ease',
            }}
          >
            {selectedReport && (
              <ReportPanel
                report={selectedReport}
                fullscreen={fullscreen}
                onClose={() => { setSelectedReport(null); setFullscreen(false) }}
                onFullscreen={() => setFullscreen(f => !f)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── REPORT PANEL ─────────────────────────────────────────────────────────────

function ReportPanel({
  report, fullscreen, onClose, onFullscreen
}: {
  report:       Report
  fullscreen:   boolean
  onClose:      () => void
  onFullscreen: () => void
}) {
  return (
    <div style={{ padding: '24px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <p className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '4px' }}>
            INCIDENT REPORT
          </p>
          <h2 className="mono" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--accent)' }}>
            {report.report_id}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={onFullscreen}
            style={{
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: '4px', padding: '6px 10px',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px',
            }}
          >
            {fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: '4px', padding: '6px 10px',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px', lineHeight: 1,
            }}
          >x</button>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <span style={{
          fontSize: '12px', padding: '4px 10px', borderRadius: '3px',
          background: `${NATURE_COLORS[report.nature] ?? '#888'}22`,
          color: NATURE_COLORS[report.nature] ?? '#888',
          fontFamily: 'IBM Plex Mono, monospace',
        }}>
          {NATURE_LABELS[report.nature] ?? report.nature}
        </span>
      </div>

      <PanelSection title="Incident Details">
        <PanelRow label="Date"     value={new Date(report.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} />
        <PanelRow label="Time"     value={report.time} />
        <PanelRow label="Building" value={report.building?.name} />
        <PanelRow label="Campus"   value={report.building?.campus} />
        <PanelRow label="Location" value={report.specific_location} />
      </PanelSection>

      {(report.rupd_called || report.ems_present || report.transported) && (
        <PanelSection title="Emergency Response">
          {report.rupd_called      && <PanelRow label="RUPD Called"      value={report.cad_number ? `Yes — CAD ${report.cad_number}` : 'Yes'} accent />}
          {report.ems_present      && <PanelRow label="EMS Present"      value="Yes" accent />}
          {report.transported      && <PanelRow label="Transported"      value="Yes" accent />}
          {report.emergency_single && <PanelRow label="Emergency Single" value={report.emergency_single} />}
        </PanelSection>
      )}

      <PanelSection title="Submitted By">
        <PanelRow label="Name"  value={report.submitted_by?.full_name} />
        {report.submitted_by?.username && <PanelRow label="NetID" value={report.submitted_by.username} />}
        {report.submitted_by?.email    && <PanelRow label="Email" value={report.submitted_by.email} />}
        {report.submitted_by?.phone    && <PanelRow label="Phone" value={report.submitted_by.phone} />}
      </PanelSection>

      {report.timeline_events?.length > 0 && (
        <PanelSection title="Timeline">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
            {report.timeline_events.map((event, i) => (
              <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <span className="mono" style={{ fontSize: '11px', color: 'var(--accent)', flexShrink: 0, marginTop: '2px' }}>
                  {event.event_time}
                </span>
                <div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '2px' }}>{event.actor}</p>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{event.description}</p>
                </div>
              </div>
            ))}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Narrative">
        <div style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: '4px', padding: '16px',
          fontSize: '13px', color: 'var(--text-secondary)',
          lineHeight: 1.8, whiteSpace: 'pre-wrap',
        }}>
          {report.narrative}
        </div>
      </PanelSection>
    </div>
  )
}

// ─── PANEL SUB-COMPONENTS ─────────────────────────────────────────────────────

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '24px' }}>
      <p className="mono" style={{
        fontSize: '10px', letterSpacing: '0.1em',
        color: 'var(--text-muted)', marginBottom: '12px',
        textTransform: 'uppercase', fontWeight: 500,
        borderBottom: '1px solid var(--border)', paddingBottom: '8px',
      }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {children}
      </div>
    </div>
  )
}

function PanelRow({ label, value, accent }: { label: string; value?: string | null; accent?: boolean }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
      <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: '13px', textAlign: 'right',
        color: accent ? 'var(--accent)' : 'var(--text-primary)',
      }}>{value}</span>
    </div>
  )
}