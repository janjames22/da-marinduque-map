// Builds data/local/local-seed.json, the starting dataset for local mode (Phases 2 and 3), with the
// made-up sample roads of Phase 16.
// It comes from the real migrations and seed, so the data carries the flags the triggers compute.
// Barangay polygons aren't included; the map reads them from public/boundaries.
//
// This file holds beneficiary names, so it must not be placed in public/ or deployed publicly.
// The Vite dev server is the only thing that serves it.
//
// Usage: npx tsx scripts/build-local-seed.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addSampleRoads } from './sample-roads';
import { loadSeedFiles, seedInterventions, type Queryable } from './seed-interventions';

const OUTPUT_PATH = resolve(import.meta.dirname, '..', 'data', 'local', 'local-seed.json');

const LOOKUP_TABLES = [
  'icons',
  'programs',
  'category_groups',
  'categories',
  'statuses',
  'beneficiary_types',
  'location_bases',
  'intervention_types',
  'intervention_type_statuses',
  'barangay_field_schema',
  'report_signatories',
];

export async function buildLocalSeed(db: Queryable) {
  const all = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;
  // to_jsonb keeps dates exactly as stored. Reading them as JavaScript dates would add a time zone.
  const records = async (sql: string) => (await all(sql)).map((row) => row.record);

  const lookups: Record<string, unknown[]> = {};
  for (const table of LOOKUP_TABLES) lookups[table] = await all(`select * from public.${table}`);

  return {
    lookups,
    municipalities: await all('select id, name, psgc_code from public.municipalities order by name'),
    barangays: await all('select id, municipality_id, name, psgc_code, attributes, version from public.barangays order by name'),
    // geojson replaces the raw geometry value, which the browser can't read.
    interventions: await records(`select to_jsonb(v) - 'geom' as record from public.interventions_v v order by v.source_id`),
    intervention_barangays: await all('select * from public.intervention_barangays'),
    status_history: await records('select to_jsonb(h) as record from public.status_history h order by h.status_date, h.created_at'),
    import_batches: await records('select to_jsonb(b) as record from public.import_batches b'),
    audit_log: await records('select to_jsonb(a) as record from public.audit_log a order by a.id'),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { createTestDb } = await import('../tests/helpers/db');
  const db = await createTestDb();
  const { rows, corrections } = loadSeedFiles();
  await seedInterventions(db, rows, corrections);
  // Local mode only: made-up roads until the FMR data arrives. See scripts/sample-roads.ts.
  const roads = await addSampleRoads(db);
  const seed = await buildLocalSeed(db);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(seed));
  console.log(`Wrote ${seed.interventions.length} interventions, ${roads} of them sample roads, to ${OUTPUT_PATH}`);
  await db.close();
}
