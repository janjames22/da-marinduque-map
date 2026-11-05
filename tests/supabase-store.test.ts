// The Supabase store against the real database functions, as each role, and step by step against
// local mode. Screens only know the DataStore interface, so the two have to behave the same.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLocalSeed } from '../scripts/build-local-seed';
import { loadSeedFiles, seedInterventions } from '../scripts/seed-interventions';
import * as engine from '../src/modules/intervention-map/data/local-engine';
import { stateFromSeed, type LocalSeed, type LocalState } from '../src/modules/intervention-map/data/local-store';
import { ConflictError, ValidationError, type DataStore, type InterventionValues, type NewStatus } from '../src/modules/intervention-map/data/store';
import { createSupabaseStore, friendlyError, BackendError, photoFileType } from '../src/modules/intervention-map/data/supabase-store';
import type { Barangay, Intervention, MapData } from '../src/modules/intervention-map/data/types';
import { buildPlaceIndex, type PlaceIndex } from '../src/modules/intervention-map/lib/qa';
import { createTestDb } from './helpers/db';
import { createPgliteBackend, type PgliteBackend } from './helpers/pglite-backend';

const ADMIN = 'e0000000-0000-4000-8000-000000000001';
const ENCODER = 'e0000000-0000-4000-8000-000000000002';
const VIEWER = 'e0000000-0000-4000-8000-000000000003';

const boundary = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'boundaries', `${name}.geojson`), 'utf8')) as GeoJSON.FeatureCollection;

let db: PGlite;
let places: PlaceIndex;
let local: LocalState;
let encoderBackend: PgliteBackend;
let encoder: DataStore;
let admin: DataStore;
let viewer: DataStore;
let data: MapData;

const storeFor = (id: string, role: 'admin' | 'encoder' | 'viewer', name: string) => {
  const backend = createPgliteBackend(db, id);
  return { backend, store: createSupabaseStore(backend, { id, full_name: name, role }) };
};

beforeAll(async () => {
  db = await createTestDb();
  const { rows } = loadSeedFiles();
  await seedInterventions(db, rows, []);

  const seed = (await buildLocalSeed(db)) as unknown as LocalSeed;
  local = stateFromSeed(JSON.parse(JSON.stringify(seed)) as LocalSeed, 'test');
  places = buildPlaceIndex(
    { barangays: boundary('barangays'), municipalities: boundary('municipalities') },
    { barangays: local.rows.barangays, municipalities: local.fixed.municipalities },
  );

  for (const id of [ADMIN, ENCODER, VIEWER]) await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(
    `insert into profiles (id, full_name, role) values ($1, 'Ana Admin', 'admin'), ($2, 'Enzo Encoder', 'encoder'), ($3, 'Vera Viewer', 'viewer')`,
    [ADMIN, ENCODER, VIEWER],
  );

  const encoderParts = storeFor(ENCODER, 'encoder', 'Enzo Encoder');
  encoderBackend = encoderParts.backend;
  encoder = encoderParts.store;
  admin = storeFor(ADMIN, 'admin', 'Ana Admin').store;
  viewer = storeFor(VIEWER, 'viewer', 'Vera Viewer').store;
  data = await encoder.load();
  await admin.load();
  await viewer.load();
}, 180_000);

afterAll(async () => {
  await db.close();
});

const machinery = () => data.types.find((t) => t.code === 'farm-machinery')!;
const firstBarangay = () => data.barangays.find((b) => b.name === 'Bantad')!;
const statusNamed = (name: string) => data.statuses.find((s) => s.name === name)!.id;

const newValues = (changes: Partial<InterventionValues> = {}): InterventionValues => ({
  intervention_type_id: machinery().id,
  category_id: data.categories.find((c) => c.intervention_type_id === machinery().id)!.id,
  title: null,
  banner_program_id: data.programs.find((p) => p.code === 'rice')!.id,
  year_funded: 2024,
  quantity: 1,
  unit_cost: null,
  fund_source: null,
  beneficiary: 'Store Test FCA',
  beneficiary_type_id: null,
  municipality_id: firstBarangay().municipality_id,
  barangay_id: firstBarangay().id,
  location_basis_id: null,
  point: { lat: 13.45, lng: 121.85 },
  attributes: {},
  remarks: null,
  ...changes,
});

const newStatus = (changes: Partial<NewStatus> = {}): NewStatus => ({
  status_id: statusNamed('Turned-over'),
  status_date: '2024-05-01',
  remarks: null,
  ...changes,
});

function fakeJpeg(name = 'field.jpg', type = 'image/jpeg'): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, { type });
}

describe('loading', () => {
  it('gets everything the map needs, for any member', async () => {
    expect(data.interventions).toHaveLength(199);
    expect(data.barangays).toHaveLength(218);
    expect(data.municipalities).toHaveLength(6);
    expect(data.statusHistory).toHaveLength(199);
    expect(data.links.length).toBeGreaterThan(150);
    expect(data.dataSources).toEqual(['RAED 2026-10-21']);
    expect(data.barangayFields.fields.length).toBe(5);
    expect(data.members).toContainEqual({ id: VIEWER, full_name: 'Vera Viewer' });

    const viewed = await viewer.load();
    expect(viewed.interventions).toHaveLength(199);
  });

  it('gets the same records as the local seed, with the same flags', () => {
    const localById = new Map(local.rows.interventions.map((r) => [r.id, r]));
    for (const record of data.interventions) {
      const other = localById.get(record.id)!;
      expect(record.qa_flags).toEqual(other.qa_flags);
      expect(record.geojson).toEqual(other.geojson);
      expect(record.plotted_barangay_id).toBe(other.plotted_barangay_id);
      expect(record.status_id).toBe(other.status_id);
    }
  });

  it('leaves the raw source row out of what the browser gets', () => {
    for (const record of data.interventions) {
      expect(record).not.toHaveProperty('source_raw');
      expect(record).not.toHaveProperty('geom');
    }
  });

  it('gives the same answer twice, so an unrelated change doesn\'t redraw everything', async () => {
    const again = await encoder.load();
    expect(JSON.stringify(again)).toBe(JSON.stringify(data));
  });
});

describe('the same steps as local mode', () => {
  function engineContext(state: LocalState, clock: () => string): engine.EngineContext {
    let next = 0;
    return {
      types: state.fixed.types,
      categories: state.fixed.categories,
      typeStatuses: state.fixed.typeStatuses,
      municipalities: state.fixed.municipalities,
      barangayFields: state.fixed.barangayFields,
      places,
      now: clock,
      newId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
    };
  }

  const comparable = (record: Intervention) => ({
    qa_flags: [...record.qa_flags].sort(),
    version: record.version,
    status_id: record.status_id,
    barangay_id: record.barangay_id,
    municipality_id: record.municipality_id,
    geojson: record.geojson,
    plotted_barangay_id: record.plotted_barangay_id,
    plotted_barangay: record.plotted_barangay,
    plotted_municipality: record.plotted_municipality,
    beneficiary: record.beneficiary,
    remarks: record.remarks,
    attributes: record.attributes,
    deleted_at: record.deleted_at === null ? null : 'deleted',
    data_source: record.data_source,
  });

  it('agrees at every step of a record\'s life, and in its history', async () => {
    const state = JSON.parse(JSON.stringify(local)) as LocalState;
    let tick = 0;
    const context = engineContext(state, () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString());
    const barangay = firstBarangay();
    const elsewhere = data.barangays.find((b) => b.municipality_id !== barangay.municipality_id)!;

    const values = newValues({ beneficiary: 'Parity FCA' });
    const onlineCreated = await encoder.createIntervention(values, newStatus(), { kind: 'create' });
    const localCreated = engine.createIntervention(state.rows, context, values, { kind: 'create' });
    engine.addStatus(state.rows, context, localCreated.id, newStatus(), { kind: 'create' });
    expect(comparable(onlineCreated)).toEqual(comparable(localCreated));

    await encoder.load(); // what the app does after every signal

    const steps: { label: string; online: (r: Intervention) => Promise<Intervention>; offline: (r: Intervention) => Intervention }[] = [
      {
        label: 'edit a field',
        online: (r) => encoder.updateIntervention(r.id, r.version, { remarks: 'Checked' }, { kind: 'edit' }),
        offline: (r) => engine.updateIntervention(state.rows, context, r.id, r.version, { remarks: 'Checked' }, { kind: 'edit' }),
      },
      {
        label: 'move far from the barangay',
        online: (r) => encoder.updateIntervention(r.id, r.version, { point: { lat: 13.25, lng: 121.95 } }, { kind: 'move' }),
        offline: (r) => engine.updateIntervention(state.rows, context, r.id, r.version, { point: { lat: 13.25, lng: 121.95 } }, { kind: 'move' }),
      },
      {
        label: 'move outside the province',
        online: (r) => encoder.updateIntervention(r.id, r.version, { point: { lat: 14.5, lng: 121 } }, { kind: 'move' }),
        offline: (r) => engine.updateIntervention(state.rows, context, r.id, r.version, { point: { lat: 14.5, lng: 121 } }, { kind: 'move' }),
      },
      {
        label: 'remove the coordinates',
        online: (r) => encoder.updateIntervention(r.id, r.version, { point: null }, { kind: 'resolve', reason: 'Bad GPS' }),
        offline: (r) => engine.updateIntervention(state.rows, context, r.id, r.version, { point: null }, { kind: 'resolve', reason: 'Bad GPS' }),
      },
      {
        label: 'change place',
        online: (r) => encoder.updateIntervention(r.id, r.version, { municipality_id: elsewhere.municipality_id, barangay_id: elsewhere.id }, { kind: 'edit' }),
        offline: (r) => engine.updateIntervention(state.rows, context, r.id, r.version, { municipality_id: elsewhere.municipality_id, barangay_id: elsewhere.id }, { kind: 'edit' }),
      },
      {
        label: 'soft delete',
        online: (r) => encoder.softDeleteIntervention(r.id, r.version, { kind: 'delete' }),
        offline: (r) => engine.softDeleteIntervention(state.rows, context, r.id, r.version, { kind: 'delete' }),
      },
      {
        label: 'restore',
        online: (r) => admin.restoreIntervention(r.id, r.version, { kind: 'restore' }),
        offline: (r) => engine.restoreIntervention(state.rows, context, r.id, r.version, { kind: 'restore' }),
      },
    ];

    let online = onlineCreated;
    let offline = localCreated;
    for (const step of steps) {
      online = await step.online(online);
      offline = step.offline(offline);
      expect(comparable(online), step.label).toEqual(comparable(offline));
      await encoder.load();
      await admin.load();
    }

    const history = await admin.auditFor(online.id);
    const localHistory = engine.auditForRecord(state.rows.auditLog, offline.id);
    const summary = (entries: typeof history) =>
      entries.map((entry) => ({ table: entry.table_name, action: entry.action, kind: entry.context?.kind, reason: entry.context?.reason }));
    expect(summary(history)).toEqual(summary(localHistory));

    // Location changes read the same way in the History panel.
    const moved = history.filter((entry) => entry.context?.kind === 'move');
    expect((moved[0].new_row as { geojson: GeoJSON.Point }).geojson.coordinates).toEqual([121.95, 13.25]);
  });

  it('agrees on the current status when one is backdated', async () => {
    const record = await encoder.createIntervention(newValues({ beneficiary: 'Status FCA' }), newStatus({ status_date: '2024-06-01' }));
    await encoder.addStatus(record.id, { status_id: statusNamed('Needs Repair'), status_date: '2024-03-01', remarks: null });
    await encoder.load();
    const reloaded = (await encoder.load()).interventions.find((r) => r.id === record.id)!;
    expect(reloaded.status_id).toBe(statusNamed('Turned-over'));

    await encoder.addStatus(record.id, { status_id: statusNamed('Serviceable'), status_date: '2024-07-01', remarks: 'After service' });
    const latest = (await encoder.load()).interventions.find((r) => r.id === record.id)!;
    expect(latest.status_id).toBe(statusNamed('Serviceable'));
  });
});

describe('conflicts', () => {
  it('gives the newest record, so the form can show what changed', async () => {
    const record = await encoder.createIntervention(newValues({ beneficiary: 'Conflict FCA' }), newStatus());
    await admin.load();
    await admin.updateIntervention(record.id, record.version, { remarks: 'Changed by the Admin' });

    const failure = await encoder.updateIntervention(record.id, record.version, { remarks: 'Too late' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictError);
    expect((failure as ConflictError).latest).toMatchObject({ remarks: 'Changed by the Admin', version: record.version + 1 });
  });

  it('gives no record when an Encoder\'s record was deleted', async () => {
    const record = await encoder.createIntervention(newValues({ beneficiary: 'Deleted FCA' }), newStatus());
    await encoder.softDeleteIntervention(record.id, record.version);
    const failure = await encoder.updateIntervention(record.id, record.version + 1, { remarks: 'x' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictError);
    expect((failure as ConflictError).latest).toBeNull();
  });

  it('protects a barangay baseline in the same way', async () => {
    const barangay = (await encoder.load()).barangays.find((b) => b.name === 'Bantad')!;
    const saved = await encoder.updateBarangayBaseline(barangay.id, barangay.version, { farmer_count: 10 });
    expect(saved).toMatchObject({ version: barangay.version + 1, attributes: { farmer_count: 10 } });
    expect(saved).not.toHaveProperty('boundary');

    const failure = await admin.updateBarangayBaseline(barangay.id, barangay.version, { farmer_count: 99 }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictError);
    expect(((failure as ConflictError).latest as Barangay).attributes).toEqual({ farmer_count: 10 });
  });
});

describe('rules', () => {
  it('names the exact field before reaching the database', async () => {
    const failure = await encoder.createIntervention(newValues({ beneficiary: null }), newStatus()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ValidationError);
    expect((failure as ValidationError).fields).toHaveProperty('beneficiary');

    const date = await encoder.createIntervention(newValues(), newStatus({ status_date: '2999-01-01' })).catch((error: unknown) => error);
    expect((date as ValidationError).fields).toHaveProperty('status_date');
  });

  it('still has the database refuse what the browser doesn\'t check', async () => {
    // A store with nothing loaded has no copy of the rules to check against.
    const unloaded = storeFor(ENCODER, 'encoder', 'Enzo Encoder').store;
    await expect(unloaded.createIntervention(newValues({ beneficiary: null }), newStatus())).rejects.toThrow(/beneficiary is required/);
  });
});

describe('roles through the store', () => {
  it('refuses a Viewer with a plain message, for every write', async () => {
    const record = data.interventions[0];
    const barangay = data.barangays[0];
    const denied = /doesn't have permission/;
    await expect(viewer.createIntervention(newValues(), newStatus())).rejects.toThrow(denied);
    await expect(viewer.updateIntervention(record.id, record.version, { remarks: 'x' })).rejects.toThrow(denied);
    await expect(viewer.softDeleteIntervention(record.id, record.version)).rejects.toThrow(denied);
    await expect(viewer.restoreIntervention(record.id, record.version)).rejects.toThrow(denied);
    await expect(viewer.addStatus(record.id, newStatus())).rejects.toThrow(denied);
    await expect(viewer.updateBarangayBaseline(barangay.id, barangay.version, {})).rejects.toThrow(denied);
    await expect(viewer.auditFor(record.id)).rejects.toThrow(denied);
  });

  it('refuses an Encoder a restore', async () => {
    const record = await encoder.createIntervention(newValues({ beneficiary: 'Restore FCA' }), newStatus());
    const deleted = await encoder.softDeleteIntervention(record.id, record.version);
    await expect(encoder.restoreIntervention(deleted.id, deleted.version)).rejects.toThrow(/doesn't have permission/);
    const restored = await admin.restoreIntervention(deleted.id, deleted.version, { kind: 'restore' });
    expect(restored.deleted_at).toBeNull();
  });

  it('shows deleted records to Admins only', async () => {
    const record = await encoder.createIntervention(newValues({ beneficiary: 'Hidden FCA' }), newStatus());
    await encoder.softDeleteIntervention(record.id, record.version);
    expect((await admin.load()).interventions.some((r) => r.id === record.id)).toBe(true);
    expect((await encoder.load()).interventions.some((r) => r.id === record.id)).toBe(false);
    expect((await viewer.load()).interventions.some((r) => r.id === record.id)).toBe(false);
  });

  it('names the person in History and on the status timeline', async () => {
    const record = await encoder.createIntervention(newValues({ beneficiary: 'Named FCA' }), newStatus(), { kind: 'create' });
    const fresh = await encoder.load();
    const entry = fresh.statusHistory.find((e) => e.intervention_id === record.id)!;
    expect(entry.created_by).toBe(ENCODER);
    expect(fresh.members.find((m) => m.id === entry.created_by)?.full_name).toBe('Enzo Encoder');

    const history = await encoder.auditFor(record.id);
    expect(history.map((h) => h.actor_name)).toEqual(['Enzo Encoder', 'Enzo Encoder']);
  });
});

describe('photos', () => {
  it('uploads the file under its record, and links it to the status', async () => {
    const record = await encoder.createIntervention(newValues({ beneficiary: 'Photo FCA' }), newStatus({ photo: fakeJpeg() }));
    const fresh = await encoder.load();
    const photo = fresh.photos.find((p) => p.intervention_id === record.id)!;
    expect(photo.storage_path).toMatch(new RegExp(`^${record.id}/[0-9a-f-]{36}\\.jpg$`));
    expect(encoderBackend.files.has(photo.storage_path)).toBe(true);

    const entry = fresh.statusHistory.find((e) => e.intervention_id === record.id)!;
    expect(entry.photo_id).toBe(photo.id);
    await expect(encoder.photoUrl(photo.id)).resolves.toMatch(/token=signed/);
  });

  it('removes the file when the save fails, so nothing is left behind', async () => {
    const before = encoderBackend.files.size;
    const record = data.interventions[0];
    const failing = createPgliteBackend(db, ENCODER);
    const store = createSupabaseStore({ ...failing, rpc: () => Promise.reject(new BackendError('23514', 'refused')) }, { id: ENCODER, full_name: null, role: 'encoder' });
    await expect(store.addStatus(record.id, newStatus({ photo: fakeJpeg() }))).rejects.toThrow('refused');
    expect(failing.files.size).toBe(0);
    expect(encoderBackend.files.size).toBe(before);
  });

  it('saves nothing when the upload fails', async () => {
    const parts = storeFor(ENCODER, 'encoder', 'Enzo Encoder');
    await parts.store.load();
    parts.backend.failNextUpload = true;
    const before = (await db.query<{ n: number }>(`select count(*)::int as n from interventions where beneficiary = 'Upload FCA'`)).rows[0].n;
    await expect(
      parts.store.createIntervention(newValues({ beneficiary: 'Upload FCA' }), newStatus({ photo: fakeJpeg() })),
    ).rejects.toThrow(/No connection|could not be uploaded/);
    const after = (await db.query<{ n: number }>(`select count(*)::int as n from interventions where beneficiary = 'Upload FCA'`)).rows[0].n;
    expect(after).toBe(before);
  });

  it('works out the file type even when the phone gives none', () => {
    expect(photoFileType({ name: 'a.JPG', type: '' })).toEqual({ extension: 'jpg', contentType: 'image/jpeg' });
    expect(photoFileType({ name: 'a.jpeg', type: '' })).toEqual({ extension: 'jpg', contentType: 'image/jpeg' });
    expect(photoFileType({ name: 'a.heic', type: '' })).toEqual({ extension: 'heic', contentType: 'image/heic' });
    expect(photoFileType({ name: 'a.png', type: 'image/png' })).toEqual({ extension: 'png', contentType: 'image/png' });
    expect(photoFileType({ name: 'mystery', type: '' })).toEqual({ extension: 'jpg', contentType: 'image/jpeg' });
  });
});

describe('error messages', () => {
  it('explains a lost connection, and keeps the database\'s own words otherwise', () => {
    expect(friendlyError(new BackendError('', 'TypeError: Failed to fetch')).message).toMatch(/No connection/);
    expect(friendlyError(new BackendError('42501', 'permission denied for table x')).message).toMatch(/doesn't have permission/);
    expect(friendlyError(new BackendError('23514', 'year_funded 2999 is in the future')).message).toBe('year_funded 2999 is in the future');
  });
});
