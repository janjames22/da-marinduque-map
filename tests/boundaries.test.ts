import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb } from './helpers/db';

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

// Inserts a record the way the seed will, with the real polygons, and returns its id and flags.
async function insertAt(type: string, municipality: string, barangay: string, wkt: string) {
  const [row] = await rows<{ id: string; qa_flags: string[] }>(
    `insert into interventions (intervention_type_id, title, municipality_id, barangay_id, geom)
     select (select id from intervention_types where code = $1), 'Test', m.id, b.id, ST_GeomFromText($4, 4326)
     from municipalities m join barangays b on b.municipality_id = m.id
     where m.name = $2 and b.name = $3
     returning id, qa_flags`,
    [type, municipality, barangay, wkt],
  );
  if (!row) throw new Error(`Barangay not found: ${barangay}, ${municipality}`);
  return row;
}

const flagsFor = async (municipality: string, barangay: string, lat: number, lon: number) =>
  (await insertAt('other', municipality, barangay, `POINT(${lon} ${lat})`)).qa_flags;

describe('real Marinduque boundaries', () => {
  it('has a valid polygon for all six municipalities', async () => {
    const result = await rows<{ name: string; ok: boolean }>(
      `select name, boundary is not null and ST_IsValid(boundary) as ok from municipalities order by name`,
    );
    expect(result).toEqual(
      ['Boac', 'Buenavista', 'Gasan', 'Mogpog', 'Santa Cruz', 'Torrijos'].map((name) => ({ name, ok: true })),
    );
  });

  it('has 218 barangays, all with a valid polygon', async () => {
    const [result] = await rows<{ total: number; valid: number }>(
      `select count(*)::int total, count(*) filter (where ST_IsValid(boundary))::int valid from barangays`,
    );
    expect(result).toEqual({ total: 218, valid: 218 });
  });

  it('fits inside the validation bounding box from the spec', async () => {
    const [box] = await rows<{ xmin: number; xmax: number; ymin: number; ymax: number }>(
      `select ST_XMin(e) xmin, ST_XMax(e) xmax, ST_YMin(e) ymin, ST_YMax(e) ymax
       from (select ST_Extent(boundary)::geometry e from municipalities) s`,
    );
    expect(box.xmin).toBeGreaterThanOrEqual(121.78);
    expect(box.xmax).toBeLessThanOrEqual(122.2);
    expect(box.ymin).toBeGreaterThanOrEqual(13.15);
    expect(box.ymax).toBeLessThanOrEqual(13.6);
  });

  it('does not place the two example coordinates in the spec outside their municipality', async () => {
    expect(await flagsFor('Santa Cruz', 'Tawiran', 13.4671083, 122.06859)).not.toContain('muni_mismatch');
    expect(await flagsFor('Gasan', 'Bacongbacong', 13.289232, 121.867325)).not.toContain('muni_mismatch');
  });

  it('flags a Santa Cruz point encoded as Gasan at both levels', async () => {
    expect(await flagsFor('Gasan', 'Pangi', 13.47, 122.07)).toEqual(['muni_mismatch', 'barangay_mismatch']);
  });
});

describe('barangay links on real polygons', () => {
  const linksOf = (id: string) =>
    rows<{ name: string; link_source: string; municipality: string }>(
      `select b.name, l.link_source, m.name as municipality
       from intervention_barangays l
       join barangays b on b.id = l.barangay_id
       join municipalities m on m.id = b.municipality_id
       where l.intervention_id = $1`,
      [id],
    );

  it('links a point to its encoded barangay only', async () => {
    const { id } = await insertAt('other', 'Gasan', 'Bacongbacong', 'POINT(121.8673 13.2892)');
    expect(await linksOf(id)).toEqual([{ name: 'Bacongbacong', link_source: 'encoded', municipality: 'Gasan' }]);
  });

  it('links a point outside its encoded barangay to the encoded one, not where it is plotted', async () => {
    const { id, qa_flags } = await insertAt('other', 'Gasan', 'Pangi', 'POINT(122.07 13.47)');
    expect(qa_flags).toContain('barangay_mismatch');
    expect((await linksOf(id)).map((l) => l.name)).toEqual(['Pangi']);
  });

  it('links a road to every barangay it crosses, across municipalities', async () => {
    const { id } = await insertAt('fmr', 'Boac', 'Tumapon', 'LINESTRING(121.86 13.45, 121.90 13.25)');
    const links = await linksOf(id);
    expect(links.length).toBeGreaterThan(3);
    expect(new Set(links.map((l) => l.municipality)).size).toBeGreaterThan(1);
    expect(links.filter((l) => l.link_source === 'encoded').map((l) => l.name)).toEqual(['Tumapon']);
  });

  it('links a service area to the barangays it covers', async () => {
    const { id } = await insertAt(
      'service-area',
      'Boac',
      'Tumapon',
      'POLYGON((121.85 13.42, 121.90 13.42, 121.90 13.46, 121.85 13.46, 121.85 13.42))',
    );
    expect((await linksOf(id)).length).toBeGreaterThan(1);
  });

  it('updates the links when a shape is redrawn', async () => {
    const { id } = await insertAt('fmr', 'Boac', 'Tumapon', 'LINESTRING(121.86 13.45, 121.90 13.25)');
    const before = (await linksOf(id)).length;
    await db.query(`update interventions set geom = ST_GeomFromText('LINESTRING(121.8600 13.4500, 121.8601 13.4501)', 4326) where id = $1`, [id]);
    expect((await linksOf(id)).length).toBeLessThan(before);
  });

  it('counts a road once in a municipal total, even though it is in several barangays', async () => {
    const { id } = await insertAt('fmr', 'Boac', 'Tumapon', 'LINESTRING(121.86 13.45, 121.90 13.40)');
    expect((await linksOf(id)).length).toBeGreaterThan(1);
    const [{ n }] = await rows<{ n: number }>(
      `select count(*)::int n from interventions i
       join municipalities m on m.id = i.municipality_id
       where m.name = 'Boac' and i.id = $1`,
      [id],
    );
    expect(n).toBe(1);
  });
});
