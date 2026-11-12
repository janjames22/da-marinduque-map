// The same promises as tests/access-control.test.ts, kept by the hosted service: real logins, real
// tokens, real Storage and Realtime. Temporary accounts only, removed at the end.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDb, loadEnv, projectUrl, publicKey } from '../../scripts/lib/env';
import { createTestAccounts, removeTestAccounts, type TestAccount, type TestAccounts } from '../../scripts/lib/test-accounts';
import { createSupabaseBackend } from '../../src/modules/intervention-map/data/supabase-backend';
import { createSupabaseStore } from '../../src/modules/intervention-map/data/supabase-store';
import { ConflictError, type DataStore, type ImportBatchInput, type ImportRowInput, type InterventionValues, type NewStatus, type TypeStatusValues, type TypeValues } from '../../src/modules/intervention-map/data/store';
import type { MapData } from '../../src/modules/intervention-map/data/types';

const BUCKET = 'intervention-photos';
const SIGNAL_LIMIT_MS = 2000;

loadEnv();

let accounts: TestAccounts;
let visitor: SupabaseClient;
let adminClient: SupabaseClient;
let encoderClient: SupabaseClient;
let viewerClient: SupabaseClient;
let strangerClient: SupabaseClient;
let admin: DataStore;
let encoder: DataStore;
let viewer: DataStore;
let data: MapData;
let realRecordsBefore: number;

const newClient = () => createClient(projectUrl(), publicKey(), { auth: { persistSession: false, autoRefreshToken: false } });

async function signedIn(account: TestAccount): Promise<SupabaseClient> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw new Error(`${account.email}: ${error.message}`);
  return client;
}

async function countRealRecords() {
  const db = await connectDb();
  try {
    return (await db.query<{ n: number }>(`select count(*)::int as n from public.interventions where beneficiary not like 'Live test%'`)).rows[0].n;
  } finally {
    await db.end();
  }
}

beforeAll(async () => {
  realRecordsBefore = await countRealRecords();
  accounts = await createTestAccounts();
  visitor = newClient();
  adminClient = await signedIn(accounts.admin);
  encoderClient = await signedIn(accounts.encoder);
  viewerClient = await signedIn(accounts.viewer);
  strangerClient = await signedIn(accounts.stranger);

  const storeFor = (client: SupabaseClient, account: TestAccount, role: 'admin' | 'encoder' | 'viewer') =>
    createSupabaseStore(createSupabaseBackend(client), { id: account.id, full_name: account.full_name, role });
  admin = storeFor(adminClient, accounts.admin, 'admin');
  encoder = storeFor(encoderClient, accounts.encoder, 'encoder');
  viewer = storeFor(viewerClient, accounts.viewer, 'viewer');
  data = await encoder.load();
  await admin.load();
  await viewer.load();
});

afterAll(async () => {
  await removeTestAccounts();
  // Proves the clean-up left the real data as it was.
  expect(await countRealRecords()).toBe(realRecordsBefore);
});

const newValues = (beneficiary: string): InterventionValues => {
  const type = data.types.find((t) => t.code === 'farm-machinery')!;
  const barangay = data.barangays.find((b) => b.name === 'Bantad')!;
  return {
    intervention_type_id: type.id,
    category_id: data.categories.find((c) => c.intervention_type_id === type.id)!.id,
    title: null,
    banner_program_id: data.programs.find((p) => p.code === 'rice')!.id,
    year_funded: 2024,
    quantity: 1,
    unit_cost: null,
    fund_source: null,
    beneficiary,
    beneficiary_type_id: null,
    municipality_id: barangay.municipality_id,
    barangay_id: barangay.id,
    location_basis_id: null,
    point: { lat: 13.45, lng: 121.85 },
    attributes: {},
    remarks: null,
  };
};

const newStatus = (changes: Partial<NewStatus> = {}): NewStatus => ({
  status_id: data.statuses.find((s) => s.name === 'Turned-over')!.id,
  status_date: '2024-05-01',
  remarks: null,
  ...changes,
});

// A row of a test import in Bantad, each a little apart so none shares a point.
const importRow = (row: number, beneficiary: string, changes: Partial<ImportRowInput['values']> = {}): ImportRowInput => {
  const { intervention_type_id: _type, ...values } = newValues(beneficiary);
  return {
    row,
    source_id: `LIVE-${row}`,
    source_raw: { Beneficiary: beneficiary, Barangay: 'Bantad' },
    values: { ...values, point: { lat: 13.45, lng: 121.85 + row * 0.0001 }, barangay_raw: 'Bantad', ...changes },
    status: { status_id: newStatus().status_id, status_date: '2024-05-01', date_basis: 'as_of', remarks: null },
  };
};

const liveBatch = (file: string): ImportBatchInput => ({
  file_name: file,
  data_source: 'Live test export',
  intervention_type_id: data.types.find((t) => t.code === 'farm-machinery')!.id,
  column_mapping: {},
});

const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'live.jpg', { type: 'image/jpeg' });

describe('reading', () => {
  it('gives visitors nothing', async () => {
    for (const table of ['interventions', 'interventions_v', 'status_history', 'audit_log', 'profiles', 'barangays', 'programs', 'intervention_photos']) {
      const { data: rows, error } = await visitor.from(table).select('*').limit(1);
      expect(error, table).not.toBeNull();
      expect(rows, table).toBeNull();
    }
    for (const fn of ['member_names', 'audit_for_intervention', 'create_intervention', 'soft_delete_intervention']) {
      const { error } = await visitor.rpc(fn, {});
      expect(error, fn).not.toBeNull();
    }
  });

  it('gives an account with no role nothing, though it can sign in', async () => {
    for (const table of ['interventions', 'interventions_v', 'status_history', 'audit_log', 'barangays', 'programs']) {
      const { data: rows, error } = await strangerClient.from(table).select('*').limit(1);
      expect(error, table).toBeNull();
      expect(rows, table).toEqual([]);
    }
  });

  it('loads the whole map for a member', () => {
    expect(data.barangays).toHaveLength(218);
    expect(data.interventions.length).toBeGreaterThanOrEqual(199);
    expect(data.statusHistory.length).toBeGreaterThanOrEqual(199);
    expect(data.dataSources).toContain('RAED 2026-10-21');
    expect(data.members.some((m) => m.full_name === 'Test viewer')).toBe(true);
  });

  it('gives geometry as GeoJSON, and no raw source row', () => {
    const located = data.interventions.find((r) => r.geojson)!;
    expect(located.geojson?.type).toBe('Point');
    expect(located).not.toHaveProperty('source_raw');
  });

  it('keeps the audit log to Admins', async () => {
    expect((await viewerClient.from('audit_log').select('id').limit(1)).data).toEqual([]);
    expect((await encoderClient.from('audit_log').select('id').limit(1)).data).toEqual([]);
    expect((await adminClient.from('audit_log').select('id').limit(1)).data).toHaveLength(1);
  });

  it('keeps other people\'s profiles to Admins', async () => {
    const own = await encoderClient.from('profiles').select('id');
    expect(own.data).toEqual([{ id: accounts.encoder.id }]);
    expect((await adminClient.from('profiles').select('id')).data!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('writing', () => {
  it('refuses a Viewer, through the functions and directly', async () => {
    const record = data.interventions[0];
    await expect(viewer.createIntervention(newValues('Live test viewer'), newStatus())).rejects.toThrow(/permission/);
    await expect(viewer.updateIntervention(record.id, record.version, { remarks: 'x' })).rejects.toThrow(/permission/);
    await expect(viewer.softDeleteIntervention(record.id, record.version)).rejects.toThrow(/permission/);
    await expect(viewer.auditFor(record.id)).rejects.toThrow(/permission/);

    const update = await viewerClient.from('interventions').update({ remarks: 'x' }).eq('id', record.id).select();
    expect(update.data ?? []).toEqual([]);
    const status = await viewerClient.from('status_history').insert({ intervention_id: record.id, status_id: record.status_id, status_date: '2024-01-01' });
    expect(status.error).not.toBeNull();
  });

  it('stops anyone making themselves Admin', async () => {
    const encoderTry = await encoderClient.from('profiles').update({ role: 'admin' }).eq('id', accounts.encoder.id).select();
    expect(encoderTry.data ?? []).toEqual([]);
    const strangerTry = await strangerClient.from('profiles').insert({ id: accounts.stranger.id, role: 'admin' });
    expect(strangerTry.error).not.toBeNull();
    const { data: profile } = await adminClient.from('profiles').select('role').eq('id', accounts.encoder.id).single();
    expect(profile?.role).toBe('encoder');
  });

  it('runs a record\'s whole life, naming the person at every step', async () => {
    const created = await encoder.createIntervention(newValues('Live test life'), newStatus(), { kind: 'create', reason: 'Live test' });
    expect(created).toMatchObject({ beneficiary: 'Live test life', version: 1, data_source: 'Encoded on the map' });
    expect(created.status_id).not.toBeNull();

    const edited = await encoder.updateIntervention(created.id, created.version, { remarks: 'Edited' }, { kind: 'edit' });
    expect(edited).toMatchObject({ remarks: 'Edited', version: 2 });

    await expect(encoder.updateIntervention(created.id, created.version, { remarks: 'Stale' })).rejects.toMatchObject({ name: 'ConflictError' });

    const deleted = await encoder.softDeleteIntervention(edited.id, edited.version, { kind: 'delete', reason: 'Live test' });
    expect(deleted.deleted_at).not.toBeNull();
    expect((await encoderClient.from('interventions').select('id').eq('id', created.id)).data).toEqual([]);
    expect((await viewerClient.from('interventions').select('id').eq('id', created.id)).data).toEqual([]);
    expect((await adminClient.from('interventions').select('id').eq('id', created.id)).data).toHaveLength(1);

    await expect(encoder.restoreIntervention(deleted.id, deleted.version)).rejects.toThrow(/permission/);
    const restored = await admin.restoreIntervention(deleted.id, deleted.version, { kind: 'restore' });
    expect(restored.deleted_at).toBeNull();

    const history = await encoder.auditFor(created.id);
    expect(history.map((h) => [h.table_name, h.action, h.actor_name])).toEqual([
      ['interventions', 'insert', 'Test encoder'],
      ['status_history', 'insert', 'Test encoder'],
      ['interventions', 'update', 'Test encoder'],
      ['interventions', 'soft_delete', 'Test encoder'],
      ['interventions', 'restore', 'Test admin'],
    ]);
    expect(history[0].context).toMatchObject({ reason: 'Live test' });

    const { data: entry } = await viewerClient.from('status_history').select('created_by').eq('intervention_id', created.id).single();
    expect(entry?.created_by).toBe(accounts.encoder.id);
  });

  it('applies the database rules on the hosted service', async () => {
    const unloaded = createSupabaseStore(createSupabaseBackend(encoderClient), { id: accounts.encoder.id, full_name: null, role: 'encoder' });
    await expect(unloaded.createIntervention({ ...newValues('Live test rule'), beneficiary: null }, newStatus())).rejects.toThrow(/beneficiary is required/);
    await expect(unloaded.createIntervention(newValues('Live test rule'), newStatus({ status_date: '2999-01-01' }))).rejects.toThrow(/future/);
    expect((await encoderClient.from('interventions').select('id').eq('beneficiary', 'Live test rule')).data).toEqual([]);
  });
});

describe('exports', () => {
  const entry = { format: 'kmz', file_name: 'Marinduque_LiveTest_2026-11-06.kmz', filters: { municipality: 'Gasan', allTypes: true }, record_count: 33 };
  const exportsBy = async (id: string) => {
    const { data: rows, error } = await adminClient.from('audit_log').select('table_name, action, actor_id, context').eq('actor_id', id).eq('action', 'export');
    expect(error).toBeNull();
    return rows;
  };
  const rpcEntry = { p_format: entry.format, p_file_name: entry.file_name, p_filters: entry.filters, p_record_count: entry.record_count };

  it('logs an export by every role: who, the format, the filters and the count', async () => {
    const roles = [
      [viewer, accounts.viewer],
      [encoder, accounts.encoder],
      [admin, accounts.admin],
    ] as const;
    for (const [store, account] of roles) {
      await store.logExport(entry);
      expect(await exportsBy(account.id), account.email).toEqual([{ table_name: 'exports', action: 'export', actor_id: account.id, context: entry }]);
    }
  });

  it('refuses visitors and accounts with no role', async () => {
    expect((await visitor.rpc('log_export', rpcEntry)).error).not.toBeNull();
    expect((await strangerClient.rpc('log_export', rpcEntry)).error).not.toBeNull();
    expect(await exportsBy(accounts.stranger.id)).toEqual([]);
  });

  it('refuses a format it doesn\'t know, and a missing count', async () => {
    await expect(viewer.logExport({ ...entry, format: 'exe' })).rejects.toThrow();
    expect((await viewerClient.rpc('log_export', { ...rpcEntry, p_record_count: null })).error).not.toBeNull();
    expect((await viewerClient.rpc('log_export', { ...rpcEntry, p_record_count: -1 })).error).not.toBeNull();
  });

  it('can\'t be written around, or written in someone else\'s name', async () => {
    const forged = { table_name: 'exports', action: 'export', actor_id: accounts.admin.id, context: entry };
    expect((await viewerClient.from('audit_log').insert(forged)).error).not.toBeNull();
    expect((await adminClient.from('audit_log').insert(forged)).error).not.toBeNull();
    expect(await exportsBy(accounts.admin.id)).toHaveLength(1);
  });
});

describe('the lists and forms', () => {
  const statusId = (name: string) => data.statuses.find((s) => s.name === name)!.id;
  const typeValues = (code: string): TypeValues => ({
    code,
    name: code,
    geometry_kind: 'point',
    icon_id: null,
    color: '#123456',
    core_field_rules: { title: 'required' },
    field_schema: { fields: [{ key: 'note', label: 'Note', input: 'text', required: true }] },
    sort_order: 90,
    is_active: true,
  });
  const statuses = (...names: string[]): TypeStatusValues[] => names.map((name, index) => ({ status_id: statusId(name), is_default: index === 0, counts_as_operational: false }));

  it('an Admin can add to a list, and nobody else can', async () => {
    const code = `e2e-test-program-${Date.now()}`;
    await admin.saveLookup('programs', null, { code, name: code, color: '#123456' });
    const loaded = await admin.load();
    const added = loaded.programs.find((p) => p.code === code)!;
    expect(added.is_active).toBe(true);
    await admin.saveLookup('programs', added.id, { is_active: false });
    expect((await admin.load()).programs.find((p) => p.code === code)?.is_active).toBe(false);

    await expect(encoder.saveLookup('programs', null, { code: `${code}-x`, name: `${code}-x`, color: '#123456' })).rejects.toThrow();
    await expect(viewer.saveLookup('programs', added.id, { name: 'Taken over' })).rejects.toThrow();
    expect((await admin.load()).programs.find((p) => p.code === code)?.name).toBe(code);
  });

  it('a type made by an Admin takes records straight away, by its own rules', async () => {
    const code = `e2e-test-type-${Date.now()}`;
    const type = await admin.saveType(null, null, typeValues(code), statuses('Proposed', 'Operational'));
    expect(type).toMatchObject({ code, version: 1 });
    await encoder.load();

    const status = { status_id: statusId('Operational'), status_date: '2024-05-01', remarks: null };
    const values = { ...newValues('Live test custom type'), intervention_type_id: type.id, category_id: null, banner_program_id: null, title: 'Live test' };
    await expect(encoder.createIntervention(values, status)).rejects.toThrow();
    const record = await encoder.createIntervention({ ...values, attributes: { note: 'kept' } }, status);
    expect(record.attributes).toEqual({ note: 'kept' });

    await admin.load();
    await expect(admin.saveType(type.id, type.version, { ...typeValues(code), geometry_kind: 'line' }, statuses('Proposed', 'Operational'))).rejects.toThrow(/geometry/);
    await expect(admin.saveType(type.id, type.version, typeValues(code), statuses('Proposed'))).rejects.toThrow(/stays on the list/);

    const updated = await admin.saveType(type.id, type.version, { ...typeValues(code), color: '#654321' }, statuses('Proposed', 'Operational'));
    expect(updated.version).toBe(type.version + 1);
    await expect(admin.saveType(type.id, type.version, typeValues(code), statuses('Proposed', 'Operational'))).rejects.toThrow(ConflictError);
  });

  // Since 0012_lines.sql a line type can be on and a road can wait for its line, so this is about polygons.
  it('a polygon type stays inactive and takes no record without a shape, on the hosted service', async () => {
    const code = `e2e-test-polygon-${Date.now()}`;
    const values = { ...typeValues(code), geometry_kind: 'polygon' as const };
    const made = await adminClient.rpc('save_intervention_type', { p_id: null, p_expected_version: null, p_values: values, p_statuses: statuses('Proposed') });
    expect(made.error?.message).toMatch(/drawing tools/);

    const polygon = await admin.saveType(null, null, { ...values, is_active: false }, statuses('Proposed'));
    expect(polygon.is_active).toBe(false);
    const activated = await adminClient.from('intervention_types').update({ is_active: true }).eq('id', polygon.id);
    expect(activated.error?.message).toMatch(/drawing tools/);

    const record = { ...newValues('Live test no shape'), intervention_type_id: polygon.id, category_id: null, title: 'Live test', attributes: { note: 'kept' }, point: null };
    const created = await encoderClient.rpc('create_intervention', { p_values: record, p_status: { status_id: statusId('Proposed'), status_date: '2024-05-01', remarks: null } });
    expect(created.error?.message).toMatch(/needs its shape/);
  });

  it('a code stays as it was, and an unsafe icon is refused, on the hosted service', async () => {
    const code = await adminClient.from('programs').update({ code: 'renamed' }).eq('code', 'rice');
    expect(code.error?.message).toMatch(/code cannot change/);
    const icon = await adminClient.from('icons').insert({ name: 'e2e-test-icon', image: '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>' });
    expect(icon.error?.message).toMatch(/scripts or links/);
  });

  it('the functions refuse a stranger and a Viewer', async () => {
    const refused = await strangerClient.rpc('save_barangay_fields', { p_expected_version: 1, p_schema: { fields: [] } });
    expect(refused.error).not.toBeNull();
    const viewerRefused = await viewerClient.rpc('save_intervention_type', { p_id: null, p_expected_version: null, p_values: typeValues('e2e-test-refused'), p_statuses: statuses('Proposed') });
    expect(viewerRefused.error?.code).toBe('42501');
  });
});

describe('photos', () => {
  it('stores a photo privately, and serves it through a signed link to any member', async () => {
    const record = await encoder.createIntervention(newValues('Live test photo'), newStatus({ photo: jpeg() }));
    const fresh = await viewer.load();
    const photo = fresh.photos.find((p) => p.intervention_id === record.id)!;
    expect(photo.storage_path).toMatch(new RegExp(`^${record.id}/`));

    const signed = await viewer.photoUrl(photo.id);
    expect(signed).toMatch(/token=/);
    const opened = await fetch(signed!);
    expect(opened.status).toBe(200);
    expect(new Uint8Array(await opened.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));

    const { data: address } = visitor.storage.from(BUCKET).getPublicUrl(photo.storage_path);
    expect((await fetch(address.publicUrl)).ok).toBe(false);
    expect((await visitor.storage.from(BUCKET).createSignedUrl(photo.storage_path, 60)).error).not.toBeNull();
    expect((await strangerClient.storage.from(BUCKET).createSignedUrl(photo.storage_path, 60)).error).not.toBeNull();

    // On a record, a file stays, even for the person who uploaded it.
    await encoderClient.storage.from(BUCKET).remove([photo.storage_path]);
    expect((await viewerClient.storage.from(BUCKET).createSignedUrl(photo.storage_path, 60)).error).toBeNull();
  });

  it('refuses uploads from Viewers and strangers, and files that aren\'t images', async () => {
    const path = `${data.interventions[0].id}/00000000-0000-4000-8000-000000000001.jpg`;
    expect((await viewerClient.storage.from(BUCKET).upload(path, jpeg())).error).not.toBeNull();
    expect((await strangerClient.storage.from(BUCKET).upload(path, jpeg())).error).not.toBeNull();
    expect((await visitor.storage.from(BUCKET).upload(path, jpeg())).error).not.toBeNull();

    const text = new File(['not a photo'], 'x.jpg', { type: 'text/plain' });
    expect((await encoderClient.storage.from(BUCKET).upload(path, text)).error).not.toBeNull();
  });

  it('refuses a file over the size limit', async () => {
    const huge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.jpg', { type: 'image/jpeg' });
    const path = `${data.interventions[0].id}/00000000-0000-4000-8000-000000000002.jpg`;
    expect((await encoderClient.storage.from(BUCKET).upload(path, huge)).error).not.toBeNull();
  });
});

describe('saved views', () => {
  const config = { layers: {}, filters: {}, style: {}, basemap: 'osm', extent: null };
  const viewId = async (client: SupabaseClient, name: string) => (await client.from('saved_views').select('id').eq('name', name).single()).data!.id as string;
  // Someone may have chosen a real default by now, and these tests must leave that alone.
  const realDefault = async () => (await adminClient.from('saved_views').select('id').eq('is_default', true)).data?.[0]?.id as string | undefined;

  it('stays private until shared, and only its owner can change it', async () => {
    await viewer.saveView(null, { name: 'E2E test private', config, is_shared: false });
    const id = await viewId(viewerClient, 'E2E test private');
    const { data: saved } = await viewerClient.from('saved_views').select('owner_id, is_shared, is_default').eq('id', id).single();
    expect(saved).toEqual({ owner_id: accounts.viewer.id, is_shared: false, is_default: false });
    expect((await encoderClient.from('saved_views').select('id').eq('id', id)).data).toEqual([]);
    expect((await adminClient.from('saved_views').select('id').eq('id', id)).data).toEqual([]);

    await viewer.saveView(id, { is_shared: true });
    expect((await encoderClient.from('saved_views').select('id').eq('id', id)).data).toHaveLength(1);

    expect((await encoderClient.from('saved_views').update({ name: 'Taken over' }).eq('id', id).select('id')).data).toEqual([]);
    expect((await encoderClient.from('saved_views').delete().eq('id', id).select('id')).data).toEqual([]);
    expect((await viewerClient.from('saved_views').select('name').eq('id', id).single()).data?.name).toBe('E2E test private');
  });

  it('can\'t be made in someone else\'s name, by a stranger or by a visitor', async () => {
    expect((await viewerClient.from('saved_views').insert({ name: 'E2E test forged', config, owner_id: accounts.admin.id })).error).not.toBeNull();
    expect((await strangerClient.from('saved_views').insert({ name: 'E2E test stranger', config })).error).not.toBeNull();
    expect((await visitor.from('saved_views').insert({ name: 'E2E test visitor', config })).error).not.toBeNull();
    expect((await visitor.from('saved_views').select('id').limit(1)).error).not.toBeNull();
    expect((await strangerClient.from('saved_views').select('id').limit(1)).data).toEqual([]);
  });

  it('needs a name, which one person can use only once', async () => {
    expect((await viewerClient.from('saved_views').insert({ name: '   ', config })).error).not.toBeNull();
    expect((await viewerClient.from('saved_views').insert({ name: 'E2E TEST private', config })).error?.code).toBe('23505');
    expect((await encoderClient.from('saved_views').insert({ name: 'E2E TEST private', config })).error).toBeNull();
  });

  it('can be taken down by an Admin once it\'s shared', async () => {
    await viewer.saveView(null, { name: 'E2E test left behind', config, is_shared: true });
    const id = await viewId(viewerClient, 'E2E test left behind');
    expect((await adminClient.from('saved_views').delete().eq('id', id).select('id')).data).toHaveLength(1);
    expect((await viewerClient.from('saved_views').select('id').eq('id', id)).data).toEqual([]);
  });

  it('becomes the default only by an Admin\'s choice, and has to be shared', async () => {
    await encoder.saveView(null, { name: 'E2E test default', config, is_shared: true });
    await admin.saveView(null, { name: 'E2E test admin personal', config, is_shared: false });
    const id = await viewId(encoderClient, 'E2E test default');
    const personal = await viewId(adminClient, 'E2E test admin personal');
    const before = await realDefault();

    // Each of these changes nothing, so a real default is safe.
    for (const client of [viewerClient, encoderClient]) {
      expect((await client.rpc('set_default_view', { p_id: id })).error?.code).toBe('42501');
      expect((await client.from('saved_views').update({ is_default: true }).eq('id', id)).error?.code).toBe('42501');
    }
    expect((await strangerClient.rpc('set_default_view', { p_id: id })).error).not.toBeNull();
    expect((await visitor.rpc('set_default_view', { p_id: id })).error).not.toBeNull();
    expect((await adminClient.rpc('set_default_view', { p_id: personal })).error?.message).toMatch(/shared/);
    expect(await realDefault()).toBe(before);
    if (before) {
      console.log('A real default view is set, so the rest of this test was left out.');
      return;
    }

    await admin.setDefaultView(id);
    expect((await viewerClient.from('saved_views').select('is_default').eq('id', id).single()).data?.is_default).toBe(true);
    expect((await encoderClient.from('saved_views').update({ is_shared: false }).eq('id', id)).error?.message).toMatch(/stay shared/);

    await admin.setDefaultView(null);
    expect(await realDefault()).toBeUndefined();
  });
});

describe('the audit log page', () => {
  it('is for Admins alone', async () => {
    for (const client of [viewerClient, encoderClient, strangerClient]) {
      expect((await client.rpc('audit_log_page', {})).error?.code).toBe('42501');
    }
    expect((await visitor.rpc('audit_log_page', {})).error).not.toBeNull();
  });

  it('finds a record\'s changes, with the person and the reason, and shows no raw source row', async () => {
    const created = await encoder.createIntervention(newValues('Live test audit page'), newStatus());
    const before = data.barangays.find((b) => b.id === created.barangay_id)!;
    const after = data.barangays.find((b) => b.municipality_id === before.municipality_id && b.id !== before.id)!;
    await encoder.updateIntervention(created.id, created.version, { barangay_id: after.id }, { kind: 'edit', reason: 'Live test reason' });

    const { entries, total } = await admin.auditLog({ recordIds: [created.id], page: 0, pageSize: 50 });
    expect(total).toBe(3);
    expect(entries.map((entry) => [entry.table_name, entry.action, entry.actor_name])).toEqual([
      ['interventions', 'update', 'Test encoder'],
      ['status_history', 'insert', 'Test encoder'],
      ['interventions', 'insert', 'Test encoder'],
    ]);
    expect(entries[0].context).toMatchObject({ kind: 'edit', reason: 'Live test reason' });
    expect(entries[0].new_row).toMatchObject({ barangay_id: after.id });
    expect(entries[0].old_row).toMatchObject({ barangay_id: before.id });
    expect(JSON.stringify(entries)).not.toContain('source_raw');
  });

  it('filters by person, action and date, in Philippine time', async () => {
    const mine = await admin.auditLog({ actorId: accounts.encoder.id, page: 0, pageSize: 200 });
    expect(mine.entries.length).toBeGreaterThan(0);
    expect(new Set(mine.entries.map((entry) => entry.actor_id))).toEqual(new Set([accounts.encoder.id]));

    const exported = await admin.auditLog({ action: 'export', actorId: accounts.viewer.id, page: 0, pageSize: 50 });
    expect(exported.entries.map((entry) => entry.table_name)).toEqual(['exports']);

    const day = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(Date.now() + offset * 86_400_000));
    expect((await admin.auditLog({ actorId: accounts.encoder.id, from: day(0), to: day(0), page: 0, pageSize: 1 })).total).toBe(mine.total);
    expect((await admin.auditLog({ actorId: accounts.encoder.id, to: day(-1), page: 0, pageSize: 1 })).total).toBe(0);
  });

  it('keeps one request from taking the whole log', async () => {
    const { data: answer, error } = await adminClient.rpc('audit_log_page', { p_limit: 100_000 });
    expect(error).toBeNull();
    expect((answer as { entries: unknown[] }).entries.length).toBeLessThanOrEqual(200);
  });
});

describe('import and QA', () => {
  const recordsOf = async (store: DataStore, batchId: string) => (await store.load()).interventions.filter((record) => record.import_batch_id === batchId);

  it('refuses a Viewer, a stranger and a visitor', async () => {
    await expect(viewer.importRecords(liveBatch('viewer.csv'), [importRow(2, 'Live test import refused')])).rejects.toThrow();
    for (const client of [visitor, strangerClient]) {
      const { error } = await client.rpc('import_records', { p_batch: liveBatch('stranger.csv'), p_rows: [importRow(2, 'Live test import refused')] });
      expect(error).not.toBeNull();
    }
    expect((await admin.load()).interventions.some((record) => record.beneficiary === 'Live test import refused')).toBe(false);
  });

  it('brings a file in as one batch, all or nothing, under the person who imported it', async () => {
    await expect(encoder.importRecords(liveBatch('bad.csv'), [importRow(2, 'Live test import A'), importRow(3, 'Live test import B', { year_funded: 2999 })])).rejects.toThrow(/^Row 3: /);
    expect((await admin.load()).interventions.some((record) => record.beneficiary === 'Live test import A')).toBe(false);

    const { id, records } = await encoder.importRecords(liveBatch('good.csv'), [importRow(2, 'Live test import A'), importRow(3, 'Live test import B', { point: null })]);
    expect(records).toBe(2);
    const after = await encoder.load();
    expect(after.importBatches.find((batch) => batch.id === id)).toMatchObject({
      file_name: 'good.csv',
      data_source: 'Live test export',
      imported_by: accounts.encoder.id,
      counts: { records: 2, flagged: 1 },
      undone_at: null,
    });
    const imported = await recordsOf(encoder, id);
    expect(imported.map((record) => [record.beneficiary, record.source_id, record.data_source, record.qa_flags]).sort()).toEqual([
      ['Live test import A', 'LIVE-2', 'Live test export', []],
      ['Live test import B', 'LIVE-3', 'Live test export', ['no_coords']],
    ]);
    expect(after.dataSources).toContain('Live test export');
  });

  it('can be undone with a reason by its importer or an Admin, not by anyone else, and not once a record is worked on', async () => {
    const mine = await encoder.importRecords(liveBatch('undo.csv'), [importRow(4, 'Live test undo A'), importRow(5, 'Live test undo B')]);
    const theirs = await admin.importRecords(liveBatch('admin.csv'), [importRow(6, 'Live test undo C')]);
    await expect(viewer.undoImport(mine.id, 'No')).rejects.toThrow();
    await expect(encoder.undoImport(theirs.id, 'Not mine')).rejects.toThrow('Only the person who imported it, or an Admin, can undo an import.');
    await expect(encoder.undoImport(mine.id, ' ')).rejects.toThrow('Give a reason for undoing the import.');

    const [first] = await recordsOf(encoder, mine.id);
    await encoder.addStatus(first.id, newStatus({ status_id: data.statuses.find((s) => s.name === 'Serviceable')!.id, status_date: '2024-06-01' }));
    await expect(admin.undoImport(mine.id, 'Wrong file')).rejects.toThrow('1 of its records has been worked on since');

    expect(await admin.undoImport(theirs.id, 'Imported twice')).toEqual({ records: 1 });
    await expect(admin.undoImport(theirs.id, 'Again')).rejects.toThrow('This import has already been undone.');
    const after = await admin.load();
    expect(after.importBatches.find((batch) => batch.id === theirs.id)).toMatchObject({ undone_by: accounts.admin.id, undo_reason: 'Imported twice' });
    // Deleted, so an Admin can still restore it, and off everyone else's map.
    expect((await recordsOf(admin, theirs.id)).map((record) => record.deleted_at !== null)).toEqual([true]);
    expect(await recordsOf(encoder, theirs.id)).toEqual([]);
  });

  it('a flag can be dismissed with a reason and put back by an Encoder, not by a Viewer, and only through its function', async () => {
    const { id } = await encoder.importRecords(liveBatch('flags.csv'), [importRow(7, 'Live test dismiss', { point: null })]);
    const [record] = await recordsOf(encoder, id);
    expect(record.qa_flags).toEqual(['no_coords']);

    await expect(viewer.dismissFlag(record.id, 'no_coords', 'No')).rejects.toThrow();
    await expect(encoder.dismissFlag(record.id, 'no_coords', ' ')).rejects.toThrow('Give a reason.');
    await expect(encoder.dismissFlag(record.id, 'out_of_province', 'Not there')).rejects.toThrow('That flag is no longer on this record.');
    const { error } = await encoderClient.from('qa_dismissals').insert({ intervention_id: record.id, flag: 'no_coords', reason: 'Around the function' });
    expect(error).not.toBeNull();

    await encoder.dismissFlag(record.id, 'no_coords', 'Coordinates to follow from the MAO');
    expect((await viewer.load()).qaDismissals.find((dismissal) => dismissal.intervention_id === record.id)).toMatchObject({
      flag: 'no_coords',
      reason: 'Coordinates to follow from the MAO',
      dismissed_by: accounts.encoder.id,
    });
    await expect(viewer.undismissFlag(record.id, 'no_coords')).rejects.toThrow();
    await encoder.undismissFlag(record.id, 'no_coords');
    expect((await viewer.load()).qaDismissals.some((dismissal) => dismissal.intervention_id === record.id)).toBe(false);
  });
});

describe('reports', () => {
  it('every member reads the signature blocks, which start with the office\'s own', () => {
    expect(data.signatories.length).toBeGreaterThan(0);
    expect(data.signatories.every((signatory) => signatory.label && signatory.name)).toBe(true);
  });

  it('only an Admin adds or changes a signature block, and none can be deleted, on the hosted service', async () => {
    // A test block of its own, so the real ones are never touched. The clean-up removes it by its label.
    await admin.saveLookup('report_signatories', null, { label: 'E2E test signer', name: 'Live test signatory', position: 'Tester', sort_order: 99, is_active: false });
    const added = (await admin.load()).signatories.find((signatory) => signatory.label === 'E2E test signer')!;
    expect(added).toMatchObject({ name: 'Live test signatory', position: 'Tester', is_active: false });
    await admin.saveLookup('report_signatories', added.id, { position: 'Tester II' });

    await expect(encoder.saveLookup('report_signatories', added.id, { name: 'Changed by an Encoder' })).rejects.toThrow();
    await expect(viewer.saveLookup('report_signatories', null, { label: 'E2E test viewer', name: 'Viewer' })).rejects.toThrow();
    await encoderClient.from('report_signatories').update({ name: 'Changed directly' }).eq('id', added.id);
    await adminClient.from('report_signatories').delete().eq('id', added.id);
    const { data: rows } = await viewerClient.from('report_signatories').select('name, position').eq('id', added.id);
    expect(rows).toEqual([{ name: 'Live test signatory', position: 'Tester II' }]);
    const { data: forVisitor } = await visitor.from('report_signatories').select('id');
    expect(forVisitor ?? []).toEqual([]);
  });

  it('logs a report downloaded as a PDF or a workbook, by any member, on the hosted service', async () => {
    await viewer.logExport({ format: 'pdf', file_name: 'Inventory_Marinduque_live-test.pdf', filters: { report: 'inventory' }, record_count: 1 });
    await encoder.logExport({ format: 'xlsx', file_name: 'Inventory_Marinduque_live-test.xlsx', filters: { report: 'inventory' }, record_count: 1 });
    await expect(viewer.logExport({ format: 'docx', file_name: 'x.docx', filters: {}, record_count: 1 })).rejects.toThrow();
    const db = await connectDb();
    try {
      const { rows } = await db.query<{ format: string }>(
        `select context ->> 'format' as format from public.audit_log where action = 'export' and actor_id = any($1::uuid[]) and context ->> 'file_name' like 'Inventory_Marinduque_live-test%' order by id`,
        [[accounts.viewer.id, accounts.encoder.id]],
      );
      expect(rows.map((row) => row.format)).toEqual(['pdf', 'xlsx']);
    } finally {
      await db.end();
    }
  });
});

describe('live signals', () => {
  const channels: SupabaseClient[] = [];

  afterAll(async () => {
    for (const client of channels) await client.removeAllChannels();
  });

  // Resolves with the channel's final state, and a way to wait for the next signal.
  async function join(client: SupabaseClient) {
    channels.push(client);
    // A client keeps one channel per topic. Asking again returns the one already joined, which never
    // reports back, so an earlier test's has to go first.
    await client.removeAllChannels();
    await client.realtime.setAuth();
    let onSignal: (() => void) | null = null;
    let received = 0;
    const channel = client.channel('map-changes', { config: { private: true } });
    channel.on('broadcast', { event: 'changed' }, () => {
      received += 1;
      onSignal?.();
    });
    const status = await new Promise<string>((resolve) => {
      channel.subscribe((state) => {
        if (state !== 'CLOSED') resolve(state);
      });
      setTimeout(() => resolve('TIMED_OUT'), 15_000);
    });
    return {
      status,
      received: () => received,
      nextSignal: () =>
        new Promise<number>((resolve, reject) => {
          const started = Date.now();
          const timer = setTimeout(() => reject(new Error('No signal within 10 s')), 10_000);
          onSignal = () => {
            clearTimeout(timer);
            onSignal = null;
            resolve(Date.now() - started);
          };
        }),
    };
  }

  it('reaches another person within about 2 s, for a new record and for a delete', async () => {
    const listener = await join(viewerClient);
    expect(listener.status).toBe('SUBSCRIBED');

    const waiting = listener.nextSignal();
    const record = await encoder.createIntervention(newValues('Live test signal'), newStatus());
    const onCreate = await waiting;
    console.log(`Signal after a new record: ${onCreate} ms`);
    expect(onCreate).toBeLessThan(SIGNAL_LIMIT_MS);

    // The case Realtime's table feed would miss: the row is now hidden from this Viewer.
    const waitingAgain = listener.nextSignal();
    await encoder.softDeleteIntervention(record.id, record.version);
    const onDelete = await waitingAgain;
    console.log(`Signal after a soft delete: ${onDelete} ms`);
    expect(onDelete).toBeLessThan(SIGNAL_LIMIT_MS);
  });

  it('reaches another person within about 2 s when a list changes', async () => {
    const listener = await join(viewerClient);
    expect(listener.status).toBe('SUBSCRIBED');
    const waiting = listener.nextSignal();
    // A test item, as an Admin can now reorder the real ones, and this must not undo that.
    const code = `e2e-test-signal-${Date.now()}`;
    await admin.saveLookup('programs', null, { code, name: code, color: '#123456' });
    const elapsed = await waiting;
    console.log(`Signal after a list changed: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(SIGNAL_LIMIT_MS);
  });

  it('reaches another person within about 2 s when a view is shared', async () => {
    const listener = await join(viewerClient);
    expect(listener.status).toBe('SUBSCRIBED');
    const waiting = listener.nextSignal();
    await encoder.saveView(null, { name: `E2E test signal ${Date.now()}`, config: { basemap: 'osm' }, is_shared: true });
    const elapsed = await waiting;
    console.log(`Signal after a view was shared: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(SIGNAL_LIMIT_MS);
  });

  it('reaches another person within about 2 s when a file is imported, as one signal for the whole file', async () => {
    const listener = await join(viewerClient);
    expect(listener.status).toBe('SUBSCRIBED');
    const waiting = listener.nextSignal();
    await encoder.importRecords(liveBatch('signal.csv'), [importRow(8, 'Live test signal import A'), importRow(9, 'Live test signal import B'), importRow(10, 'Live test signal import C')]);
    const elapsed = await waiting;
    console.log(`Signal after an import of 3 rows: ${elapsed} ms`);
    expect(elapsed).toBeLessThan(SIGNAL_LIMIT_MS);
    // Not one for each row and its status.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(listener.received()).toBe(1);
  });

  it('doesn\'t let visitors or strangers listen', async () => {
    const asVisitor = await join(newClient());
    expect(asVisitor.status).not.toBe('SUBSCRIBED');
    const asStranger = await join(strangerClient);
    expect(asStranger.status).not.toBe('SUBSCRIBED');
  });

  it('doesn\'t let a member send signals of their own', async () => {
    const channel = encoderClient.channel('map-changes', { config: { private: true } });
    await new Promise((resolve) => channel.subscribe((state) => state === 'SUBSCRIBED' && resolve(null)));
    const result = await channel.httpSend('changed', { table: 'forged' }).catch((error: Error) => ({ success: false, error: error.message }));
    expect(result.success).toBe(false);
  });
});
