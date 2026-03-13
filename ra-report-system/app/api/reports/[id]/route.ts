import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/reports/[id]
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params

    const report = await prisma.report.findUnique({
      where: { report_id: id },
      include: {
        building:        true,
        submitted_by:    true,
        report_staff: {
          include: { staff: true }
        },
        involved_students: {
          include: { student: true }
        },
        timeline_events: {
          orderBy: { sequence: 'asc' }
        },
      },
    })

    if (!report) {
      return NextResponse.json({ success: false, error: 'Report not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: report })
  } catch (error) {
    console.error('GET /api/reports/[id] error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch report' }, { status: 500 })
  }
}