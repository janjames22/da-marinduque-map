// Exports the data to backups/, with the date in each file name.
//   interventions, status-history and barangay-attributes as CSV and GeoJSON, for people and QGIS
//   snapshot, as JSON, which is what npm run restore reads
//
// Usage: npm run backup
//        npm run backup -- --photos    also downloads the photo files
//
// These files hold beneficiary names. backups/ is ignored by git, and they shouldn't be shared.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { manilaToday } from '../src/modules/intervention-map/lib/dates';
import { adminClient, connectDb, loadEnv, run } from './lib/env';
import type { Queryable } from './seed-interventions';

const DEFAULT_DIR = resolve(import.meta.dirname, '..', 'backups');
const PHOTO_BUCKET = 'intervention-photos';

// In the order a restore has to load them.
export const LOOKUP_TABLES = [
  'icons',
  'programs',
  'category_groups',
  'statuses',
  'beneficiary_types',
  'location_bases',
  'intervention_types',
  'intervention_type_statuses',
  'categories',
  'barangay_field_schema',
];
export const RECORD_TABLES = [
  'profiles',
  'import_batches',
  'interventions',
  'intervention_barangays',
  'intervention_photos',
  'status_history',
  'saved_views',
  'audit_log',
];

export interface Snapshot {
  created_at: string;
  barangays: { id: number; name: string; psgc_code: string; attributes: Record<string, unknown>; version: number }[];
  tables: Record<string, Record<string, unknown>[]>;
}

export async function takeSnapshot(db: Queryable): Promise<Snapshot> {
  const tables: Snapshot['tables'] = {};
  for (const table of [...LOOKUP_TABLES, ...RECORD_TABLES]) {
    // to_jsonb turns geometry into GeoJSON, which a restore can read back.
    const { rows } = await db.query<{ row: Record<string, unknown> }>(`select to_jsonb(t) as row from public.${table} t`);
    tables[table] = rows.map((row) => row.row);
  }
  const { rows: barangays } = await db.query<Snapshot['barangays'][number]>(
    'select id, name, psgc_code, attributes, version from public.barangays order by id',
  );
  return { created_at: new Date().toISOString(), barangays, tables };
}

type Row = Record<string, unknown>;

// Custom fields become ordinary columns, so each one can be sorted and filtered in a spreadsheet.
function flattenAttributes<T extends { attributes: Row }>(rows: T[]): Row[] {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row.attributes)))].sort();
  return rows.map(({ attributes, ...rest }) => {
    const flat: Row = { ...rest };
    for (const key of keys) flat[`attr_${key}`] = attributes[key] ?? null;
    return flat;
  });
}

export function toCsv(rows: Row[]): string {
  // The mark tells Excel it's UTF-8, for names with n-tilde. A value starting with = could run as
  // a formula when someone opens the file, so those are escaped.
  return `﻿${Papa.unparse(rows, { escapeFormulae: true })}`;
}

export function toGeoJson(rows: Row[], geometryKey = 'geometry'): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: rows.map(({ [geometryKey]: geometry, ...properties }) => ({ type: 'Feature', geometry: geometry ?? null, properties })),
  });
}

export interface ReadableExports {
  interventions: Row[];
  statusHistory: Row[];
  barangays: Row[];
}

export async function readableExports(db: Queryable): Promise<ReadableExports> {
  const { rows: interventions } = await db.query<Row & { attributes: Row }>(`
    select
      v.id, v.data_source, v.source_id,
      t.name as type, c.name as category, v.title, p.name as program, v.year_funded, v.quantity,
      v.unit_cost, v.fund_source, v.beneficiary, bt.name as beneficiary_type,
      m.name as municipality, b.name as barangay, v.barangay_raw,
      v.plotted_barangay, v.plotted_municipality, lb.name as location_basis,
      ST_Y(ST_PointOnSurface(v.geom)) as latitude, ST_X(ST_PointOnSurface(v.geom)) as longitude,
      s.name as status, array_to_string(v.qa_flags, ';') as qa_flags, v.remarks,
      v.attributes, v.version,
      created.full_name as created_by, updated.full_name as updated_by,
      to_char(v.created_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as created_at,
      to_char(v.updated_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as updated_at,
      to_char(v.deleted_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as deleted_at,
      v.geojson as geometry
    from public.interventions_v v
    join public.intervention_types t on t.id = v.intervention_type_id
    join public.municipalities m on m.id = v.municipality_id
    left join public.categories c on c.id = v.category_id
    left join public.programs p on p.id = v.banner_program_id
    left join public.beneficiary_types bt on bt.id = v.beneficiary_type_id
    left join public.barangays b on b.id = v.barangay_id
    left join public.location_bases lb on lb.id = v.location_basis_id
    left join public.statuses s on s.id = v.status_id
    left join public.profiles created on created.id = v.created_by
    left join public.profiles updated on updated.id = v.updated_by
    order by m.name, b.name nulls last, v.source_id nulls last, v.id
  `);

  const { rows: statusHistory } = await db.query<Row>(`
    select
      h.id, h.intervention_id, i.source_id, i.beneficiary, s.name as status,
      to_char(h.status_date, 'YYYY-MM-DD') as status_date, h.date_basis, h.source_note, h.remarks,
      photo.storage_path as photo_path, person.full_name as created_by,
      to_char(h.created_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as created_at,
      ST_AsGeoJSON(i.geom)::jsonb as geometry
    from public.status_history h
    join public.interventions i on i.id = h.intervention_id
    join public.statuses s on s.id = h.status_id
    left join public.intervention_photos photo on photo.id = h.photo_id
    left join public.profiles person on person.id = h.created_by
    order by h.intervention_id, h.status_date, h.created_at
  `);

  const { rows: barangays } = await db.query<Row & { attributes: Row }>(`
    select b.psgc_code, m.name as municipality, b.name as barangay, b.attributes, b.version,
           ST_AsGeoJSON(b.boundary)::jsonb as geometry
    from public.barangays b
    join public.municipalities m on m.id = b.municipality_id
    order by m.name, b.name
  `);

  return { interventions: flattenAttributes(interventions), statusHistory, barangays: flattenAttributes(barangays) };
}

export function writeBackup(directory: string, date: string, snapshot: Snapshot, exports: ReadableExports): string[] {
  mkdirSync(directory, { recursive: true });
  const written: string[] = [];
  const save = (name: string, text: string) => {
    const path = join(directory, name);
    writeFileSync(path, text);
    written.push(path);
  };

  // In a spreadsheet, the whole shape would only fill a cell, and a line or polygon can be huge.
  const withoutGeometry = (rows: Row[]) => rows.map(({ geometry: _geometry, ...rest }) => rest);

  save(`interventions-${date}.csv`, toCsv(withoutGeometry(exports.interventions)));
  save(`interventions-${date}.geojson`, toGeoJson(exports.interventions));
  save(`status-history-${date}.csv`, toCsv(withoutGeometry(exports.statusHistory)));
  save(`status-history-${date}.geojson`, toGeoJson(exports.statusHistory));
  save(`barangay-attributes-${date}.csv`, toCsv(withoutGeometry(exports.barangays)));
  save(`barangay-attributes-${date}.geojson`, toGeoJson(exports.barangays));
  save(`snapshot-${date}.json`, JSON.stringify(snapshot));
  return written;
}

async function downloadPhotos(directory: string, date: string, snapshot: Snapshot) {
  const storage = adminClient().storage.from(PHOTO_BUCKET);
  const root = join(directory, `photos-${date}`);
  const paths = snapshot.tables.intervention_photos.map((photo) => photo.storage_path as string);
  let failed = 0;
  for (const path of paths) {
    const { data, error } = await storage.download(path);
    if (error) {
      failed += 1;
      console.error(`Could not download ${path}: ${error.message}`);
      continue;
    }
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(await data.arrayBuffer()));
  }
  console.log(`Photos: ${paths.length - failed} of ${paths.length} downloaded to ${root}`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(async () => {
    loadEnv();
    const db = await connectDb();
    try {
      const snapshot = await takeSnapshot(db);
      const date = manilaToday();
      const written = writeBackup(DEFAULT_DIR, date, snapshot, await readableExports(db));
      for (const path of written) console.log(path);

      const records = snapshot.tables.interventions;
      const deleted = records.filter((record) => record.deleted_at !== null).length;
      console.log(`\n${records.length} records (${deleted} deleted), ${snapshot.tables.status_history.length} status entries, ${snapshot.barangays.length} barangays.`);

      const photos = snapshot.tables.intervention_photos.length;
      if (process.argv.includes('--photos')) await downloadPhotos(DEFAULT_DIR, date, snapshot);
      else if (photos > 0) console.log(`${photos} photo files were not copied. Add --photos to include them.`);
    } finally {
      await db.end();
    }
  });
}
