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

const MAX_CONCURRENT = 2
let activeRequests = 0
const queue: Array<() => void> = []

function acquireSlot(): Promise<void> {
  return new Promise(resolve => {
    if (activeRequests < MAX_CONCURRENT) {
      activeRequests++
      resolve()
    } else {
      queue.push(() => {
        activeRequests++
        resolve()
      })
    }
  })
}

function releaseSlot() {
  activeRequests--
  const next = queue.shift()
  if (next) next()
}

async function callModel(prompt: string): Promise<string> {
  await acquireSlot()
  try {
    const response = await model.chat.completions.create({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    })
    return response.choices[0].message.content!
  } finally {
    releaseSlot()
  }
}

async function callModelMini(prompt: string): Promise<string> {
  await acquireSlot()
  try {
    const response = await model.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    })
    return response.choices[0].message.content!
  } finally {
    releaseSlot()
  }
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

  const summary: Record<string, Record<string, { count: number; types: string[] }>> = {}
for (const row of locationData) {
  if (!summary[row.building_name]) summary[row.building_name] = {}
  if (!summary[row.building_name][row.specific_location]) {
    summary[row.building_name][row.specific_location] = { count: 0, types: [] }
  }
  summary[row.building_name][row.specific_location].count++
  if (!summary[row.building_name][row.specific_location].types.includes(row.nature)) {
    summary[row.building_name][row.specific_location].types.push(row.nature)
  }
}

const hotspots: Record<string, Record<string, { count: number; types: string[] }>> = {}
for (const [building, locations] of Object.entries(summary)) {
  for (const [location, data] of Object.entries(locations)) {
    if (data.count >= 2) {
      if (!hotspots[building]) hotspots[building] = {}
      hotspots[building][location] = data
    }
  }
}

const prompt = `
You are a Rutgers Residence Life analyst. Analyze repeat incident locations.

HOTSPOT LOCATIONS (2+ incidents only):
${JSON.stringify(hotspots, null, 2)}

USER QUERY (if any): ${state.userQuery ?? 'Location pattern analysis'}

Identify the most concerning repeat locations and recommend interventions. 3 paragraphs max.
`

  const locationAnalysis = await callModelMini(prompt)
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

  // Step 1: Generate SQL from the question
  const sqlPrompt = `
You are a PostgreSQL expert. Write a SQL query to answer the user's question using this schema.

SCHEMA:
tables:
- reports (id, nature, policy_type, severity_level, rupd_called, ems_present, transported, date, specific_location, building_id, narrative)
- buildings (id, name, campus)

nature values: 'Title IX', 'Mental Health Concern', 'Policy Violation', 'Roommate Conflict', 'General Residence Life Concern', 'Facilities Issues'
policy_type values: 'ALCOHOL_UNDERAGE', 'DRUG_CANNABIS', 'NOISE', 'FIRE_SAFETY_HOTPLATE', 'FIRE_SAFETY_CANDLE', 'FIRE_SAFETY_LITHIUM', 'GUEST_OVERSTAY', 'GUEST_PROPPED', 'PROHIBITED_ITEM', 'VANDALISM', 'SMOKING', 'DISRUPTION', 'WEAPONS'
severity_level values: 'LOW', 'MEDIUM', 'HIGH', 'CRISIS'
campus values: 'COLLEGE_AVE', 'BUSCH', 'COOK_DOUGLASS', 'LIVINGSTON'

QUESTION: ${state.userQuery}

Rules:
- Always JOIN buildings on r.building_id = b.id
- Always include b.name AS building and b.campus in SELECT when relevant
- Use COUNT()::int for counts
- ORDER BY count DESC
- LIMIT 20
- Return ONLY the raw SQL query, no markdown, no explanation, no backticks
- When asked about specific substances or incident types, always break them out as separate columns (e.g. COUNT(CASE WHEN policy_type = 'ALCOHOL_UNDERAGE' THEN 1 END)::int AS alcohol)
- Never use column aliases in ORDER BY, always repeat the full expression like ORDER BY (COUNT(CASE WHEN r.policy_type = 'ALCOHOL_UNDERAGE' THEN 1 END) + COUNT(CASE WHEN r.policy_type = 'DRUG_CANNABIS' THEN 1 END)) DESC
`

  let contextData: any[] = []
  try {
    const rawSql = await callModel(sqlPrompt)
    const cleanSql = rawSql.replace(/```sql|```/g, '').trim()
    console.log('Generated SQL:', cleanSql)
    contextData = await prisma.$queryRawUnsafe(cleanSql)
  } catch (err) {
    console.error('Text-to-SQL failed, falling back to building stats:', err)
    contextData = state.buildingStats.slice(0, 15)
  }

  // Step 2: Answer the question using the fetched data
  const answerPrompt = `
You are a Rutgers Residence Life analyst. Answer the user's question directly using the data provided.

QUESTION: ${state.userQuery}

DATA:
${JSON.stringify(contextData, null, 2)}

ADDITIONAL CONTEXT:
${state.buildingAnalysis ?? ''}

Instructions:
- Answer the question directly in the first sentence
- Use specific numbers, building names, and campus names from the data
- If the data doesn't fully answer the question, say so clearly
- 2-4 paragraphs, factual and specific
- Do not add caveats about data limitations unless data is actually missing
- Do not say "the data is limited" if the query returned results
- Include dates in results if you feel the need to. Don't exclude them just to keep the query simpler, your response should be as insightful as possible. 
`

  const queryAnalysis = await callModel(answerPrompt)
  console.log('Query agent complete')
  return { queryAnalysis }
}

// 8. JOIN NODE — no-op sync point; waits for all parallel branches before report
async function joinNode(_state: typeof TrendState.State) {
  console.log('Join Node: all branches complete, proceeding to report...')
  return {}
}

// 9. REPORT AGENT — compiles everything into final executive summary
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

// Returns the optional drill-down node name, or falls through to joinNode
function routeLocation(state: typeof TrendState.State): string {
  return state.shouldDrillLocation ? 'locationAnalyzer' : 'joinNode'
}

function routePerson(state: typeof TrendState.State): string {
  return state.shouldDrillPerson ? 'personAnalyzer' : 'joinNode'
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
  .addNode('joinNode',         joinNode)
  .addNode('reportCompiler',   reportAgent)

  // intake fans out to all four parallel agents
  .addEdge('__start__',        'intake')
  .addEdge('intake',           'buildingAnalyzer')
  .addEdge('intake',           'campusAnalyzer')
  .addEdge('intake',           'alertScanner')
  .addEdge('intake',           'queryAnalyzer')

  // campus and query always go straight to join
  .addEdge('campusAnalyzer',   'joinNode')
  .addEdge('queryAnalyzer',    'joinNode')

  // building conditionally drills location, then both paths converge at join
  .addConditionalEdges('buildingAnalyzer', routeLocation, {
    locationAnalyzer: 'locationAnalyzer',
    joinNode:         'joinNode',
  })
  .addEdge('locationAnalyzer', 'joinNode')

  // alert conditionally drills person, then both paths converge at join
  .addConditionalEdges('alertScanner', routePerson, {
    personAnalyzer: 'personAnalyzer',
    joinNode:       'joinNode',
  })
  .addEdge('personAnalyzer',   'joinNode')

  // join waits for all upstream paths, then fires the report exactly once
  .addEdge('joinNode',         'reportCompiler')
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