import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  normalizeBarangayName,
  parseSeedCsv,
  printReport,
  seedInterventions,
  SEED_CSV_PATH,
  type SeedReport,
  type SeedRow,
} from '../scripts/seed-interventions';
import { createTestDb } from './helpers/db';

const flagged = (row: SeedRow, flag: string) => row.qa_flags.split(';').includes(flag);

let db: PGlite;
let csv: SeedRow[];
let report: SeedReport;
let recordsAfterFailedSeed: number;

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function count(where: string): Promise<number> {
  const [{ n }] = await rows<{ n: number }>(`select count(*)::int n from interventions where ${where}`);
  return n;
}

const withFlag = (flag: string) => count(`'${flag}' = any(qa_flags)`);

async function sourceIdsWithFlag(flag: string): Promise<string[]> {
  const result = await rows<{ source_id: string }>(
    `select source_id from interventions where $1 = any(qa_flags) order by source_id`,
    [flag],
  );
  return result.map((r) => r.source_id);
}

async function tally(sql: string): Promise<Record<string, number>> {
  const result = await rows<{ key: string; n: number }>(sql);
  return Object.fromEntries(result.map(({ key, n }) => [key, n]));
}

beforeAll(async () => {
  db = await createTestDb();
  csv = parseSeedCsv(readFileSync(SEED_CSV_PATH, 'utf8'));

  // A bad last row must undo everything. If it didn't, the real seed below would also
  // fail on the categories already inserted.
  const badLastRow = { ...csv[csv.length - 1], municipality: 'Atlantis' };
  await expect(seedInterventions(db, [...csv.slice(0, -1), badLastRow])).rejects.toThrow(/Atlantis/);
  recordsAfterFailedSeed = await count('true');

  report = await seedInterventions(db, csv);
  printReport(report);
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('record counts match the source report', () => {
  it('loads all 199 records: 195 machinery and 4 SPIS', async () => {
    expect(report.inserted).toBe(199);
    expect(await count('true')).toBe(199);
    expect(await tally(`select intervention_type::text key, count(*)::int n from interventions group by 1`)).toEqual({
      machinery: 195,
      spis: 4,
    });
  });

  it('matches the per-municipality counts', async () => {
    expect(
      await tally(
        `select m.name key, count(*)::int n
         from interventions i join municipalities m on m.id = i.municipality_id group by 1`,
      ),
    ).toEqual({ 'Santa Cruz': 48, Boac: 38, Torrijos: 36, Gasan: 33, Mogpog: 25, Buenavista: 19 });
  });

  it('matches the status counts, with the 4 SPIS as Unknown', async () => {
    expect(await tally(`select status::text key, count(*)::int n from interventions group by 1`)).toEqual({
      'Turned-over': 163,
      Serviceable: 32,
      Unknown: 4,
    });
    expect(await count(`status = 'Unknown' and intervention_type <> 'spis'`)).toBe(0);
  });

  it('leaves nothing behind when a row fails', () => {
    expect(recordsAfterFailedSeed).toBe(0);
  });
});

describe('lookups', () => {
  it('adds the Urban and Peri-Urban program, and every record has its program', async () => {
    const programs = await rows<{ name: string }>('select name from programs');
    expect(programs).toHaveLength(6);
    expect(programs.map((p) => p.name)).toContain('National Urban and Peri-Urban Agriculture Program');

    const [{ n }] = await rows<{ n: number }>(
      `select count(*)::int n from interventions i join programs p on p.id = i.banner_program_id
       where p.code = 'urban'`,
    );
    expect(n).toBe(1);
  });

  it('seeds categories from exactly the distinct CSV category and group values', async () => {
    const seeded = await rows<{ name: string; group_code: string }>(
      'select name, group_code::text from categories order by name',
    );
    const expected = [...new Set(csv.map((r) => `${r.category}|${r.category_group}`))]
      .map((pair) => {
        const [name, group] = pair.split('|');
        return { name, group_code: group.toLowerCase().replaceAll(' ', '_') };
      })
      .sort((a, b) => (a.name < b.name ? -1 : 1));

    expect(seeded.slice().sort((a, b) => (a.name < b.name ? -1 : 1))).toEqual(expected);
    expect(seeded).toHaveLength(28);
  });
});

describe('QA flags are computed by the database', () => {
  it('finds the expected counts', async () => {
    expect(await withFlag('no_coords')).toBe(26);
    expect(await withFlag('out_of_province')).toBe(1);
    expect(await withFlag('no_barangay')).toBe(5);
  });

  it('flags the Malibago record for its longitude and leaves the value uncorrected', async () => {
    const [malibago] = await rows<{ longitude: string; longitude_raw: string; barangay_raw: string; municipality: string }>(
      `select i.longitude, i.longitude_raw, i.barangay_raw, m.name as municipality
       from interventions i join municipalities m on m.id = i.municipality_id
       where 'out_of_province' = any(i.qa_flags)`,
    );
    expect(malibago.barangay_raw).toBe('Malibago');
    expect(malibago.municipality).toBe('Torrijos');
    expect(Number(malibago.longitude)).toBe(122.90523);
    expect(malibago.longitude_raw).toBe('122.90523');
  });

  it('flags the same records as the CSV, not just the same number', () => {
    for (const difference of report.flagDifferences) {
      expect(difference).toMatchObject({ onlyInCsv: [], onlyInDb: [] });
    }
    expect(report.flagDifferences.map((d) => d.dbFlag)).toEqual([
      'no_coords',
      'out_of_province',
      'no_barangay',
      'duplicate_point',
    ]);
  });

  it('runs the point-in-polygon check on every located record', async () => {
    // Recalculated here, separately from the trigger, against the same polygons and tolerance.
    const located = await rows<{ source_id: string; has_geom: boolean; has_boundary: boolean; inside: boolean; flagged: boolean }>(
      `select i.source_id,
              i.geom is not null as has_geom,
              m.boundary is not null as has_boundary,
              coalesce(ST_DWithin(m.boundary::geography, i.geom::geography, 250), false) as inside,
              'muni_mismatch' = any(i.qa_flags) as flagged
       from interventions i join municipalities m on m.id = i.municipality_id
       where i.latitude is not null`,
    );

    expect(located).toHaveLength(199 - 26);
    expect(located.every((r) => r.has_geom && r.has_boundary)).toBe(true);
    expect(located.filter((r) => r.flagged !== !r.inside)).toEqual([]);

    const mismatches = located.filter((r) => r.flagged);
    console.log(`muni_mismatch: ${mismatches.length} of ${located.length} located records`);
    expect(mismatches.map((r) => r.source_id)).toContain('RAED-2026-10-21-103'); // Malibago, out of province
  });

  it('ignores computed flags supplied by the caller', async () => {
    // beneficiary_name_check is the only CSV flag sent on insert, so no other CSV flag can
    // reach the database. A caller writing one directly is overwritten too.
    await db.query('begin');
    await db.query(`update interventions set qa_flags = array['no_coords'] where latitude is not null`);
    expect(await count(`'no_coords' = any(qa_flags)`)).toBe(26);
    await db.query('rollback');
  });
});

describe('beneficiary_name_check is a carried-over manual flag', () => {
  it('keeps the same 7 records as the CSV', async () => {
    const expected = csv.filter((r) => flagged(r, 'beneficiary_name_check')).map((r) => r.source_id).sort();
    expect(expected).toHaveLength(7);
    expect(await sourceIdsWithFlag('beneficiary_name_check')).toEqual(expected);
  });

  it('survives an edit to the record', async () => {
    const [{ source_id }] = await rows<{ source_id: string }>(
      `select source_id from interventions where 'beneficiary_name_check' = any(qa_flags) limit 1`,
    );
    await db.query('begin');
    await db.query(`update interventions set remarks = 'edited', latitude = 13.3, longitude = 121.9 where source_id = $1`, [
      source_id,
    ]);
    expect(await sourceIdsWithFlag('beneficiary_name_check')).toContain(source_id);
    await db.query('rollback');
  });

  it('survives a flag refresh caused by a neighbouring record', async () => {
    const [target] = await rows<{ source_id: string; latitude: string; longitude: string }>(
      `select source_id, latitude, longitude from interventions
       where 'beneficiary_name_check' = any(qa_flags) and latitude is not null limit 1`,
    );
    await db.query('begin');
    await db.query(
      `update interventions set latitude = $1, longitude = $2
       where source_id = (select source_id from interventions where source_id <> $3 and latitude is not null limit 1)`,
      [target.latitude, target.longitude, target.source_id],
    );
    const [after] = await rows<{ qa_flags: string[] }>('select qa_flags from interventions where source_id = $1', [
      target.source_id,
    ]);
    expect(after.qa_flags).toContain('beneficiary_name_check');
    expect(after.qa_flags).toContain('duplicate_point');
    await db.query('rollback');
  });
});

describe('unlocated records', () => {
  it('stores empty coordinates as null and never as 0', async () => {
    expect(await count('latitude is null and longitude is null and geom is null')).toBe(26);
    expect(await count('latitude = 0 or longitude = 0')).toBe(0);
  });

  it('keeps the raw 0 for the two records that had it in the source', async () => {
    expect(await count(`latitude is null and latitude_raw = '0' and longitude_raw = '0'`)).toBe(2);
  });
});

describe('raw values are kept', () => {
  it('stores the raw columns exactly as they appear in the CSV', async () => {
    const stored = await rows<Record<string, string | null>>(
      `select source_id, name_raw, beneficiary_raw, municipality_raw, barangay_raw, latitude_raw, longitude_raw
       from interventions order by source_id`,
    );
    const blankToNull = (value: string) => (value === '' ? null : value);
    const expected = csv
      .slice()
      .sort((a, b) => (a.source_id < b.source_id ? -1 : 1))
      .map((r) => ({
        source_id: r.source_id,
        name_raw: r.name_raw,
        beneficiary_raw: r.beneficiary_raw,
        municipality_raw: r.municipality_raw,
        barangay_raw: blankToNull(r.barangay),
        latitude_raw: blankToNull(r.latitude_raw),
        longitude_raw: blankToNull(r.longitude_raw),
      }));
    expect(stored).toEqual(expected);
  });

  it('keeps the two Sta. Cruz spellings raw and the municipality standardized', async () => {
    const [{ n }] = await rows<{ n: number }>(
      `select count(*)::int n from interventions i join municipalities m on m.id = i.municipality_id
       where m.name = 'Santa Cruz' and i.municipality_raw in ('Sta. Cruz', 'Sta Cruz')`,
    );
    expect(n).toBe(2);
  });
});

describe('barangay matching', () => {
  it('normalizes case, spacing, hyphens, Pob./Poblacion and n-tilde', () => {
    const same = (a: string, b: string) => expect(normalizeBarangayName(a)).toBe(normalizeBarangayName(b));
    same('TAWIRAN', 'Tawiran');
    same('  Bagong   Silang ', 'Bagong Silang');
    same('Bicas-bicas', 'Bicas Bicas');
    same('Barangay I (Pob.)', 'Barangay I (Poblacion)');
    same('Pag-Asa Pob.', 'Pag Asa Poblacion');
    same('Kiñaman', 'Kinaman');
    same('Bicas–bicas', 'Bicas-bicas');
  });

  it('does not treat different names as the same', () => {
    expect(normalizeBarangayName('Pingan')).not.toBe(normalizeBarangayName('Pinggan'));
    expect(normalizeBarangayName('Pob')).not.toBe(normalizeBarangayName('Poblete'));
  });

  it('accounts for every record: matched, blank or unmatched', async () => {
    const matched = await count('barangay_id is not null');
    const blank = await count(`barangay_id is null and barangay_raw is null and 'no_barangay' = any(qa_flags)`);
    const unmatched = await count(`barangay_id is null and barangay_raw is not null and 'barangay_unmatched' = any(qa_flags)`);
    expect(blank).toBe(5);
    expect(unmatched).toBe(report.unmatchedBarangays.length);
    expect(matched + blank + unmatched).toBe(199);
  });

  it('only matches a barangay inside the record\'s own municipality', async () => {
    const [{ n }] = await rows<{ n: number }>(
      `select count(*)::int n from interventions i join barangays b on b.id = i.barangay_id
       where b.municipality_id <> i.municipality_id`,
    );
    expect(n).toBe(0);
  });

  it('reports closest candidates for every unmatched name', async () => {
    expect(report.unmatchedBarangays.length).toBeGreaterThan(0);
    for (const unmatched of report.unmatchedBarangays) {
      expect(unmatched.sameMunicipality.length).toBeGreaterThan(0);
      expect(unmatched.sameMunicipality.every((c) => c.municipality === unmatched.municipality)).toBe(true);
      expect(unmatched.otherMunicipalities.every((c) => c.municipality !== unmatched.municipality)).toBe(true);
    }
    expect(await sourceIdsWithFlag('barangay_unmatched')).toEqual(
      report.unmatchedBarangays.map((u) => u.sourceId).sort(),
    );
  });
});
