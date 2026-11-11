// Saved views and the audit log page against the real migrations: what each role can do, through the
// Supabase store and straight at the database, and local mode doing the same.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as localAdmin from '../src/modules/intervention-map/data/local-admin';
import * as engine from '../src/modules/intervention-map/data/local-engine';
import { ValidationError, type DataStore } from '../src/modules/intervention-map/data/store';
import { createSupabaseStore } from '../src/modules/intervention-map/data/supabase-store';
import type { AuditEntry, MapData } from '../src/modules/intervention-map/data/types';
import { auditDetails, auditTarget } from '../src/modules/intervention-map/lib/audit-display';
import { createTestDb } from './helpers/db';
import { createPgliteBackend } from './helpers/pglite-backend';

const ADMIN = 'e0000000-0000-4000-8000-000000000001';
const ENCODER = 'e0000000-0000-4000-8000-000000000002';
const VIEWER = 'e0000000-0000-4000-8000-000000000003';
const NO_PROFILE = 'e0000000-0000-4000-8000-000000000004';
const SECOND_ADMIN = 'e0000000-0000-4000-8000-000000000005';

let db: PGlite;
let admin: DataStore;
let encoder: DataStore;
let viewer: DataStore;
let data: MapData;

const storeFor = (id: string, role: 'admin' | 'encoder' | 'viewer') => createSupabaseStore(createPgliteBackend(db, id), { id, full_name: role, role });

// Always rolled back, so a case can't affect the next one.
async function attempt(account: string, sql: string, params: unknown[] = []) {
  await db.exec('begin');
  try {
    await db.exec(account ? 'set local role authenticated' : 'set local role anon');
    await db.query(`select set_config('request.jwt.sub', $1, true)`, [account]);
    const result = await db.query<Record<string, unknown>>(sql, params);
    return { ok: true, rows: result.rows, affected: result.affectedRows ?? 0, code: undefined as string | undefined, message: undefined as string | undefined };
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return { ok: false, rows: [], affected: 0, code: failure.code, message: failure.message };
  } finally {
    await db.exec('rollback');
  }
}

const viewNamed = async (store: DataStore, name: string) => (await store.load()).savedViews.find((view) => view.name === name);
const CONFIG = { basemap: 'osm', layers: {}, filters: {}, style: {}, extent: null };

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [ADMIN, ENCODER, VIEWER, NO_PROFILE, SECOND_ADMIN]) await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(
    `insert into profiles (id, full_name, role) values ($1, 'Ana Admin', 'admin'), ($2, 'Enzo Encoder', 'encoder'), ($3, 'Vera Viewer', 'viewer'), ($4, 'Abe Admin', 'admin')`,
    [ADMIN, ENCODER, VIEWER, SECOND_ADMIN],
  );
  admin = storeFor(ADMIN, 'admin');
  encoder = storeFor(ENCODER, 'encoder');
  viewer = storeFor(VIEWER, 'viewer');
  data = await admin.load();
  await encoder.load();
  await viewer.load();
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe('a saved view', () => {
  it('can be kept by anyone with a role, including a Viewer, and stays private', async () => {
    await viewer.saveView(null, { name: 'Vera private', config: CONFIG, is_shared: false });
    const mine = await viewNamed(viewer, 'Vera private');
    expect(mine).toMatchObject({ owner_id: VIEWER, is_shared: false, is_default: false, config: CONFIG });
    expect(await viewNamed(encoder, 'Vera private')).toBeUndefined();
    expect(await viewNamed(admin, 'Vera private')).toBeUndefined();
  });

  it('can be shared with everyone, and taken back', async () => {
    await encoder.saveView(null, { name: 'Enzo shared', config: CONFIG, is_shared: true });
    expect(await viewNamed(viewer, 'Enzo shared')).toBeDefined();
    expect(await viewNamed(admin, 'Enzo shared')).toBeDefined();

    const view = (await viewNamed(encoder, 'Enzo shared'))!;
    await encoder.saveView(view.id, { is_shared: false });
    expect(await viewNamed(viewer, 'Enzo shared')).toBeUndefined();
    await encoder.saveView(view.id, { is_shared: true });
  });

  it('can be updated and deleted only by its owner, whoever can see it', async () => {
    const view = (await viewNamed(viewer, 'Enzo shared'))!;
    await expect(viewer.saveView(view.id, { name: 'Taken over' })).rejects.toThrow();
    await expect(viewer.deleteView(view.id)).rejects.toThrow();
    expect((await attempt(VIEWER, `update public.saved_views set name = 'x' where id = $1`, [view.id])).affected).toBe(0);
    expect((await attempt(VIEWER, 'delete from public.saved_views where id = $1', [view.id])).affected).toBe(0);
    expect((await attempt(ENCODER, `update public.saved_views set name = 'Renamed' where id = $1`, [view.id])).affected).toBe(1);
  });

  it('can\'t be made in someone else\'s name, or by someone with no role', async () => {
    const forged = await attempt(VIEWER, `insert into public.saved_views (name, config, owner_id) values ('Forged', '{}', $1)`, [ADMIN]);
    expect(forged.ok).toBe(false);
    expect((await attempt(NO_PROFILE, `insert into public.saved_views (name, config) values ('Stranger', '{}')`)).ok).toBe(false);
    expect((await attempt('', `insert into public.saved_views (name, config) values ('Visitor', '{}')`)).ok).toBe(false);
    expect((await attempt('', 'select * from public.saved_views')).ok).toBe(false);
  });

  it('needs a name and proper settings', async () => {
    await expect(viewer.saveView(null, { name: '   ', config: CONFIG, is_shared: false })).rejects.toThrow(ValidationError);
    expect((await attempt(VIEWER, `insert into public.saved_views (name, config) values ('   ', '{}')`)).message).toMatch(/needs a name/);
    expect((await attempt(VIEWER, `insert into public.saved_views (name, config) values ('Bad', '[]')`)).message).toMatch(/not valid/);
  });

  it('keeps one person\'s names apart, but two people can use the same one', async () => {
    await expect(viewer.saveView(null, { name: ' vera PRIVATE ', config: CONFIG, is_shared: false })).rejects.toThrow(/already/);
    expect((await attempt(VIEWER, `insert into public.saved_views (name, config) values ('VERA private', '{}')`)).code).toBe('23505');
    expect((await attempt(ENCODER, `insert into public.saved_views (name, config) values ('Vera private', '{}')`)).ok).toBe(true);
  });

  it('trims its name, and the database keeps track of when it changed', async () => {
    await encoder.saveView(null, { name: '  Trimmed  ', config: CONFIG, is_shared: false });
    const saved = (await viewNamed(encoder, 'Trimmed'))!;
    expect(saved.name).toBe('Trimmed');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await encoder.saveView(saved.id, { config: { ...CONFIG, basemap: 'topo' } });
    const updated = (await viewNamed(encoder, 'Trimmed'))!;
    expect(updated.updated_at > saved.updated_at).toBe(true);
    expect(updated.config).toMatchObject({ basemap: 'topo' });
    await encoder.deleteView(saved.id);
  });

  it('goes in the audit log under its owner\'s name', async () => {
    const view = (await viewNamed(encoder, 'Renamed')) ?? (await viewNamed(encoder, 'Enzo shared'))!;
    const { rows } = await db.query<{ actor_id: string; action: string }>(`select actor_id, action from public.audit_log where table_name = 'saved_views' and record_id = $1 order by id limit 1`, [view.id]);
    expect(rows[0]).toEqual({ actor_id: ENCODER, action: 'insert' });
  });
});

describe('the default view', () => {
  let first: string;
  let second: string;
  let personal: string;
  const defaults = async () => (await admin.load()).savedViews.filter((view) => view.is_default).map((view) => view.id);

  beforeAll(async () => {
    await admin.saveView(null, { name: 'First default', config: CONFIG, is_shared: true });
    await encoder.saveView(null, { name: 'Second default', config: CONFIG, is_shared: true });
    await admin.saveView(null, { name: 'Admin private', config: CONFIG, is_shared: false });
    first = (await viewNamed(admin, 'First default'))!.id;
    second = (await viewNamed(admin, 'Second default'))!.id;
    personal = (await viewNamed(admin, 'Admin private'))!.id;
  });

  it('is chosen by an Admin, from anyone\'s shared views, and there\'s only ever one', async () => {
    await admin.setDefaultView(first);
    expect(await defaults()).toEqual([first]);
    await admin.setDefaultView(second);
    expect(await defaults()).toEqual([second]);
    expect((await viewNamed(viewer, 'Second default'))?.is_default).toBe(true);
    expect((await viewNamed(viewer, 'First default'))?.is_default).toBe(false);
  });

  it('can\'t be chosen by anyone else, whatever they try', async () => {
    await expect(viewer.setDefaultView(first)).rejects.toThrow();
    await expect(encoder.setDefaultView(first)).rejects.toThrow();
    expect((await attempt(VIEWER, 'select public.set_default_view($1)', [first])).code).toBe('42501');
    expect((await attempt(NO_PROFILE, 'select public.set_default_view($1)', [first])).code).toBe('42501');
    expect((await attempt('', 'select public.set_default_view($1)', [first])).ok).toBe(false);
    // Not even the view's owner, and not by writing the column.
    expect((await attempt(ENCODER, 'update public.saved_views set is_default = true where id = $1', [second])).code).toBe('42501');
    expect((await attempt(ADMIN, 'update public.saved_views set is_default = true where id = $1', [first])).code).toBe('42501');
    expect((await attempt(ENCODER, `insert into public.saved_views (name, config, is_default) values ('Sneaky', '{}', true)`)).code).toBe('42501');
    expect(await defaults()).toEqual([second]);
  });

  it('has to be shared', async () => {
    await expect(admin.setDefaultView(personal)).rejects.toThrow(/shared/);
    expect(await defaults()).toEqual([second]);
  });

  it('can\'t stop being shared while it\'s the default', async () => {
    expect((await attempt(ENCODER, 'update public.saved_views set is_shared = false where id = $1', [second])).message).toMatch(/stay shared/);
    // This browser doesn't know yet that it was chosen, so the database has to be the one to refuse.
    await expect(encoder.saveView(second, { is_shared: false })).rejects.toThrow(/default/);
    // Once it knows, it says so in plain words, before trying.
    await encoder.load();
    await expect(encoder.saveView(second, { is_shared: false })).rejects.toThrow(ValidationError);
    expect((await viewNamed(viewer, 'Second default'))?.is_shared).toBe(true);
  });

  it('can be cleared, so everyone opens on the usual map', async () => {
    await admin.setDefaultView(null);
    expect(await defaults()).toEqual([]);
    await admin.setDefaultView(second);
  });

  it('goes in the audit log under the Admin\'s name', async () => {
    const { rows } = await db.query<{ actor_id: string }>(`select actor_id from public.audit_log where table_name = 'saved_views' and record_id = $1 and new_row ->> 'is_default' = 'true' order by id desc limit 1`, [second]);
    expect(rows[0].actor_id).toBe(ADMIN);
  });

  it('an Admin can take down anyone\'s shared view, including the default, but not a personal one', async () => {
    await viewer.saveView(null, { name: 'Vera shared', config: CONFIG, is_shared: true });
    const shared = (await viewNamed(admin, 'Vera shared'))!;
    await expect(encoder.deleteView(shared.id)).rejects.toThrow();
    await admin.deleteView(shared.id);
    expect(await viewNamed(viewer, 'Vera shared')).toBeUndefined();

    const privateView = (await viewNamed(viewer, 'Vera private'))!;
    expect((await attempt(ADMIN, 'delete from public.saved_views where id = $1', [privateView.id])).affected).toBe(0);

    await admin.deleteView(second);
    expect(await defaults()).toEqual([]);
  });

  it('another Admin can change it too', async () => {
    const other = storeFor(SECOND_ADMIN, 'admin');
    await other.load();
    await other.setDefaultView(first);
    expect(await defaults()).toEqual([first]);
    await other.setDefaultView(null);
  });
});

describe('the audit log page', () => {
  let recordId: string;
  let otherRecordId: string;

  beforeAll(async () => {
    const fresh = await encoder.load();
    const machinery = fresh.types.find((type) => type.code === 'farm-machinery')!;
    const barangay = fresh.barangays.find((candidate) => candidate.name === 'Bantad')!;
    const values = {
      intervention_type_id: machinery.id,
      category_id: fresh.categories.find((category) => category.intervention_type_id === machinery.id)!.id,
      title: null,
      banner_program_id: fresh.programs[0].id,
      year_funded: 2024,
      quantity: 1,
      unit_cost: null,
      fund_source: null,
      beneficiary: 'Audit test FCA',
      beneficiary_type_id: null,
      municipality_id: barangay.municipality_id,
      barangay_id: barangay.id,
      location_basis_id: null,
      point: null,
      attributes: {},
      remarks: null,
    };
    const statusId = fresh.typeStatuses.find((entry) => entry.intervention_type_id === machinery.id)!.status_id;
    const status = { status_id: statusId, status_date: '2024-01-01', remarks: null };
    const record = await encoder.createIntervention(values, status, { kind: 'create' });
    recordId = record.id;
    await encoder.load();
    const updated = await encoder.updateIntervention(record.id, record.version, { remarks: 'Checked' }, { kind: 'edit', reason: 'Visited the site' });
    await encoder.addStatus(record.id, { ...status, status_date: '2024-02-01' }, { kind: 'status' });

    const other = await admin.createIntervention({ ...values, beneficiary: 'Other test FCA' }, status, { kind: 'create' });
    otherRecordId = other.id;
    await admin.load();
    await admin.softDeleteIntervention(other.id, other.version, { kind: 'delete', reason: 'Duplicate' });
    await admin.load();
    expect(updated.version).toBeGreaterThan(record.version);
  });

  const page = (over = {}) => admin.auditLog({ page: 0, pageSize: 200, ...over });

  it('is for Admins only, whatever anyone tries', async () => {
    await expect(encoder.auditLog({ page: 0, pageSize: 10 })).rejects.toThrow();
    await expect(viewer.auditLog({ page: 0, pageSize: 10 })).rejects.toThrow();
    for (const account of [ENCODER, VIEWER, NO_PROFILE]) {
      expect((await attempt(account, 'select public.audit_log_page()')).code).toBe('42501');
      expect((await attempt(account, 'select * from public.audit_log')).rows).toEqual([]);
    }
    expect((await attempt('', 'select public.audit_log_page()')).ok).toBe(false);
    expect((await attempt('', 'select * from public.audit_log')).ok).toBe(false);
  });

  it('can\'t be written to by anyone', async () => {
    expect((await attempt(ADMIN, `insert into public.audit_log (table_name, action) values ('x', 'update')`)).code).toBe('42501');
    expect((await attempt(ADMIN, 'delete from public.audit_log')).code).toBe('42501');
    expect((await attempt(ADMIN, `update public.audit_log set table_name = 'x'`)).code).toBe('42501');
  });

  it('lists the newest first, naming who did it and why', async () => {
    const { entries, total } = await page({ recordIds: [recordId] });
    expect(total).toBe(entries.length);
    const times = entries.map((entry) => entry.at);
    expect([...times].sort().reverse()).toEqual(times);
    const edit = entries.find((entry) => entry.action === 'update' && entry.table_name === 'interventions')!;
    expect(edit.actor_id).toBe(ENCODER);
    expect(edit.actor_name).toBe('Enzo Encoder');
    expect(edit.context).toMatchObject({ kind: 'edit', reason: 'Visited the site' });
  });

  it('leaves the raw source row out', async () => {
    const { entries } = await page({});
    expect(entries.some((entry) => entry.new_row !== null && 'source_raw' in entry.new_row)).toBe(false);
  });

  it('filters by record, including its status entries', async () => {
    const { entries } = await page({ recordIds: [recordId] });
    expect(new Set(entries.map((entry) => entry.table_name))).toEqual(new Set(['interventions', 'status_history']));
    for (const entry of entries) {
      const owner = entry.table_name === 'interventions' ? entry.record_id : (entry.new_row ?? entry.old_row)?.intervention_id;
      expect(owner).toBe(recordId);
    }
    expect((await page({ recordIds: [] })).total).toBe(0);
    const both = await page({ recordIds: [recordId, otherRecordId] });
    expect(both.total).toBeGreaterThan(entries.length);
  });

  it('filters by person, and by changes with no login behind them', async () => {
    const byAdmin = await page({ actorId: ADMIN });
    expect(byAdmin.entries.length).toBeGreaterThan(0);
    expect(new Set(byAdmin.entries.map((entry) => entry.actor_id))).toEqual(new Set([ADMIN]));

    await db.query(`update public.programs set sort_order = sort_order where code = 'rice'`);
    const noLogin = await page({ noActor: true });
    expect(noLogin.entries.length).toBeGreaterThan(0);
    expect(new Set(noLogin.entries.map((entry) => entry.actor_id))).toEqual(new Set([null]));
  });

  it('filters by action', async () => {
    const deleted = await page({ action: 'soft_delete' });
    expect(deleted.total).toBe(1);
    expect(deleted.entries[0].record_id).toBe(otherRecordId);
    expect(deleted.entries[0].context).toMatchObject({ reason: 'Duplicate' });
    expect((await page({ action: 'restore' })).total).toBe(0);
  });

  it('filters by date, as whole Philippine days', async () => {
    const { rows } = await db.query<{ id: string }>(`insert into public.audit_log (table_name, action, at) values ('programs', 'update', '2020-06-15T16:30:00Z'), ('programs', 'update', '2020-06-15T15:30:00Z') returning id`);
    expect(rows).toHaveLength(2);
    // 16:30 UTC is already the 16th in Manila, and 15:30 UTC is still the 15th.
    const the16th = await page({ from: '2020-06-16', to: '2020-06-16' });
    expect(the16th.total).toBe(1);
    expect(the16th.entries[0].at).toContain('2020-06-15T16:30');
    const the15th = await page({ from: '2020-06-15', to: '2020-06-15' });
    expect(the15th.total).toBe(1);
    expect(the15th.entries[0].at).toContain('2020-06-15T15:30');
    expect((await page({ from: '2020-06-15', to: '2020-06-16' })).total).toBe(2);
    expect((await page({ to: '2020-06-14' })).total).toBe(0);
    expect((await page({ from: '2099-01-01' })).total).toBe(0);
  });

  it('goes a page at a time, with the same total, and won\'t hand over the whole log at once', async () => {
    const all = await page({});
    expect(all.total).toBeGreaterThan(3);
    const firstPage = await admin.auditLog({ page: 0, pageSize: 2 });
    const secondPage = await admin.auditLog({ page: 1, pageSize: 2 });
    expect(firstPage.total).toBe(all.total);
    expect(firstPage.entries).toHaveLength(2);
    expect(secondPage.entries[0].id).not.toBe(firstPage.entries[0].id);
    expect(secondPage.entries[0].id).toBe(all.entries[2].id);

    // More lines than one page may hold, added and taken away again.
    await db.exec('begin');
    try {
      await db.exec(`insert into public.audit_log (table_name, action) select 'programs', 'update' from generate_series(1, 250)`);
      await db.exec('set local role authenticated');
      await db.query(`select set_config('request.jwt.sub', $1, true)`, [ADMIN]);
      const { rows } = await db.query<{ count: number; total: number }>(`select jsonb_array_length(public.audit_log_page(p_limit => 100000) -> 'entries') as count, (public.audit_log_page(p_limit => 1) ->> 'total')::int as total`);
      expect(rows[0].total).toBeGreaterThan(250);
      expect(Number(rows[0].count)).toBe(200);
    } finally {
      await db.exec('rollback');
    }
  });

  it('says what each line is about, with a link to it', async () => {
    const fresh = await admin.load();
    const { entries } = await page({ recordIds: [recordId] });
    const edit = entries.find((entry) => entry.action === 'update' && entry.table_name === 'interventions')!;
    expect(auditTarget(edit, fresh)).toMatchObject({ link: `/map/records/${recordId}` });
    expect(auditTarget(edit, fresh).label).toContain('Audit test FCA');
    expect(auditDetails(edit, fresh)).toEqual(['Remarks: (none) → Checked']);
    const status = entries.find((entry) => entry.table_name === 'status_history')!;
    expect(auditTarget(status, fresh).link).toBe(`/map/records/${recordId}`);
    expect(auditDetails(status, fresh)[0]).toMatch(/^Status set to /);

    const deleted = (await page({ action: 'soft_delete' })).entries[0];
    expect(auditTarget(deleted, fresh).link).toBe(`/map/records/${otherRecordId}`);
  });
});

describe('what a line of the log says about other things', () => {
  const entry = (over: Partial<AuditEntry>): AuditEntry => ({ id: 1, table_name: 'programs', record_id: '1', action: 'update', old_row: null, new_row: null, actor_id: null, context: null, at: '2026-01-01T00:00:00Z', ...over });

  it('links each kind to where it\'s managed', () => {
    const named = { name: 'Rice' };
    expect(auditTarget(entry({ new_row: named }), data)).toEqual({ label: 'Program: Rice', link: '/admin/programs' });
    expect(auditTarget(entry({ table_name: 'statuses', new_row: named }), data).link).toBe('/admin/statuses');
    expect(auditTarget(entry({ table_name: 'icons', new_row: named }), data).link).toBe('/admin/lists');
    expect(auditTarget(entry({ table_name: 'intervention_types', record_id: '2', new_row: named }), data)).toEqual({ label: 'Type: Rice', link: '/admin/types/2' });
    expect(auditTarget(entry({ table_name: 'profiles', new_row: { full_name: 'Ana' } }), data)).toEqual({ label: 'Person: Ana', link: '/admin/users' });
    expect(auditTarget(entry({ table_name: 'barangay_field_schema' }), data).link).toBe('/admin/barangay-fields');
    expect(auditTarget(entry({ table_name: 'saved_views', new_row: named }), data)).toEqual({ label: 'Saved view: Rice', link: null });
    expect(auditTarget(entry({ table_name: 'exports', action: 'export', record_id: null, context: { file_name: 'Marinduque.kmz' } }), data)).toEqual({ label: 'Export: Marinduque.kmz', link: null });
    const barangay = data.barangays[0];
    expect(auditTarget(entry({ table_name: 'barangays', record_id: String(barangay.id) }), data)).toEqual({ label: `Barangay ${barangay.name}`, link: `/map/barangays/${barangay.id}` });
  });

  it('copes with a record that\'s gone, and one it knows nothing about', () => {
    expect(auditTarget(entry({ table_name: 'interventions', record_id: 'gone', old_row: { beneficiary: 'Old FCA' }, action: 'delete' }), data)).toEqual({ label: 'Old FCA', link: '/map/records/gone' });
    expect(auditTarget(entry({ table_name: 'something_new' }), data)).toEqual({ label: 'something new', link: null });
  });

  it('gives what changed, leaving out bookkeeping', () => {
    const lines = auditDetails(entry({ table_name: 'profiles', old_row: { role: 'viewer', version: 1, updated_at: 'a', deactivated_at: null }, new_row: { role: 'encoder', version: 2, updated_at: 'b', deactivated_at: '2026-01-01' } }), data);
    expect(lines).toEqual(['role: viewer → encoder', 'deactivated at: (none) → 2026-01-01']);
    expect(auditDetails(entry({ table_name: 'intervention_types', old_row: { field_schema: { fields: [] } }, new_row: { field_schema: { fields: [1] } } }), data)).toEqual(['field schema changed']);
    expect(auditDetails(entry({ table_name: 'exports', action: 'export', context: { format: 'kmz', record_count: 2 } }), data)).toEqual(['KMZ, 2 records']);
    expect(auditDetails(entry({ action: 'insert', new_row: { name: 'New' } }), data)).toEqual([]);
  });
});

describe('local mode does the same', () => {
  const context = (at = '2026-11-07T00:00:00.000Z') => {
    let next = 0;
    return { now: () => at, newId: () => `view-${++next}` } as unknown as engine.EngineContext;
  };
  const rows = () => ({ interventions: [], links: [], statusHistory: [], barangays: [], photos: [], auditLog: [], changeCount: 0 }) as engine.LocalRows;

  it('keeps views, with the same rules, and logs them', () => {
    const state = rows();
    localAdmin.saveView(state, context(), 'me', null, { name: ' Rice ', config: CONFIG, is_shared: false });
    const view = state.savedViews![0];
    expect(view).toMatchObject({ name: 'Rice', owner_id: 'me', is_shared: false, is_default: false });
    expect(state.auditLog.at(-1)).toMatchObject({ table_name: 'saved_views', action: 'insert' });

    expect(() => localAdmin.saveView(state, context(), 'me', null, { name: 'rice', config: CONFIG })).toThrow(ValidationError);
    expect(() => localAdmin.saveView(state, context(), 'me', null, { name: ' ', config: CONFIG })).toThrow(ValidationError);
    expect(() => localAdmin.saveView(state, context(), 'me', 'missing', { name: 'x' })).toThrow();

    localAdmin.saveView(state, context('2026-11-08T00:00:00.000Z'), 'me', view.id, { config: { basemap: 'topo' } });
    expect(view.config).toEqual({ basemap: 'topo' });
    expect(view.updated_at).toBe('2026-11-08T00:00:00.000Z');
  });

  it('copes with a saved state from before views existed', () => {
    const state = rows();
    expect(state.savedViews).toBeUndefined();
    expect(() => localAdmin.setDefaultView(state, context(), null)).not.toThrow();
    expect(() => localAdmin.deleteView(state, context(), 'missing')).toThrow();
    localAdmin.saveView(state, context(), 'me', null, { name: 'First', config: CONFIG });
    expect(state.savedViews).toHaveLength(1);
  });

  it('has one default, which must be shared and stay shared', () => {
    const state = rows();
    const ctx = context();
    localAdmin.saveView(state, ctx, 'me', null, { name: 'One', config: CONFIG, is_shared: true });
    localAdmin.saveView(state, ctx, 'me', null, { name: 'Two', config: CONFIG, is_shared: true });
    localAdmin.saveView(state, ctx, 'me', null, { name: 'Private', config: CONFIG, is_shared: false });
    const [one, two, personal] = state.savedViews!;

    expect(() => localAdmin.setDefaultView(state, ctx, personal.id)).toThrow(ValidationError);
    localAdmin.setDefaultView(state, ctx, one.id);
    localAdmin.setDefaultView(state, ctx, two.id);
    expect(state.savedViews!.filter((view) => view.is_default).map((view) => view.id)).toEqual([two.id]);
    expect(() => localAdmin.saveView(state, ctx, 'me', two.id, { is_shared: false })).toThrow(ValidationError);

    localAdmin.setDefaultView(state, ctx, null);
    expect(state.savedViews!.some((view) => view.is_default)).toBe(false);

    localAdmin.deleteView(state, ctx, one.id);
    expect(state.savedViews!.map((view) => view.id)).toEqual([two.id, personal.id]);
    expect(state.auditLog.at(-1)).toMatchObject({ action: 'delete', record_id: one.id });
  });

  it('reads the log by the same rules as the database', () => {
    const line = (over: Partial<AuditEntry>): AuditEntry => ({ id: 1, table_name: 'interventions', record_id: 'r1', action: 'update', old_row: null, new_row: null, actor_id: null, context: null, at: '2026-01-01T00:00:00Z', ...over });
    const log = [
      line({ id: 1, record_id: 'r1', at: '2020-06-15T15:30:00Z' }),
      line({ id: 2, record_id: 'r2', at: '2020-06-15T16:30:00Z', action: 'soft_delete' }),
      line({ id: 3, table_name: 'status_history', record_id: 's1', new_row: { intervention_id: 'r1' }, at: '2020-06-17T00:00:00Z', action: 'insert' }),
      line({ id: 4, table_name: 'programs', record_id: '1', at: '2020-06-18T00:00:00Z', actor_id: 'someone' }),
    ];
    const ids = (query: Partial<Parameters<typeof engine.auditPage>[1]>) => engine.auditPage(log, { page: 0, pageSize: 50, ...query }).entries.map((entry) => entry.id);

    expect(ids({})).toEqual([4, 3, 2, 1]);
    expect(ids({ recordIds: ['r1'] })).toEqual([3, 1]);
    expect(ids({ recordIds: [] })).toEqual([]);
    expect(ids({ action: 'soft_delete' })).toEqual([2]);
    expect(ids({ actorId: 'someone' })).toEqual([4]);
    expect(ids({ noActor: true })).toEqual([3, 2, 1]);
    expect(ids({ from: '2020-06-16', to: '2020-06-16' })).toEqual([2]);
    expect(ids({ from: '2020-06-15', to: '2020-06-15' })).toEqual([1]);
    expect(engine.auditPage(log, { page: 1, pageSize: 2 })).toMatchObject({ total: 4, entries: [{ id: 2 }, { id: 1 }] });
  });
});
