// Imports, undoing them, and dismissed flags, against the real migrations and the RAED data: what each
// role can do, through the Supabase store and straight at the database, and local mode doing the same.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLocalSeed } from '../scripts/build-local-seed';
import { loadSeedFiles, seedInterventions } from '../scripts/seed-interventions';
import * as engine from '../src/modules/intervention-map/data/local-engine';
import * as localImport from '../src/modules/intervention-map/data/local-import';
import { stateFromSeed, type LocalSeed, type LocalState } from '../src/modules/intervention-map/data/local-store';
import type { DataStore, ImportBatchInput, ImportRowInput } from '../src/modules/intervention-map/data/store';
import { createSupabaseStore } from '../src/modules/intervention-map/data/supabase-store';
import type { MapData } from '../src/modules/intervention-map/data/types';
import { buildPlaceIndex } from '../src/modules/intervention-map/lib/qa';
import { createTestDb } from './helpers/db';
import { createPgliteBackend } from './helpers/pglite-backend';

const ADMIN = 'f1000000-0000-4000-8000-000000000001';
const ENCODER = 'f1000000-0000-4000-8000-000000000002';
const OTHER_ENCODER = 'f1000000-0000-4000-8000-000000000003';
const VIEWER = 'f1000000-0000-4000-8000-000000000004';
const NO_PROFILE = 'f1000000-0000-4000-8000-000000000005';

let db: PGlite;
let admin: DataStore;
let encoder: DataStore;
let otherEncoder: DataStore;
let viewer: DataStore;
let data: MapData;
let seed: LocalSeed;

const storeFor = (id: string, role: 'admin' | 'encoder' | 'viewer') => createSupabaseStore(createPgliteBackend(db, id), { id, full_name: role, role });
const rows = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

// Always rolled back, so a case can't affect the next one.
async function attempt(account: string, sql: string, params: unknown[] = []) {
  await db.exec('begin');
  try {
    await db.exec(account ? 'set local role authenticated' : 'set local role anon');
    await db.query(`select set_config('request.jwt.sub', $1, true)`, [account]);
    const result = await db.query<Record<string, unknown>>(sql, params);
    return { ok: true, rows: result.rows, code: undefined as string | undefined, message: undefined as string | undefined };
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return { ok: false, rows: [], code: failure.code, message: failure.message };
  } finally {
    await db.exec('rollback');
  }
}

beforeAll(async () => {
  db = await createTestDb();
  const { rows: csv } = loadSeedFiles();
  await seedInterventions(db, csv, []);
  seed = JSON.parse(JSON.stringify(await buildLocalSeed(db))) as LocalSeed;
  for (const id of [ADMIN, ENCODER, OTHER_ENCODER, VIEWER, NO_PROFILE]) await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(
    `insert into profiles (id, full_name, role) values ($1, 'Ana Admin', 'admin'), ($2, 'Enzo Encoder', 'encoder'), ($3, 'Olga Encoder', 'encoder'), ($4, 'Vera Viewer', 'viewer')`,
    [ADMIN, ENCODER, OTHER_ENCODER, VIEWER],
  );
  admin = storeFor(ADMIN, 'admin');
  encoder = storeFor(ENCODER, 'encoder');
  otherEncoder = storeFor(OTHER_ENCODER, 'encoder');
  viewer = storeFor(VIEWER, 'viewer');
  data = await admin.load();
}, 180_000);

afterAll(async () => {
  await db.close();
});

let sequence = 0;
const ids = () => {
  const machinery = data.types.find((type) => type.code === 'farm-machinery')!;
  const bantad = data.barangays.find((barangay) => barangay.name === 'Bantad')!;
  return {
    machinery: machinery.id,
    category: data.categories.find((category) => category.intervention_type_id === machinery.id)!.id,
    rice: data.programs.find((program) => program.code === 'rice')!.id,
    bantad: bantad.id,
    boac: bantad.municipality_id,
    turnedOver: data.statuses.find((status) => status.name === 'Turned-over')!.id,
  };
};

// A clean row in Bantad, Boac, unless told otherwise. Each has its own beneficiary, so none is a duplicate.
function row(over: Partial<ImportRowInput['values']> = {}, extra: Partial<ImportRowInput> = {}): ImportRowInput {
  const { category, rice, bantad, boac, turnedOver } = ids();
  sequence += 1;
  return {
    row: sequence + 1,
    source_id: `ABEMIS-${sequence}`,
    source_raw: { Beneficiary: `Import test FCA ${sequence}`, Barangay: 'Bantad' },
    values: {
      category_id: category,
      title: null,
      banner_program_id: rice,
      year_funded: 2024,
      quantity: 1,
      unit_cost: null,
      fund_source: null,
      beneficiary: `Import test FCA ${sequence}`,
      beneficiary_type_id: null,
      municipality_id: boac,
      barangay_id: bantad,
      barangay_raw: 'Bantad',
      location_basis_id: null,
      point: { lat: 13.45, lng: 121.85 + sequence * 0.00001 },
      attributes: {},
      remarks: null,
      ...over,
    },
    status: { status_id: turnedOver, status_date: '2026-10-01', date_basis: 'as_of', remarks: null },
    ...extra,
  };
}

// Phase 16c: roads from a map file, in Bantad as the rows are. A line, and a line in two parts.
const ONE: [number, number][] = [[121.85, 13.45], [121.8503, 13.4502]];
const PARTS: [number, number][][] = [
  [[121.85, 13.45], [121.8502, 13.4501]],
  [[121.8503, 13.4502], [121.8505, 13.4503]],
];
const roadIds = () => ({
  road: data.types.find((type) => type.code === 'fmr')!.id,
  proposed: data.statuses.find((status) => status.name === 'Proposed')!.id,
});
// A road needs a title and no category, and its status comes from its own list.
function roadRow(title: string, over: Partial<ImportRowInput['values']> = {}): ImportRowInput {
  const { proposed } = roadIds();
  return row({ category_id: null, title, beneficiary: null, point: null, ...over }, { status: { status_id: proposed, status_date: '2026-10-01', date_basis: 'as_of', remarks: null } });
}

const batch = (over: Partial<ImportBatchInput> = {}): ImportBatchInput => ({
  file_name: 'abemis-2026.xlsx',
  data_source: 'ABEMIS export',
  intervention_type_id: ids().machinery,
  column_mapping: { columns: { Beneficiary: 'beneficiary' } },
  ...over,
});

const signals = async () => (await rows<{ n: number }>('select count(*)::int as n from realtime.messages'))[0].n;

describe('an import', () => {
  let batchId: string;

  it('brings a file in as one batch, keeping its source and the barangay as written', async () => {
    const before = await signals();
    const result = await encoder.importRecords(batch(), [row(), row({ barangay_id: null, barangay_raw: 'Bantadd' }), row({ point: null })]);
    batchId = result.id;
    expect(result.records).toBe(3);
    // One signal for open maps, not one for each row and its status.
    expect((await signals()) - before).toBe(1);

    const [saved] = await rows<Record<string, unknown>>('select file_name, data_source, imported_by, counts, undone_at from import_batches where id = $1', [batchId]);
    expect(saved).toEqual({ file_name: 'abemis-2026.xlsx', data_source: 'ABEMIS export', imported_by: ENCODER, counts: { records: 3, flagged: 2 }, undone_at: null });

    const records = await rows<{ source_id: string; data_source: string; created_by: string; qa_flags: string[]; barangay_raw: string | null; source_raw: Record<string, unknown>; status_id: number }>(
      'select source_id, data_source, created_by, qa_flags, barangay_raw, source_raw, status_id from interventions where import_batch_id = $1 order by source_id',
      [batchId],
    );
    expect(records.map((record) => [record.data_source, record.created_by, record.qa_flags])).toEqual([
      ['ABEMIS export', ENCODER, []],
      ['ABEMIS export', ENCODER, ['barangay_unmatched']],
      ['ABEMIS export', ENCODER, ['no_coords']],
    ]);
    expect(records[1].barangay_raw).toBe('Bantadd');
    expect(records[0].source_raw).toMatchObject({ Barangay: 'Bantad' });
    expect(records.every((record) => record.status_id === ids().turnedOver)).toBe(true);

    const statuses = await rows<{ date_basis: string; source_note: string; status_date: string }>(
      `select date_basis, source_note, to_char(status_date, 'YYYY-MM-DD') as status_date from status_history where intervention_id in (select id from interventions where import_batch_id = $1)`,
      [batchId],
    );
    expect(statuses).toEqual(Array(3).fill({ date_basis: 'as_of', source_note: 'ABEMIS export', status_date: '2026-10-01' }));
  });

  it('counts as flagged what the dashboard does: a shared point alone is often right', async () => {
    const twin = row();
    const { id } = await encoder.importRecords(batch({ file_name: 'twins.csv' }), [twin, row({ point: twin.values.point })]);
    const [saved] = await rows<{ counts: Record<string, number> }>('select counts from import_batches where id = $1', [id]);
    expect(saved.counts).toEqual({ records: 2, flagged: 0 });
    const flags = await rows<{ qa_flags: string[] }>('select qa_flags from interventions where import_batch_id = $1', [id]);
    expect(flags.map((record) => record.qa_flags)).toEqual([['duplicate_point'], ['duplicate_point']]);
  });

  it('goes in the audit log as an import, under the person who did it', async () => {
    const lines = await rows<{ table_name: string; actor_id: string; kind: string }>(
      `select table_name, actor_id, context ->> 'kind' as kind from audit_log where table_name in ('interventions', 'import_batches') and (record_id = $1 or new_row ->> 'import_batch_id' = $1)`,
      [batchId],
    );
    // Each record, and the batch: made, then given its counts once the flags were known.
    expect(lines).toHaveLength(5);
    expect(new Set(lines.map((line) => `${line.actor_id}|${line.kind}`))).toEqual(new Set([`${ENCODER}|import`]));
  });

  it('is all or nothing, and names the row a refusal came from', async () => {
    const first = row();
    const bad = row({ year_funded: 2999 });
    await expect(encoder.importRecords(batch({ data_source: 'Refused file' }), [first, bad])).rejects.toThrow(new RegExp(`Row ${bad.row}: .*future`));
    expect(await rows('select id from import_batches where data_source = $1', ['Refused file'])).toEqual([]);
    expect(await rows('select id from interventions where source_id = $1', [first.source_id])).toEqual([]);

    const wrongStatus = row({}, { status: { status_id: data.statuses.find((status) => status.name === 'Operational')!.id, status_date: '2026-10-01', date_basis: 'as_of', remarks: null } });
    await expect(encoder.importRecords(batch({ data_source: 'Refused file' }), [wrongStatus])).rejects.toThrow(new RegExp(`Row ${wrongStatus.row}: status is not in the status list`));
  });

  it('needs a data source, a file name, rows, an active type, and no more than 2,000 rows', async () => {
    await expect(encoder.importRecords(batch({ data_source: '  ' }), [row()])).rejects.toThrow(/data source/);
    await expect(encoder.importRecords(batch({ file_name: '' }), [row()])).rejects.toThrow(/name of its file/);
    await expect(encoder.importRecords(batch(), [])).rejects.toThrow(/at least one row/);
    const inactive = data.types.find((type) => !type.is_active)!.id;
    await expect(encoder.importRecords(batch({ intervention_type_id: inactive }), [row()])).rejects.toThrow(/active intervention type/);
    const many = Array.from({ length: 2001 }, () => ({ row: 1 }));
    expect((await attempt(ENCODER, 'select public.import_records($1::jsonb, $2::jsonb)', [JSON.stringify(batch()), JSON.stringify(many)])).message).toMatch(/2,000 rows/);
  });

  it('is refused for a Viewer, an account with no role, and a visitor', async () => {
    await expect(viewer.importRecords(batch(), [row()])).rejects.toThrow();
    const args = [JSON.stringify(batch()), JSON.stringify([row()])];
    expect((await attempt(VIEWER, 'select public.import_records($1::jsonb, $2::jsonb)', args)).code).toBe('42501');
    expect((await attempt(NO_PROFILE, 'select public.import_records($1::jsonb, $2::jsonb)', args)).code).toBe('42501');
    expect((await attempt('', 'select public.import_records($1::jsonb, $2::jsonb)', args)).ok).toBe(false);
  });

  it('can\'t be written around: the batch and the import columns are written only by the import', async () => {
    expect((await attempt(ENCODER, `insert into import_batches (file_name, data_source) values ('x', 'y')`)).code).toBe('42501');
    expect((await attempt(ENCODER, `update interventions set source_raw = '{}' where import_batch_id = $1`, [batchId])).code).toBe('42501');
    expect((await attempt(ENCODER, `update import_batches set undone_at = now() where id = $1`, [batchId])).code).toBe('42501');
    expect((await attempt(ENCODER, 'select public.send_map_signal($1)', ['interventions'])).code).toBe('42501');
  });
});

describe('undoing an import', () => {
  const recordsOf = async (id: string) => rows<{ id: string; version: number; deleted_at: string | null }>('select id, version, deleted_at from interventions where import_batch_id = $1 order by source_id', [id]);

  it('by the person who imported it, with a reason, takes its records off the map', async () => {
    const { id } = await encoder.importRecords(batch({ file_name: 'second.csv' }), [row(), row()]);
    await expect(encoder.undoImport(id, '   ')).rejects.toThrow(/reason/);
    const result = await encoder.undoImport(id, 'Wrong file');
    expect(result.records).toBe(2);
    expect((await recordsOf(id)).every((record) => record.deleted_at !== null)).toBe(true);
    const [saved] = await rows<{ undone_by: string; undo_reason: string; undone: boolean }>('select undone_by, undo_reason, undone_at is not null as undone from import_batches where id = $1', [id]);
    expect(saved).toEqual({ undone_by: ENCODER, undo_reason: 'Wrong file', undone: true });

    const deletions = await rows<{ action: string; reason: string }>(
      `select action, context ->> 'reason' as reason from audit_log where table_name = 'interventions' and new_row ->> 'import_batch_id' = $1 and action = 'soft_delete'`,
      [id],
    );
    expect(deletions).toEqual(Array(2).fill({ action: 'soft_delete', reason: 'Wrong file' }));

    // Not twice, and an Admin can still bring one back.
    await expect(encoder.undoImport(id, 'Again')).rejects.toThrow(/already been undone/);
    const [first] = await recordsOf(id);
    await admin.restoreIntervention(first.id, first.version);
    expect((await recordsOf(id))[0].deleted_at).toBeNull();
  });

  it('not by another Encoder, but by an Admin', async () => {
    const { id } = await encoder.importRecords(batch({ file_name: 'third.csv' }), [row()]);
    await expect(otherEncoder.undoImport(id, 'Not mine')).rejects.toThrow(/Only the person who imported it/);
    await expect(viewer.undoImport(id, 'Viewer')).rejects.toThrow();
    expect((await admin.undoImport(id, 'Cleaning up')).records).toBe(1);
  });

  it('not once anyone has worked on one of its records, as that work would be lost', async () => {
    const { id } = await encoder.importRecords(batch({ file_name: 'fourth.csv' }), [row(), row(), row()]);
    const [first, second] = await recordsOf(id);
    await encoder.updateIntervention(first.id, first.version, { remarks: 'Checked on site' }, { kind: 'edit' });
    await expect(encoder.undoImport(id, 'Wrong file')).rejects.toThrow(/1 of its records has been worked on/);
    await encoder.addStatus(second.id, { status_id: data.statuses.find((status) => status.name === 'Serviceable')!.id, status_date: '2026-10-15', remarks: null });
    await expect(admin.undoImport(id, 'Wrong file')).rejects.toThrow(/2 of its records have been worked on/);
    expect((await recordsOf(id)).every((record) => record.deleted_at === null)).toBe(true);
  });

  it('not for the batches the RAED seed loaded by script', async () => {
    const [raed] = await rows<{ id: string }>(`select id from import_batches where imported_by is null limit 1`);
    await expect(admin.undoImport(raed.id, 'Trying')).rejects.toThrow(/loaded by a script/);
  });
});

describe('dismissing a flag', () => {
  const dismissals = (id: string) => rows<{ flag: string; reason: string; dismissed_by: string }>('select flag, reason, dismissed_by from qa_dismissals where intervention_id = $1', [id]);
  const flagsOf = async (id: string) => (await rows<{ qa_flags: string[] }>('select qa_flags from interventions where id = $1', [id]))[0].qa_flags;
  const withFlag = (flag: string) => data.interventions.find((record) => record.qa_flags.includes(flag) && record.deleted_at === null)!;

  it('records that a person looked and accepted it, while the flag stays true', async () => {
    const record = withFlag('barangay_mismatch');
    await encoder.dismissFlag(record.id, 'barangay_mismatch', '  The point is the FCA office, next door  ');
    expect(await dismissals(record.id)).toEqual([{ flag: 'barangay_mismatch', reason: 'The point is the FCA office, next door', dismissed_by: ENCODER }]);
    expect(await flagsOf(record.id)).toContain('barangay_mismatch');

    // In the record's history and the Admin's log page, under the person.
    const history = await encoder.auditFor(record.id);
    expect(history.at(-1)).toMatchObject({ table_name: 'qa_dismissals', action: 'insert', actor_name: 'Enzo Encoder', context: { kind: 'dismiss', reason: 'The point is the FCA office, next door' } });
    const page = await admin.auditLog({ recordIds: [record.id], page: 0, pageSize: 50 });
    expect(page.entries.some((entry) => entry.table_name === 'qa_dismissals')).toBe(true);

    await encoder.undismissFlag(record.id, 'barangay_mismatch');
    expect(await dismissals(record.id)).toEqual([]);
    await expect(encoder.undismissFlag(record.id, 'barangay_mismatch')).rejects.toThrow(/isn't dismissed/);
  });

  it('needs a reason, a flag the record has, and an Encoder or Admin', async () => {
    const record = withFlag('barangay_mismatch');
    // The function's own words, not the table's check that backs it up.
    await expect(encoder.dismissFlag(record.id, 'barangay_mismatch', ' ')).rejects.toThrow('Give a reason. It goes in the audit log.');
    await expect(encoder.dismissFlag(record.id, 'no_coords', 'Not there')).rejects.toThrow('That flag is no longer on this record.');
    await expect(viewer.dismissFlag(record.id, 'barangay_mismatch', 'Viewer')).rejects.toThrow();
    expect((await attempt(VIEWER, 'select public.dismiss_flag($1, $2, $3)', [record.id, 'barangay_mismatch', 'x'])).code).toBe('42501');
    expect((await attempt(ENCODER, `insert into qa_dismissals (intervention_id, flag, reason) values ($1, 'barangay_mismatch', 'x')`, [record.id])).code).toBe('42501');
    // Members can read them, as they read the records.
    expect((await attempt(VIEWER, 'select * from qa_dismissals')).ok).toBe(true);
    expect((await attempt('', 'select * from qa_dismissals')).ok).toBe(false);
  });

  it('clears a name check instead, as that flag is a person\'s own', async () => {
    const record = withFlag('beneficiary_name_check');
    await expect(encoder.dismissFlag(record.id, 'beneficiary_name_check', '')).rejects.toThrow('Give a reason. It goes in the audit log.');
    expect(await flagsOf(record.id)).toContain('beneficiary_name_check');
    await encoder.dismissFlag(record.id, 'beneficiary_name_check', 'Spelling confirmed with the MAO');
    expect(await flagsOf(record.id)).not.toContain('beneficiary_name_check');
    expect(await dismissals(record.id)).toEqual([]);
  });

  it('lasts only as long as its flag: a change that clears it ends the dismissal', async () => {
    const { id } = await encoder.importRecords(batch({ file_name: 'fifth.csv' }), [row({ barangay_id: null, barangay_raw: 'Somewhere else' })]);
    const [record] = await rows<{ id: string; version: number }>('select id, version from interventions where import_batch_id = $1', [id]);
    await encoder.dismissFlag(record.id, 'barangay_unmatched', 'Sitio name, not a barangay');
    expect(await dismissals(record.id)).toHaveLength(1);
    await encoder.updateIntervention(record.id, record.version, { barangay_id: ids().bantad }, { kind: 'edit', reason: 'Matched by hand' });
    expect(await flagsOf(record.id)).toEqual([]);
    expect(await dismissals(record.id)).toEqual([]);
  });
});

describe('local mode does the same', () => {
  let state: LocalState;
  let context: engine.EngineContext;

  const boundary = (name: string) =>
    JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'boundaries', `${name}.geojson`), 'utf8')) as GeoJSON.FeatureCollection;

  beforeAll(() => {
    state = stateFromSeed(JSON.parse(JSON.stringify(seed)) as LocalSeed, 'test');
    let counter = 0;
    let tick = 0;
    context = {
      types: state.fixed.types,
      categories: state.fixed.categories,
      typeStatuses: state.fixed.typeStatuses,
      municipalities: state.fixed.municipalities,
      barangayFields: state.fixed.barangayFields,
      lists: state.fixed,
      places: buildPlaceIndex({ barangays: boundary('barangays'), municipalities: boundary('municipalities') }, { barangays: state.rows.barangays, municipalities: state.fixed.municipalities }),
      now: () => new Date(Date.UTC(2026, 10, 9, 0, 0, tick++)).toISOString(),
      newId: () => `local-${++counter}`,
    } as unknown as engine.EngineContext;
  });

  it('imports with the same flags, statuses and counts, and undoes by the same rules', () => {
    const result = localImport.importRecords(state.rows, context, 'me', batch(), [row(), row({ barangay_id: null, barangay_raw: 'Bantadd' }), row({ point: null })]);
    expect(result.records).toBe(3);
    const records = state.rows.interventions.filter((record) => record.import_batch_id === result.id);
    expect(records.map((record) => [record.data_source, record.qa_flags])).toEqual([
      ['ABEMIS export', []],
      ['ABEMIS export', ['barangay_unmatched']],
      ['ABEMIS export', ['no_coords']],
    ]);
    expect(state.rows.importBatches!.at(-1)).toMatchObject({ imported_by: 'me', counts: { records: 3, flagged: 2 } });
    const entries = state.rows.statusHistory.filter((entry) => records.some((record) => record.id === entry.intervention_id));
    expect(entries.map((entry) => [entry.date_basis, entry.source_note])).toEqual(Array(3).fill(['as_of', 'ABEMIS export']));

    const bad = row({ year_funded: 2999 });
    expect(() => localImport.importRecords(state.rows, context, 'me', batch(), [bad])).toThrow(new RegExp(`Row ${bad.row}:`));

    // A shared point alone isn't counted as flagged, as in the database.
    const twin = row();
    const twins = localImport.importRecords(state.rows, context, 'me', batch({ file_name: 'twins.csv' }), [twin, row({ point: twin.values.point })]);
    expect(state.rows.importBatches!.find((candidate) => candidate.id === twins.id)!.counts).toEqual({ records: 2, flagged: 0 });

    expect(() => localImport.undoImport(state.rows, context, { id: 'someone else', role: 'encoder' }, result.id, 'Mine?')).toThrow(/Only the person/);
    expect(() => localImport.undoImport(state.rows, context, { id: 'me', role: 'encoder' }, result.id, ' ')).toThrow();
    expect(localImport.undoImport(state.rows, context, { id: 'me', role: 'encoder' }, result.id, 'Wrong file').records).toBe(3);
    expect(records.every((record) => record.deleted_at !== null)).toBe(true);
    expect(() => localImport.undoImport(state.rows, context, { id: 'me', role: 'admin' }, result.id, 'Again')).toThrow(/already/);
    const raed = state.rows.importBatches!.find((candidate) => candidate.imported_by === null)!;
    expect(() => localImport.undoImport(state.rows, context, { id: 'me', role: 'admin' }, raed.id, 'Trying')).toThrow(/script/);
  });

  it('imports roads with a line, a line in parts, or none, as the database does', () => {
    const { road } = roadIds();
    // The road type is off in the RAED seed, so it's switched on for this case, as an Admin would.
    const roads = { ...context, types: context.types.map((type) => (type.id === road ? { ...type, is_active: true } : type)) };
    const result = localImport.importRecords(state.rows, roads, 'me', batch({ intervention_type_id: road, file_name: 'roads.geojson' }), [
      roadRow('Local road one', { line: ONE }),
      roadRow('Local road two', { line_parts: PARTS }),
      roadRow('Local road three'),
    ]);
    const records = state.rows.interventions.filter((record) => record.import_batch_id === result.id);
    expect(records.map((record) => record.geojson)).toEqual([{ type: 'LineString', coordinates: ONE }, { type: 'MultiLineString', coordinates: PARTS }, null]);
    expect(records.map((record) => record.qa_flags.includes('no_coords'))).toEqual([false, false, true]);
    // Linked to the barangays the line crosses, as intervention_barangays is.
    expect(state.rows.links.some((link) => link.intervention_id === records[1].id && link.link_source === 'spatial')).toBe(true);

    expect(() => localImport.importRecords(state.rows, roads, 'me', batch({ intervention_type_id: road }), [roadRow('Short', { line_parts: [[[121.85, 13.45]]] })])).toThrow(/Row \d+: .*two points/);
    expect(() => localImport.importRecords(state.rows, context, 'me', batch(), [row({ point: null, line: ONE })])).toThrow(/Row \d+: .*not a line/);
  });

  it('dismisses and clears flags the same way, and a dismissal ends with its flag', () => {
    const { id } = localImport.importRecords(state.rows, context, 'me', batch({ file_name: 'local.csv' }), [row({ barangay_id: null, barangay_raw: 'Somewhere else' })]);
    const record = state.rows.interventions.find((candidate) => candidate.import_batch_id === id)!;
    expect(() => localImport.dismissFlag(state.rows, context, 'me', record.id, 'barangay_unmatched', ' ')).toThrow();
    localImport.dismissFlag(state.rows, context, 'me', record.id, 'barangay_unmatched', 'Sitio name');
    expect(state.rows.qaDismissals).toContainEqual(expect.objectContaining({ intervention_id: record.id, flag: 'barangay_unmatched', reason: 'Sitio name' }));
    expect(() => localImport.undoImport(state.rows, context, { id: 'me', role: 'admin' }, id, 'Wrong file')).toThrow(/worked on/);

    engine.updateIntervention(state.rows, context, record.id, record.version, { barangay_id: ids().bantad }, { kind: 'edit', reason: 'Matched' });
    expect(record.qa_flags).toEqual([]);
    expect(state.rows.qaDismissals!.some((dismissal) => dismissal.intervention_id === record.id)).toBe(false);

    const named = state.rows.interventions.find((candidate) => candidate.qa_flags.includes('beneficiary_name_check') && candidate.deleted_at === null)!;
    localImport.dismissFlag(state.rows, context, 'me', named.id, 'beneficiary_name_check', 'Confirmed');
    expect(named.qa_flags).not.toContain('beneficiary_name_check');
  });
});

// Phase 16c: a road from a file comes in with its line, through import_records, as a road drawn on the
// map is saved through create_intervention.
describe('roads from a map file', () => {
  beforeAll(async () => {
    // The road type is off in the RAED seed. An Admin switches it on before importing roads.
    await db.query(`update intervention_types set is_active = true where code = 'fmr'`);
  });

  it('saves a line as a LineString, a line in parts as a MultiLineString, and a road with none to wait', async () => {
    const { road } = roadIds();
    const result = await encoder.importRecords(batch({ intervention_type_id: road, file_name: 'roads.geojson' }), [
      roadRow('Road one', { line: ONE }),
      roadRow('Road two', { line_parts: PARTS }),
      roadRow('Road three'),
    ]);
    const saved = await rows<{ title: string; geojson: GeoJSON.Geometry | null; qa_flags: string[] }>(
      'select title, geojson, qa_flags from interventions_v where import_batch_id = $1 order by title',
      [result.id],
    );
    expect(saved.map((record) => [record.title, record.geojson])).toEqual([
      ['Road one', { type: 'LineString', coordinates: ONE }],
      ['Road three', null],
      ['Road two', { type: 'MultiLineString', coordinates: PARTS }],
    ]);
    expect(saved.map((record) => record.qa_flags.includes('no_coords'))).toEqual([false, true, false]);
    // A road in parts is linked to the barangays it runs through, as one drawn on the map is.
    const links = await rows('select 1 from intervention_barangays b join interventions i on i.id = b.intervention_id where i.title = $1 and b.link_source = $2', ['Road two', 'spatial']);
    expect(links.length).toBeGreaterThan(0);
  });

  it('refuses a part of fewer than two points, two shapes at once, and a line for a point type', async () => {
    const { road } = roadIds();
    const importing = (type: number, item: ImportRowInput) =>
      attempt(ENCODER, 'select public.import_records($1::jsonb, $2::jsonb)', [JSON.stringify(batch({ intervention_type_id: type })), JSON.stringify([item])]);
    expect((await importing(road, roadRow('Short', { line_parts: [[[121.85, 13.45]]] }))).message).toMatch(/^Row \d+: a line needs at least two points/);
    expect((await importing(road, roadRow('Empty', { line_parts: [] }))).message).toMatch(/at least one part/);
    expect((await importing(road, roadRow('Both', { line: ONE, line_parts: PARTS }))).message).toMatch(/not both/);
    expect((await importing(ids().machinery, row({ point: null, line: ONE }))).message).toMatch(/needs a point geometry/);
    expect((await importing(road, roadRow('Fine', { line: ONE }))).ok).toBe(true);
  });
});
