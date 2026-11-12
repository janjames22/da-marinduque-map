// Made-up Farm-to-Market Roads for local mode and the tests, until the region's FMR data arrives
// (Phase 16, roadmap Q-5). They go only into data/local/local-seed.json, through the real migrations
// and triggers, so their flags and barangay links are the database's own. Nothing here is ever written
// to the live database: npm run db:seed doesn't call it.
//
// Each road runs from the middle of one barangay to the middle of a neighbour in the same municipality,
// with a bend, so it crosses a barangay line as real roads do. The barangays are picked by name order,
// so the roads come out the same every time.
import type { Queryable } from './seed-interventions';

export const SAMPLE_ROADS_SOURCE = 'Sample roads (made up for testing)';
const STATUS_DATE = '2026-11-01';

interface SampleRoad {
  municipality: string;
  // Which barangay of the municipality, in name order among those with a neighbour.
  pick: number;
  status: string;
  program: string;
  year: number;
  // The length the source would report, in km. Null leaves the form's field empty.
  reportedKm: number | null;
  // False makes a road that waits for its traced line.
  traced: boolean;
  // How far the bend sits off the straight line, as a share of the road's length.
  bend: number;
}

export const SAMPLE_ROADS: SampleRoad[] = [
  { municipality: 'Boac', pick: 0, status: 'Completed', program: 'rice', year: 2023, reportedKm: 0.9, traced: true, bend: 0.12 },
  { municipality: 'Boac', pick: 12, status: 'Operational', program: 'hvcdp', year: 2022, reportedKm: null, traced: true, bend: -0.1 },
  { municipality: 'Mogpog', pick: 1, status: 'On-going', program: 'corn', year: 2025, reportedKm: 2.3, traced: true, bend: 0.15 },
  { municipality: 'Santa Cruz', pick: 2, status: 'Proposed', program: 'rice', year: 2026, reportedKm: null, traced: true, bend: -0.12 },
  { municipality: 'Santa Cruz', pick: 5, status: 'Proposed', program: 'corn', year: 2026, reportedKm: 3.2, traced: false, bend: 0 },
  { municipality: 'Torrijos', pick: 1, status: 'Needs Repair', program: 'hvcdp', year: 2021, reportedKm: 1.7, traced: true, bend: 0.1 },
  { municipality: 'Gasan', pick: 2, status: 'Operational', program: 'rice', year: 2024, reportedKm: null, traced: true, bend: 0.08 },
  { municipality: 'Buenavista', pick: 0, status: 'Completed', program: 'corn', year: 2024, reportedKm: null, traced: false, bend: 0 },
];

type LngLat = [number, number];

// Start, two points either side of the bend, and the end.
function bentLine(start: LngLat, end: LngLat, bend: number): LngLat[] {
  const [dx, dy] = [end[0] - start[0], end[1] - start[1]];
  const at = (share: number, offset: number): LngLat => [start[0] + dx * share - dy * offset, start[1] + dy * share + dx * offset];
  const round = ([lng, lat]: LngLat): LngLat => [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
  return [start, at(0.35, bend), at(0.65, bend * 0.6), end].map(round);
}

export async function addSampleRoads(db: Queryable): Promise<number> {
  await db.query(`update public.intervention_types set is_active = true where code = 'fmr'`);

  for (const road of SAMPLE_ROADS) {
    // A barangay of the municipality and its first neighbour there, both by name, with the middle of each.
    const { rows } = await db.query<{ id: number; name: string; municipality_id: number; neighbour: string; start: string; finish: string }>(
      `select b.id, b.name, b.municipality_id, n.name as neighbour,
              ST_AsGeoJSON(ST_PointOnSurface(b.boundary)) as start, ST_AsGeoJSON(ST_PointOnSurface(n.boundary)) as finish
       from public.barangays b
       join public.municipalities m on m.id = b.municipality_id and m.name = $1
       join lateral (
         select other.name, other.boundary from public.barangays other
         where other.municipality_id = b.municipality_id and other.id <> b.id and ST_Touches(other.boundary, b.boundary)
         order by other.name limit 1
       ) n on true
       order by b.name
       offset $2 limit 1`,
      [road.municipality, road.pick],
    );
    const place = rows[0];
    if (!place) throw new Error(`No barangay ${road.pick} with a neighbour in ${road.municipality}`);

    const line = road.traced
      ? { type: 'LineString', coordinates: bentLine(JSON.parse(place.start).coordinates, JSON.parse(place.finish).coordinates, road.bend) }
      : null;
    const attributes = road.reportedKm === null ? {} : { length_km: road.reportedKm, width_m: 4 };

    const { rows: inserted } = await db.query<{ id: string }>(
      `insert into public.interventions (
         intervention_type_id, title, banner_program_id, year_funded, quantity,
         municipality_id, barangay_id, geom, attributes, data_source
       ) values (
         (select id from public.intervention_types where code = 'fmr'), $1,
         (select id from public.programs where code = $2), $3, 1,
         $4, $5, ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), $7::jsonb, $8
       ) returning id`,
      [`Sample FMR: ${place.name} to ${place.neighbour}`, road.program, road.year, place.municipality_id, place.id, line && JSON.stringify(line), JSON.stringify(attributes), SAMPLE_ROADS_SOURCE],
    );
    await db.query(
      `insert into public.status_history (intervention_id, status_id, status_date, date_basis)
       values ($1, (select id from public.statuses where name = $2), $3, 'changed')`,
      [inserted[0].id, road.status, STATUS_DATE],
    );
  }
  return SAMPLE_ROADS.length;
}
