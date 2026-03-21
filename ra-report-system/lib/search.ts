import { prisma } from './prisma'

export async function fullTextSearch(query: string, campus?: string, nature?: string) {
  const campusFilter = campus
    ? `AND b.campus = '${campus.toUpperCase().replace(/ /g, '_').replace(/\//g, '_')}'`
    : ''

  const natureFilter = nature ? `AND r.nature = '${nature}'` : ''

  const results = await prisma.$queryRawUnsafe(`
    SELECT
      r.id,
      r.report_id,
      r.date,
      r.time,
      r.nature,
      r.specific_location,
      r.narrative,
      r.rupd_called,
      r.ems_present,
      r.transported,
      r.cad_number,
      r.emergency_single,
      b.name AS building_name,
      b.campus AS building_campus,
      s.full_name AS submitted_by_name,
      s.username AS submitted_by_username,
      s.email AS submitted_by_email,
      s.phone AS submitted_by_phone,
      ts_rank(
        to_tsvector('english', r.narrative || ' ' || COALESCE(r.specific_location, '')),
        plainto_tsquery('english', $1)
      ) AS rank
    FROM reports r
    JOIN buildings b ON r.building_id = b.id
    LEFT JOIN staff s ON r.submitted_by_id = s.id
    WHERE
      to_tsvector('english', r.narrative || ' ' || COALESCE(r.specific_location, '') || ' ' || b.name || ' ' || COALESCE(s.full_name, ''))
      @@ plainto_tsquery('english', $1)
      ${campusFilter}
      ${natureFilter}
    ORDER BY rank DESC
    LIMIT 20
  `, query) as any[]

  return results.map(r => ({
    report: {
      id:                r.id,
      report_id:         r.report_id,
      date:              r.date,
      time:              r.time,
      nature:            r.nature,
      specific_location: r.specific_location,
      narrative:         r.narrative,
      rupd_called:       r.rupd_called,
      ems_present:       r.ems_present,
      transported:       r.transported,
      cad_number:        r.cad_number,
      emergency_single:  r.emergency_single,
      building: {
        name:   r.building_name,
        campus: r.building_campus,
      },
      submitted_by: {
        full_name: r.submitted_by_name,
        username:  r.submitted_by_username,
        email:     r.submitted_by_email,
        phone:     r.submitted_by_phone,
      },
      report_staff:    [],
      timeline_events: [],
    },
    rank: r.rank,
  }))
}