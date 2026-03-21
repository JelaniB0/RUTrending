import { NextRequest, NextResponse } from 'next/server'
import { fullTextSearch } from '@/lib/search'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const { query, campus, nature } = await req.json()

    if (!query?.trim()) {
      return NextResponse.json({ success: false, error: 'Query is required' }, { status: 400 })
    }

    // Detect author intent — "by X", "written by X", "submitted by X", "from X"
    const authorMatch = query.match(
      /\b(?:by|written by|submitted by|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i
    )
    const authorName = authorMatch ? authorMatch[1].trim() : null

    if (authorName) {
      // Pure SQL author lookup
      const reports = await prisma.report.findMany({
        where: {
          submitted_by: { full_name: { contains: authorName, mode: 'insensitive' } },
          ...(campus && {
            building: { campus: campus.toUpperCase().replace(/ /g, '_').replace(/\//g, '_') as any }
          }),
          ...(nature && { nature: nature as any }),
        },
        include: {
          building:        true,
          submitted_by:    true,
          report_staff:    { include: { staff: true } },
          timeline_events: { orderBy: { sequence: 'asc' } },
        },
        orderBy: { date: 'desc' },
        take: 50,
      })

      return NextResponse.json({
        success: true,
        results: reports.map(report => ({ report, rank: 1.0 })),
        count:   reports.length,
      })
    }

    // Full-text search for everything else
    const results = await fullTextSearch(query, campus, nature)

    return NextResponse.json({
      success: true,
      results,
      count: results.length,
    })

  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ success: false, error: 'Search failed' }, { status: 500 })
  }
}