'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const BUILDINGS: Record<string, string[]> = {
  'Busch': [
    'Allen Hall','B.E.S.T Neighborhood','Barr Hall','Buell Apartments',
    'Crosby Suites','Johnson Apartments','Judson Suites','Marvin Apartments',
    'Mattia Hall','McCormick Suites','Metzger Hall','Morrow Suites',
    'Nichols Apartments','Richardson Apartments','Silvers Apartments',
    'Thomas Suites','Winkler Suites',
  ],
  'College Ave': [
    'Brett Hall','Campbell Hall','Clothier Hall','Demarest Hall',
    'Frelinghuysen Hall','Hardenbergh Hall','Hegeman Hall','Honors College',
    'Leupp Hall','Mettler Hall','Pell Hall','Sojourner Truth Apartments',
    'Stonier Hall','Tinsley Hall','University Center at Easton Avenue','Wessels Hall',
  ],
  'Cook/Douglass': [
    'Helyar House','Henderson Apartments','Jameson Hall','Katzenbach Hall',
    'Lippincott Hall','New Gibbons','Newell Apartments','Nicholas Hall',
    'Perry Hall','Starkey Apartments','Voorhees Residence Hall','Woodbury Bunting-Cobb Hall',
  ],
  'Livingston': [
    'Livingston Apartments','Lynton Towers North','Lynton Towers South',
    'Quad I','Quad II','Quad III',
  ],
}

const NATURES = [
  'Title IX',
  'Mental Health Concern',
  'Policy Violation',
  'Roommate Conflict',
  'General Residence Life Concern',
  'Facilities Issues',
]

const PARTY_ROLES = [
  { value: 'ACCUSED',             label: 'Accused student (person(s) allegedly involved in a policy violation)' },
  { value: 'VICTIM',              label: 'Victim (person(s) directly impacted by an incident)' },
  { value: 'WITNESS',             label: 'Witness (person(s) who can provide additional information about an incident)' },
  { value: 'STUDENT_OF_CONCERN',  label: 'Student of Concern (person(s) exhibiting mental and/or physical health concerns)' },
  { value: 'INVOLVED_PARTY',      label: 'Involved party (person(s) involved in a roommate conflict)' },
  { value: 'FACILITIES_CONCERN',  label: 'Facilities Concern (person(s) or community affected by a facilities concern)' },
  { value: 'NO_STUDENT_INVOLVED', label: 'No Student Involved (no persons were present at the time of the incident)' },
]

const STEPS = ['Identity', 'Incident', 'Location', 'Parties', 'Narrative', 'Review']

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface InvolvedParty {
  name:  string
  role:  string
  ruid:  string
  dob:   string
  phone: string
}

const EMPTY_PARTY: InvolvedParty = { name: '', role: '', ruid: '', dob: '', phone: '' }

interface FormData {
  ra_name:           string
  ra_username:       string
  ra_phone:          string
  ra_email:          string
  nature:            string
  date:              string
  time:              string
  rupd_called:       boolean
  cad_number:        string
  ems_present:       boolean
  transported:       boolean
  emergency_single:  string
  campus:            string
  building_name:     string
  specific_location: string
  involved_parties:  InvolvedParty[]
  narrative:         string
  media_files:       File[]
}

const EMPTY_FORM: FormData = {
  ra_name: '', ra_username: '', ra_phone: '', ra_email: '',
  nature: '', date: '', time: '',
  rupd_called: false, cad_number: '', ems_present: false,
  transported: false, emergency_single: '',
  campus: '', building_name: '', specific_location: '',
  involved_parties: [{ ...EMPTY_PARTY }],
  narrative: '', media_files: [],
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function SubmitPage() {
  const router = useRouter()
  const [step, setStep]               = useState(0)
  const [form, setForm]               = useState<FormData>(EMPTY_FORM)
  const [submitting, setSubmitting]   = useState(false)
  const [submitted, setSubmitted]     = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submittedId, setSubmittedId] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const role = localStorage.getItem('ru_role')
    if (!role) { router.push('/'); return }
    setForm(f => ({ ...f, date: new Date().toISOString().split('T')[0] }))
  }, [router])

  function set(key: keyof FormData, val: any) {
    setForm(f => ({ ...f, [key]: val }))
  }

  function updateParty(i: number, key: keyof InvolvedParty, val: string) {
    const updated = [...form.involved_parties]
    updated[i] = { ...updated[i], [key]: val }
    setForm(f => ({ ...f, involved_parties: updated }))
  }

  function addParty() {
    setForm(f => ({ ...f, involved_parties: [...f.involved_parties, { ...EMPTY_PARTY }] }))
  }

  function removeParty(i: number) {
    setForm(f => ({ ...f, involved_parties: f.involved_parties.filter((_, idx) => idx !== i) }))
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function stepValid(s: number): boolean {
    if (s === 0) {
      return !!form.ra_name.trim() && !!form.ra_username.trim() &&
             !!form.ra_phone.trim() && !!form.ra_email.trim()
    }
    if (s === 1) {
      const rupdOk = !form.rupd_called || !!form.cad_number.trim()
      return !!form.nature && !!form.date && !!form.time && rupdOk
    }
    if (s === 2) return !!form.campus && !!form.building_name && !!form.specific_location
    if (s === 3) return true // parties optional
    if (s === 4) {
      const hasEnd = form.narrative.trim().toLowerCase().endsWith('end of report.')
      return form.narrative.trim().length > 50 && hasEnd
    }
    return true
  }

  // ── Media ─────────────────────────────────────────────────────────────────
  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    setForm(f => ({ ...f, media_files: [...f.media_files, ...files] }))
  }

  function removeFile(i: number) {
    setForm(f => ({ ...f, media_files: f.media_files.filter((_, idx) => idx !== i) }))
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitting(true)
    setSubmitError('')
    try {
      const [hStr, mStr] = form.time.split(':')
      const h = parseInt(hStr)
      const ampm = h >= 12 ? 'pm' : 'am'
      const h12  = h % 12 === 0 ? 12 : h % 12
      const timeStr = `${h12}:${mStr}${ampm}`

      const NATURE_MAP: Record<string, string> = {
        'Title IX':                       'TITLE_IX',
        'Mental Health Concern':          'MENTAL_HEALTH',
        'Policy Violation':               'POLICY_VIOLATION',
        'Roommate Conflict':              'ROOMMATE_CONFLICT',
        'General Residence Life Concern': 'GENERAL_CONCERN',
        'Facilities Issues':              'FACILITIES',
      }

      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          building_name:     form.building_name,
          specific_location: form.specific_location,
          nature:            NATURE_MAP[form.nature] ?? form.nature,
          date:              form.date,
          time:              timeStr,
          narrative:         form.narrative,
          submitted_by_name: form.ra_name,
          ra_username:       form.ra_username,
          ra_phone:          form.ra_phone,
          ra_email:          form.ra_email,
          rupd_called:       form.rupd_called,
          cad_number:        form.cad_number || null,
          ems_present:       form.ems_present,
          transported:       form.transported,
          emergency_single:  form.emergency_single || null,
          involved_parties:  form.involved_parties.filter(p => p.name.trim()),
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      setSubmittedId(data.data.report_id)
      setSubmitted(true)
    } catch (e: any) {
      setSubmitError(e.message ?? 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <Nav />
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 'calc(100vh - 52px)', padding: '40px',
        }}>
          <div className="card fade-in" style={{ padding: '48px', maxWidth: '480px', width: '100%', textAlign: 'center' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%',
              background: 'rgba(0,196,122,0.12)', border: '1px solid var(--green)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
            }}>
              <span style={{ color: 'var(--green)', fontSize: '20px' }}>✓</span>
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Report Submitted</h2>
            <p className="mono" style={{ color: 'var(--accent)', fontSize: '14px', marginBottom: '8px' }}>
              {submittedId}
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '32px' }}>
              Your report has been saved. Entity extraction is running in the background.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn-primary" onClick={() => { setForm(EMPTY_FORM); setSubmitted(false); setStep(0) }}>
                Submit Another
              </button>
              <button className="btn-secondary" onClick={() => router.push('/dashboard')}>
                View Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <Nav />
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '40px 24px' }}>

        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <p className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '6px' }}>
            INCIDENT REPORT
          </p>
          <h1 style={{ fontSize: '22px', fontWeight: 600 }}>Submit Report</h1>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', marginBottom: '32px' }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '26px', height: '26px', borderRadius: '50%',
                  border: `1px solid ${i === step ? 'var(--accent)' : i < step ? 'var(--green)' : 'var(--border)'}`,
                  background: i === step ? 'var(--accent-glow)' : i < step ? 'rgba(0,196,122,0.1)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {i < step
                    ? <span style={{ color: 'var(--green)', fontSize: '12px' }}>✓</span>
                    : <span className="mono" style={{ fontSize: '11px', color: i === step ? 'var(--accent)' : 'var(--text-muted)' }}>{i + 1}</span>
                  }
                </div>
                <span style={{
                  fontSize: '12px', fontWeight: i === step ? 500 : 400,
                  color: i === step ? 'var(--text-primary)' : 'var(--text-muted)',
                }}>{s}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ flex: 1, height: '1px', background: 'var(--border)', margin: '0 12px' }} />
              )}
            </div>
          ))}
        </div>

        {/* Form card */}
        <div className="card fade-in" style={{ padding: '32px' }} key={step}>

          {/* ── STEP 0: Identity ── */}
          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <SectionTitle>Your Information</SectionTitle>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '-8px' }}>
                Enter your information as the submitting RA.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <Field label="Full Name">
                  <input className="input-base" placeholder="e.g. John Doe" value={form.ra_name} onChange={e => set('ra_name', e.target.value)} />
                </Field>
                <Field label="NetID / Username">
                  <input className="input-base" placeholder="e.g. jd2026" value={form.ra_username} onChange={e => set('ra_username', e.target.value)} />
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <Field label="Phone">
                  <input className="input-base" placeholder="732-555-0101" value={form.ra_phone} onChange={e => set('ra_phone', e.target.value)} />
                </Field>
                <Field label="Email">
                  <input className="input-base" placeholder="netid@rutgers.edu" type="email" value={form.ra_email} onChange={e => set('ra_email', e.target.value)} />
                </Field>
              </div>
            </div>
          )}

          {/* ── STEP 1: Incident ── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <SectionTitle>Incident Details</SectionTitle>
              <Field label="Nature of Incident">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {NATURES.map(n => (
                    <button key={n} onClick={() => set('nature', n)} style={{
                      padding: '10px 12px', textAlign: 'left',
                      border: `1px solid ${form.nature === n ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: '4px',
                      background: form.nature === n ? 'var(--accent-glow)' : 'var(--bg-secondary)',
                      color: form.nature === n ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontSize: '13px', cursor: 'pointer', transition: 'all 0.15s',
                    }}>
                      <span style={{ marginRight: '8px' }}>{natureIcon(n)}</span>{n}
                    </button>
                  ))}
                </div>
              </Field>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <Field label="Date">
                  <input className="input-base" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
                </Field>
                <Field label="Time">
                  <input className="input-base" type="time" value={form.time} onChange={e => set('time', e.target.value)} />
                </Field>
              </div>

              <Field label="Emergency Response">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <Toggle label="RUPD Called" value={form.rupd_called} onChange={v => set('rupd_called', v)} />
                  {form.rupd_called && (
                    <div className="fade-in">
                      <Field label="CAD Number (required)">
                        <input
                          className="input-base"
                          placeholder="e.g. 26-33028"
                          value={form.cad_number}
                          onChange={e => set('cad_number', e.target.value)}
                          style={{ borderColor: !form.cad_number.trim() ? 'var(--accent)' : 'var(--border)' }}
                        />
                      </Field>
                    </div>
                  )}
                  <Toggle label="EMS Present"         value={form.ems_present}  onChange={v => set('ems_present', v)} />
                  <Toggle label="Resident Transported" value={form.transported}  onChange={v => set('transported', v)} />
                </div>
              </Field>

              <Field label="Emergency Single (if applicable)">
                <input className="input-base" placeholder="e.g. Quad I 1020" value={form.emergency_single} onChange={e => set('emergency_single', e.target.value)} />
              </Field>
            </div>
          )}

          {/* ── STEP 2: Location ── */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <SectionTitle>Location</SectionTitle>
              <Field label="Campus">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {Object.keys(BUILDINGS).map(c => (
                    <button key={c} onClick={() => { set('campus', c); set('building_name', '') }} style={{
                      padding: '10px 14px', textAlign: 'left',
                      border: `1px solid ${form.campus === c ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: '4px',
                      background: form.campus === c ? 'var(--accent-glow)' : 'var(--bg-secondary)',
                      color: form.campus === c ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontSize: '13px', cursor: 'pointer', transition: 'all 0.15s',
                    }}>{c}</button>
                  ))}
                </div>
              </Field>

              {form.campus && (
                <Field label="Building">
                  <select className="input-base" value={form.building_name} onChange={e => set('building_name', e.target.value)}>
                    <option value="">Select building...</option>
                    {BUILDINGS[form.campus].map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </Field>
              )}

              <Field label="Specific Location">
                <input className="input-base" placeholder="e.g. Room 214, 3rd Floor Lounge, Main Lobby..." value={form.specific_location} onChange={e => set('specific_location', e.target.value)} />
              </Field>
            </div>
          )}

          {/* ── STEP 3: Involved Parties ── */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <SectionTitle>Involved Parties</SectionTitle>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '-8px' }}>
                Add all individuals involved in this incident. This section is optional.
              </p>

              {form.involved_parties.map((party, i) => (
                <div key={i} className="card" style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <p className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                      PARTY {i + 1}
                    </p>
                    {form.involved_parties.length > 1 && (
                      <button
                        onClick={() => removeParty(i)}
                        style={{
                          background: 'transparent', border: 'none',
                          color: 'var(--text-muted)', cursor: 'pointer',
                          fontSize: '18px', lineHeight: 1, padding: '0 4px',
                          transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                      >×</button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                    <Field label="First Name MI Last Name">
                      <input
                        className="input-base"
                        placeholder="e.g. John A. Smith"
                        value={party.name}
                        onChange={e => updateParty(i, 'name', e.target.value)}
                      />
                    </Field>
                    <Field label="Select Role">
                      <select
                        className="input-base"
                        value={party.role}
                        onChange={e => updateParty(i, 'role', e.target.value)}
                      >
                        <option value=""></option>
                        {PARTY_ROLES.map(r => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                    <Field label="RUID Number">
                      <input
                        className="input-base"
                        placeholder="e.g. 123456789"
                        value={party.ruid}
                        onChange={e => updateParty(i, 'ruid', e.target.value)}
                      />
                    </Field>
                    <Field label="DOB (YYYY-MM-DD)">
                      <input
                        className="input-base"
                        type="date"
                        value={party.dob}
                        onChange={e => updateParty(i, 'dob', e.target.value)}
                      />
                    </Field>
                  </div>

                  <Field label="Phone Number">
                    <input
                      className="input-base"
                      placeholder="e.g. 732-555-0101"
                      value={party.phone}
                      onChange={e => updateParty(i, 'phone', e.target.value)}
                    />
                  </Field>
                </div>
              ))}

              <button
                onClick={addParty}
                style={{
                  padding: '12px', border: '1px dashed var(--border)',
                  borderRadius: '4px', background: 'transparent',
                  color: 'var(--text-secondary)', fontSize: '13px',
                  cursor: 'pointer', transition: 'all 0.15s', width: '100%',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--border-bright)'
                  e.currentTarget.style.color = 'var(--text-primary)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                  e.currentTarget.style.color = 'var(--text-secondary)'
                }}
              >
                + Add another party
              </button>
            </div>
          )}

          {/* ── STEP 4: Narrative ── */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <SectionTitle>Narrative</SectionTitle>

              <div style={{
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                borderRadius: '4px', padding: '14px 16px',
              }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', lineHeight: 1.7, marginBottom: '8px' }}>
                  Write in third person. Begin with:
                </p>
                <p className="mono" style={{ color: 'var(--text-secondary)', fontSize: '12px', lineHeight: 1.7 }}>
                  "On [Day], [Month] [Date], [Year] at approximately [time], Resident Assistant [Name]..."
                </p>
                <div style={{
                  marginTop: '10px', paddingTop: '10px',
                  borderTop: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  <div style={{
                    background: 'rgba(204,0,51,0.12)', border: '1px solid var(--accent)',
                    borderRadius: '3px', padding: '2px 8px',
                  }}>
                    <span className="mono" style={{ color: 'var(--accent)', fontSize: '11px', fontWeight: 600 }}>REQUIRED</span>
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                    Narrative must end with <span className="mono" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>"End of report."</span>
                  </p>
                </div>
              </div>

              <Field label={`Narrative — ${form.narrative.trim().split(/\s+/).filter(Boolean).length} words`}>
                <textarea
                  className="input-base"
                  placeholder={`On Monday, March 15, 2026 at approximately 11:30pm, Resident Assistant ${form.ra_name || '[Your Name]'}...\n\nEnd of report.`}
                  value={form.narrative}
                  onChange={e => set('narrative', e.target.value)}
                  rows={14}
                  style={{ resize: 'vertical', lineHeight: 1.7 }}
                />
              </Field>

              {/* End of report indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: form.narrative.trim().toLowerCase().endsWith('end of report.')
                    ? 'var(--green)' : 'var(--border)',
                  transition: 'background 0.2s',
                }} />
                <span style={{
                  fontSize: '12px',
                  color: form.narrative.trim().toLowerCase().endsWith('end of report.')
                    ? 'var(--green)' : 'var(--text-muted)',
                }}>
                  {form.narrative.trim().toLowerCase().endsWith('end of report.')
                    ? 'Narrative ends correctly with "End of report."'
                    : 'Narrative must end with "End of report."'
                  }
                </span>
              </div>

              {/* Media upload */}
              <div>
                <label className="field-label">Attach Media (optional)</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '1px dashed var(--border)', borderRadius: '4px',
                    padding: '20px', textAlign: 'center', cursor: 'pointer',
                    background: 'var(--bg-secondary)', transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-bright)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                >
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '4px' }}>
                    Click to attach images or documents
                  </p>
                  <p className="mono" style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                    JPG, PNG, PDF — max 10MB each
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf"
                    style={{ display: 'none' }}
                    onChange={handleFiles}
                  />
                </div>

                {form.media_files.length > 0 && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {form.media_files.map((f, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                        borderRadius: '4px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                            {f.type.startsWith('image') ? 'IMG' : 'PDF'}
                          </span>
                          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{f.name}</span>
                          <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                            {(f.size / 1024).toFixed(0)}KB
                          </span>
                        </div>
                        <button
                          onClick={() => removeFile(i)}
                          style={{
                            background: 'transparent', border: 'none',
                            color: 'var(--text-muted)', cursor: 'pointer',
                            fontSize: '16px', padding: '2px 6px', transition: 'color 0.15s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 5: Review ── */}
          {step === 5 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <SectionTitle>Review & Submit</SectionTitle>

              <ReviewSection title="Submitted By">
                <ReviewRow label="Name"    value={form.ra_name} />
                <ReviewRow label="NetID"   value={form.ra_username} />
                <ReviewRow label="Phone"   value={form.ra_phone} />
                <ReviewRow label="Email"   value={form.ra_email} />
              </ReviewSection>

              <ReviewSection title="Incident">
                <ReviewRow label="Nature"      value={form.nature} accent />
                <ReviewRow label="Date"        value={form.date} />
                <ReviewRow label="Time"        value={form.time} />
                <ReviewRow label="RUPD"        value={form.rupd_called ? `Yes — CAD ${form.cad_number}` : 'No'} />
                <ReviewRow label="EMS"         value={form.ems_present ? 'Yes' : 'No'} />
                <ReviewRow label="Transported" value={form.transported ? 'Yes' : 'No'} />
              </ReviewSection>

              <ReviewSection title="Location">
                <ReviewRow label="Campus"   value={form.campus} />
                <ReviewRow label="Building" value={form.building_name} />
                <ReviewRow label="Location" value={form.specific_location} />
              </ReviewSection>

              {form.involved_parties.filter(p => p.name.trim()).length > 0 && (
                <ReviewSection title="Involved Parties">
                  {form.involved_parties.filter(p => p.name.trim()).map((p, i) => (
                    <ReviewRow
                      key={i}
                      label={`Party ${i + 1}`}
                      value={`${p.name}${p.role ? ` — ${PARTY_ROLES.find(r => r.value === p.role)?.label.split('(')[0].trim()}` : ''}`}
                    />
                  ))}
                </ReviewSection>
              )}

              <ReviewSection title="Narrative">
                <p style={{
                  color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.7,
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: '4px', padding: '12px 14px',
                }}>
                  {form.narrative.slice(0, 400)}{form.narrative.length > 400 ? '...' : ''}
                </p>
              </ReviewSection>

              {form.media_files.length > 0 && (
                <ReviewSection title="Attachments">
                  <ReviewRow label="Files" value={`${form.media_files.length} file(s) attached`} />
                </ReviewSection>
              )}

              {submitError && (
                <div style={{
                  background: 'rgba(204,0,51,0.1)', border: '1px solid var(--accent)',
                  borderRadius: '4px', padding: '12px 14px',
                  color: '#ff4466', fontSize: '13px',
                }}>
                  {submitError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
          <button
            className="btn-secondary"
            onClick={() => step === 0 ? router.push('/') : setStep(s => s - 1)}
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </button>

          {step < STEPS.length - 1 ? (
            <button
              className="btn-primary"
              disabled={!stepValid(step)}
              onClick={() => setStep(s => s + 1)}
            >
              Continue
            </button>
          ) : (
            <button
              className="btn-primary"
              disabled={submitting}
              onClick={handleSubmit}
            >
              {submitting ? 'Submitting...' : 'Submit Report'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>{children}</h2>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', cursor: 'pointer',
        border: `1px solid ${value ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '4px',
        background: value ? 'var(--accent-glow)' : 'var(--bg-secondary)',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: '13px', color: value ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</span>
      <div style={{
        width: '36px', height: '20px', borderRadius: '10px',
        background: value ? 'var(--accent)' : 'var(--border)',
        position: 'relative', transition: 'background 0.15s',
      }}>
        <div style={{
          position: 'absolute', top: '3px',
          left: value ? '19px' : '3px',
          width: '14px', height: '14px', borderRadius: '50%',
          background: '#fff', transition: 'left 0.15s',
        }} />
      </div>
    </div>
  )
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '16px' }}>
      <p className="mono" style={{
        fontSize: '10px', letterSpacing: '0.1em',
        color: 'var(--text-muted)', marginBottom: '12px', textTransform: 'uppercase',
      }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {children}
      </div>
    </div>
  )
}

function ReviewRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
      <span className="field-label" style={{ margin: 0, flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: '13px', textAlign: 'right',
        color: accent ? 'var(--accent)' : 'var(--text-primary)',
        fontFamily: accent ? 'IBM Plex Mono, monospace' : 'inherit',
      }}>{value}</span>
    </div>
  )
}

function natureIcon(n: string) {
  if (n === 'Title IX')                       return '⚠'
  if (n === 'Mental Health Concern')          return '◈'
  if (n === 'Policy Violation')               return '⊘'
  if (n === 'Roommate Conflict')              return '◫'
  if (n === 'General Residence Life Concern') return '◎'
  if (n === 'Facilities Issues')              return '◧'
  return '○'
}