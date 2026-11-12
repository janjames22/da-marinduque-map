import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb } from './helpers/db';

// These tests replace the real polygons with simple squares so distances are easy to reason about.
// tests/boundaries.test.ts covers the real polygons. Boac gets one square, Gasan another further south.
const BOAC_SQUARE = 'MULTIPOLYGON(((121.80 13.40, 121.95 13.40, 121.95 13.50, 121.80 13.50, 121.80 13.40)))';
const GASAN_SQUARE = 'MULTIPOLYGON(((121.80 13.20, 121.95 13.20, 121.95 13.30, 121.80 13.30, 121.80 13.20)))';

const IN_GASAN = { lat: 13.25, lon: 121.85 };

let db: PGlite;
let boac: number;
let gasan: number;
let torrijos: number;
let boacBarangay: number;
let gasanBarangay: number;
let torrijosBarangay: number;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

type Row = { id: string; qa_flags: string[]; geom: string | null; version: number; status_id: number | null };

interface NewRecord {
  lat?: number | null;
  lon?: number | null;
  wkt?: string;
  type?: string;
  municipality?: number;
  barangay?: number | null;
  year?: number | null;
  attributes?: Record<string, unknown>;
  title?: string | null;
  category?: string | null;
}

async function insertRecord({
  lat = null,
  lon = null,
  wkt,
  type = 'other',
  municipality = boac,
  barangay = boacBarangay,
  year = 2022,
  attributes = {},
  title = 'Test record',
  category = null,
}: NewRecord) {
  const pointWkt = lat !== null && lon !== null ? `POINT(${lon} ${lat})` : null;
  return one<Row>(
    `insert into interventions
       (intervention_type_id, title, category_id, banner_program_id, year_funded, beneficiary,
        municipality_id, barangay_id, geom, attributes)
     values ((select id from intervention_types where code = $1), $2,
        (select id from categories where code = $3),
        (select id from programs where code = 'rice'), $4, 'Test FA', $5, $6,
        ST_GeomFromText($7, 4326), $8::jsonb)
     returning id, qa_flags, geom, version, status_id`,
    [type, title, category, year, municipality, barangay, wkt ?? pointWkt, JSON.stringify(attributes)],
  );
}

async function flagsOf(id: string): Promise<string[]> {
  return (await one<{ qa_flags: string[] }>('select qa_flags from interventions where id = $1', [id])).qa_flags;
}

beforeAll(async () => {
  db = await createTestDb();

  const muni = async (name: string) =>
    (await one<{ id: number }>('select id from municipalities where name = $1', [name])).id;
  boac = await muni('Boac');
  gasan = await muni('Gasan');
  torrijos = await muni('Torrijos');

  await db.query('update municipalities set boundary = ST_GeomFromText($1, 4326) where id = $2', [BOAC_SQUARE, boac]);
  await db.query('update municipalities set boundary = ST_GeomFromText($1, 4326) where id = $2', [GASAN_SQUARE, gasan]);
  await db.query('update municipalities set boundary = null where id = $1', [torrijos]);
  await db.query('update barangays set boundary = null');

  const barangay = async (municipality: number, name: string) =>
    (await one<{ id: number }>('select id from barangays where municipality_id = $1 and name = $2', [municipality, name]))
      .id;
  boacBarangay = await barangay(boac, 'Ihatub');
  gasanBarangay = await barangay(gasan, 'Pangi');
  torrijosBarangay = await barangay(torrijos, 'Malibago');
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe('starting lookups', () => {
  const names = async (sql: string, params: unknown[] = []) =>
    (await db.query<{ name: string }>(sql, params)).rows.map((r) => r.name);

  it('loads programs and municipalities', async () => {
    expect(await names('select name from programs')).toHaveLength(6);
    expect(await names('select name from municipalities')).toHaveLength(6);
  });

  it('defines the starting intervention types with their geometry kinds', async () => {
    const types = (
      await db.query<{ name: string; geometry_kind: string }>(
        'select name, geometry_kind::text from intervention_types order by sort_order',
      )
    ).rows;
    expect(types).toEqual([
      { name: 'Farm Machinery', geometry_kind: 'point' },
      { name: 'SSIP', geometry_kind: 'point' },
      { name: 'Farm-to-Market Road', geometry_kind: 'line' },
      { name: 'Postharvest Facility', geometry_kind: 'point' },
      { name: 'Irrigation Canal', geometry_kind: 'line' },
      { name: 'Service Area', geometry_kind: 'polygon' },
      { name: 'Other', geometry_kind: 'point' },
    ]);
  });

  it('activates only Farm Machinery and SSIP, keeping the rest for later', async () => {
    expect(await names('select name from intervention_types where is_active order by sort_order')).toEqual([
      'Farm Machinery',
      'SSIP',
    ]);
    expect(await names('select name from intervention_types where not is_active')).toHaveLength(5);
  });

  it('lists the SSIP categories, including Other through any-type', async () => {
    expect(
      await names(
        `select c.name from categories c
         where c.intervention_type_id = (select id from intervention_types where code = 'ssip')
            or c.intervention_type_id is null
         order by c.sort_order`,
      ),
    ).toEqual([
      'Solar-Powered Irrigation System (SPIS)',
      'Small Farm Reservoir (SFR)',
      'Shallow Tube Well (STW)',
      'Pump Irrigation from Open Source (PISOS)',
      'Small Water Impounding Project (SWIP)',
      'Diversion Dam',
      'Other',
    ]);
  });

  it('gives SSIP its starter fields', async () => {
    const { field_schema } = await one<{ field_schema: { fields: { key: string }[] } }>(
      `select field_schema from intervention_types where code = 'ssip'`,
    );
    expect(field_schema.fields.map((f) => f.key)).toEqual([
      'water_source',
      'service_area_ha',
      'farmer_beneficiaries',
      'pump_capacity',
      'solar_capacity_kwp',
    ]);
  });

  it('keeps SSIP as a point type', async () => {
    const { geometry_kind } = await one<{ geometry_kind: string }>(
      `select geometry_kind::text from intervention_types where code = 'ssip'`,
    );
    expect(geometry_kind).toBe('point');
  });

  it('seeds the location basis lookup', async () => {
    expect(await names('select name from location_bases order by sort_order')).toEqual([
      'Actual unit/structure location',
      'FCA office/storage',
      'Barangay center (approximate)',
      'Unknown',
    ]);
  });

  const statusesFor = (code: string, extra = '') =>
    names(
      `select s.name from intervention_type_statuses ts
       join statuses s on s.id = ts.status_id
       join intervention_types t on t.id = ts.intervention_type_id
       where t.code = $1 ${extra}
       order by ts.sort_order`,
      [code],
    );

  it('gives SSIP its own status list', async () => {
    expect(await statusesFor('ssip')).toEqual([
      'Inventory',
      'On-going',
      'Completed',
      'Operational',
      'Needs Repair',
      'Non-operational',
    ]);
  });

  it('sets which statuses count as operational per type', async () => {
    const operational = 'and ts.counts_as_operational';
    expect(await statusesFor('ssip', operational)).toEqual(['Operational']);
    expect(await statusesFor('farm-machinery', operational)).toEqual(['Turned-over', 'Serviceable']);
  });

  it('has every type with a status list and exactly one default', async () => {
    const { rows } = await db.query<{ code: string; defaults: number }>(
      `select t.code, count(*) filter (where ts.is_default)::int defaults
       from intervention_types t join intervention_type_statuses ts on ts.intervention_type_id = t.id
       group by 1`,
    );
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.defaults === 1)).toBe(true);
  });

  it('includes the six extra categories under sensible types', async () => {
    const { rows } = await db.query<{ name: string; type: string | null }>(
      `select c.name, t.code as type from categories c left join intervention_types t on t.id = c.intervention_type_id
       where c.name in ('Disc Plow / Harrow', 'Seeder', 'Rice Reaper', 'Small Water Impounding Project (SWIP)', 'Diversion Dam', 'Other')
       order by c.sort_order`,
    );
    expect(rows).toEqual([
      { name: 'Disc Plow / Harrow', type: 'farm-machinery' },
      { name: 'Seeder', type: 'farm-machinery' },
      { name: 'Rice Reaper', type: 'farm-machinery' },
      { name: 'Small Water Impounding Project (SWIP)', type: 'ssip' },
      { name: 'Diversion Dam', type: 'ssip' },
      { name: 'Other', type: null },
    ]);
  });
});

describe('coordinates and QA flags', () => {
  it('stores 0,0 as unlocated with no geometry', async () => {
    const row = await insertRecord({ lat: 0, lon: 0 });
    expect(row.geom).toBeNull();
    expect(row.qa_flags).toEqual(['no_coords']);
  });

  it('keeps and flags a single stray zero', async () => {
    const row = await insertRecord({ lat: 0, lon: 121.9 });
    expect(row.geom).not.toBeNull();
    expect(row.qa_flags).toContain('out_of_province');
  });

  it('keeps and flags an out-of-province longitude without correcting it', async () => {
    const row = await insertRecord({ lat: 13.33, lon: 122.90523, municipality: torrijos, barangay: torrijosBarangay });
    const { x } = await one<{ x: number }>('select ST_X(geom) x from interventions where id = $1', [row.id]);
    expect(x).toBe(122.90523);
    expect(row.qa_flags).toEqual(['out_of_province']);
  });

  it('accepts a point inside the selected municipality', async () => {
    const row = await insertRecord({ lat: 13.46, lon: 121.86 });
    expect(row.qa_flags).toEqual([]);
    expect(row.geom).not.toBeNull();
  });

  it('flags a point that falls in a different municipality', async () => {
    const row = await insertRecord({ lat: 13.47, lon: 121.89, municipality: gasan, barangay: gasanBarangay }); // in Boac
    expect(row.qa_flags).toEqual(['muni_mismatch']);
  });

  it('allows a point just outside the boundary, within tolerance', async () => {
    const row = await insertRecord({ lat: 13.501, lon: 121.87 }); // about 110 m past the northern edge
    expect(row.qa_flags).toEqual([]);
  });

  it('flags a point beyond the tolerance', async () => {
    const row = await insertRecord({ lat: 13.51, lon: 121.87 }); // about 1.1 km past the edge
    expect(row.qa_flags).toEqual(['muni_mismatch']);
  });

  it('skips the municipality check when no boundary is loaded', async () => {
    const row = await insertRecord({ lat: 13.33, lon: 122.08, municipality: torrijos, barangay: torrijosBarangay });
    expect(row.qa_flags).toEqual([]);
  });

  it('clears flags when a bad coordinate is corrected', async () => {
    const row = await insertRecord({ lat: 13.33, lon: 122.90523, municipality: torrijos, barangay: torrijosBarangay });
    await db.query(`update interventions set geom = ST_GeomFromText('POINT(122.0812 13.33)', 4326) where id = $1`, [row.id]);
    expect(await flagsOf(row.id)).toEqual([]);
  });

  it('flags an out-of-box vertex on a line even if the line starts inside', async () => {
    const row = await insertRecord({
      type: 'fmr',
      wkt: 'LINESTRING(121.85 13.45, 122.40 13.45)',
    });
    expect(row.qa_flags).toContain('out_of_province');
  });

  it('accepts a line that crosses out of its municipality while touching it', async () => {
    const row = await insertRecord({ type: 'fmr', wkt: 'LINESTRING(121.90 13.45, 122.10 13.45)' });
    expect(row.qa_flags).toEqual([]);
  });
});

describe('barangay_mismatch', () => {
  const SQUARE = 'MULTIPOLYGON(((121.84 13.44, 121.86 13.44, 121.86 13.46, 121.84 13.46, 121.84 13.44)))';
  const OTHER_SQUARE = 'MULTIPOLYGON(((121.90 13.44, 121.92 13.44, 121.92 13.46, 121.90 13.46, 121.90 13.44)))';
  let otherBarangay: number;

  beforeAll(async () => {
    otherBarangay = (await one<{ id: number }>(`select id from barangays where municipality_id = $1 and name = 'Tumapon'`, [boac])).id;
    await db.query('update barangays set boundary = ST_GeomFromText($1, 4326) where id = $2', [SQUARE, boacBarangay]);
    await db.query('update barangays set boundary = ST_GeomFromText($1, 4326) where id = $2', [OTHER_SQUARE, otherBarangay]);
  });

  afterAll(async () => {
    await db.query('update barangays set boundary = null where id in ($1, $2)', [boacBarangay, otherBarangay]);
  });

  it('is clear for a point inside its encoded barangay', async () => {
    const row = await insertRecord({ lat: 13.45, lon: 121.85 });
    expect(row.qa_flags).toEqual([]);
  });

  it('flags a point outside its encoded barangay', async () => {
    const row = await insertRecord({ lat: 13.45, lon: 121.91 });
    expect(row.qa_flags).toEqual(['barangay_mismatch']);
  });

  it('clears when the barangay is corrected to where the point is', async () => {
    const row = await insertRecord({ lat: 13.451, lon: 121.911 });
    expect(row.qa_flags).toEqual(['barangay_mismatch']);
    await db.query('update interventions set barangay_id = $1 where id = $2', [otherBarangay, row.id]);
    expect(await flagsOf(row.id)).toEqual([]);
  });

  it('clears when the point is moved into the encoded barangay', async () => {
    const row = await insertRecord({ lat: 13.452, lon: 121.912 });
    await db.query(`update interventions set geom = ST_GeomFromText('POINT(121.851 13.451)', 4326) where id = $1`, [row.id]);
    expect(await flagsOf(row.id)).toEqual([]);
  });

  it('stays flagged when the only change is setting the location basis', async () => {
    const row = await insertRecord({ lat: 13.453, lon: 121.913 });
    await db.query(
      `update interventions set location_basis_id = (select id from location_bases where name = 'Actual unit/structure location')
       where id = $1`,
      [row.id],
    );
    expect(await flagsOf(row.id)).toEqual(['barangay_mismatch']);
  });

  it('reports the plotted barangay through the read view', async () => {
    const row = await insertRecord({ lat: 13.454, lon: 121.914 });
    const view = await one<{ plotted_barangay: string; plotted_municipality: string; geojson: { type: string } }>(
      'select plotted_barangay, plotted_municipality, geojson from interventions_v where id = $1',
      [row.id],
    );
    expect(view.plotted_barangay).toBe('Tumapon');
    expect(view.plotted_municipality).toBe('Boac');
    expect(view.geojson.type).toBe('Point');
  });
});

describe('shared coordinates', () => {
  const inGasan = { municipality: 0, barangay: 0 };
  beforeAll(() => {
    inGasan.municipality = gasan;
    inGasan.barangay = gasanBarangay;
  });

  it('flags both records and clears the flag when one moves away', async () => {
    const first = await insertRecord({ ...IN_GASAN, ...inGasan });
    expect(first.qa_flags).toEqual([]);

    const second = await insertRecord({ ...IN_GASAN, ...inGasan });
    expect(second.qa_flags).toEqual(['duplicate_point']);
    expect(await flagsOf(first.id)).toEqual(['duplicate_point']);

    await db.query(`update interventions set geom = ST_GeomFromText('POINT(121.85 13.26)', 4326) where id = $1`, [second.id]);
    expect(await flagsOf(first.id)).toEqual([]);
    expect(await flagsOf(second.id)).toEqual([]);
  });

  it('clears the flag when a record at the point is soft-deleted', async () => {
    const point = { lat: 13.27, lon: 121.86, ...inGasan };
    const first = await insertRecord(point);
    const second = await insertRecord(point);
    await db.query('update interventions set deleted_at = now() where id = $1', [second.id]);
    expect(await flagsOf(first.id)).toEqual([]);
  });

  it('clears the flag when a record at the point is removed', async () => {
    const point = { lat: 13.28, lon: 121.87, ...inGasan };
    const first = await insertRecord(point);
    const second = await insertRecord(point);
    await db.query('delete from interventions where id = $1', [second.id]);
    expect(await flagsOf(first.id)).toEqual([]);
  });

  it('does not change updated_at or version on a record whose flag is only refreshed', async () => {
    const point = { lat: 13.29, lon: 121.88, ...inGasan };
    const first = await insertRecord(point);
    const before = await one<{ updated_at: string; version: number }>(
      'select updated_at::text, version from interventions where id = $1',
      [first.id],
    );
    await insertRecord(point);
    const after = await one<{ updated_at: string; version: number }>(
      'select updated_at::text, version from interventions where id = $1',
      [first.id],
    );
    expect(after).toEqual(before);
  });

  it('does not apply to lines', async () => {
    const wkt = 'LINESTRING(121.82 13.42, 121.83 13.43)';
    await insertRecord({ type: 'fmr', wkt });
    const second = await insertRecord({ type: 'fmr', wkt });
    expect(second.qa_flags).not.toContain('duplicate_point');
  });
});

describe('barangay flags', () => {
  it('flags a record with no barangay name as no_barangay', async () => {
    const row = await insertRecord({ barangay: null });
    expect(row.qa_flags).toEqual(['no_coords', 'no_barangay']);
  });

  it('treats a blank barangay name as no_barangay', async () => {
    const row = await insertRecord({ barangay: null });
    await db.query(`update interventions set barangay_raw = '   ' where id = $1`, [row.id]);
    expect(await flagsOf(row.id)).toEqual(['no_coords', 'no_barangay']);
  });

  it('flags a named barangay that has no match as barangay_unmatched', async () => {
    const row = await insertRecord({ barangay: null });
    await db.query(`update interventions set barangay_raw = 'Barangay 367' where id = $1`, [row.id]);
    expect(await flagsOf(row.id)).toEqual(['no_coords', 'barangay_unmatched']);
  });

  it('clears the flag once the barangay is linked', async () => {
    const row = await insertRecord({ barangay: null });
    await db.query(`update interventions set barangay_raw = 'Ihatub', barangay_id = $1 where id = $2`, [boacBarangay, row.id]);
    expect(await flagsOf(row.id)).toEqual(['no_coords']);
  });
});

describe('manual flags', () => {
  it('ignores computed flags supplied by the caller, and keeps manual ones', async () => {
    const row = await insertRecord({ lat: 13.46, lon: 121.88 });
    await db.query(
      `update interventions set qa_flags = array['no_coords', 'beneficiary_name_check'] where id = $1`,
      [row.id],
    );
    expect(await flagsOf(row.id)).toEqual(['beneficiary_name_check']);
  });

  it('keeps a manual flag through an edit', async () => {
    const row = await insertRecord({ lat: 13.46, lon: 121.881 });
    await db.query(`update interventions set qa_flags = array['beneficiary_name_check'] where id = $1`, [row.id]);
    await db.query(`update interventions set remarks = 'edited' where id = $1`, [row.id]);
    expect(await flagsOf(row.id)).toEqual(['beneficiary_name_check']);
  });
});

describe('intervention type rules', () => {
  it('rejects a geometry that does not match the type', async () => {
    await expect(insertRecord({ type: 'fmr', lat: 13.46, lon: 121.86 })).rejects.toThrow(/needs a line geometry/);
    await expect(insertRecord({ type: 'other', wkt: 'LINESTRING(121.85 13.45, 121.86 13.46)' })).rejects.toThrow(
      /needs a point geometry/,
    );
    await expect(insertRecord({ type: 'service-area', wkt: 'LINESTRING(121.85 13.45, 121.86 13.46)' })).rejects.toThrow(
      /needs a polygon geometry/,
    );
  });

  it('accepts lines and polygons for their types', async () => {
    const line = await insertRecord({ type: 'fmr', wkt: 'LINESTRING(121.85 13.45, 121.86 13.46)' });
    const polygon = await insertRecord({
      type: 'service-area',
      wkt: 'POLYGON((121.85 13.45, 121.86 13.45, 121.86 13.46, 121.85 13.45))',
    });
    expect(line.geom).not.toBeNull();
    expect(polygon.geom).not.toBeNull();
  });

  it('lets a line record wait for its traced line, as a point waits for coordinates, but not a polygon', async () => {
    // Since 0012_lines.sql: a road is counted before its line is traced, and kept off the map.
    const waiting = await insertRecord({ type: 'fmr' });
    expect(waiting.geom).toBeNull();
    expect(waiting.qa_flags).toContain('no_coords');
    await expect(insertRecord({ type: 'service-area' })).rejects.toThrow(/needs its shape/);
    expect((await insertRecord({ type: 'other' })).geom).toBeNull();

    const line = await insertRecord({ type: 'fmr', wkt: 'LINESTRING(121.85 13.45, 121.86 13.46)' });
    expect(line.qa_flags).not.toContain('no_coords');
    await db.query('update interventions set geom = null where id = $1', [line.id]);
    expect(await flagsOf(line.id)).toContain('no_coords');

    const polygon = await insertRecord({ type: 'service-area', wkt: 'POLYGON((121.85 13.45, 121.86 13.45, 121.86 13.46, 121.85 13.45))' });
    await expect(db.query('update interventions set geom = null where id = $1', [polygon.id])).rejects.toThrow(/needs its shape/);
  });

  it('rejects an invalid polygon', async () => {
    await expect(
      insertRecord({
        type: 'service-area',
        wkt: 'POLYGON((121.85 13.45, 121.86 13.46, 121.86 13.45, 121.85 13.46, 121.85 13.45))',
      }),
    ).rejects.toThrow(/not valid/);
  });

  it('stops a type changing geometry kind once it has records', async () => {
    await insertRecord({ type: 'fmr', wkt: 'LINESTRING(121.85 13.45, 121.87 13.46)' });
    await expect(
      db.query(`update intervention_types set geometry_kind = 'point' where code = 'fmr'`),
    ).rejects.toThrow(/geometry kind cannot change/);
  });

  it('allows a new type to be created without code changes', async () => {
    await db.query(
      `insert into intervention_types (code, name, geometry_kind, color, is_active, field_schema)
       values ('greenhouse', 'Greenhouse', 'polygon', '#123456', false,
         '{"fields": [{"key": "area_sqm", "label": "Area", "input": "number", "required": true}]}')`,
    );
    const row = await insertRecord({
      type: 'greenhouse',
      wkt: 'POLYGON((121.85 13.45, 121.851 13.45, 121.851 13.451, 121.85 13.45))',
      attributes: { area_sqm: 120 },
    });
    expect(row.id).toBeTruthy();
  });

  it('enforces the core fields each type requires', async () => {
    await expect(insertRecord({ type: 'farm-machinery', category: 'seeder', year: null })).rejects.toThrow(
      /year_funded is required/,
    );
    await expect(insertRecord({ type: 'fmr', title: null, category: 'other' })).rejects.toThrow(/title is required/);
    // year_funded isn't required for a road.
    const road = await insertRecord({ type: 'fmr', year: null, wkt: 'LINESTRING(121.85 13.45, 121.86 13.46)' });
    expect(road.id).toBeTruthy();
  });

  it('needs a title or a category', async () => {
    await db.query(
      `insert into intervention_types (code, name, geometry_kind, color) values ('no-rules', 'No Rules', 'point', '#654321')`,
    );
    await expect(insertRecord({ type: 'no-rules', title: null, category: null })).rejects.toThrow(/check constraint/i);
    const row = await insertRecord({ type: 'no-rules', title: null, category: 'other' });
    expect(row.id).toBeTruthy();
  });

  it('rejects a category from another type, and allows one for any type', async () => {
    await expect(insertRecord({ type: 'fmr', category: 'seeder' })).rejects.toThrow(/does not belong/);
    const row = await insertRecord({ type: 'fmr', category: 'other', wkt: 'LINESTRING(121.85 13.45, 121.86 13.46)' });
    expect(row.id).toBeTruthy();
  });
});

describe('custom fields', () => {
  const machinery = { type: 'farm-machinery', category: 'seeder', title: null };

  it('accepts valid values', async () => {
    const row = await insertRecord({
      ...machinery,
      attributes: { variant: 'Pull type', engine_no: 'E-1', date_turned_over: '2024-03-01' },
    });
    expect(row.id).toBeTruthy();
  });

  it.each([
    ['an unknown field', { nonsense: 1 }, /unknown field/],
    ['a number for a text field', { engine_no: 5 }, /must be of kind text/],
    ['a badly formatted date', { date_turned_over: '03/01/2024' }, /must be a date/],
    ['an impossible date', { date_turned_over: '2024-13-45' }, /must be a date/],
  ])('rejects %s', async (_label, attributes, message) => {
    await expect(insertRecord({ ...machinery, attributes })).rejects.toThrow(message);
  });

  describe('with a dropdown and a required field', () => {
    beforeAll(async () => {
      await db.query(
        `insert into intervention_types (code, name, geometry_kind, color, field_schema)
         values ('nursery', 'Nursery', 'point', '#123457', '{"fields": [
           {"key": "scale", "label": "Scale", "input": "dropdown", "required": true,
            "options": [{"value": "small", "label": "Small"}, {"value": "large", "label": "Large"}]},
           {"key": "certified", "label": "Certified", "input": "yes_no"},
           {"key": "seedlings", "label": "Seedlings", "input": "number"}
         ]}')`,
      );
    });

    it('accepts valid values', async () => {
      const row = await insertRecord({ type: 'nursery', attributes: { scale: 'small', certified: true, seedlings: 40 } });
      expect(row.id).toBeTruthy();
    });

    it.each([
      ['a missing required field', { certified: true }, /scale is required/],
      ['an option not on the list', { scale: 'huge' }, /invalid option/],
      ['text for a yes/no field', { scale: 'small', certified: 'yes' }, /must be of kind yes_no/],
      ['text for a number field', { scale: 'small', seedlings: 'many' }, /must be of kind number/],
    ])('rejects %s', async (_label, attributes, message) => {
      await expect(insertRecord({ type: 'nursery', attributes })).rejects.toThrow(message);
    });

    it('does not block moving an existing record after a field becomes required', async () => {
      const row = await insertRecord({ type: 'nursery', attributes: { scale: 'small' } });
      await db.query(
        `update intervention_types
         set field_schema = jsonb_set(field_schema, '{fields,2,required}', 'true')
         where code = 'nursery'`,
      );
      await db.query(`update interventions set geom = ST_GeomFromText('POINT(121.85 13.46)', 4326) where id = $1`, [row.id]);
      expect(await flagsOf(row.id)).toEqual([]);
      await db.query(
        `update intervention_types
         set field_schema = jsonb_set(field_schema, '{fields,2,required}', 'false')
         where code = 'nursery'`,
      );
    });

    it('refuses to remove a field or option, and allows archiving', async () => {
      await expect(
        db.query(`update intervention_types set field_schema = '{"fields": []}' where code = 'nursery'`),
      ).rejects.toThrow(/cannot be removed/);

      await expect(
        db.query(
          `update intervention_types
           set field_schema = jsonb_set(field_schema, '{fields,0,options}', '[{"value": "small", "label": "Small"}]')
           where code = 'nursery'`,
        ),
      ).rejects.toThrow(/option large of field scale cannot be removed/);

      await db.query(
        `update intervention_types set field_schema = jsonb_set(field_schema, '{fields,1,archived}', 'true')
         where code = 'nursery'`,
      );
      const row = await insertRecord({ type: 'nursery', attributes: { scale: 'large' } });
      expect(row.id).toBeTruthy();
    });

    it('refuses to change a field input kind', async () => {
      await expect(
        db.query(
          `update intervention_types set field_schema = jsonb_set(field_schema, '{fields,2,input}', '"text"')
           where code = 'nursery'`,
        ),
      ).rejects.toThrow(/cannot change its input kind/);
    });
  });

  it.each([
    ['no fields array', '{}', /"fields" array/],
    ['a bad key', '{"fields": [{"key": "Bad Key", "label": "x", "input": "text"}]}', /invalid field key/],
    ['a duplicate key', '{"fields": [{"key": "a", "label": "x", "input": "text"}, {"key": "a", "label": "y", "input": "text"}]}', /duplicate field key/],
    ['no label', '{"fields": [{"key": "a", "input": "text"}]}', /needs a label/],
    ['a bad input kind', '{"fields": [{"key": "a", "label": "x", "input": "slider"}]}', /invalid input kind/],
    ['a dropdown with no options', '{"fields": [{"key": "a", "label": "x", "input": "dropdown"}]}', /needs options/],
  ])('rejects a field schema with %s', async (_label, schema, message) => {
    await expect(
      db.query(
        `insert into intervention_types (code, name, geometry_kind, color, field_schema)
         values ('bad', 'Bad', 'point', '#000000', $1::jsonb)`,
        [schema],
      ),
    ).rejects.toThrow(message);
  });
});

describe('barangay baseline attributes', () => {
  it('accepts valid values', async () => {
    await db.query(
      `update barangays set attributes = '{"agricultural_area_ha": 120.5, "farmer_count": 80, "main_crops": "Rice, coconut"}'
       where id = $1`,
      [boacBarangay],
    );
    const { attributes } = await one<{ attributes: { farmer_count: number } }>(
      'select attributes from barangays where id = $1',
      [boacBarangay],
    );
    expect(attributes.farmer_count).toBe(80);
  });

  it('rejects a wrong kind and an unknown field', async () => {
    await expect(
      db.query(`update barangays set attributes = '{"farmer_count": "many"}' where id = $1`, [boacBarangay]),
    ).rejects.toThrow(/must be of kind number/);
    await expect(
      db.query(`update barangays set attributes = '{"nonsense": 1}' where id = $1`, [boacBarangay]),
    ).rejects.toThrow(/unknown field/);
  });
});

describe('status history', () => {
  const statusNamed = async (name: string) =>
    (await one<{ id: number }>('select id from statuses where name = $1', [name])).id;

  async function addStatus(id: string, status: string, date: string) {
    await db.query('insert into status_history (intervention_id, status_id, status_date) values ($1, $2, $3)', [
      id,
      await statusNamed(status),
      date,
    ]);
  }

  async function currentStatus(id: string) {
    const row = await one<{ name: string | null }>(
      'select s.name from interventions i left join statuses s on s.id = i.status_id where i.id = $1',
      [id],
    );
    return row.name;
  }

  it('starts with no status and follows the latest entry', async () => {
    const row = await insertRecord({});
    expect(await currentStatus(row.id)).toBeNull();
    await addStatus(row.id, 'Operational', '2024-01-01');
    expect(await currentStatus(row.id)).toBe('Operational');
    await addStatus(row.id, 'Needs Repair', '2025-01-01');
    expect(await currentStatus(row.id)).toBe('Needs Repair');
  });

  it('keeps the whole history rather than overwriting', async () => {
    const row = await insertRecord({});
    await addStatus(row.id, 'Proposed', '2022-01-01');
    await addStatus(row.id, 'Completed', '2023-01-01');
    await addStatus(row.id, 'Operational', '2024-01-01');
    const { rows } = await db.query<{ name: string }>(
      `select s.name from status_history h join statuses s on s.id = h.status_id
       where h.intervention_id = $1 order by h.status_date`,
      [row.id],
    );
    expect(rows.map((r) => r.name)).toEqual(['Proposed', 'Completed', 'Operational']);
  });

  it('does not let a backdated entry replace the current status', async () => {
    const row = await insertRecord({});
    await addStatus(row.id, 'Operational', '2025-06-01');
    await addStatus(row.id, 'Proposed', '2020-01-01');
    expect(await currentStatus(row.id)).toBe('Operational');
  });

  it('treats a date as a change date unless told it is an as-of date', async () => {
    const row = await insertRecord({});
    await addStatus(row.id, 'Operational', '2025-06-01');
    const { date_basis } = await one<{ date_basis: string }>(
      'select date_basis from status_history where intervention_id = $1',
      [row.id],
    );
    expect(date_basis).toBe('changed');
    await expect(
      db.query(
        `insert into status_history (intervention_id, status_id, date_basis)
         values ($1, (select id from statuses where name = 'Operational'), 'maybe')`,
        [row.id],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('ignores a direct edit of status_id', async () => {
    const row = await insertRecord({});
    await addStatus(row.id, 'Operational', '2025-06-01');
    await db.query('update interventions set status_id = $1 where id = $2', [await statusNamed('Unknown'), row.id]);
    expect(await currentStatus(row.id)).toBe('Operational');
  });

  it('ignores a status_id supplied on insert', async () => {
    const row = await one<{ status_id: number | null }>(
      `insert into interventions (intervention_type_id, title, municipality_id, status_id)
       values ((select id from intervention_types where code = 'other'), 'x', $1, $2) returning status_id`,
      [boac, await statusNamed('Operational')],
    );
    expect(row.status_id).toBeNull();
  });

  it('rejects a status outside the type\'s list', async () => {
    const machinery = await insertRecord({ type: 'farm-machinery', category: 'seeder', title: null });
    await expect(addStatus(machinery.id, 'Operational', '2024-01-01')).rejects.toThrow(/not in the status list/);

    const ssip = await insertRecord({ type: 'ssip', category: 'spis' });
    await expect(addStatus(ssip.id, 'Turned-over', '2024-01-01')).rejects.toThrow(/not in the status list/);
  });
});

describe('optimistic locking', () => {
  it('increases version on each edit, so a stale write changes nothing', async () => {
    const row = await insertRecord({});
    expect(row.version).toBe(1);

    await db.query(`update interventions set remarks = 'first' where id = $1 and version = 1`, [row.id]);
    const stale = await db.query(`update interventions set remarks = 'second' where id = $1 and version = 1`, [row.id]);
    expect(stale.affectedRows ?? 0).toBe(0);

    const { remarks, version } = await one<{ remarks: string; version: number }>(
      'select remarks, version from interventions where id = $1',
      [row.id],
    );
    expect(remarks).toBe('first');
    expect(version).toBe(2);
  });
});

describe('audit log', () => {
  const auditFor = (id: string) =>
    db
      .query<{ action: string; old_row: { remarks?: string } | null; new_row: { remarks?: string } | null }>(
        `select action, old_row, new_row from audit_log where table_name = 'interventions' and record_id = $1 order by id`,
        [id],
      )
      .then((r) => r.rows);

  it('records a create, an edit, a soft delete, a restore and a delete', async () => {
    const row = await insertRecord({});
    await db.query(`update interventions set remarks = 'edited' where id = $1`, [row.id]);
    await db.query('update interventions set deleted_at = now() where id = $1', [row.id]);
    await db.query('update interventions set deleted_at = null where id = $1', [row.id]);
    await db.query('delete from interventions where id = $1', [row.id]);

    const entries = await auditFor(row.id);
    expect(entries.map((e) => e.action)).toEqual(['insert', 'update', 'soft_delete', 'restore', 'delete']);
    expect(entries[1].old_row?.remarks).toBeNull();
    expect(entries[1].new_row?.remarks).toBe('edited');
  });

  it('does not log a neighbour whose flag was only refreshed', async () => {
    const point = { lat: 13.41, lon: 121.82 };
    const first = await insertRecord(point);
    await insertRecord(point);
    expect((await auditFor(first.id)).map((e) => e.action)).toEqual(['insert']);
  });

  it('logs a status change once, in status_history', async () => {
    const row = await insertRecord({});
    await db.query(
      `insert into status_history (intervention_id, status_id) values ($1, (select id from statuses where name = 'Completed'))`,
      [row.id],
    );
    const { n } = await one<{ n: number }>(
      `select count(*)::int n from audit_log where table_name = 'status_history' and new_row ->> 'intervention_id' = $1`,
      [row.id],
    );
    expect(n).toBe(1);
    expect((await auditFor(row.id)).map((e) => e.action)).toEqual(['insert']);
  });

  it('records changes to lookups and intervention types', async () => {
    await db.query(`update programs set color = '#111111' where code = 'rice'`);
    await db.query(`update intervention_types set color = '#222222' where code = 'other'`);
    const { rows } = await db.query<{ table_name: string }>(
      `select distinct table_name from audit_log where table_name in ('programs', 'intervention_types')`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(['intervention_types', 'programs']);
  });

  it('did not log the starting data or copy polygons', async () => {
    const { n } = await one<{ n: number }>(
      `select count(*)::int n from audit_log where table_name = 'barangays' and new_row ? 'boundary'`,
    );
    expect(n).toBe(0);
    const { lookups } = await one<{ lookups: number }>(
      `select count(*)::int lookups from audit_log where table_name = 'location_bases'`,
    );
    expect(lookups).toBe(0);
  });
});

describe('constraints', () => {
  it('rejects a barangay from another municipality', async () => {
    await expect(insertRecord({ municipality: boac, barangay: gasanBarangay })).rejects.toThrow(/foreign key/i);
  });

  it('rejects a future year and a year before 2000', async () => {
    await expect(insertRecord({ year: new Date().getFullYear() + 2 })).rejects.toThrow(/future/);
    await expect(insertRecord({ year: 1999 })).rejects.toThrow(/check constraint/i);
  });
});

describe('row-level security', () => {
  const MEMBER = '11111111-1111-1111-1111-111111111111';
  const STRANGER = '22222222-2222-2222-2222-222222222222';
  const ADMIN = '33333333-3333-3333-3333-333333333333';

  beforeAll(async () => {
    await db.query('insert into auth.users (id) values ($1), ($2), ($3)', [MEMBER, STRANGER, ADMIN]);
    await db.query(`insert into profiles (id, role) values ($1, 'viewer'), ($2, 'admin')`, [MEMBER, ADMIN]);
    await insertRecord({ lat: 13.46, lon: 121.87 });
  });

  async function as<T>(role: 'anon' | 'authenticated', userId: string, work: () => Promise<T>): Promise<T> {
    await db.exec(`set role ${role}`);
    await db.query(`select set_config('request.jwt.sub', $1, false)`, [userId]);
    try {
      return await work();
    } finally {
      await db.exec('reset role');
      await db.query(`select set_config('request.jwt.sub', '', false)`);
    }
  }

  const countOf = (from: string) => async () => (await one<{ n: number }>(`select count(*)::int n from ${from}`)).n;
  const countRecords = countOf('interventions');

  it('blocks anonymous visitors from reading', async () => {
    await expect(as('anon', '', countRecords)).rejects.toThrow(/permission denied/i);
    await expect(as('anon', '', countOf('municipalities'))).rejects.toThrow(/permission denied/i);
    await expect(as('anon', '', countOf('interventions_v'))).rejects.toThrow(/permission denied/i);
  });

  it('shows nothing to a signed-in account with no profile', async () => {
    expect(await as('authenticated', STRANGER, countRecords)).toBe(0);
    expect(await as('authenticated', STRANGER, countOf('programs'))).toBe(0);
    expect(await as('authenticated', STRANGER, countOf('location_bases'))).toBe(0);
    expect(await as('authenticated', STRANGER, countOf('interventions_v'))).toBe(0);
  });

  it('lets a member read records but hides soft-deleted ones', async () => {
    const visible = await as('authenticated', MEMBER, countRecords);
    expect(visible).toBeGreaterThan(0);

    const total = await countRecords();
    const notDeleted = (await one<{ n: number }>('select count(*)::int n from interventions where deleted_at is null')).n;
    expect(total).toBeGreaterThan(notDeleted);
    expect(visible).toBe(notDeleted);
  });

  it('applies the same rule through the read view', async () => {
    const visible = await as('authenticated', MEMBER, countRecords);
    expect(await as('authenticated', MEMBER, countOf('interventions_v'))).toBe(visible);
  });

  it('blocks a viewer from writing', async () => {
    // Row-level security filters out every row of an update rather than raising an error.
    const update = await as('authenticated', MEMBER, () => db.query('update interventions set remarks = $1', ['changed']));
    expect(update.affectedRows ?? 0).toBe(0);

    await expect(as('authenticated', MEMBER, () => insertRecord({}))).rejects.toThrow(/permission denied|row-level security/i);
  });

  it('limits the audit log to admins', async () => {
    expect(await as('authenticated', MEMBER, countOf('audit_log'))).toBe(0);
    expect(await as('authenticated', ADMIN, countOf('audit_log'))).toBeGreaterThan(0);
  });

  it('shows saved views only to their owner, unless shared', async () => {
    await db.query(`insert into saved_views (name, owner_id) values ('private', $1)`, [ADMIN]);
    await db.query(`insert into saved_views (name, owner_id, is_shared) values ('shared', $1, true)`, [ADMIN]);

    const names = async () => (await db.query<{ name: string }>('select name from saved_views order by name')).rows.map((r) => r.name);
    expect(await as('authenticated', MEMBER, names)).toEqual(['shared']);
    expect(await as('authenticated', ADMIN, names)).toEqual(['private', 'shared']);
    expect(await as('authenticated', STRANGER, names)).toEqual([]);
  });
});
