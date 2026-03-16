'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface CampusStat {
  campus:            string
  total_reports:     number
  title_ix:          number
  mental_health:     number
  policy_violation:  number
  roommate_conflict: number
  general_concern:   number
  facilities:        number
  rupd_called:       number
  ems_present:       number
}

interface NatureStat {
  month:  string
  nature: string
  total:  number
}

interface RepeatLocation {
  building_name:     string
  campus:            string
  specific_location: string
  incident_count:    number
  incident_types:    string[]
  first_incident:    string
  last_incident:     string
}

interface AgentResult {
  finalReport:      string | null
  alerts:           string[]
  buildingAnalysis: string | null
  campusAnalysis:   string | null
  locationAnalysis: string | null
  personAnalysis:   string | null
  queryAnalysis:    string | null   // ← new
}

const NATURE_COLORS: Record<string, string> = {
  'Title IX':                       '#e74c3c',
  'Mental Health Concern':          '#9b6fff',
  'Policy Violation':               '#f5a623',
  'Roommate Conflict':              '#4a9eff',
  'General Residence Life Concern': '#00c47a',
  'Facilities Issues':              '#8888aa',
}

const CAMPUSES = ['All', 'Busch', 'College Ave', 'Cook/Douglass', 'Livingston']

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()

  useEffect(() => {
    const role = localStorage.getItem('ru_role')
    if (role !== 'ARLC/RLC') router.push('/')
  }, [router])

  const [selectedCampus, setSelectedCampus] = useState('All')
  const [startDate,      setStartDate]      = useState('')
  const [endDate,        setEndDate]        = useState('')
  const [campusStats,    setCampusStats]    = useState<CampusStat[]>([])
  const [monthlyData,    setMonthlyData]    = useState<any[]>([])
  const [repeatLocs,     setRepeatLocs]     = useState<RepeatLocation[]>([])
  const [loading,        setLoading]        = useState(true)
  const [userQuery,      setUserQuery]      = useState('')
  const [agentRunning,   setAgentRunning]   = useState(false)
  const [agentResult,    setAgentResult]    = useState<AgentResult | null>(null)
  const [agentError,     setAgentError]     = useState('')
  const [activeTab,      setActiveTab]      = useState<'query' | 'report' | 'alerts' | 'building' | 'location' | 'person'>('report')

  useEffect(() => { fetchAll() }, [selectedCampus])

  async function fetchAll() {
    setLoading(true)
    try {
      const campusParam = selectedCampus !== 'All'
        ? `&campus=${encodeURIComponent(selectedCampus)}`
        : ''

      const [campusRes, natureRes, repeatRes] = await Promise.all([
        fetch(`/api/trends?type=campus`),
        fetch(`/api/trends?type=nature${campusParam}`),
        fetch(`/api/trends?type=repeat${campusParam}`),
      ])

      const [campusJson, natureJson, repeatJson] = await Promise.all([
        campusRes.json(),
        natureRes.json(),
        repeatRes.json(),
      ])

      const allCampus: CampusStat[] = campusJson.data ?? []
      const filtered = selectedCampus !== 'All'
        ? allCampus.filter(c => c.campus === selectedCampus)
        : allCampus
      if (campusJson.success) setCampusStats(filtered)

      if (repeatJson.success) setRepeatLocs(repeatJson.data)

      if (natureJson.success) {
        const raw: NatureStat[] = natureJson.data
        const months  = [...new Set(raw.map(r => r.month.slice(0, 7)))].sort()
        const natures = [...new Set(raw.map(r => r.nature))]

        const transformed = months.map(month => {
          const entry: any = { month: month.slice(5) }
          natures.forEach(nature => {
            const found = raw.find(r => r.month.slice(0, 7) === month && r.nature === nature)
            entry[nature] = found?.total ?? 0
          })
          return entry
        })
        setMonthlyData(transformed)
      }
    } catch (e) {
      console.error('Failed to fetch dashboard data:', e)
    } finally {
      setLoading(false)
    }
  }

  async function runAgents() {
    setAgentRunning(true)
    setAgentError('')
    setAgentResult(null)
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campus:    selectedCampus !== 'All' ? selectedCampus : undefined,
          startDate: startDate || undefined,
          endDate:   endDate   || undefined,
          userQuery: userQuery || undefined,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      setAgentResult(data)
      // Land on the query tab if a specific question was asked, otherwise report
      setActiveTab(data.queryAnalysis ? 'query' : 'report')
    } catch (e: any) {
      setAgentError(e.message ?? 'Agent analysis failed')
    } finally {
      setAgentRunning(false)
    }
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const totalReports = campusStats.reduce((s, c) => s + c.total_reports, 0)
  const totalRupd    = campusStats.reduce((s, c) => s + c.rupd_called,   0)
  const totalEms     = campusStats.reduce((s, c) => s + c.ems_present,   0)

  const topCampus   = [...campusStats].sort((a, b) => b.total_reports - a.total_reports)[0]
  const topBuilding = [...repeatLocs]
    .sort((a, b) => b.incident_count - a.incident_count)[0]?.building_name ?? null

  const isFiltered = selectedCampus !== 'All'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <Nav />

      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '32px 24px' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
          <div>
            <p className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '6px' }}>
              ANALYTICS DASHBOARD
            </p>
            <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Incident Trends</h1>
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

        {/* ── Campus filter tabs ── */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '28px' }}>
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

        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px', color: 'var(--text-muted)' }}>
            <p className="mono" style={{ fontSize: '13px', letterSpacing: '0.05em' }}>Loading data...</p>
          </div>
        ) : (
          <>
            {/* ── Stat cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '28px' }}>
              <StatCard label="Total Reports" value={totalReports} color="var(--text-primary)" />
              <StatCard label="RUPD Calls"    value={totalRupd}    color="var(--accent)" />
              <StatCard label="EMS Incidents" value={totalEms}     color="var(--yellow)" />
              <StatCard
                label={isFiltered ? 'Most Active Building' : 'Most Active Campus'}
                value={isFiltered ? (topBuilding ?? '—') : (topCampus?.campus ?? '—')}
                color="var(--blue)"
                isText
              />
            </div>

            {/* ── Charts row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>

              {/* Monthly trends */}
              <div className="card" style={{ padding: '24px' }}>
                <p className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '20px' }}>
                  MONTHLY TRENDS BY TYPE
                </p>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '4px' }}
                      labelStyle={{ color: 'var(--text-secondary)', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }} />
                    {Object.entries(NATURE_COLORS).map(([nature, color]) => (
                      <Line
                        key={nature}
                        type="monotone"
                        dataKey={nature}
                        stroke={color}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Campus breakdown */}
              <div className="card" style={{ padding: '24px' }}>
                <p className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '20px' }}>
                  {isFiltered ? `${selectedCampus.toUpperCase()} BREAKDOWN` : 'CAMPUS BREAKDOWN'}
                </p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={campusStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="campus" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '4px' }}
                      labelStyle={{ color: 'var(--text-secondary)', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }} />
                    <Bar dataKey="title_ix"          name="Title IX"          fill="#e74c3c" stackId="a" />
                    <Bar dataKey="mental_health"     name="Mental Health"     fill="#9b6fff" stackId="a" />
                    <Bar dataKey="policy_violation"  name="Policy Violation"  fill="#f5a623" stackId="a" />
                    <Bar dataKey="roommate_conflict" name="Roommate Conflict" fill="#4a9eff" stackId="a" />
                    <Bar dataKey="general_concern"   name="General Concern"   fill="#00c47a" stackId="a" />
                    <Bar dataKey="facilities"        name="Facilities"        fill="#8888aa" stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ── Repeat locations table ── */}
            <div className="card" style={{ padding: '24px', marginBottom: '20px' }}>
              <p className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '20px' }}>
                {isFiltered
                  ? `REPEAT INCIDENT LOCATIONS — ${selectedCampus.toUpperCase()}`
                  : 'REPEAT INCIDENT LOCATIONS'
                }
              </p>
              {repeatLocs.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No repeat locations found.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Building', 'Campus', 'Location', 'Count', 'Types', 'First', 'Last'].map(h => (
                        <th key={h} style={{
                          textAlign: 'left', padding: '8px 12px',
                          borderBottom: '1px solid var(--border)',
                          fontSize: '11px', fontFamily: 'IBM Plex Mono, monospace',
                          letterSpacing: '0.06em', color: 'var(--text-muted)',
                          textTransform: 'uppercase', fontWeight: 500,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {repeatLocs.map((r, i) => (
                      <tr
                        key={i}
                        style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '10px 12px', fontSize: '13px', color: 'var(--text-primary)' }}>{r.building_name}</td>
                        <td style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>{r.campus}</td>
                        <td style={{ padding: '10px 12px', fontSize: '13px', color: 'var(--text-secondary)' }}>{r.specific_location}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span className="badge badge-red">{r.incident_count}</span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {r.incident_types.map((t, j) => (
                              <span key={j} className="badge badge-gray" style={{ fontSize: '10px' }}>
                                {t.split(' ')[0]}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-muted)' }} className="mono">
                          {r.first_incident?.slice(0, 10)}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-muted)' }} className="mono">
                          {r.last_incident?.slice(0, 10)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── AI Analysis panel ── */}
            <div className="card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <p className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '4px' }}>
                    AI TREND ANALYSIS
                  </p>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Run the multi-agent system to generate a full trend report
                    {isFiltered ? ` for ${selectedCampus}` : ''}.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: agentRunning ? 'var(--yellow)' : agentResult ? 'var(--green)' : 'var(--border)',
                    animation: agentRunning ? 'pulse 1s infinite' : 'none',
                  }} />
                  <span className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {agentRunning ? 'RUNNING' : agentResult ? 'AGENT COMPLETE' : 'IDLE'}
                  </span>
                </div>
              </div>

              {/* Query + run */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <input
                  className="input-base"
                  placeholder="Optional: ask a specific question e.g. 'noise complaint trends by room' or 'who are repeat offenders'"
                  value={userQuery}
                  onChange={e => setUserQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !agentRunning && runAgents()}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn-primary"
                  onClick={runAgents}
                  disabled={agentRunning}
                  style={{ whiteSpace: 'nowrap', minWidth: '120px' }}
                >
                  {agentRunning ? 'Running...' : 'Run Analysis'}
                </button>
              </div>

              {/* Running indicator */}
              {agentRunning && (
                <div style={{
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: '4px', padding: '16px 20px',
                  display: 'flex', alignItems: 'center', gap: '12px',
                }}>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: 'var(--yellow)', animation: 'pulse 1s infinite',
                  }} />
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    Agents running — intake, building, campus, alert, query, location, person, and report agents processing...
                  </p>
                </div>
              )}

              {/* Error */}
              {agentError && (
                <div style={{
                  background: 'rgba(204,0,51,0.1)', border: '1px solid var(--accent)',
                  borderRadius: '4px', padding: '12px 16px',
                  color: '#ff4466', fontSize: '13px',
                }}>
                  {agentError}
                </div>
              )}

              {/* Results */}
              {agentResult && !agentRunning && (
                <div className="fade-in">
                  {/* Tabs */}
                  <div style={{
                    display: 'flex', gap: '4px', marginBottom: '20px',
                    borderBottom: '1px solid var(--border)',
                  }}>
                    {([
                      // Only show "Your Question" tab if a specific query was made
                      ...(agentResult.queryAnalysis ? [{ key: 'query', label: '✦ Your Question' }] : []),
                      { key: 'report',   label: 'Executive Report' },
                      { key: 'alerts',   label: `Alerts (${agentResult.alerts?.length ?? 0})` },
                      { key: 'building', label: 'Buildings' },
                      ...(agentResult.locationAnalysis ? [{ key: 'location', label: 'Locations' }] : []),
                      ...(agentResult.personAnalysis   ? [{ key: 'person',   label: 'Persons'   }] : []),
                    ] as { key: typeof activeTab; label: string }[]).map(tab => (
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
                          marginBottom: '-1px', transition: 'color 0.15s',
                        }}
                      >{tab.label}</button>
                    ))}
                  </div>

                  {/* Tab content */}
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: '4px', padding: '20px' }}>

                    {/* ── Your Question tab ── */}
                    {activeTab === 'query' && agentResult.queryAnalysis && (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                        {agentResult.queryAnalysis}
                      </p>
                    )}

                    {/* ── Executive Report tab ── */}
                    {activeTab === 'report' && (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                        {agentResult.finalReport}
                      </p>
                    )}

                    {/* ── Alerts tab ── */}
                    {activeTab === 'alerts' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {agentResult.alerts?.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No alerts generated.</p>
                        ) : (
                          agentResult.alerts?.map((alert, i) => (
                            <div key={i} style={{
                              display: 'flex', gap: '12px', alignItems: 'flex-start',
                              padding: '12px 14px',
                              background: 'rgba(204,0,51,0.06)',
                              border: '1px solid rgba(204,0,51,0.2)',
                              borderRadius: '4px',
                            }}>
                              <span style={{ color: 'var(--accent)', fontSize: '12px', marginTop: '1px', flexShrink: 0 }}>!</span>
                              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.6 }}>
                                {alert.replace(/^ALERT:\s*/i, '')}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {/* ── Buildings tab ── */}
                    {activeTab === 'building' && (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                        {agentResult.buildingAnalysis}
                      </p>
                    )}

                    {/* ── Locations tab ── */}
                    {activeTab === 'location' && agentResult.locationAnalysis && (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                        {agentResult.locationAnalysis}
                      </p>
                    )}

                    {/* ── Persons tab ── */}
                    {activeTab === 'person' && agentResult.personAnalysis && (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                        {agentResult.personAnalysis}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── STAT CARD ────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, isText }: {
  label: string; value: number | string; color: string; isText?: boolean
}) {
  return (
    <div className="card" style={{ padding: '20px' }}>
      <p className="stat-label">{label}</p>
      <p style={{
        fontFamily: isText ? 'IBM Plex Sans, sans-serif' : 'IBM Plex Mono, monospace',
        fontSize: isText ? '18px' : '28px',
        fontWeight: 600, color, lineHeight: 1, marginTop: '10px',
      }}>
        {value}
      </p>
    </div>
  )
}