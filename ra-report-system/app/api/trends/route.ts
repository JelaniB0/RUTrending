import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runTrendAnalysis } from '@/lib/agents'
 
// GET /api/trends
// Query params: type (building|campus|nature|repeat), campus, startDate, endDate
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const type       = searchParams.get('type') ?? 'campus'
    const campus     = searchParams.get('campus')
    const startDate  = searchParams.get('startDate')
    const endDate    = searchParams.get('endDate')
 
    if (type === 'campus') {
      const results = await prisma.$queryRawUnsafe(`
        SELECT
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
        GROUP BY b.campus
        ORDER BY total_reports DESC
      `)
      return NextResponse.json({ success: true, type, data: results })
    }
 
    if (type === 'building') {
      const campusFilter = campus ? `WHERE b.campus = '${campus}'` : ''
      const results = await prisma.$queryRawUnsafe(`
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
          COUNT(CASE WHEN r.rupd_called = true THEN 1 END)::int AS rupd_called
        FROM reports r
        JOIN buildings b ON r.building_id = b.id
        ${campusFilter}
        GROUP BY b.id, b.name, b.campus
        ORDER BY total_reports DESC
      `)
      return NextResponse.json({ success: true, type, data: results })
    }
 
    if (type === 'nature') {
      const results = await prisma.$queryRaw`
        SELECT
          DATE_TRUNC('month', r.date) AS month,
          r.nature,
          COUNT(r.id)::int AS total
        FROM reports r
        GROUP BY DATE_TRUNC('month', r.date), r.nature
        ORDER BY month ASC, total DESC
      `
      return NextResponse.json({ success: true, type, data: results })
    }
 
    if (type === 'repeat') {
      const results = await prisma.$queryRaw`
        SELECT
          b.name AS building_name,
          b.campus,
          r.specific_location,
          COUNT(r.id)::int AS incident_count,
          array_agg(r.nature ORDER BY r.date) AS incident_types,
          MIN(r.date) AS first_incident,
          MAX(r.date) AS last_incident
        FROM reports r
        JOIN buildings b ON r.building_id = b.id
        GROUP BY b.name, b.campus, r.specific_location
        HAVING COUNT(r.id) > 1
        ORDER BY incident_count DESC
        LIMIT 20
      `
      return NextResponse.json({ success: true, type, data: results })
    }
 
    return NextResponse.json(
      { success: false, error: 'Invalid type. Use: campus, building, nature, repeat' },
      { status: 400 }
    )
 
  } catch (error) {
    console.error('GET /api/trends error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch trends' }, { status: 500 })
  }
}
 
// POST /api/trends
// Triggers the full LangGraph multi-agent trend analysis system
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { campus, startDate, endDate, userQuery } = body
 
    const result = await runTrendAnalysis({
      campus,
      startDate,
      endDate,
      userQuery,
    })
 
    return NextResponse.json({
      success:          true,
      finalReport:      result.finalReport,
      alerts:           result.alerts,
      buildingAnalysis: result.buildingAnalysis,
      campusAnalysis:   result.campusAnalysis,
      locationAnalysis: result.locationAnalysis ?? null,
      personAnalysis:   result.personAnalysis   ?? null,
    })
 
  } catch (error) {
    console.error('POST /api/trends error:', error)
    return NextResponse.json({ success: false, error: 'Failed to run trend analysis' }, { status: 500 })
  }
}