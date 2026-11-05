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

// Inserts a record the way the seed will, with the real polygons, and returns its QA flags.
async function flagsFor(municipality: string, barangay: string, lat: number, lon: number) {
  const [row] = await rows<{ qa_flags: string[] }>(
    `insert into interventions
       (intervention_type, category_id, name_raw, banner_program_id, year_funded, beneficiary,
        municipality_id, barangay_id, latitude, longitude, status)
     select 'machinery', (select id from categories where code = 'other'), 'Test',
        (select id from programs where code = 'rice'), 2022, 'Test FA', m.id, b.id, $3, $4, 'Turned-over'
     from municipalities m join barangays b on b.municipality_id = m.id
     where m.name = $1 and b.name = $2
     returning qa_flags`,
    [municipality, barangay, lat, lon],
  );
  if (!row) throw new Error(`Barangay not found: ${barangay}, ${municipality}`);
  return row.qa_flags;
}

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

  it('accepts the two example coordinates quoted in the spec', async () => {
    expect(await flagsFor('Santa Cruz', 'Tawiran', 13.4671083, 122.06859)).toEqual([]);
    expect(await flagsFor('Gasan', 'Bacongbacong', 13.289232, 121.867325)).toEqual([]);
  });

  it('flags a Santa Cruz point encoded as Gasan', async () => {
    expect(await flagsFor('Gasan', 'Pangi', 13.47, 122.07)).toEqual(['muni_mismatch']);
  });
});
