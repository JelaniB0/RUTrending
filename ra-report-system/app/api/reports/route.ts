import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/reports
// Supports query params: campus, building, nature, startDate, endDate, rupd, limit
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    const campus    = searchParams.get('campus')
    const building  = searchParams.get('building')
    const nature    = searchParams.get('nature')
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')
    const rupd      = searchParams.get('rupd')
    const limit     = searchParams.get('limit')

    const reports = await prisma.report.findMany({
      where: {
        ...(nature && { nature: nature as any }),
        ...(rupd   && { rupd_called: rupd === 'true' }),
        ...(startDate && endDate && {
          date: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          }
        }),
        ...(building && {
          building: { name: { contains: building, mode: 'insensitive' } }
        }),
        ...(campus && {
          building: { campus: campus as any }
        }),
      },
      include: {
        building:      true,
        submitted_by:  true,
        report_staff: {
          include: { staff: true }
        },
        timeline_events: {
          orderBy: { sequence: 'asc' }
        },
      },
      orderBy: { date: 'desc' },
      take: limit ? parseInt(limit) : 50,
    })

    return NextResponse.json({ success: true, count: reports.length, data: reports })
  } catch (error) {
    console.error('GET /api/reports error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch reports' }, { status: 500 })
  }
}

// POST /api/reports
// Submits a new report and runs LangChain extraction automatically
export async function POST(req: NextRequest) {
    const NATURE_MAP: Record<string, string> = {
    'Title IX':                       'TITLE_IX',
    'Mental Health Concern':          'MENTAL_HEALTH',
    'Policy Violation':               'POLICY_VIOLATION',
    'Roommate Conflict':              'ROOMMATE_CONFLICT',
    'General Residence Life Concern': 'GENERAL_CONCERN',
    'Facilities Issues':              'FACILITIES',
  }

  try {
    const body = await req.json()

    const {
      building_name,
      specific_location,
      nature,
      policy_type,
      severity_level,
      concern_type,
      issue_type,
      date,
      time,
      narrative,
      submitted_by_name,
      rupd_called,
      cad_number,
      ems_present,
      transported,
      emergency_single,
    } = body

    // Look up building
    const building = await prisma.building.findFirst({
      where: { name: { contains: building_name, mode: 'insensitive' } }
    })
    if (!building) {
      return NextResponse.json(
        { success: false, error: `Building "${building_name}" not found` },
        { status: 400 }
      )
    }

    // Look up submitted_by staff
    // Look up or create submitted_by staff
    let staff = await prisma.staff.findFirst({
      where: { full_name: { contains: submitted_by_name, mode: 'insensitive' } }
    })

    if (!staff) {
      staff = await prisma.staff.create({
        data: {
          full_name: submitted_by_name,
          username:  body.ra_username ?? null,
          role:      'RA',
          phone:     body.ra_phone ?? null,
          email:     body.ra_email ?? null,
        }
      })
    }

    // Generate next report ID
    const lastReport = await prisma.report.findFirst({ orderBy: { id: 'desc' } })
    const lastNum    = lastReport ? parseInt(lastReport.report_id.replace('IR-', '')) : 0
    const newReportId = `IR-${String(lastNum + 1).padStart(5, '0')}`

    // Create the report
    const report = await prisma.report.create({
      data: {
        report_id:        newReportId,
        building_id:      building.id,
        specific_location,
        nature: (NATURE_MAP[nature] ?? nature) as any,
        policy_type:      policy_type    ?? null,
        severity_level:   severity_level ?? null,
        concern_type:     concern_type   ?? null,
        issue_type:       issue_type     ?? null,
        date:             new Date(date),
        time,
        narrative,
        submitted_by_id:  staff.id,
        rupd_called:      rupd_called    ?? false,
        cad_number:       cad_number     ?? null,
        ems_present:      ems_present    ?? false,
        transported:      transported    ?? false,
        emergency_single: emergency_single ?? null,
      },
      include: {
        building:     true,
        submitted_by: true,
      }
    })

    // ── Run LangChain extraction on the narrative ─────────────────────────
    try {
      const { extractFromNarrative } = await import('@/lib/extraction')
      const extracted = await extractFromNarrative(narrative)

      // Store involved students extracted from narrative
      for (const party of extracted.involved_parties) {
        // Skip staff members
        const isStaff =
          party.name.includes('RA ')   ||
          party.name.includes('ARLC')  ||
          party.name.includes('RLC')   ||
          party.role === 'INVOLVED_PARTY'
        if (isStaff) continue

        const nameParts = party.name.trim().split(' ')
        const firstName = nameParts[0]
        const lastName  = nameParts.slice(1).join(' ') || 'Unknown'
        const ruidKey   = party.ruid ?? `AUTO-${party.name.replace(/\s+/g, '-')}`

        const student = await prisma.student.upsert({
          where:  { ruid: ruidKey },
          update: {},
          create: {
            first_name: firstName,
            last_name:  lastName,
            ruid:       party.ruid ?? null,
            hall:       party.hall ?? null,
          },
        })

        await prisma.reportStudent.upsert({
          where: {
            report_id_student_id: {
              report_id:  report.id,
              student_id: student.id,
            }
          },
          update: {},
          create: {
            report_id:  report.id,
            student_id: student.id,
            role:       party.role as any,
          },
        })
      }

      // Store timeline events extracted from narrative
      for (let i = 0; i < extracted.timeline.length; i++) {
        const event = extracted.timeline[i]
        await prisma.timelineEvent.create({
          data: {
            report_id:   report.id,
            event_time:  event.time,
            event_date:  new Date(date),
            actor:       event.actor,
            description: event.action,
            sequence:    i + 1,
          }
        })
      }

      return NextResponse.json({
        success:   true,
        data:      report,
        extracted,
      }, { status: 201 })

    } catch (extractionError) {
      // Extraction failed but report was saved — don't fail the whole request
      console.error('Extraction error (non-fatal):', extractionError)
      return NextResponse.json({
        success:          true,
        data:             report,
        extraction_error: 'Report saved successfully but entity extraction failed',
      }, { status: 201 })
    }

  } catch (error) {
    console.error('POST /api/reports error:', error)
    return NextResponse.json({ success: false, error: 'Failed to create report' }, { status: 500 })
  }
}