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

type Row = { id: string; qa_flags: string[]; latitude: string | null; longitude: string | null; geom: string | null };

interface NewRecord {
  lat: number | null;
  lon: number | null;
  municipality?: number;
  barangay?: number | null;
  year?: number;
}

async function insertRecord({ lat, lon, municipality = boac, barangay = boacBarangay, year = 2022 }: NewRecord) {
  return one<Row>(
    `insert into interventions
       (intervention_type, category_id, name_raw, banner_program_id, year_funded, beneficiary,
        municipality_id, barangay_id, latitude, longitude, status)
     values ('machinery', (select id from categories where code = 'test-category'), 'Hand Tractor',
        (select id from programs where code = 'rice'), $1, 'Test FA', $2, $3, $4, $5, 'Turned-over')
     returning id, qa_flags, latitude, longitude, geom`,
    [year, municipality, barangay, lat, lon],
  );
}

async function flagsOf(id: string): Promise<string[]> {
  return (await one<{ qa_flags: string[] }>('select qa_flags from interventions where id = $1', [id])).qa_flags;
}

beforeAll(async () => {
  db = await createTestDb();
  await db.query(`insert into categories (code, name, group_code) values ('test-category', 'Test Category', 'other')`);

  const muni = async (name: string) =>
    (await one<{ id: number }>('select id from municipalities where name = $1', [name])).id;
  boac = await muni('Boac');
  gasan = await muni('Gasan');
  torrijos = await muni('Torrijos');

  await db.query('update municipalities set boundary = ST_GeomFromText($1, 4326) where id = $2', [BOAC_SQUARE, boac]);
  await db.query('update municipalities set boundary = ST_GeomFromText($1, 4326) where id = $2', [GASAN_SQUARE, gasan]);

  await db.query('update municipalities set boundary = null where id = $1', [torrijos]);

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

describe('reference data', () => {
  it('loads the programs and municipalities', async () => {
    const count = async (table: string) => (await one<{ n: number }>(`select count(*)::int n from ${table}`)).n;
    expect(await count('programs')).toBe(6);
    expect(await count('municipalities')).toBe(6);
  });
});

describe('coordinates and QA flags', () => {
  it('stores 0,0 as unlocated with no geometry', async () => {
    const row = await insertRecord({ lat: 0, lon: 0 });
    expect(row.latitude).toBeNull();
    expect(row.longitude).toBeNull();
    expect(row.geom).toBeNull();
    expect(row.qa_flags).toEqual(['no_coords']);
  });

  it('keeps and flags the out-of-province Malibago longitude without correcting it', async () => {
    const row = await insertRecord({
      lat: 13.33,
      lon: 122.90523,
      municipality: torrijos,
      barangay: torrijosBarangay,
    });
    expect(Number(row.longitude)).toBe(122.90523);
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
    const row = await insertRecord({
      lat: 13.33,
      lon: 122.08,
      municipality: torrijos,
      barangay: torrijosBarangay,
    });
    expect(row.qa_flags).toEqual([]);
  });

  it('clears flags when a bad coordinate is corrected', async () => {
    const row = await insertRecord({ lat: 13.33, lon: 122.90523, municipality: torrijos, barangay: torrijosBarangay });
    await db.query('update interventions set longitude = 122.0812 where id = $1', [row.id]);
    expect(await flagsOf(row.id)).toEqual([]);
  });
});

describe('shared coordinates', () => {
  it('flags both records and clears the flag when one moves away', async () => {
    const first = await insertRecord({ lat: IN_GASAN.lat, lon: IN_GASAN.lon, municipality: gasan, barangay: gasanBarangay });
    expect(first.qa_flags).toEqual([]);

    const second = await insertRecord({ lat: IN_GASAN.lat, lon: IN_GASAN.lon, municipality: gasan, barangay: gasanBarangay });
    expect(second.qa_flags).toEqual(['duplicate_point']);
    expect(await flagsOf(first.id)).toEqual(['duplicate_point']);

    await db.query('update interventions set latitude = 13.26 where id = $1', [second.id]);
    expect(await flagsOf(first.id)).toEqual([]);
    expect(await flagsOf(second.id)).toEqual([]);
  });

  it('clears the flag when a record at the point is soft-deleted', async () => {
    const point = { lat: 13.27, lon: 121.86, municipality: gasan, barangay: gasanBarangay };
    const first = await insertRecord(point);
    const second = await insertRecord(point);
    await db.query('update interventions set deleted_at = now() where id = $1', [second.id]);
    expect(await flagsOf(first.id)).toEqual([]);
  });

  it('clears the flag when a record at the point is removed', async () => {
    const point = { lat: 13.28, lon: 121.87, municipality: gasan, barangay: gasanBarangay };
    const first = await insertRecord(point);
    const second = await insertRecord(point);
    await db.query('delete from interventions where id = $1', [second.id]);
    expect(await flagsOf(first.id)).toEqual([]);
  });

  it('does not change updated_at on a record whose flag is only refreshed', async () => {
    const point = { lat: 13.29, lon: 121.88, municipality: gasan, barangay: gasanBarangay };
    const first = await insertRecord(point);
    const before = await one<{ updated_at: string }>('select updated_at::text from interventions where id = $1', [first.id]);
    await insertRecord(point);
    const after = await one<{ updated_at: string }>('select updated_at::text from interventions where id = $1', [first.id]);
    expect(after.updated_at).toBe(before.updated_at);
  });
});

describe('barangay flags', () => {
  const unlocated = { lat: null, lon: null, barangay: null };

  it('flags a record with no barangay name as no_barangay', async () => {
    const row = await insertRecord(unlocated);
    expect(row.qa_flags).toEqual(['no_coords', 'no_barangay']);
  });

  it('treats a blank barangay name as no_barangay', async () => {
    const row = await insertRecord(unlocated);
    await db.query(`update interventions set barangay_raw = '   ' where id = $1`, [row.id]);
    expect(await flagsOf(row.id)).toEqual(['no_coords', 'no_barangay']);
  });

  it('flags a named barangay that has no match as barangay_unmatched', async () => {
    const row = await insertRecord(unlocated);
    await db.query(`update interventions set barangay_raw = 'Barangay 367' where id = $1`, [row.id]);
    expect(await flagsOf(row.id)).toEqual(['no_coords', 'barangay_unmatched']);
  });

  it('clears the flag once the barangay is linked', async () => {
    const row = await insertRecord(unlocated);
    await db.query(`update interventions set barangay_raw = 'Ihatub', barangay_id = $1 where id = $2`, [
      boacBarangay,
      row.id,
    ]);
    expect(await flagsOf(row.id)).toEqual(['no_coords']);
  });
});

describe('constraints', () => {
  it('rejects a barangay from another municipality', async () => {
    await expect(insertRecord({ lat: null, lon: null, municipality: boac, barangay: gasanBarangay })).rejects.toThrow(
      /foreign key/i,
    );
  });

  it('rejects a latitude without a longitude', async () => {
    await expect(insertRecord({ lat: 13.4, lon: null })).rejects.toThrow(/check constraint/i);
  });

  it('rejects a future year and a year before 2000', async () => {
    await expect(insertRecord({ lat: null, lon: null, year: new Date().getFullYear() + 2 })).rejects.toThrow(/future/);
    await expect(insertRecord({ lat: null, lon: null, year: 1999 })).rejects.toThrow(/check constraint/i);
  });
});

describe('row-level security', () => {
  const MEMBER = '11111111-1111-1111-1111-111111111111';
  const STRANGER = '22222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    await db.query('insert into auth.users (id) values ($1), ($2)', [MEMBER, STRANGER]);
    await db.query(`insert into profiles (id, role) values ($1, 'viewer')`, [MEMBER]);
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

  const countRecords = async () => (await one<{ n: number }>('select count(*)::int n from interventions')).n;

  it('blocks anonymous visitors from reading', async () => {
    await expect(as('anon', '', countRecords)).rejects.toThrow(/permission denied/i);
    await expect(
      as('anon', '', () => one('select count(*) from municipalities')),
    ).rejects.toThrow(/permission denied/i);
  });

  it('shows nothing to a signed-in account with no profile', async () => {
    expect(await as('authenticated', STRANGER, countRecords)).toBe(0);
    const lookups = await as('authenticated', STRANGER, () =>
      one<{ n: number }>('select count(*)::int n from programs'),
    );
    expect(lookups.n).toBe(0);
  });

  it('lets a member read records but hides soft-deleted ones', async () => {
    const visible = await as('authenticated', MEMBER, countRecords);
    expect(visible).toBeGreaterThan(0);

    const total = await countRecords();
    const notDeleted = (
      await one<{ n: number }>('select count(*)::int n from interventions where deleted_at is null')
    ).n;
    expect(total).toBeGreaterThan(notDeleted); // a soft-deleted record exists from earlier tests
    expect(visible).toBe(notDeleted);
  });

  it('blocks a member from writing until Phase 5 policies exist', async () => {
    // With no update policy, row-level security filters out every row rather than raising an error.
    const update = await as('authenticated', MEMBER, () =>
      db.query('update interventions set remarks = $1', ['changed']),
    );
    expect(update.affectedRows ?? 0).toBe(0);

    await expect(as('authenticated', MEMBER, () => insertRecord({ lat: null, lon: null }))).rejects.toThrow(
      /row-level security/i,
    );
  });
});
