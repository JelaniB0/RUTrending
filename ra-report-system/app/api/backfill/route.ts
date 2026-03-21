import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { embedText } from '@/lib/embed'

export async function GET() {
  const reports = await prisma.report.findMany({
    where: { narrative: { not: '' } },
    select: { id: true, report_id: true, narrative: true }
  })

  console.log(`Backfilling ${reports.length} reports...`)

  let success = 0
  let failed  = 0

  for (const report of reports) {
    try {
      const embedding = await embedText(report.narrative)
      const vector = `[${embedding.join(',')}]`
      await prisma.$executeRawUnsafe(
        `UPDATE reports SET narrative_embedding = $1::vector WHERE id = $2`,
        vector,
        report.id
      )
      success++
      console.log(`Embedded ${report.report_id}`)
    } catch (e) {
      console.error(`Failed ${report.report_id}:`, e)
      failed++
    }
  }

  return NextResponse.json({ success: true, embedded: success, failed })
}