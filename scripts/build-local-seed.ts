// Builds data/local/local-seed.json, the starting dataset for local mode (Phases 2 and 3).
// It comes from the real migrations and seed, so the data carries the flags the triggers compute.
// Barangay polygons aren't included; the map reads them from public/boundaries.
//
// This file holds beneficiary names, so it must not be placed in public/ or deployed publicly.
//
// Usage: npx tsx scripts/build-local-seed.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
];

export async function buildLocalSeed(db: Queryable) {
  const all = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;

  const lookups: Record<string, unknown[]> = {};
  for (const table of LOOKUP_TABLES) lookups[table] = await all(`select * from public.${table}`);

  return {
    lookups,
    municipalities: await all('select id, name, psgc_code from public.municipalities order by name'),
    barangays: await all('select id, municipality_id, name, psgc_code, attributes from public.barangays order by name'),
    // geojson replaces the raw geometry value, which the browser can't read.
    interventions: await all(
      `select to_jsonb(v) - 'geom' as record from public.interventions_v v order by v.source_id`,
    ).then((rows) => rows.map((row) => row.record)),
    intervention_barangays: await all('select * from public.intervention_barangays'),
    status_history: await all('select * from public.status_history order by status_date, created_at'),
    import_batches: await all('select * from public.import_batches'),
    audit_log: await all('select * from public.audit_log order by id'),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { createTestDb } = await import('../tests/helpers/db');
  const db = await createTestDb();
  const { rows, corrections } = loadSeedFiles();
  await seedInterventions(db, rows, corrections);
  const seed = await buildLocalSeed(db);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(seed));
  console.log(`Wrote ${seed.interventions.length} interventions to ${OUTPUT_PATH}`);
  await db.close();
}
