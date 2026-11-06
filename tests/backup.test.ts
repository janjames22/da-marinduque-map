// A backup only counts if it can be restored, so these restore one into a database and compare.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Papa from 'papaparse';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readableExports, takeSnapshot, toCsv, writeBackup, type ReadableExports, type Snapshot } from '../scripts/backup';
import { findLeaks } from '../scripts/check-bundle';
import { checkNoSecretInBrowserSettings } from '../scripts/lib/env';
import { restoreSnapshot } from '../scripts/restore';
import { loadSeedFiles, seedInterventions } from '../scripts/seed-interventions';
import { createTestDb } from './helpers/db';

const ENCODER = 'f0000000-0000-4000-8000-000000000001';
const GONE = 'f0000000-0000-4000-8000-000000000002';
const NEW_RECORD = 'f1000000-0000-4000-8000-000000000001';

let db: PGlite;
let snapshot: Snapshot;
let exports: ReadableExports;

async function asEncoder(sql: string, params: unknown[]) {
  await db.exec('begin');
  await db.exec('set local role authenticated');
  await db.query(`select set_config('request.jwt.sub', $1, true)`, [ENCODER]);
  const result = await db.query<Record<string, unknown>>(sql, params);
  await db.exec('commit');
  return result.rows;
}

// Everything a restore has to bring back, in a form that can be compared.
async function fingerprint(target: PGlite) {
  const tables = ['interventions', 'status_history', 'intervention_photos', 'intervention_barangays', 'import_batches', 'categories', 'programs'];
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    const { rows } = await target.query<{ row: Record<string, unknown> }>(`select to_jsonb(t) as row from public.${table} t`);
    result[table] = rows.map((row) => JSON.stringify(row.row)).sort();
  }
  const barangays = await target.query('select id, attributes, version from public.barangays order by id');
  result.barangays = barangays.rows;
  const view = await target.query<{ id: string; plotted_barangay_id: number | null }>('select id, plotted_barangay_id from public.interventions_v order by id');
  result.view = view.rows;
  return result;
}

beforeAll(async () => {
  db = await createTestDb();
  const { rows } = loadSeedFiles();
  await seedInterventions(db, rows, []);

  await db.query('insert into auth.users (id) values ($1), ($2)', [ENCODER, GONE]);
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Enzo Encoder', 'encoder'), ($2, 'Gone Person', 'encoder')`, [ENCODER, GONE]);

  const [{ type_id, category_id, program_id, municipality_id, barangay_id, status_id }] = (
    await db.query<Record<string, number>>(
      `select
        (select id from intervention_types where code = 'farm-machinery') as type_id,
        (select id from categories where code = 'seeder') as category_id,
        (select id from programs where code = 'rice') as program_id,
        (select municipality_id from barangays where name = 'Bantad') as municipality_id,
        (select id from barangays where name = 'Bantad') as barangay_id,
        (select id from statuses where name = 'Turned-over') as status_id`,
    )
  ).rows;

  const values = {
    id: NEW_RECORD,
    intervention_type_id: type_id,
    category_id,
    banner_program_id: program_id,
    year_funded: 2025,
    beneficiary: '=SUM(A1) Ñino FCA',
    municipality_id,
    barangay_id,
    point: { lat: 13.4567891, lng: 121.8765432 },
    attributes: { engine_no: 'E-77' },
  };
  await asEncoder('select create_intervention($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb)', [
    values,
    { status_id, status_date: '2025-03-01', remarks: 'Delivered' },
    { storage_path: `${NEW_RECORD}/c0000000-0000-4000-8000-000000000001.jpg`, exif_location: { lat: 13.45, lng: 121.87 } },
    { kind: 'create', reason: 'Field visit' },
  ]);
  await asEncoder('select soft_delete_intervention(id, version) from interventions where source_id = (select min(source_id) from interventions)', []);
  await asEncoder('select update_barangay_baseline($1, 1, $2::jsonb)', [barangay_id, { farmer_count: 42, main_crops: 'Rice' }]);
  await db.query(`insert into saved_views (name, owner_id) values ('Encoder view', $1), ('Gone view', $2)`, [ENCODER, GONE]);
  await db.query(`update programs set color = '#123456' where code = 'rice'`);
  await db.query(`update interventions set updated_by = $1 where id = $2`, [GONE, NEW_RECORD]);

  snapshot = JSON.parse(JSON.stringify(await takeSnapshot(db))) as Snapshot;
  exports = JSON.parse(JSON.stringify(await readableExports(db))) as ReadableExports;
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe('backup files', () => {
  let directory: string;
  const date = '2026-11-05';

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'da-backup-'));
    writeBackup(directory, date, snapshot, exports);
  });

  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  const csv = (name: string) => Papa.parse<Record<string, string>>(readFileSync(join(directory, name), 'utf8').replace(/^﻿/, ''), { header: true }).data;
  const geojson = (name: string) => JSON.parse(readFileSync(join(directory, name), 'utf8')) as GeoJSON.FeatureCollection;

  it('has CSV and GeoJSON for each export, with the date in every name', () => {
    expect(readdirSync(directory).sort()).toEqual([
      `barangay-attributes-${date}.csv`,
      `barangay-attributes-${date}.geojson`,
      `interventions-${date}.csv`,
      `interventions-${date}.geojson`,
      `snapshot-${date}.json`,
      `status-history-${date}.csv`,
      `status-history-${date}.geojson`,
    ]);
  });

  it('has every record, including deleted ones, with readable names', () => {
    const rows = csv(`interventions-${date}.csv`);
    expect(rows).toHaveLength(200);
    expect(rows.filter((row) => row.deleted_at !== '')).toHaveLength(1);

    const added = rows.find((row) => row.id === NEW_RECORD)!;
    expect(added).toMatchObject({
      type: 'Farm Machinery',
      category: 'Seeder',
      program: 'Rice Program',
      municipality: 'Boac',
      barangay: 'Bantad',
      status: 'Turned-over',
      created_by: 'Enzo Encoder',
      attr_engine_no: 'E-77',
    });
    expect(Number(added.latitude)).toBeCloseTo(13.4567891, 6);
    expect(Number(added.longitude)).toBeCloseTo(121.8765432, 6);
  });

  it('agrees with the counts by municipality', () => {
    const rows = csv(`interventions-${date}.csv`).filter((row) => row.data_source === 'RAED 2026-10-21');
    const by = (name: string) => rows.filter((row) => row.municipality === name).length;
    expect(rows).toHaveLength(199);
    expect(['Santa Cruz', 'Boac', 'Torrijos', 'Gasan', 'Mogpog', 'Buenavista'].map(by)).toEqual([48, 38, 36, 33, 25, 19]);
  });

  it('gives QGIS valid features, with coordinates in lon,lat order', () => {
    const { type, features } = geojson(`interventions-${date}.geojson`);
    expect(type).toBe('FeatureCollection');
    expect(features).toHaveLength(200);

    const added = features.find((feature) => feature.properties?.id === NEW_RECORD)!;
    expect((added.geometry as GeoJSON.Point).coordinates).toEqual([121.8765432, 13.4567891]);
    expect(added.properties).not.toHaveProperty('geometry');

    // Records with no coordinates are still present.
    expect(features.filter((feature) => feature.geometry === null).length).toBeGreaterThan(0);
  });

  it('has the status history, including the as-of RAED entries', () => {
    const rows = csv(`status-history-${date}.csv`);
    expect(rows).toHaveLength(200);
    const added = rows.find((row) => row.intervention_id === NEW_RECORD)!;
    expect(added).toMatchObject({ status: 'Turned-over', status_date: '2025-03-01', date_basis: 'changed', remarks: 'Delivered', created_by: 'Enzo Encoder' });
    expect(added.photo_path).toMatch(new RegExp(`^${NEW_RECORD}/`));
    expect(rows.filter((row) => row.date_basis === 'as_of')).toHaveLength(199);
    expect(geojson(`status-history-${date}.geojson`).features).toHaveLength(200);
  });

  it('has all 218 barangays, with their baseline values and shapes', () => {
    const rows = csv(`barangay-attributes-${date}.csv`);
    expect(rows).toHaveLength(218);
    expect(rows.find((row) => row.barangay === 'Bantad')).toMatchObject({ municipality: 'Boac', attr_farmer_count: '42', attr_main_crops: 'Rice' });

    const { features } = geojson(`barangay-attributes-${date}.geojson`);
    expect(features).toHaveLength(218);
    expect(features[0].geometry.type).toMatch(/Polygon/);
    expect(features[0].properties).toHaveProperty('psgc_code');
  });

  it('marks CSV files as UTF-8 for Excel, and stops a value running as a formula', () => {
    const text = readFileSync(join(directory, `interventions-${date}.csv`), 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("'=SUM(A1) Ñino FCA");
    expect(text).not.toMatch(/,=SUM/);
    expect(toCsv([{ number: -5, text: '-5' }])).toContain("-5,\"'-5\"");
  });
});

describe('restoring into a new, empty database', () => {
  let fresh: PGlite;

  beforeAll(async () => {
    fresh = await createTestDb();
    await fresh.query('insert into auth.users (id) values ($1)', [ENCODER]);
  }, 120_000);

  afterAll(async () => {
    await fresh.close();
  });

  it('brings everything back as it was, without touching versions', async () => {
    const result = await restoreSnapshot(fresh, snapshot);
    expect(result.restored.interventions).toBe(200);

    const original = await fingerprint(db);
    const restored = await fingerprint(fresh);
    const withoutPerson = (rows: unknown) =>
      (rows as string[]).map((text) => {
        const { updated_by: _updated, ...rest } = JSON.parse(text) as Record<string, unknown>;
        return JSON.stringify(rest);
      });
    expect(withoutPerson(restored.interventions)).toEqual(withoutPerson(original.interventions));
    expect(restored.status_history).toEqual(original.status_history);
    expect(restored.intervention_photos).toEqual(original.intervention_photos);
    expect(restored.intervention_barangays).toEqual(original.intervention_barangays);
    expect(restored.categories).toEqual(original.categories);
    expect(restored.programs).toEqual(original.programs);
    expect(restored.barangays).toEqual(original.barangays);
    expect(restored.view).toEqual(original.view);
  });

  it('clears references to accounts that no longer exist, and says so', async () => {
    const check = await fresh.query<{ updated_by: string | null }>('select updated_by from interventions where id = $1', [NEW_RECORD]);
    expect(check.rows[0].updated_by).toBeNull();

    const views = await fresh.query<{ name: string }>('select name from saved_views');
    expect(views.rows).toEqual([{ name: 'Encoder view' }]);
    const profiles = await fresh.query<{ id: string }>('select id from profiles');
    expect(profiles.rows).toEqual([{ id: ENCODER }]);
  });

  it('keeps the audit log, adds a line saying it was restored, and turns auditing back on', async () => {
    const log = await fresh.query<{ table_name: string; action: string; context: { records: number } }>(
      `select table_name, action, context from audit_log order by id desc limit 1`,
    );
    expect(log.rows[0]).toMatchObject({ table_name: 'backup', action: 'restore', context: { records: 200 } });

    const copied = await fresh.query<{ reason: string }>(`select context ->> 'reason' as reason from audit_log where record_id = $1`, [NEW_RECORD]);
    expect(copied.rows).toContainEqual({ reason: 'Field visit' });

    const before = await fresh.query<{ n: number }>('select count(*)::int as n from audit_log');
    await fresh.query(`update interventions set remarks = 'after restore' where id = $1`, [NEW_RECORD]);
    const after = await fresh.query<{ n: number }>('select count(*)::int as n from audit_log');
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);
  });

  it('turns the rule triggers back on, and new rows get new ids', async () => {
    await expect(fresh.query(`update interventions set year_funded = 2999 where id = $1`, [NEW_RECORD])).rejects.toThrow(/future/);

    const version = await fresh.query<{ version: number }>(`update interventions set remarks = 'again' where id = $1 returning version`, [NEW_RECORD]);
    expect(version.rows[0].version).toBeGreaterThan(1);

    const program = await fresh.query<{ id: number }>(`insert into programs (code, name, color) values ('new', 'New', '#000000') returning id`);
    expect(program.rows[0].id).toBeGreaterThan(6);
  });

  it('refuses to run over existing records', async () => {
    const before = await fingerprint(fresh);
    await expect(restoreSnapshot(fresh, snapshot)).rejects.toThrow(/already has/);
    expect(await fingerprint(fresh)).toEqual(before);
  });

  it('replaces records when asked, including ones added since the backup', async () => {
    await fresh.query(`update interventions set remarks = 'edited after the backup' where id = $1`, [NEW_RECORD]);
    await restoreSnapshot(fresh, snapshot, { replace: true });

    const row = await fresh.query<{ remarks: string | null; n: number }>(
      `select remarks, (select count(*)::int from interventions) as n from interventions where id = $1`,
      [NEW_RECORD],
    );
    expect(row.rows[0]).toEqual({ remarks: null, n: 200 });
  });

  it('changes nothing if the barangay list doesn\'t match', async () => {
    const before = await fingerprint(fresh);
    const wrong = { ...snapshot, barangays: [{ ...snapshot.barangays[0], psgc_code: 'WRONG' }, ...snapshot.barangays.slice(1)] };
    await expect(restoreSnapshot(fresh, wrong, { replace: true })).rejects.toThrow(/doesn't match/);
    expect(await fingerprint(fresh)).toEqual(before);
  });

  it('rolls everything back if a restore fails partway', async () => {
    const before = await fingerprint(fresh);
    const broken = JSON.parse(JSON.stringify(snapshot)) as Snapshot;
    broken.tables.status_history[0].intervention_id = '99999999-9999-4999-8999-999999999999';
    await expect(restoreSnapshot(fresh, broken, { replace: true })).rejects.toThrow();
    expect(await fingerprint(fresh)).toEqual(before);

    // The triggers were switched off inside the transaction, so they come back with it.
    await expect(fresh.query(`update interventions set year_funded = 2999 where id = $1`, [NEW_RECORD])).rejects.toThrow(/future/);
  });
});

describe('keeping secrets out of the website', () => {
  const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;

  it('finds a secret in a build, and names the file but not the value', () => {
    const problems = findLeaks(
      [{ name: 'dist/app.js', text: 'const a = "my-secret-value"' }, { name: 'dist/ok.js', text: 'nothing' }],
      [{ label: 'the database password', value: 'my-secret-value' }],
    );
    expect(problems).toEqual(['dist/app.js contains the database password']);
    expect(problems.join()).not.toContain('my-secret-value');
  });

  it('finds any secret key by its shape, but not the library\'s mention of the prefix', () => {
    const find = (text: string) => findLeaks([{ name: 'app.js', text }], []);
    expect(find('const k = "sb_secret_abcdefghijklmnop1234"')).toEqual(['app.js contains a secret key']);
    expect(find('if (key.startsWith("sb_secret_")) warn()')).toEqual([]);
    expect(find(`const k = "${jwt('service_role')}"`)).toEqual(['app.js contains a service role key']);
    expect(find(`const k = "${jwt('anon')}"`)).toEqual([]);
  });

  it('refuses a secret in a VITE_ setting, without printing it', () => {
    for (const value of ['sb_secret_abc123', jwt('service_role'), 'postgresql://postgres:pw@host/db']) {
      expect(() => checkNoSecretInBrowserSettings({ VITE_SOMETHING: value })).toThrow(/VITE_SOMETHING holds a secret/);
      try {
        checkNoSecretInBrowserSettings({ VITE_SOMETHING: value });
      } catch (error) {
        expect((error as Error).message).not.toContain(value);
      }
    }
  });

  it('accepts the public keys and secrets kept out of VITE_ settings', () => {
    expect(() =>
      checkNoSecretInBrowserSettings({
        VITE_SUPABASE_URL: 'https://abc.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
        VITE_SUPABASE_ANON_KEY: jwt('anon'),
        SUPABASE_SECRET_KEY: 'sb_secret_abc',
      }),
    ).not.toThrow();
  });
});
