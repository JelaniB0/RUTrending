import * as dotenv from 'dotenv'
dotenv.config()

import { ChatOpenAI } from '@langchain/openai'
import { StateGraph, Annotation, END } from '@langchain/langgraph'
import { prisma } from './prisma'

// ─── MODEL ───────────────────────────────────────────────────────────────────

const model = new ChatOpenAI({
  model: 'gpt-4o',
  apiKey: process.env.GITHUB_TOKEN!,
  configuration: {
    baseURL: 'https://models.inference.ai.azure.com',
  },
  temperature: 0,
})

// ─── STATE DEFINITION ────────────────────────────────────────────────────────

const TrendState = Annotation.Root({
  // Inputs
  campus:              Annotation<string | null>,
  buildingId:          Annotation<number | null>,
  startDate:           Annotation<string | null>,
  endDate:             Annotation<string | null>,
  userQuery:           Annotation<string | null>,   // natural language query from user

  // Raw data
  rawReports:          Annotation<any[]>,
  buildingStats:       Annotation<any[]>,
  campusStats:         Annotation<any[]>,

  // Agent outputs
  buildingAnalysis:    Annotation<string | null>,
  campusAnalysis:      Annotation<string | null>,
  locationAnalysis:    Annotation<string | null>,
  personAnalysis:      Annotation<string | null>,
  alerts:              Annotation<string[]>,
  finalReport:         Annotation<string | null>,

  // Routing flags
  shouldDrillLocation: Annotation<boolean>,
  shouldDrillPerson:   Annotation<boolean>,
  flaggedBuildings:    Annotation<string[]>,        // building names to drill into
})

// ─── AGENT NODES ─────────────────────────────────────────────────────────────

// 1. INTAKE AGENT — fetches all raw data from the database
async function intakeAgent(state: typeof TrendState.State) {
  console.log('🔍 Intake Agent: fetching data...')

  const where: any = {}
  if (state.campus) where.building = { campus: state.campus as any }
  if (state.startDate && state.endDate) {
    where.date = { gte: new Date(state.startDate), lte: new Date(state.endDate) }
  }

  const rawReports = await prisma.report.findMany({
    where,
    include: { building: true, report_staff: { include: { staff: true } } },
    orderBy: { date: 'desc' },
    take: 100,
  })

  const campusClause = state.campus ? `WHERE b.campus = '${state.campus}'` : ''

  const buildingStats = await prisma.$queryRawUnsafe(`
    SELECT
      b.id AS building_id,
      b.name AS building_name,
      b.campus,
      COUNT(r.id)::int AS total_reports,
      COUNT(CASE WHEN r.nature = 'Title IX' THEN 1 END)::int AS title_ix,
      COUNT(CASE WHEN r.nature = 'Mental Health Concern' THEN 1 END)::int AS mental_health,
      COUNT(CASE WHEN r.nature = 'Policy Violation' THEN 1 END)::int AS policy_violation,
      COUNT(CASE WHEN r.nature = 'Roommate Conflict' THEN 1 END)::int AS roommate_conflict,
      COUNT(CASE WHEN r.nature = 'General Residence Life Concern' THEN 1 END)::int AS general_concern,
      COUNT(CASE WHEN r.nature = 'Facilities Issues' THEN 1 END)::int AS facilities,
      COUNT(CASE WHEN r.rupd_called = true THEN 1 END)::int AS rupd_called,
      COUNT(CASE WHEN r.ems_present = true THEN 1 END)::int AS ems_present
    FROM reports r
    JOIN buildings b ON r.building_id = b.id
    ${campusClause}
    GROUP BY b.id, b.name, b.campus
    ORDER BY total_reports DESC
  `) as any[]

  const campusStats = await prisma.$queryRawUnsafe(`
    SELECT
      b.campus,
      COUNT(r.id)::int AS total_reports,
      COUNT(CASE WHEN r.nature = 'Title IX' THEN 1 END)::int AS title_ix,
      COUNT(CASE WHEN r.nature = 'Mental Health Concern' THEN 1 END)::int AS mental_health,
      COUNT(CASE WHEN r.nature = 'Policy Violation' THEN 1 END)::int AS policy_violation,
      COUNT(CASE WHEN r.nature = 'Roommate Conflict' THEN 1 END)::int AS roommate_conflict,
      COUNT(CASE WHEN r.nature = 'Facilities Issues' THEN 1 END)::int AS facilities,
      COUNT(CASE WHEN r.rupd_called = true THEN 1 END)::int AS rupd_called,
      COUNT(CASE WHEN r.ems_present = true THEN 1 END)::int AS ems_present
    FROM reports r
    JOIN buildings b ON r.building_id = b.id
    GROUP BY b.campus
    ORDER BY total_reports DESC
  `) as any[]

  console.log(`  ✓ Fetched ${rawReports.length} reports, ${buildingStats.length} buildings`)
  return { rawReports, buildingStats, campusStats }
}

// 2. BUILDING AGENT — analyzes per-building patterns and sets routing flags
async function buildingAgent(state: typeof TrendState.State) {
  console.log('🏢 Building Agent: analyzing building patterns...')

  const topBuildings = state.buildingStats.slice(0, 10)
  const prompt = `
You are a Rutgers University Residence Life analyst. Analyze these building-level incident statistics.

BUILDING STATISTICS:
${JSON.stringify(topBuildings, null, 2)}

USER QUERY (if any): ${state.userQuery ?? 'General trend analysis'}

Provide a concise analysis covering:
1. Which buildings have the highest incident rates and what types dominate
2. Any buildings with concerning patterns (high Title IX, repeated mental health, high RUPD involvement)
3. Buildings that may need additional RA support or resources
4. Any notable cross-building trends

Also at the end of your response, on a new line, output a JSON array of building names that warrant
deeper location-level analysis (i.e. buildings with 4+ reports or alarming incident type concentrations).
Format: FLAGGED_BUILDINGS: ["Building Name 1", "Building Name 2"]

3-5 paragraphs of analysis, then the FLAGGED_BUILDINGS line.
`

  const response = await model.invoke(prompt)
  const content = response.content as string

  // Extract flagged buildings from response
  let flaggedBuildings: string[] = []
  const flagMatch = content.match(/FLAGGED_BUILDINGS:\s*(\[.*?\])/s)
  if (flagMatch) {
    try {
      flaggedBuildings = JSON.parse(flagMatch[1])
    } catch {
      flaggedBuildings = []
    }
  }

  // Remove the FLAGGED_BUILDINGS line from the analysis text
  const buildingAnalysis = content.replace(/FLAGGED_BUILDINGS:.*$/s, '').trim()

  // Check if user query requests location drill-down
  const queryWantsLocation = state.userQuery
    ? /room|floor|lounge|lobby|area|location|specific|where/i.test(state.userQuery)
    : false

  const shouldDrillLocation = flaggedBuildings.length > 0 || queryWantsLocation

  console.log(`  ✓ Building analysis complete. Flagged ${flaggedBuildings.length} buildings for location drill-down`)
  return { buildingAnalysis, flaggedBuildings, shouldDrillLocation }
}

// 3. CAMPUS AGENT — campus-wide trend analysis
async function campusAgent(state: typeof TrendState.State) {
  console.log('🎓 Campus Agent: analyzing campus-wide trends...')

  const prompt = `
You are a Rutgers University Residence Life analyst. Analyze these campus-wide incident statistics.

CAMPUS STATISTICS:
${JSON.stringify(state.campusStats, null, 2)}

BUILDING ANALYSIS:
${state.buildingAnalysis}

USER QUERY (if any): ${state.userQuery ?? 'General trend analysis'}

Provide a campus-wide trend analysis covering:
1. Which campuses have the most incidents and what types dominate
2. Significant differences between campuses
3. Resources or interventions that should be prioritized at the campus level
4. Overall residential community health assessment

3-4 paragraphs, factual and actionable.
`

  const response = await model.invoke(prompt)
  const campusAnalysis = response.content as string
  console.log('  ✓ Campus analysis complete')
  return { campusAnalysis }
}

// 4. ALERT AGENT — flags urgent patterns and sets person drill-down flag
async function alertAgent(state: typeof TrendState.State) {
  console.log('🚨 Alert Agent: scanning for urgent patterns...')

  // Repeat locations
  const repeatLocations = await prisma.$queryRaw`
    SELECT
      b.name AS building_name,
      r.specific_location,
      COUNT(r.id)::int AS incident_count,
      array_agg(r.nature ORDER BY r.date) AS incident_types
    FROM reports r
    JOIN buildings b ON r.building_id = b.id
    GROUP BY b.name, r.specific_location
    HAVING COUNT(r.id) > 1
    ORDER BY incident_count DESC
    LIMIT 10
  ` as any[]

  // Repeat involved students (appears in 2+ reports)
  const repeatStudents = await prisma.$queryRaw`
    SELECT
      s.first_name || ' ' || s.last_name AS student_name,
      s.ruid,
      COUNT(rs.report_id)::int AS report_count,
      array_agg(DISTINCT r.nature) AS incident_types
    FROM students s
    JOIN report_students rs ON s.id = rs.student_id
    JOIN reports r ON rs.report_id = r.id
    GROUP BY s.id, s.first_name, s.last_name, s.ruid
    HAVING COUNT(rs.report_id) >= 2
    ORDER BY report_count DESC
  ` as any[]

  const highSeverityCount = state.rawReports.filter(r =>
    r.rupd_called || r.ems_present || r.transported
  ).length

  const prompt = `
You are a Rutgers Residence Life safety analyst. Review these patterns and generate specific alerts.

REPEAT INCIDENT LOCATIONS:
${JSON.stringify(repeatLocations, null, 2)}

STUDENTS APPEARING IN MULTIPLE REPORTS: ${repeatStudents.length} students
HIGH SEVERITY INCIDENTS (RUPD/EMS involved): ${highSeverityCount}

USER QUERY (if any): ${state.userQuery ?? 'General trend analysis'}

Generate specific, actionable alerts. Each alert should start with "ALERT:".
Focus on repeat locations, high RUPD/EMS involvement, and escalating patterns.

Return ONLY a JSON array of alert strings. No explanation, no markdown.
`

  const response = await model.invoke(prompt)
  let alerts: string[] = []
  try {
    const content = (response.content as string).replace(/```json|```/g, '').trim()
    alerts = JSON.parse(content)
  } catch {
    alerts = ['ALERT: Unable to parse alert data — manual review recommended.']
  }

  // Trigger person agent if repeat students found OR user asked about a person
  const queryWantsPerson = state.userQuery
    ? /person|student|resident|individual|who|repeat offender|same person/i.test(state.userQuery)
    : false
  const shouldDrillPerson = repeatStudents.length > 0 || queryWantsPerson

  console.log(`Generated ${alerts.length} alerts. Person drill-down: ${shouldDrillPerson}`)
  return { alerts, shouldDrillPerson }
}

// 5. LOCATION AGENT — drills into flagged buildings at room/floor/area level
async function locationAgent(state: typeof TrendState.State) {
  console.log('📍 Location Agent: drilling into flagged buildings...')

  const buildingList = state.flaggedBuildings.map(name => `'${name}'`).join(', ')

  const locationData = await prisma.$queryRawUnsafe(`
    SELECT
      b.name AS building_name,
      b.campus,
      r.specific_location,
      r.nature,
      r.date,
      r.rupd_called,
      r.ems_present
    FROM reports r
    JOIN buildings b ON r.building_id = b.id
    WHERE b.name IN (${buildingList})
    ORDER BY b.name, r.specific_location, r.date
  `) as any[]

  // Group by building and location
  const grouped: Record<string, Record<string, any[]>> = {}
  for (const row of locationData) {
    if (!grouped[row.building_name]) grouped[row.building_name] = {}
    if (!grouped[row.building_name][row.specific_location]) {
      grouped[row.building_name][row.specific_location] = []
    }
    grouped[row.building_name][row.specific_location].push(row)
  }

  const prompt = `
You are a Rutgers Residence Life analyst doing a detailed location breakdown.

INCIDENT DATA BY BUILDING AND LOCATION:
${JSON.stringify(grouped, null, 2)}

USER QUERY (if any): ${state.userQuery ?? 'Location pattern analysis'}

Analyze location-level patterns within these buildings:
1. Which specific rooms, floors, or areas have repeat incidents
2. Whether repeat incidents in the same location involve the same type or escalating types
3. Any physical locations that may need environmental interventions (lighting, security cameras, staff presence)
4. Specific recommendations per building

Be specific with room numbers and locations. 3-5 paragraphs.
`

  const response = await model.invoke(prompt)
  const locationAnalysis = response.content as string
  console.log('Location analysis complete')
  return { locationAnalysis }
}

// 6. PERSON AGENT — analyzes repeat involved parties
async function personAgent(state: typeof TrendState.State) {
  console.log('👤 Person Agent: analyzing repeat involved parties...')

  const repeatStudents = await prisma.$queryRaw`
    SELECT
      s.first_name || ' ' || s.last_name AS student_name,
      s.ruid,
      s.hall,
      COUNT(rs.report_id)::int AS report_count,
      array_agg(DISTINCT r.nature ORDER BY r.nature) AS incident_types,
      array_agg(rs.role ORDER BY r.date) AS roles,
      MIN(r.date) AS first_report,
      MAX(r.date) AS last_report
    FROM students s
    JOIN report_students rs ON s.id = rs.student_id
    JOIN reports r ON rs.report_id = r.id
    GROUP BY s.id, s.first_name, s.last_name, s.ruid, s.hall
    HAVING COUNT(rs.report_id) >= 2
    ORDER BY report_count DESC
  ` as any[]

  if (repeatStudents.length === 0) {
    return { personAnalysis: 'No students appeared in multiple reports during this period.' }
  }

  const prompt = `
You are a Rutgers Residence Life case manager reviewing students who appear in multiple incident reports.

REPEAT INVOLVED PARTIES:
${JSON.stringify(repeatStudents, null, 2)}

USER QUERY (if any): ${state.userQuery ?? 'Person pattern analysis'}

Analyze these patterns:
1. Students appearing as accused in multiple reports — escalation risk
2. Students appearing as victims or students of concern multiple times — support needs
3. Any students whose incident types suggest a pattern (e.g. repeated policy violations, repeated mental health concerns)
4. Recommended follow-up actions for case management

Important: Be clinical and professional. Do not make assumptions beyond what the data shows.
Refer to students by initials only for privacy (e.g. "Student L.S.").
3-4 paragraphs.
`

  const response = await model.invoke(prompt)
  const personAnalysis = response.content as string
  console.log('  ✓ Person analysis complete')
  return { personAnalysis }
}

// 7. REPORT AGENT — compiles everything into final executive summary
async function reportAgent(state: typeof TrendState.State) {
  console.log('📋 Report Agent: compiling final report...')

  const sections = [
    `CAMPUS ANALYSIS:\n${state.campusAnalysis}`,
    `BUILDING ANALYSIS:\n${state.buildingAnalysis}`,
    state.locationAnalysis ? `LOCATION DRILL-DOWN:\n${state.locationAnalysis}` : null,
    state.personAnalysis   ? `PERSON PATTERNS:\n${state.personAnalysis}` : null,
    `ALERTS:\n${state.alerts.join('\n')}`,
  ].filter(Boolean).join('\n\n')

  const prompt = `
You are a Rutgers University Residence Life director writing an executive summary report.

${sections}

USER QUERY (if any): ${state.userQuery ?? 'General trend analysis'}

Write a concise executive summary (4-6 paragraphs) suitable for a Residence Life director.
Structure it as:
1. Overall community health assessment
2. Top concerns and hotspots
3. Notable patterns (location, person, or escalation trends if applicable)
4. Recommended immediate actions
5. Longer-term recommendations

Be direct, specific, and actionable.
`

  const response = await model.invoke(prompt)
  const finalReport = response.content as string
  console.log('  ✓ Final report compiled')
  return { finalReport }
}

// ─── ROUTING FUNCTIONS ────────────────────────────────────────────────────────

function routeAfterBuilding(state: typeof TrendState.State): string[] {
  const next = ['reportCompiler']
  if (state.shouldDrillLocation) next.push('locationAnalyzer')
  return next
}

function routeAfterAlert(state: typeof TrendState.State): string[] {
  const next: string[] = []
  if (state.shouldDrillPerson) next.push('personAnalyzer')
  return next
}

// ─── BUILD THE GRAPH ──────────────────────────────────────────────────────────

const graph = new StateGraph(TrendState)
  .addNode('intake',           intakeAgent)
  .addNode('buildingAnalyzer', buildingAgent)
  .addNode('campusAnalyzer',   campusAgent)
  .addNode('alertScanner',     alertAgent)
  .addNode('locationAnalyzer', locationAgent)
  .addNode('personAnalyzer',   personAgent)
  .addNode('reportCompiler',   reportAgent)

  // Intake fans out to three parallel agents
  .addEdge('__start__',        'intake')
  .addEdge('intake',           'buildingAnalyzer')
  .addEdge('intake',           'campusAnalyzer')
  .addEdge('intake',           'alertScanner')

  // Campus always feeds into report
  .addEdge('campusAnalyzer',   'reportCompiler')

  // Building conditionally activates location agent
  .addConditionalEdges('buildingAnalyzer', routeAfterBuilding)

  // Alert conditionally activates person agent
  .addConditionalEdges('alertScanner', routeAfterAlert)

  // Location and person both feed into report
  .addEdge('locationAnalyzer', 'reportCompiler')
  .addEdge('personAnalyzer',   'reportCompiler')

  // Report is the end
  .addEdge('reportCompiler',   '__end__')

export const trendAgent = graph.compile()

// ─── EXPORTED RUN FUNCTION ────────────────────────────────────────────────────

export async function runTrendAnalysis(options: {
  campus?:    string
  startDate?: string
  endDate?:   string
  userQuery?: string
}) {
  const result = await trendAgent.invoke({
    campus:              options.campus    ?? null,
    buildingId:          null,
    startDate:           options.startDate ?? null,
    endDate:             options.endDate   ?? null,
    userQuery:           options.userQuery ?? null,
    rawReports:          [],
    buildingStats:       [],
    campusStats:         [],
    buildingAnalysis:    null,
    campusAnalysis:      null,
    locationAnalysis:    null,
    personAnalysis:      null,
    alerts:              [],
    finalReport:         null,
    shouldDrillLocation: false,
    shouldDrillPerson:   false,
    flaggedBuildings:    [],
  })

  return result
}