// app/api/trends/building-heatmap/route.ts
// OR add this as a new `type` case inside your existing /api/trends/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export interface BuildingHeatmapEntry {
  building_name:    string
  campus:           string
  lat:              number
  lng:              number
  total:            number
  title_ix:         number
  mental_health:    number
  policy_violation: number
  roommate_conflict:number
  general_concern:  number
  facilities:       number
  rupd_called:      number
  ems_present:      number
  last_incident:    string | null
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const campus    = searchParams.get('campus')    // optional filter
    const startDate = searchParams.get('startDate') // optional ISO date
    const endDate   = searchParams.get('endDate')   // optional ISO date

    // Build date filter
    const dateFilter: any = {}
    if (startDate) dateFilter.gte = new Date(startDate)
    if (endDate)   dateFilter.lte = new Date(endDate)

    const reports = await prisma.report.findMany({
      where: {
        ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
        ...(campus ? { building: { campus: campus as any } } : {}),
      },
      select: {
        nature:       true,
        rupd_called:  true,
        ems_present:  true,
        date:         true,
        building: {
          select: { name: true, campus: true },
        },
      },
    })

    // Group by building
    const grouped: Record<string, {
      campus:           string
      total:            number
      title_ix:         number
      mental_health:    number
      policy_violation: number
      roommate_conflict:number
      general_concern:  number
      facilities:       number
      rupd_called:      number
      ems_present:      number
      last_incident:    Date | null
    }> = {}

    for (const r of reports) {
      const key = r.building.name
      if (!grouped[key]) {
        grouped[key] = {
          campus:           r.building.campus,
          total:            0,
          title_ix:         0,
          mental_health:    0,
          policy_violation: 0,
          roommate_conflict:0,
          general_concern:  0,
          facilities:       0,
          rupd_called:      0,
          ems_present:      0,
          last_incident:    null,
        }
      }

      const g = grouped[key]
      g.total++
      if (r.rupd_called) g.rupd_called++
      if (r.ems_present) g.ems_present++
      if (!g.last_incident || r.date > g.last_incident) g.last_incident = r.date

      switch (r.nature) {
        case 'TITLE_IX':          g.title_ix++;          break
        case 'MENTAL_HEALTH':     g.mental_health++;     break
        case 'POLICY_VIOLATION':  g.policy_violation++;  break
        case 'ROOMMATE_CONFLICT': g.roommate_conflict++; break
        case 'GENERAL_CONCERN':   g.general_concern++;   break
        case 'FACILITIES':        g.facilities++;        break
      }
    }

    // Import building coords and merge
    const { RUTGERS_BUILDINGS } = await import('@/lib/rutgers-buildings')

    const result: BuildingHeatmapEntry[] = RUTGERS_BUILDINGS.map(b => {
      const g = grouped[b.name]
      return {
        building_name:     b.name,
        campus:            b.campus,
        lat:               b.lat,
        lng:               b.lng,
        total:             g?.total            ?? 0,
        title_ix:          g?.title_ix         ?? 0,
        mental_health:     g?.mental_health    ?? 0,
        policy_violation:  g?.policy_violation ?? 0,
        roommate_conflict: g?.roommate_conflict ?? 0,
        general_concern:   g?.general_concern  ?? 0,
        facilities:        g?.facilities       ?? 0,
        rupd_called:       g?.rupd_called      ?? 0,
        ems_present:       g?.ems_present       ?? 0,
        last_incident:     g?.last_incident?.toISOString().slice(0, 10) ?? null,
      }
    })

    return NextResponse.json({ success: true, data: result })
  } catch (e: any) {
    console.error('[building-heatmap]', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}