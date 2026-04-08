import { PrismaClient, Campus, StaffRole, ReportNature, PolicyType, MentalHealthSeverity, RoleInReport } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const prisma = new PrismaClient()
 
// ─── MAPPINGS ─────────────────────────────────────────────────────────────────
 
const CAMPUS_MAP: Record<string, Campus> = {
  'College Ave':   Campus.COLLEGE_AVE,
  'Busch':         Campus.BUSCH,
  'Cook/Douglass': Campus.COOK_DOUGLASS,
  'Livingston':    Campus.LIVINGSTON,
}
 
const NATURE_MAP: Record<string, ReportNature> = {
  'Title IX':                        ReportNature.TITLE_IX,
  'Mental Health Concern':           ReportNature.MENTAL_HEALTH,
  'Policy Violation':                ReportNature.POLICY_VIOLATION,
  'Roommate Conflict':               ReportNature.ROOMMATE_CONFLICT,
  'General Residence Life Concern':  ReportNature.GENERAL_CONCERN,
  'Facilities Issues':               ReportNature.FACILITIES,
}
 
const POLICY_MAP: Record<string, PolicyType> = {
  'drug_cannabis':        PolicyType.DRUG_CANNABIS,
  'alcohol_underage':     PolicyType.ALCOHOL_UNDERAGE,
  'fire_safety_hotplate': PolicyType.FIRE_SAFETY_HOTPLATE,
  'fire_safety_candle':   PolicyType.FIRE_SAFETY_CANDLE,
  'fire_safety_lithium':  PolicyType.FIRE_SAFETY_LITHIUM,
  'noise':                PolicyType.NOISE,
  'guest_overstay':       PolicyType.GUEST_OVERSTAY,
  'guest_propped':        PolicyType.GUEST_PROPPED,
  'prohibited_item':      PolicyType.PROHIBITED_ITEM,
  'vandalism':            PolicyType.VANDALISM,
  'smoking':              PolicyType.SMOKING,
  'disruption':           PolicyType.DISRUPTION,
  'weapons':              PolicyType.WEAPONS,
}
 
const SEVERITY_MAP: Record<string, MentalHealthSeverity> = {
  'low':    MentalHealthSeverity.LOW,
  'medium': MentalHealthSeverity.MEDIUM,
  'high':   MentalHealthSeverity.HIGH,
  'crisis': MentalHealthSeverity.CRISIS,
}
 
// ─── RA USERNAMES & CONTACT INFO ─────────────────────────────────────────────
 
const RA_INFO: Record<string, { username: string; phone: string; email: string }> = {
  'John Doe':  { username: 'jd2155', phone: '732-555-0101', email: 'john.doe@rutgers.edu' },
  'Priya Nair':       { username: 'pn2345', phone: '732-555-0202', email: 'priya.nair@rutgers.edu' },
  'Carlos Rivera':    { username: 'cr3456', phone: '732-555-0303', email: 'carlos.rivera@rutgers.edu' },
  'Aisha Okafor':     { username: 'ao4567', phone: '732-555-0404', email: 'aisha.okafor@rutgers.edu' },
  'Devon Wallace':    { username: 'dw5678', phone: '732-555-0505', email: 'devon.wallace@rutgers.edu' },
  'Marcus Thompson':  { username: 'mt1234', phone: '732-555-0606', email: 'marcus.thompson@rutgers.edu' },
  'Simone Laurent':   { username: 'sl6789', phone: '732-555-0707', email: 'simone.laurent@rutgers.edu' },
  'Tariq Osei':       { username: 'to7890', phone: '732-555-0808', email: 'tariq.osei@rutgers.edu' },
}
 
// ─── TIMELINE EXTRACTOR ───────────────────────────────────────────────────────
// Extracts timestamped events from narrative text
 
function extractTimeline(narrative: string, reportDate: string): Array<{
  event_time: string
  event_date: Date
  actor: string
  description: string
  sequence: number
}> {
  const events: Array<{ event_time: string; event_date: Date; actor: string; description: string; sequence: number }> = []
  const date = new Date(reportDate)
 
  // Match time patterns like "at 11:45pm", "at 2:30am"
  const timePattern = /at (\d{1,2}:\d{2}(?:am|pm))/gi
  const lines = narrative.split('. ')
 
  let sequence = 1
  for (const line of lines) {
    const timeMatch = line.match(/at (\d{1,2}:\d{2}(?:am|pm))/i)
    if (!timeMatch) continue
 
    const time = timeMatch[1]
 
    // Determine actor and description from line content
    let actor = 'Unknown'
    let description = line.trim()
 
    if (/Resident Assistant|RA /i.test(line)) {
      const raMatch = line.match(/Resident Assistant ([A-Z][a-z]+ [A-Z][a-z]+)/i)
      actor = raMatch ? raMatch[1] : 'RA'
    } else if (/RUPD|police/i.test(line)) {
      actor = 'RUPD'
    } else if (/EMS|paramedic/i.test(line)) {
      actor = 'EMS'
    } else if (/ARLC/i.test(line)) {
      const arlcMatch = line.match(/ARLC ([A-Z][a-z]+)/i)
      actor = arlcMatch ? `ARLC ${arlcMatch[1]}` : 'ARLC'
    } else if (/RLC/i.test(line)) {
      actor = 'RLC'
    } else if (/maintenance/i.test(line)) {
      actor = 'Maintenance'
    }
 
    // Shorten description to key action
    if (/called RUPD/i.test(line)) description = 'Called RUPD'
    else if (/called.*EMS|EMS.*called/i.test(line)) description = 'Called EMS'
    else if (/transported/i.test(line)) description = 'Resident transported to hospital'
    else if (/RUPD arrived/i.test(line)) description = 'RUPD arrived on scene'
    else if (/EMS arrived/i.test(line)) description = 'EMS arrived on scene'
    else if (/ARLC.*arrived|arrived.*ARLC/i.test(line)) description = 'ARLC arrived on scene'
    else if (/RLC.*arrived|arrived.*RLC/i.test(line)) description = 'RLC arrived on scene'
    else if (/knocked on the door/i.test(line)) description = 'RA knocked on door'
    else if (/called.*maintenance|maintenance.*called/i.test(line)) description = 'Called emergency maintenance'
    else if (/maintenance arrived/i.test(line)) description = 'Maintenance arrived'
    else if (/documentation.*completed|completed.*documentation/i.test(line)) description = 'Documentation completed'
    else if (/notified.*ARLC|ARLC.*notified/i.test(line)) description = 'ARLC notified'
    else if (/CAD number/i.test(line)) {
      const cadMatch = line.match(/CAD number ([\w-]+)/i)
      description = cadMatch ? `RUPD issued CAD number ${cadMatch[1]}` : 'RUPD issued CAD number'
    }
    else description = line.substring(0, 80).trim() + (line.length > 80 ? '...' : '')
 
    events.push({ event_time: time, event_date: date, actor, description, sequence })
    sequence++
  }
 
  return events
}
 
// ─── MAIN SEED FUNCTION ───────────────────────────────────────────────────────
 
async function main() {
  console.log('🌱 Starting seed...\n')
 
  // Load JSON dataset
  const dataPath = path.join(__dirname, 'ra_reports_150.json')
  const raw = fs.readFileSync(dataPath, 'utf-8')
  const reports: any[] = JSON.parse(raw)
 
  // ── 1. SEED BUILDINGS ──────────────────────────────────────────────────────
  console.log('📍 Seeding buildings...')
  const buildingMap = new Map<string, number>() // name → id
 
  const uniqueBuildings = [...new Set(reports.map(r => JSON.stringify({ name: r.building, campus: r.campus })))]
    .map(s => JSON.parse(s))
 
  for (const b of uniqueBuildings) {
    const building = await prisma.building.upsert({
      where: { name: b.name },
      update: {},
      create: { name: b.name, campus: CAMPUS_MAP[b.campus] },
    })
    buildingMap.set(building.name, building.id)
  }
  console.log(`  ✓ ${uniqueBuildings.length} buildings seeded\n`)
 
  // ── 2. SEED STAFF ──────────────────────────────────────────────────────────
  console.log('👥 Seeding staff...')
  const staffMap = new Map<string, number>() // name → id
 
  // Collect all unique staff names with roles
  const allStaff: Array<{ name: string; role: StaffRole }> = []
 
  const raNames = [...new Set(reports.map(r => r.ra))]
  raNames.forEach(name => allStaff.push({ name, role: StaffRole.RA }))
 
  const arlcNames = [...new Set(reports.map(r => r.arlc_present).filter(Boolean))]
  arlcNames.forEach(name => allStaff.push({ name, role: StaffRole.ARLC }))
 
  const rlcNames = [...new Set(reports.map(r => r.rlc_present).filter(Boolean))]
  rlcNames.forEach(name => allStaff.push({ name, role: StaffRole.RLC }))
 
  for (const s of allStaff) {
    const info = RA_INFO[s.name]
    const staff = await prisma.staff.upsert({
      where: { email: info?.email ?? `${s.name.toLowerCase().replace(/ /g, '.')}@rutgers.edu` },
      update: {},
      create: {
        full_name: s.name,
        username:  info?.username ?? null,
        role:      s.role,
        phone:     info?.phone ?? null,
        email:     info?.email ?? `${s.name.toLowerCase().replace(/ /g, '.')}@rutgers.edu`,
      },
    })
    staffMap.set(staff.full_name, staff.id)
  }
  console.log(`  ✓ ${allStaff.length} staff members seeded\n`)
 
  // ── 3. SEED REPORTS ────────────────────────────────────────────────────────
  console.log('📋 Seeding reports...')
  let reportCount = 0
 
  for (const r of reports) {
    const buildingId   = buildingMap.get(r.building)!
    const submittedById = staffMap.get(r.submitted_by)!
 
    // Create the report
    const report = await prisma.report.upsert({
      where: { report_id: r.report_id },
      update: {},
      create: {
        report_id:         r.report_id,
        building_id:       buildingId,
        specific_location: r.specific_location,
        nature:            NATURE_MAP[r.nature],
        policy_type:       r.policy_type ? POLICY_MAP[r.policy_type] : null,
        severity_level:    r.severity_level ? SEVERITY_MAP[r.severity_level] : null,
        concern_type:      r.concern_type ?? null,
        issue_type:        r.issue_type ?? null,
        date:              new Date(r.date),
        time:              r.time,
        narrative:         r.narrative,
        submitted_by_id:   submittedById,
        rupd_called:       r.rupd_called === 'Yes',
        cad_number:        r.cad_number ?? null,
        ems_present:       r.ems_present === 'Yes',
        transported:       r.transported === 'Yes',
        emergency_single:  r.emergency_single === 'N/A' ? null : r.emergency_single,
      },
    })
 
    // ── 4. SEED REPORT_STAFF ────────────────────────────────────────────────
    // RA always present
    await prisma.reportStaff.upsert({
      where: { report_id_staff_id: { report_id: report.id, staff_id: staffMap.get(r.ra)! } },
      update: {},
      create: { report_id: report.id, staff_id: staffMap.get(r.ra)!, role_in_report: RoleInReport.RA },
    })
 
    // ARLC if present
    if (r.arlc_present && staffMap.has(r.arlc_present)) {
      await prisma.reportStaff.upsert({
        where: { report_id_staff_id: { report_id: report.id, staff_id: staffMap.get(r.arlc_present)! } },
        update: {},
        create: { report_id: report.id, staff_id: staffMap.get(r.arlc_present)!, role_in_report: RoleInReport.ARLC },
      })
    }
 
    // RLC if present
    if (r.rlc_present && staffMap.has(r.rlc_present)) {
      await prisma.reportStaff.upsert({
        where: { report_id_staff_id: { report_id: report.id, staff_id: staffMap.get(r.rlc_present)! } },
        update: {},
        create: { report_id: report.id, staff_id: staffMap.get(r.rlc_present)!, role_in_report: RoleInReport.RLC },
      })
    }
 
    // ── 5. SEED TIMELINE EVENTS ─────────────────────────────────────────────
    const events = extractTimeline(r.narrative, r.date)
    for (const e of events) {
      await prisma.timelineEvent.create({
        data: {
          report_id:   report.id,
          event_time:  e.event_time,
          event_date:  e.event_date,
          actor:       e.actor,
          description: e.description,
          sequence:    e.sequence,
        },
      })
    }
 
    reportCount++
    if (reportCount % 25 === 0) console.log(`  ... ${reportCount}/150 reports seeded`)
  }
 
  console.log(`  ✓ ${reportCount} reports seeded\n`)
 
  // ── 6. SUMMARY ─────────────────────────────────────────────────────────────
  const counts = await Promise.all([
    prisma.building.count(),
    prisma.staff.count(),
    prisma.report.count(),
    prisma.reportStaff.count(),
    prisma.timelineEvent.count(),
  ])
 
  console.log(' Seed complete!')
  console.log(`   Buildings:      ${counts[0]}`)
  console.log(`   Staff:          ${counts[1]}`)
  console.log(`   Reports:        ${counts[2]}`)
  console.log(`   Report-Staff:   ${counts[3]}`)
  console.log(`   Timeline Events:${counts[4]}`)
}
 
main()
  .catch(e => { console.error(' Seed failed:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
 