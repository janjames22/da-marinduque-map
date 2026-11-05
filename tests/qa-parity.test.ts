// Local mode and live warnings use a browser copy of the database's rules. These tests run both on
// the same cases, so the two can't drift apart.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLocalSeed } from '../scripts/build-local-seed';
import { loadSeedFiles, seedInterventions } from '../scripts/seed-interventions';
import * as engine from '../src/modules/intervention-map/data/local-engine';
import { stateFromSeed, type LocalSeed, type LocalState } from '../src/modules/intervention-map/data/local-store';
import { MANUAL_DATA_SOURCE, type EngineContext } from '../src/modules/intervention-map/data/local-engine';
import type { ChangeNote, InterventionPatch, InterventionValues } from '../src/modules/intervention-map/data/store';
import { ConflictError, ValidationError } from '../src/modules/intervention-map/data/store';
import { buildPlaceIndex, computeFlags, locatePoint, pointOf, type PlaceIndex } from '../src/modules/intervention-map/lib/qa';
import type { LatLng } from '../src/modules/intervention-map/lib/coordinates';
import { createTestDb } from './helpers/db';

const boundary = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'boundaries', `${name}.geojson`), 'utf8')) as GeoJSON.FeatureCollection;

let db: PGlite;
let places: PlaceIndex;
let state: LocalState;
let machineryId: number;
let ssipId: number;
let plantingCategoryId: number;
let spisCategoryId: number;
let riceId: number;
let statusIds: Map<string, number>;

const rows = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

beforeAll(async () => {
  db = await createTestDb();
  const { rows: csv } = loadSeedFiles();
  await seedInterventions(db, csv, []);
  const seed = (await buildLocalSeed(db)) as unknown as LocalSeed;
  state = stateFromSeed(JSON.parse(JSON.stringify(seed)) as LocalSeed, 'test');
  places = buildPlaceIndex(
    { barangays: boundary('barangays'), municipalities: boundary('municipalities') },
    { barangays: state.rows.barangays, municipalities: state.fixed.municipalities },
  );

  machineryId = state.fixed.types.find((t) => t.code === 'farm-machinery')!.id;
  ssipId = state.fixed.types.find((t) => t.code === 'ssip')!.id;
  plantingCategoryId = state.fixed.categories.find((c) => c.intervention_type_id === machineryId)!.id;
  spisCategoryId = state.fixed.categories.find((c) => c.intervention_type_id === ssipId)!.id;
  riceId = state.fixed.programs.find((p) => p.code === 'rice')!.id;
  statusIds = new Map(state.fixed.statuses.map((s) => [s.name, s.id]));
}, 180_000);

afterAll(async () => {
  await db.close();
});

const sorted = (flags: string[]) => [...flags].sort();

describe('flags and plotted barangay on the RAED records', () => {
  it('match the triggers and the view for all 199 records', () => {
    const { interventions } = state.rows;
    expect(interventions).toHaveLength(199);

    for (const record of interventions) {
      const flags = computeFlags(
        {
          id: record.id,
          point: pointOf(record),
          municipality_id: record.municipality_id,
          barangay_id: record.barangay_id,
          barangay_raw: record.barangay_raw,
          qa_flags: record.qa_flags,
          deleted_at: record.deleted_at,
        },
        interventions,
        places,
      );
      expect({ source: record.data_source, id: record.id, flags: sorted(flags) }).toEqual({
        source: record.data_source,
        id: record.id,
        flags: sorted(record.qa_flags),
      });

      const point = pointOf(record);
      expect(point ? locatePoint(point, places) : null).toBe(record.plotted_barangay_id);
    }
  });
});

describe('flags and plotted barangay on generated points', () => {
  // A small fixed-seed generator, so a failure can be reproduced.
  function random(seed: number) {
    let value = seed;
    return () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 2 ** 32;
    };
  }

  // Points 240 m and 260 m from barangay corners, either side of the 250 m tolerance.
  function nearBorderPoints(count: number, next: () => number): LatLng[] {
    const points: LatLng[] = [];
    const features = boundary('barangays').features;
    for (let i = 0; i < count; i++) {
      const feature = features[Math.floor(next() * features.length)];
      const geometry = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
      const [lng, lat] = ring[Math.floor(next() * ring.length)];
      const metres = next() < 0.5 ? 240 : 260;
      const bearing = next() * 2 * Math.PI;
      points.push({
        lat: lat + (metres * Math.cos(bearing)) / 110_700,
        lng: lng + (metres * Math.sin(bearing)) / 108_200,
      });
    }
    return points;
  }

  it('agree on 600 points across and around the island', async () => {
    const next = random(20261105);
    const points: LatLng[] = [
      ...Array.from({ length: 300 }, () => ({ lat: 13.1 + next() * 0.55, lng: 121.75 + next() * 0.5 })),
      ...nearBorderPoints(300, next),
    ];
    const { barangays } = state.rows;

    await db.exec('begin');
    const differences: unknown[] = [];
    for (const point of points) {
      const barangay = barangays[Math.floor(next() * barangays.length)];
      const [row] = await rows<{ qa_flags: string[]; plotted_barangay_id: number | null }>(
        `with inserted as (
           insert into interventions (intervention_type_id, category_id, banner_program_id, year_funded, beneficiary,
                                      municipality_id, barangay_id, geom)
           values ($1, $2, $3, 2024, 'Parity', $4, $5, ST_SetSRID(ST_MakePoint($6::float8, $7::float8), 4326))
           returning id, qa_flags
         )
         select i.qa_flags, p.id as plotted_barangay_id
         from inserted i
         left join lateral (
           select b.id from barangays b
           where b.boundary && ST_Expand(ST_SetSRID(ST_MakePoint($6::float8, $7::float8), 4326), 0.003)
             and ST_DWithin(b.boundary::geography, ST_SetSRID(ST_MakePoint($6::float8, $7::float8), 4326)::geography, 250)
           order by ST_Distance(b.boundary, ST_SetSRID(ST_MakePoint($6::float8, $7::float8), 4326)), b.id
           limit 1
         ) p on true`,
        [machineryId, plantingCategoryId, riceId, barangay.municipality_id, barangay.id, point.lng, point.lat],
      );

      const flags = computeFlags(
        {
          id: null,
          point,
          municipality_id: barangay.municipality_id,
          barangay_id: barangay.id,
          barangay_raw: null,
          qa_flags: [],
          deleted_at: null,
        },
        [],
        places,
      );
      const plotted = locatePoint(point, places);
      // Generated points never coincide, so shared coordinates aren't in play here.
      const fromDb = row.qa_flags.filter((flag) => flag !== 'duplicate_point');
      if (JSON.stringify(sorted(flags)) !== JSON.stringify(sorted(fromDb)) || plotted !== row.plotted_barangay_id) {
        differences.push({ point, barangay: barangay.id, flags, fromDb, plotted, dbPlotted: row.plotted_barangay_id });
      }
    }
    await db.exec('rollback');

    expect(differences).toEqual([]);
  }, 180_000);

  it('treats points a metre apart as different, as "exact coordinates" means', async () => {
    const barangay = state.rows.barangays[0];
    const { rows: [surface] } = await db.query<{ lat: number; lng: number }>(
      `select ST_Y(p) lat, ST_X(p) lng from (select ST_PointOnSurface(boundary) p from barangays where id = $1) s`,
      [barangay.id],
    );

    await db.exec('begin');
    const insert = (lng: number) =>
      rows<{ qa_flags: string[] }>(
        `insert into interventions (intervention_type_id, category_id, banner_program_id, year_funded, beneficiary,
                                    municipality_id, barangay_id, geom)
         values ($1, $2, $3, 2024, 'Near', $4, $5, ST_SetSRID(ST_MakePoint($6::float8, $7::float8), 4326))
         returning qa_flags`,
        [machineryId, plantingCategoryId, riceId, barangay.municipality_id, barangay.id, lng, surface.lat],
      );
    await insert(surface.lng);
    const [near] = await insert(surface.lng + 1e-7);
    const [same] = await insert(surface.lng);
    await db.exec('rollback');

    expect(near.qa_flags).not.toContain('duplicate_point');
    expect(same.qa_flags).toContain('duplicate_point');
  });
});

// The same sequence of writes, run through the triggers and through the local engine.
interface Backend {
  create(values: InterventionValues, statusName: string, statusDate: string, note?: ChangeNote): Promise<string>;
  update(id: string, version: number, patch: InterventionPatch, note?: ChangeNote): Promise<void>;
  remove(id: string, version: number, note?: ChangeNote): Promise<void>;
  restore(id: string, version: number, note?: ChangeNote): Promise<void>;
  addStatus(id: string, statusName: string, statusDate: string, note?: ChangeNote): Promise<void>;
  baseline(id: number, version: number, attributes: Record<string, unknown>, note?: ChangeNote): Promise<void>;
  read(id: string): Promise<RecordState>;
  readBaseline(id: number): Promise<{ version: number; attributes: unknown }>;
  auditTail(count: number): Promise<{ table: string; action: string; context: unknown }[]>;
}

interface RecordState {
  flags: string[];
  statusId: number | null;
  version: number;
  links: number[];
  plotted: number | null;
  deleted: boolean;
  statusEntries: number;
}

function sqlBackend(): Backend {
  const setNote = (note?: ChangeNote) => rows(`select set_config('app.audit_context', $1, false)`, [note ? JSON.stringify(note) : '']);
  const COLUMN_FOR = (patch: InterventionPatch) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      sets.push(sql.replace('?', `$${params.length + 1}`));
    };
    if (patch.barangay_id !== undefined) add('barangay_id = ?', patch.barangay_id);
    if (patch.municipality_id !== undefined) add('municipality_id = ?', patch.municipality_id);
    if (patch.beneficiary !== undefined) add('beneficiary = ?', patch.beneficiary);
    if (patch.location_basis_id !== undefined) add('location_basis_id = ?', patch.location_basis_id);
    if (patch.attributes !== undefined) add('attributes = ?::jsonb', JSON.stringify(patch.attributes));
    if (patch.year_funded !== undefined) add('year_funded = ?', patch.year_funded);
    if (patch.point !== undefined) {
      if (patch.point === null) sets.push('geom = null');
      else add('geom = ST_GeomFromText(?, 4326)', `POINT(${patch.point.lng} ${patch.point.lat})`);
    }
    if (patch.clear_name_check) sets.push(`qa_flags = array_remove(qa_flags, 'beneficiary_name_check')`);
    return { sets, params };
  };

  return {
    async create(values, statusName, statusDate, note) {
      await setNote(note);
      const [{ id }] = await rows<{ id: string }>(
        `insert into interventions (intervention_type_id, category_id, banner_program_id, year_funded, beneficiary,
           municipality_id, barangay_id, geom, attributes, data_source)
         values ($1, $2, $3, $4, $5, $6, $7,
           case when $8::float8 is null then null else ST_SetSRID(ST_MakePoint($8::float8, $9::float8), 4326) end, $10::jsonb, $11)
         returning id`,
        [
          values.intervention_type_id,
          values.category_id,
          values.banner_program_id,
          values.year_funded,
          values.beneficiary,
          values.municipality_id,
          values.barangay_id,
          values.point?.lng ?? null,
          values.point?.lat ?? null,
          JSON.stringify(values.attributes),
          MANUAL_DATA_SOURCE,
        ],
      );
      await rows(`insert into status_history (intervention_id, status_id, status_date) values ($1, $2, $3)`, [
        id,
        statusIds.get(statusName),
        statusDate,
      ]);
      return id;
    },
    async update(id, version, patch, note) {
      await setNote(note);
      const { sets, params } = COLUMN_FOR(patch);
      const updated = await rows(
        `update interventions set ${sets.join(', ')} where id = $1 and version = ${version} returning id`,
        [id, ...params],
      );
      if (updated.length === 0) throw new ConflictError(null);
    },
    async remove(id, version, note) {
      await setNote(note);
      const updated = await rows(`update interventions set deleted_at = now() where id = $1 and version = ${version} returning id`, [id]);
      if (updated.length === 0) throw new ConflictError(null);
    },
    async restore(id, version, note) {
      await setNote(note);
      const updated = await rows(`update interventions set deleted_at = null where id = $1 and version = ${version} returning id`, [id]);
      if (updated.length === 0) throw new ConflictError(null);
    },
    async addStatus(id, statusName, statusDate, note) {
      await setNote(note);
      await rows(`insert into status_history (intervention_id, status_id, status_date) values ($1, $2, $3)`, [
        id,
        statusIds.get(statusName),
        statusDate,
      ]);
    },
    async baseline(id, version, attributes, note) {
      await setNote(note);
      const updated = await rows(`update barangays set attributes = $2::jsonb where id = $1 and version = ${version} returning id`, [
        id,
        JSON.stringify(attributes),
      ]);
      if (updated.length === 0) throw new ConflictError(null);
    },
    async read(id) {
      const [row] = await rows<RecordState>(
        `select v.qa_flags as flags, v.status_id as "statusId", v.version, v.plotted_barangay_id as plotted,
                v.deleted_at is not null as deleted,
                coalesce((select array_agg(l.barangay_id order by l.barangay_id) from intervention_barangays l where l.intervention_id = v.id), '{}') as links,
                (select count(*)::int from status_history h where h.intervention_id = v.id) as "statusEntries"
         from interventions_v v where v.id = $1`,
        [id],
      );
      return { ...row, flags: sorted(row.flags) };
    },
    async readBaseline(id) {
      const [row] = await rows<{ version: number; attributes: unknown }>(`select version, attributes from barangays where id = $1`, [id]);
      return row;
    },
    async auditTail(count) {
      const entries = await rows<{ table: string; action: string; context: unknown }>(
        `select table_name as table, action, context from audit_log order by id desc limit ${count}`,
      );
      return entries.reverse();
    },
  };
}

function engineBackend(): Backend {
  const local = JSON.parse(JSON.stringify(state)) as LocalState;
  let tick = 0;
  let counter = 0;
  const context: EngineContext = {
    types: local.fixed.types,
    categories: local.fixed.categories,
    typeStatuses: local.fixed.typeStatuses,
    municipalities: local.fixed.municipalities,
    barangayFields: local.fixed.barangayFields,
    places,
    now: () => new Date(Date.UTC(2026, 10, 5, 0, 0, tick++)).toISOString(),
    newId: () => `local-${++counter}`,
  };

  return {
    async create(values, statusName, statusDate, note) {
      const record = engine.createIntervention(local.rows, context, values, note);
      engine.addStatus(local.rows, context, record.id, { status_id: statusIds.get(statusName)!, status_date: statusDate, remarks: null }, note);
      return record.id;
    },
    async update(id, version, patch, note) {
      engine.updateIntervention(local.rows, context, id, version, patch, note);
    },
    async remove(id, version, note) {
      engine.softDeleteIntervention(local.rows, context, id, version, note);
    },
    async restore(id, version, note) {
      engine.restoreIntervention(local.rows, context, id, version, note);
    },
    async addStatus(id, statusName, statusDate, note) {
      engine.addStatus(local.rows, context, id, { status_id: statusIds.get(statusName)!, status_date: statusDate, remarks: null }, note);
    },
    async baseline(id, version, attributes, note) {
      engine.updateBarangayBaseline(local.rows, context, id, version, attributes, note);
    },
    async read(id) {
      const record = local.rows.interventions.find((r) => r.id === id)!;
      return {
        flags: sorted(record.qa_flags),
        statusId: record.status_id,
        version: record.version,
        links: local.rows.links.filter((l) => l.intervention_id === id).map((l) => l.barangay_id).sort((a, b) => a - b),
        plotted: record.plotted_barangay_id,
        deleted: record.deleted_at !== null,
        statusEntries: local.rows.statusHistory.filter((h) => h.intervention_id === id).length,
      };
    },
    async readBaseline(id) {
      const barangay = local.rows.barangays.find((b) => b.id === id)!;
      return { version: barangay.version, attributes: barangay.attributes };
    },
    async auditTail(count) {
      return local.rows.auditLog.slice(-count).map((entry) => ({ table: entry.table_name, action: entry.action, context: entry.context }));
    },
  };
}

describe('the same edits through the triggers and the local engine', () => {
  let barangayA: { id: number; municipality_id: number; lat: number; lng: number };
  let barangayB: { id: number; municipality_id: number; lat: number; lng: number };

  beforeAll(async () => {
    const surface = await rows<{ id: number; municipality_id: number; lat: number; lng: number }>(
      `select id, municipality_id, ST_Y(p) lat, ST_X(p) lng from (
         select b.id, b.municipality_id, ST_PointOnSurface(b.boundary) p, row_number() over (partition by b.municipality_id order by b.id) n
         from barangays b) s
       where n = 1 order by municipality_id limit 2`,
    );
    [barangayA, barangayB] = surface;
  });

  const newValues = (point: LatLng | null, over: Partial<InterventionValues> = {}): InterventionValues => ({
    intervention_type_id: machineryId,
    category_id: plantingCategoryId,
    title: null,
    banner_program_id: riceId,
    year_funded: 2024,
    quantity: 1,
    unit_cost: null,
    fund_source: null,
    beneficiary: 'Scenario FA',
    beneficiary_type_id: null,
    municipality_id: barangayA.municipality_id,
    barangay_id: barangayA.id,
    location_basis_id: null,
    point,
    attributes: {},
    remarks: null,
    ...over,
  });

  // Runs the scenario on both, comparing everything after every step.
  async function runBoth(scenario: (backend: Backend, check: (name: string, id: string) => Promise<void>) => Promise<void>) {
    const logs: Record<string, RecordState>[] = [];
    await db.exec('begin');
    try {
      for (const backend of [sqlBackend(), engineBackend()]) {
        const log: Record<string, RecordState> = {};
        await scenario(backend, async (name, id) => {
          log[name] = await backend.read(id);
        });
        logs.push(log);
      }
    } finally {
      await db.exec('rollback');
    }
    expect(logs[1]).toEqual(logs[0]);
    return logs[0];
  }

  it('create, shared coordinates, move, delete and restore', async () => {
    const log = await runBoth(async (backend, check) => {
      const point = { lat: barangayA.lat, lng: barangayA.lng };
      const a = await backend.create(newValues(point), 'Turned-over', '2026-01-10', { kind: 'create' });
      await check('a created', a);

      const b = await backend.create(newValues(point, { beneficiary: 'Other FA' }), 'Serviceable', '2026-01-11');
      await check('a after b shares its point', a);
      await check('b shares a point', b);

      await backend.update(b, 1, { point: { lat: barangayB.lat, lng: barangayB.lng } }, { kind: 'move' });
      await check('a after b moved away', a);
      await check('b moved into another municipality', b);

      await backend.update(b, 2, { municipality_id: barangayB.municipality_id, barangay_id: barangayB.id }, { kind: 'resolve', reason: 'Field visit' });
      await check('b barangay corrected', b);

      await backend.update(b, 3, { point: { lat: barangayA.lat, lng: barangayA.lng }, municipality_id: barangayA.municipality_id, barangay_id: barangayA.id });
      await check('a after b moved back', a);

      await backend.remove(b, 4, { kind: 'delete', reason: 'Entered twice' });
      await check('a after b deleted', a);
      await check('b deleted', b);

      await backend.restore(b, 5, { kind: 'restore' });
      await check('a after b restored', a);
      await check('b restored', b);
    });

    expect(log['b shares a point'].flags).toContain('duplicate_point');
    expect(log['a after b moved away'].flags).not.toContain('duplicate_point');
    expect(log['b moved into another municipality'].flags).toEqual(expect.arrayContaining(['barangay_mismatch', 'muni_mismatch']));
    expect(log['b barangay corrected'].flags).toEqual([]);
    expect(log['b deleted'].flags).not.toContain('duplicate_point');
    expect(log['a after b restored'].flags).toContain('duplicate_point');
  });

  it('records with no coordinates and no barangay', async () => {
    const log = await runBoth(async (backend, check) => {
      const a = await backend.create(newValues(null, { barangay_id: null }), 'Turned-over', '2026-01-10');
      await check('unlocated', a);
      await backend.update(a, 1, { point: { lat: 14.5, lng: 121 } });
      await check('outside the province', a);
      await backend.update(a, 2, { point: null, barangay_id: barangayA.id });
      await check('cleared', a);
      await backend.update(a, 3, { point: { lat: 0, lng: 0 } });
      await check('zero means none', a);
    });
    expect(log.unlocated.flags).toEqual(['no_barangay', 'no_coords']);
    expect(log['outside the province'].flags).toEqual(expect.arrayContaining(['out_of_province', 'muni_mismatch']));
    expect(log.cleared.flags).toEqual(['no_coords']);
    expect(log['zero means none'].flags).toEqual(['no_coords']);
  });

  it('status history: the latest date is current, and a backdated entry does not replace it', async () => {
    const log = await runBoth(async (backend, check) => {
      const a = await backend.create(newValues({ lat: barangayA.lat, lng: barangayA.lng }), 'Turned-over', '2026-02-01');
      await check('first', a);
      await backend.addStatus(a, 'Needs Repair', '2026-03-01', { kind: 'status' });
      await check('newer', a);
      await backend.addStatus(a, 'Serviceable', '2026-02-15');
      await check('backdated', a);
      await backend.addStatus(a, 'Unserviceable', '2026-03-01');
      await check('same day, entered later', a);
    });
    expect(log.first.statusId).toBe(statusIds.get('Turned-over'));
    expect(log.newer.statusId).toBe(statusIds.get('Needs Repair'));
    expect(log.backdated.statusId).toBe(statusIds.get('Needs Repair'));
    expect(log['same day, entered later'].statusId).toBe(statusIds.get('Unserviceable'));
    expect(log.newer.version).toBe(1); // a status change isn't an edit of the record
  });

  it('writes the same audit trail, including the reason', async () => {
    const tails: unknown[] = [];
    await db.exec('begin');
    try {
      for (const backend of [sqlBackend(), engineBackend()]) {
        const a = await backend.create(newValues({ lat: barangayA.lat, lng: barangayA.lng }), 'Turned-over', '2026-02-01', { kind: 'create' });
        await backend.update(a, 1, { beneficiary: 'Renamed FA' }, { kind: 'edit' });
        await backend.addStatus(a, 'Needs Repair', '2026-03-01', { kind: 'status', reason: 'Inspected' });
        await backend.remove(a, 2, { kind: 'delete', reason: 'Wrong entry' });
        await backend.restore(a, 3, { kind: 'restore' });
        tails.push(await backend.auditTail(6));
      }
    } finally {
      await db.exec('rollback');
    }
    expect(tails[1]).toEqual(tails[0]);
    expect(tails[0]).toEqual([
      { table: 'interventions', action: 'insert', context: { kind: 'create' } },
      { table: 'status_history', action: 'insert', context: { kind: 'create' } },
      { table: 'interventions', action: 'update', context: { kind: 'edit' } },
      { table: 'status_history', action: 'insert', context: { kind: 'status', reason: 'Inspected' } },
      { table: 'interventions', action: 'soft_delete', context: { kind: 'delete', reason: 'Wrong entry' } },
      { table: 'interventions', action: 'restore', context: { kind: 'restore' } },
    ]);
  });

  it('barangay baseline edits bump the version and are logged', async () => {
    const results: unknown[] = [];
    await db.exec('begin');
    try {
      for (const backend of [sqlBackend(), engineBackend()]) {
        await backend.baseline(barangayA.id, 1, { farmer_count: 120, main_crops: 'Rice' }, { kind: 'baseline' });
        results.push({ row: await backend.readBaseline(barangayA.id), tail: await backend.auditTail(1) });
      }
    } finally {
      await db.exec('rollback');
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toEqual({
      row: { version: 2, attributes: { farmer_count: 120, main_crops: 'Rice' } },
      tail: [{ table: 'barangays', action: 'update', context: { kind: 'baseline' } }],
    });
  });

  it('clearing a name check is kept, and other flags cannot be cleared by hand', async () => {
    const flagged = state.rows.interventions.find((r) => r.qa_flags.includes('beneficiary_name_check'))!;
    expect(flagged).toBeDefined();
    const local = JSON.parse(JSON.stringify(state)) as LocalState;
    const context: EngineContext = {
      types: local.fixed.types,
      categories: local.fixed.categories,
      typeStatuses: local.fixed.typeStatuses,
      municipalities: local.fixed.municipalities,
      barangayFields: local.fixed.barangayFields,
      places,
      now: () => '2026-11-05T00:00:00.000Z',
      newId: () => 'x',
    };
    const updated = engine.updateIntervention(local.rows, context, flagged.id, flagged.version, { clear_name_check: true, remarks: 'Checked' });
    expect(updated.qa_flags).not.toContain('beneficiary_name_check');

    const edited = engine.updateIntervention(local.rows, context, flagged.id, updated.version, { remarks: 'Again' });
    expect(edited.qa_flags).not.toContain('beneficiary_name_check');
  });

  // Both sides must refuse the same bad writes.
  describe('rejects the same bad writes', () => {
    const attempt = async (backend: Backend, run: (b: Backend) => Promise<unknown>) => {
      await db.exec('savepoint attempt');
      try {
        await run(backend);
        return 'accepted';
      } catch {
        return 'rejected';
      } finally {
        await db.exec('rollback to savepoint attempt');
      }
    };

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
    const nextYear = Number(today.slice(0, 4)) + 1;
    const point = () => ({ lat: barangayA.lat, lng: barangayA.lng });

    const cases: [string, (b: Backend) => Promise<unknown>, 'accepted' | 'rejected'][] = [
      ['a valid record', (b) => b.create(newValues(point()), 'Turned-over', '2026-01-10'), 'accepted'],
      ['a year in the future', (b) => b.create(newValues(point(), { year_funded: nextYear }), 'Turned-over', '2026-01-10'), 'rejected'],
      ['a year before 2000', (b) => b.create(newValues(point(), { year_funded: 1999 }), 'Turned-over', '2026-01-10'), 'rejected'],
      ['a missing required program', (b) => b.create(newValues(point(), { banner_program_id: null }), 'Turned-over', '2026-01-10'), 'rejected'],
      ['a missing required beneficiary', (b) => b.create(newValues(point(), { beneficiary: null }), 'Turned-over', '2026-01-10'), 'rejected'],
      ['a category from another type', (b) => b.create(newValues(point(), { category_id: spisCategoryId }), 'Turned-over', '2026-01-10'), 'rejected'],
      ['an unknown custom field', (b) => b.create(newValues(point(), { attributes: { nope: 'x' } }), 'Turned-over', '2026-01-10'), 'rejected'],
      ['a custom field of the wrong kind', (b) => b.create(newValues(point(), { attributes: { serial_no: 12 } }), 'Turned-over', '2026-01-10'), 'rejected'],
      ['a bad custom date', (b) => b.create(newValues(point(), { attributes: { date_turned_over: '2026-02-31' } }), 'Turned-over', '2026-01-10'), 'rejected'],
      ['a barangay from another municipality', (b) => b.create(newValues(point(), { barangay_id: barangayB.id }), 'Turned-over', '2026-01-10'), 'rejected'],
      ['a status not on the type\'s list', (b) => b.create(newValues(point()), 'On-going', '2026-01-10'), 'rejected'],
      ['a status date in the future', (b) => b.create(newValues(point()), 'Turned-over', `${nextYear}-01-01`), 'rejected'],
      ['an unknown barangay baseline field', (b) => b.baseline(barangayA.id, 1, { nope: 1 }), 'rejected'],
      ['a baseline number given as text', (b) => b.baseline(barangayA.id, 1, { farmer_count: 'many' }), 'rejected'],
    ];

    it.each(cases)('%s', async (_name, run, expected) => {
      await db.exec('begin');
      try {
        expect(await attempt(sqlBackend(), run)).toBe(expected);
        expect(await attempt(engineBackend(), run)).toBe(expected);
      } finally {
        await db.exec('rollback');
      }
    });

    it('an out-of-date version is refused by both', async () => {
      for (const backend of [sqlBackend(), engineBackend()]) {
        await db.exec('begin');
        try {
          const id = await backend.create(newValues(point()), 'Turned-over', '2026-01-10');
          await backend.update(id, 1, { beneficiary: 'First edit' });
          await expect(backend.update(id, 1, { beneficiary: 'Second edit' })).rejects.toBeInstanceOf(ConflictError);
          expect((await backend.read(id)).version).toBe(2);
        } finally {
          await db.exec('rollback');
        }
      }
    });

    it('a required value can\'t be removed, but editing something else is still allowed', async () => {
      const local = engineBackend();
      const id = await local.create(newValues(point()), 'Turned-over', '2026-01-10');
      await expect(local.update(id, 1, { point: { lat: barangayB.lat, lng: barangayB.lng } })).resolves.toBeUndefined();
      await expect(local.update(id, 2, { year_funded: null })).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
