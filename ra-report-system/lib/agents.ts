import * as dotenv from 'dotenv'
dotenv.config()

import OpenAI from 'openai'
import { StateGraph, Annotation, END } from '@langchain/langgraph'
import { prisma } from './prisma'

// ─── MODEL ───────────────────────────────────────────────────────────────────

const model = new OpenAI({
  apiKey: process.env.GITHUB_TOKEN!,
  baseURL: 'https://models.inference.ai.azure.com',
})

async function callModel(prompt: string): Promise<string> {
  const response = await model.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
  })
  return response.choices[0].message.content!
}

// ─── STATE DEFINITION ────────────────────────────────────────────────────────

const TrendState = Annotation.Root({
  // Inputs
  campus:              Annotation<string | null>,
  buildingId:          Annotation<number | null>,
  startDate:           Annotation<string | null>,
  endDate:             Annotation<string | null>,
  userQuery:           Annotation<string | null>,

  // Raw data
  rawReports:          Annotation<any[]>,
  buildingStats:       Annotation<any[]>,
  campusStats:         Annotation<any[]>,

  // Agent outputs
  buildingAnalysis:    Annotation<string | null>,
  campusAnalysis:      Annotation<string | null>,
  locationAnalysis:    Annotation<string | null>,
  personAnalysis:      Annotation<string | null>,
  queryAnalysis:       Annotation<string | null>,
  alerts:              Annotation<string[]>,
  finalReport:         Annotation<string | null>,

  // Routing flags
  shouldDrillLocation: Annotation<boolean>,
  shouldDrillPerson:   Annotation<boolean>,
  flaggedBuildings:    Annotation<string[]>,
})

// ─── AGENT NODES ─────────────────────────────────────────────────────────────

// 1. INTAKE AGENT — fetches all raw data from the database
async function intakeAgent(state: typeof TrendState.State) {
  console.log('Intake Agent: fetching data...')

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

  console.log(`Fetched ${rawReports.length} reports, ${buildingStats.length} buildings`)
  return { rawReports, buildingStats, campusStats }
}

// 2. BUILDING AGENT — analyzes per-building patterns and sets routing flags
async function buildingAgent(state: typeof TrendState.State) {
  console.log('Building Agent: analyzing building patterns...')

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

  const content = await callModel(prompt)

  let flaggedBuildings: string[] = []
  const flagMatch = content.match(/FLAGGED_BUILDINGS:\s*(\[.*?\])/)
  if (flagMatch) {
    try {
      flaggedBuildings = JSON.parse(flagMatch[1])
    } catch {
      flaggedBuildings = []
    }
  }

  const buildingAnalysis = content.replace(/FLAGGED_BUILDINGS:.*$/, '').trim()

  const queryWantsLocation = state.userQuery
    ? /room|floor|lounge|lobby|area|location|specific|where/i.test(state.userQuery)
    : false

  const shouldDrillLocation = flaggedBuildings.length > 0 || queryWantsLocation

  console.log(`Building analysis complete. Flagged ${flaggedBuildings.length} buildings for location drill-down`)
  return { buildingAnalysis, flaggedBuildings, shouldDrillLocation }
}

// 3. CAMPUS AGENT — campus-wide trend analysis
async function campusAgent(state: typeof TrendState.State) {
  console.log('Campus Agent: analyzing campus-wide trends...')

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

  const campusAnalysis = await callModel(prompt)
  console.log('Campus analysis complete')
  return { campusAnalysis }
}

// 4. ALERT AGENT — flags urgent patterns and sets person drill-down flag
async function alertAgent(state: typeof TrendState.State) {
  console.log('Alert Agent: scanning for urgent patterns...')

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

  const raw = await callModel(prompt)
  let alerts: string[] = []
  try {
    const content = raw.replace(/```json|```/g, '').trim()
    alerts = JSON.parse(content)
  } catch {
    alerts = ['ALERT: Unable to parse alert data — manual review recommended.']
  }

  const queryWantsPerson = state.userQuery
    ? /person|student|resident|individual|who|repeat offender|same person/i.test(state.userQuery)
    : false
  const shouldDrillPerson = repeatStudents.length > 0 || queryWantsPerson

  console.log(`Generated ${alerts.length} alerts. Person drill-down: ${shouldDrillPerson}`)
  return { alerts, shouldDrillPerson }
}

// 5. LOCATION AGENT — drills into flagged buildings at room/floor/area level
async function locationAgent(state: typeof TrendState.State) {
  console.log('Location Agent: drilling into flagged buildings...')

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

  const locationAnalysis = await callModel(prompt)
  console.log('Location analysis complete')
  return { locationAnalysis }
}

// 6. PERSON AGENT — analyzes repeat involved parties
async function personAgent(state: typeof TrendState.State) {
  console.log('Person Agent: analyzing repeat involved parties...')

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

  const personAnalysis = await callModel(prompt)
  console.log('Person analysis complete')
  return { personAnalysis }
}

// 7. QUERY AGENT — directly answers the user's specific question
async function queryAgent(state: typeof TrendState.State) {
  console.log('Query Agent: answering specific user question...')

  if (!state.userQuery) return { queryAnalysis: null }

  const q = state.userQuery.toLowerCase()

  let contextData: any[] = []

  if (q.includes('repeat') || q.includes('offender') || q.includes('student') || q.includes('who')) {
    contextData = await prisma.$queryRaw`
      SELECT
        s.first_name || ' ' || s.last_name AS name,
        s.ruid,
        s.hall,
        COUNT(rs.report_id)::int AS report_count,
        array_agg(DISTINCT r.nature) AS incident_types
      FROM students s
      JOIN report_students rs ON s.id = rs.student_id
      JOIN reports r ON rs.report_id = r.id
      GROUP BY s.id, s.first_name, s.last_name, s.ruid, s.hall
      HAVING COUNT(rs.report_id) >= 2
      ORDER BY report_count DESC
    ` as any[]
  } else if (q.includes('noise')) {
    contextData = await prisma.$queryRaw`
      SELECT b.name AS building, b.campus, r.specific_location, COUNT(r.id)::int AS count
      FROM reports r JOIN buildings b ON r.building_id = b.id
      WHERE (r.nature = 'General Residence Life Concern' AND r.concern_type ILIKE '%noise%')
         OR (r.nature = 'Policy Violation' AND r.policy_type = 'NOISE')
      GROUP BY b.name, b.campus, r.specific_location
      ORDER BY count DESC LIMIT 10
    ` as any[]
  } else if (q.includes('alcohol') || q.includes('drug') || q.includes('cannabis')) {
    contextData = await prisma.$queryRaw`
      SELECT b.campus, COUNT(r.id)::int AS total,
        COUNT(CASE WHEN r.policy_type = 'ALCOHOL_UNDERAGE' THEN 1 END)::int AS alcohol,
        COUNT(CASE WHEN r.policy_type = 'DRUG_CANNABIS' THEN 1 END)::int AS cannabis
      FROM reports r JOIN buildings b ON r.building_id = b.id
      WHERE r.policy_type IN ('ALCOHOL_UNDERAGE', 'DRUG_CANNABIS')
      GROUP BY b.campus ORDER BY total DESC
    ` as any[]
  } else if (q.includes('mental health') || q.includes('wellness') || q.includes('crisis')) {
    contextData = await prisma.$queryRaw`
      SELECT b.name AS building, b.campus, r.severity_level, COUNT(r.id)::int AS count
      FROM reports r JOIN buildings b ON r.building_id = b.id
      WHERE r.nature = 'Mental Health Concern'
      GROUP BY b.name, b.campus, r.severity_level
      ORDER BY count DESC LIMIT 10
    ` as any[]
  } else if (q.includes('title ix') || q.includes('sexual') || q.includes('harassment')) {
    contextData = await prisma.$queryRaw`
      SELECT b.name AS building, b.campus, COUNT(r.id)::int AS count
      FROM reports r JOIN buildings b ON r.building_id = b.id
      WHERE r.nature = 'Title IX'
      GROUP BY b.name, b.campus
      ORDER BY count DESC LIMIT 10
    ` as any[]
  } else if (q.includes('rupd') || q.includes('police')) {
    contextData = await prisma.$queryRaw`
      SELECT b.campus, b.name AS building, COUNT(r.id)::int AS rupd_count
      FROM reports r JOIN buildings b ON r.building_id = b.id
      WHERE r.rupd_called = true
      GROUP BY b.campus, b.name
      ORDER BY rupd_count DESC LIMIT 10
    ` as any[]
  } else if (q.includes('ems') || q.includes('ambulance') || q.includes('transport')) {
    contextData = await prisma.$queryRaw`
      SELECT b.campus, b.name AS building,
        COUNT(r.id)::int AS ems_count,
        COUNT(CASE WHEN r.transported = true THEN 1 END)::int AS transported
      FROM reports r JOIN buildings b ON r.building_id = b.id
      WHERE r.ems_present = true
      GROUP BY b.campus, b.name
      ORDER BY ems_count DESC
    ` as any[]
  } else if (q.includes('roommate')) {
    contextData = await prisma.$queryRaw`
      SELECT b.name AS building, b.campus, COUNT(r.id)::int AS count
      FROM reports r JOIN buildings b ON r.building_id = b.id
      WHERE r.nature = 'Roommate Conflict'
      GROUP BY b.name, b.campus
      ORDER BY count DESC LIMIT 10
    ` as any[]
  } else if (q.includes('facilit') || q.includes('maintenance') || q.includes('flood') || q.includes('power')) {
    contextData = await prisma.$queryRaw`
      SELECT b.name AS building, b.campus, r.issue_type, COUNT(r.id)::int AS count
      FROM reports r JOIN buildings b ON r.building_id = b.id
      WHERE r.nature = 'Facilities Issues'
      GROUP BY b.name, b.campus, r.issue_type
      ORDER BY count DESC LIMIT 10
    ` as any[]
  } else {
    contextData = state.buildingStats.slice(0, 15)
  }

  const prompt = `
You are a Rutgers Residence Life analyst. A staff member has asked a specific question.
Answer it directly and thoroughly using the data provided.

QUESTION: ${state.userQuery}

RELEVANT DATA:
${JSON.stringify(contextData, null, 2)}

ADDITIONAL CONTEXT FROM BUILDING ANALYSIS:
${state.buildingAnalysis ?? 'Not yet available'}

Instructions:
- Answer the question directly in the first sentence
- Use specific numbers, building names, and campus names from the data
- If the data doesn't fully answer the question, say so clearly
- 2-4 paragraphs, factual and specific
`

  const queryAnalysis = await callModel(prompt)
  console.log('Query agent complete')
  return { queryAnalysis }
}

// 8. REPORT AGENT — compiles everything into final executive summary
async function reportAgent(state: typeof TrendState.State) {
  console.log('Report Agent: compiling final report...')

  const sections = [
    state.queryAnalysis    ? `SPECIFIC QUERY ANSWER:\n${state.queryAnalysis}`   : null,
    `CAMPUS ANALYSIS:\n${state.campusAnalysis}`,
    `BUILDING ANALYSIS:\n${state.buildingAnalysis}`,
    state.locationAnalysis ? `LOCATION DRILL-DOWN:\n${state.locationAnalysis}` : null,
    state.personAnalysis   ? `PERSON PATTERNS:\n${state.personAnalysis}`       : null,
    `ALERTS:\n${state.alerts.join('\n')}`,
  ].filter(Boolean).join('\n\n')

  const prompt = `
You are a Rutgers University Residence Life director writing an executive summary report.

GROUND TRUTH — USE ONLY THESE EXACT NUMBERS. DO NOT INVENT OR MODIFY ANY STATISTICS:

CAMPUS STATS (authoritative):
${JSON.stringify(state.campusStats, null, 2)}

TOP BUILDINGS (authoritative):
${JSON.stringify(state.buildingStats.slice(0, 10), null, 2)}

AGENT ANALYSES (use for narrative context only, not for numbers):
${sections}

USER QUERY (if any): ${state.userQuery ?? 'General trend analysis'}

Write a concise executive summary (4-6 paragraphs) suitable for a Residence Life director.
Structure it as:
1. Overall community health assessment
2. Top concerns and hotspots — ONLY cite numbers from CAMPUS STATS and TOP BUILDINGS above
3. Notable patterns (location, person, or escalation trends if applicable)
4. Recommended immediate actions
5. Longer-term recommendations

CRITICAL: Every number you write must match the GROUND TRUTH data exactly.
Do not round, estimate, or carry over numbers from the agent analyses.
If a number isn't in the ground truth data, do not include it.
`

  const finalReport = await callModel(prompt)
  console.log('Final report compiled')
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
  .addNode('queryAnalyzer',    queryAgent)
  .addNode('reportCompiler',   reportAgent)

  .addEdge('__start__',        'intake')
  .addEdge('intake',           'buildingAnalyzer')
  .addEdge('intake',           'campusAnalyzer')
  .addEdge('intake',           'alertScanner')
  .addEdge('intake',           'queryAnalyzer')

  .addEdge('campusAnalyzer',   'reportCompiler')
  .addEdge('queryAnalyzer',    'reportCompiler')

  .addConditionalEdges('buildingAnalyzer', routeAfterBuilding)
  .addConditionalEdges('alertScanner',     routeAfterAlert)

  .addEdge('locationAnalyzer', 'reportCompiler')
  .addEdge('personAnalyzer',   'reportCompiler')

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
    queryAnalysis:       null,
    alerts:              [],
    finalReport:         null,
    shouldDrillLocation: false,
    shouldDrillPerson:   false,
    flaggedBuildings:    [],
  })

  return result
}