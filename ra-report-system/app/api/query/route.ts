import { NextRequest, NextResponse } from 'next/server'

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { userQuery, campus, startDate, endDate } = body

    const { runTrendAnalysis } = await import('@/lib/agents')
    const result = await runTrendAnalysis({
      campus,
      startDate,
      endDate,
      userQuery: userQuery?.trim() || undefined,
    })

    return NextResponse.json({
      success:          true,
      mode:             'agent',
      finalReport:      result.finalReport,
      alerts:           result.alerts,
      buildingAnalysis: result.buildingAnalysis,
      campusAnalysis:   result.campusAnalysis,
      locationAnalysis: result.locationAnalysis ?? null,
      personAnalysis:   result.personAnalysis   ?? null,
      queryAnalysis:    result.queryAnalysis     ?? null,
    })

  } catch (error) {
    console.error('POST /api/query error:', error)
    return NextResponse.json({ success: false, error: 'Query failed' }, { status: 500 })
  }
}