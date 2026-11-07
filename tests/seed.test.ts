import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import Papa from 'papaparse';
import { toMapData, type LocalSeed } from '../src/modules/intervention-map/data/local-store';
import {
  buildShading,
  countByBarangay,
  liveRecords,
  recordsInView,
  unassignedRecords,
  type ViewFilters,
} from '../src/modules/intervention-map/lib/choropleth';
import { isOnMap, statusDateLabel } from '../src/modules/intervention-map/lib/display';
import { buildVerificationRows, verificationCsv, type VerificationRow } from '../scripts/build-field-verification';
import { buildLocalSeed } from '../scripts/build-local-seed';
import {
  barangayNameKeys,
  checkCorrections,
  loadSeedFiles,
  normalizeBarangayName,
  parseCorrections,
  printReport,
  RAED_DATA_SOURCE,
  seedInterventions,
  type Correction,
  type SeedReport,
  type SeedRow,
} from '../scripts/seed-interventions';
import { createTestDb } from './helpers/db';

const flagged = (row: SeedRow, flag: string) => row.qa_flags.split(';').includes(flag);

const id = (n: string) => `RAED-2026-10-21-${n}`;

let db: PGlite;
let csv: SeedRow[];
let correctionsFile: Correction[];
let report: SeedReport;
let recordsAfterFailedSeed: number;

async function rows<T>(sql: string, params: unknown[] = [], target: PGlite = db): Promise<T[]> {
  return (await target.query<T>(sql, params)).rows;
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

// These tests pin the source data as reported, so they seed with no corrections. They keep
// passing when rows in corrections.csv are confirmed, which changes the seed's real output.
beforeAll(async () => {
  db = await createTestDb();
  ({ rows: csv, corrections: correctionsFile } = loadSeedFiles());

  // A bad last row must undo everything. If it didn't, the real seed below would also
  // fail on the records already inserted.
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
  it('loads all 199 records: 195 Farm Machinery and 4 SSIP', async () => {
    expect(report.inserted).toBe(199);
    expect(await count('true')).toBe(199);
    expect(
      await tally(
        `select t.name key, count(*)::int n
         from interventions i join intervention_types t on t.id = i.intervention_type_id group by 1`,
      ),
    ).toEqual({ 'Farm Machinery': 195, SSIP: 4 });
  });

  it('files the 4 SPIS records under SSIP, category SPIS', async () => {
    const [{ n }] = await rows<{ n: number }>(
      `select count(*)::int n from interventions i
       join intervention_types t on t.id = i.intervention_type_id
       join categories c on c.id = i.category_id
       where t.code = 'ssip' and c.name = 'Solar-Powered Irrigation System (SPIS)'`,
    );
    expect(n).toBe(4);
  });

  it('matches the per-municipality counts', async () => {
    expect(
      await tally(
        `select m.name key, count(*)::int n
         from interventions i join municipalities m on m.id = i.municipality_id group by 1`,
      ),
    ).toEqual({ 'Santa Cruz': 48, Boac: 38, Torrijos: 36, Gasan: 33, Mogpog: 25, Buenavista: 19 });
  });

  it('matches the status counts, with the SPIS records taking their status from Stage', async () => {
    expect(
      await tally(
        `select s.name key, count(*)::int n
         from interventions i join statuses s on s.id = i.status_id group by 1`,
      ),
    ).toEqual({ 'Turned-over': 163, Serviceable: 32, Inventory: 2, Completed: 2 });
  });

  it('matches the banner program counts', async () => {
    expect(
      await tally(
        `select p.code key, count(*)::int n
         from interventions i join programs p on p.id = i.banner_program_id group by 1`,
      ),
    ).toEqual({ rice: 62, hvcdp: 59, corn: 38, organic: 30, livestock: 9, urban: 1 });
  });

  it('leaves nothing behind when a row fails', () => {
    expect(recordsAfterFailedSeed).toBe(0);
  });
});

describe('RAED tagging', () => {
  it('tags every record and its batch as RAED 2026-10-21', async () => {
    expect(RAED_DATA_SOURCE).toBe('RAED 2026-10-21');
    expect(await count(`data_source = 'RAED 2026-10-21'`)).toBe(199);
    expect(await count('import_batch_id is null')).toBe(0);
  });

  it('files one import batch per type, as the import wizard will', async () => {
    const batches = await rows<{ code: string; data_source: string; records: number; linked: number }>(
      `select t.code, b.data_source, (b.counts ->> 'records')::int records,
              (select count(*)::int from interventions i where i.import_batch_id = b.id) linked
       from import_batches b join intervention_types t on t.id = b.intervention_type_id
       order by t.code`,
    );
    expect(batches).toEqual([
      { code: 'farm-machinery', data_source: RAED_DATA_SOURCE, records: 195, linked: 195 },
      { code: 'ssip', data_source: RAED_DATA_SOURCE, records: 4, linked: 4 },
    ]);
  });

  it('sets every RAED record to location basis Unknown', async () => {
    const [{ n }] = await rows<{ n: number }>(
      `select count(*)::int n from interventions i join location_bases l on l.id = i.location_basis_id
       where l.name = 'Unknown'`,
    );
    expect(n).toBe(199);
  });

  it('carries the CSV stage as status alone, keeping the raw value only in source_raw', async () => {
    expect(await count(`attributes ? 'stage'`)).toBe(0);
    expect(
      await tally(
        `select s.name key, count(*)::int n
         from interventions i
         join intervention_types t on t.id = i.intervention_type_id
         join statuses s on s.id = i.status_id
         where t.code = 'ssip' group by 1`,
      ),
    ).toEqual({ Inventory: 2, Completed: 2 });
    expect(await count(`source_raw ->> 'stage' <> ''`)).toBe(4);
  });

  it('moves the CSV variant to a custom field', async () => {
    expect(await count(`attributes ? 'variant'`)).toBe(40);
    const [row] = await rows<{ variant: string }>(
      `select attributes ->> 'variant' as variant from interventions where source_id = (
         select source_id from interventions where attributes ? 'variant' order by source_id limit 1)`,
    );
    expect(csv.map((r) => r.category_variant)).toContain(row.variant);
  });
});

describe('status history', () => {
  it('has one entry per record, and that entry is the current status', async () => {
    const [{ entries, matching }] = await rows<{ entries: number; matching: number }>(
      `select count(*)::int entries, count(*) filter (where h.status_id = i.status_id)::int matching
       from status_history h join interventions i on i.id = h.intervention_id`,
    );
    expect({ entries, matching }).toEqual({ entries: 199, matching: 199 });
  });

  it('records the RAED date as an as-of date, not a change date', async () => {
    const [{ as_of }] = await rows<{ as_of: number }>(
      `select count(*)::int as_of from status_history
       where status_date = '2026-10-21' and date_basis = 'as_of' and source_note = 'RAED report'`,
    );
    expect(as_of).toBe(199);
  });

  it('counts no RAED SSIP as operational, since Completed and Inventory do not count', async () => {
    expect(
      await tally(
        `select t.code key, count(*) filter (where ts.counts_as_operational)::int n
         from interventions i
         join intervention_types t on t.id = i.intervention_type_id
         join intervention_type_statuses ts on ts.intervention_type_id = t.id and ts.status_id = i.status_id
         group by 1`,
      ),
    ).toEqual({ 'farm-machinery': 195, ssip: 0 });
  });
});

describe('lookups', () => {
  it('adds the Urban and Peri-Urban program', async () => {
    const programs = await rows<{ name: string }>('select name from programs');
    expect(programs).toHaveLength(6);
    expect(programs.map((p) => p.name)).toContain('National Urban and Peri-Urban Agriculture Program');
  });

  it('has every CSV category, under the right group and type', async () => {
    const seeded = await rows<{ name: string; group_name: string; type_code: string }>(
      `select c.name, g.name as group_name, t.code as type_code
       from categories c
       join category_groups g on g.id = c.category_group_id
       join intervention_types t on t.id = c.intervention_type_id`,
    );
    const byName = new Map(seeded.map((c) => [c.name, c]));
    const typeCodes: Record<string, string> = { machinery: 'farm-machinery', spis: 'ssip' };

    const distinct = new Set(csv.map((r) => r.category));
    expect(distinct.size).toBe(28);
    for (const row of csv) {
      expect(byName.get(row.category)).toEqual({
        name: row.category,
        group_name: row.category_group,
        type_code: typeCodes[row.intervention_type],
      });
    }
  });

  it('keeps the extra categories alongside the CSV ones', async () => {
    const names = (await rows<{ name: string }>('select name from categories')).map((c) => c.name);
    expect(names).toHaveLength(28 + 6 + 3);
    expect(names).toEqual(
      expect.arrayContaining([
        'Disc Plow / Harrow',
        'Seeder',
        'Rice Reaper',
        'Small Water Impounding Project (SWIP)',
        'Diversion Dam',
        'Other',
        'Small Farm Reservoir (SFR)',
        'Shallow Tube Well (STW)',
        'Pump Irrigation from Open Source (PISOS)',
      ]),
    );
  });
});

describe('QA flags are computed by the database', () => {
  it('finds the expected counts', async () => {
    expect(await withFlag('no_coords')).toBe(26);
    expect(await withFlag('out_of_province')).toBe(1);
    expect(await withFlag('no_barangay')).toBe(5);
    expect(await withFlag('muni_mismatch')).toBe(5);
    expect(await withFlag('barangay_mismatch')).toBe(28);
    expect(await withFlag('barangay_unmatched')).toBe(4);
    expect(await withFlag('duplicate_point')).toBe(24);
  });

  it('flags the Malibago record for its longitude and leaves the value uncorrected', async () => {
    const [malibago] = await rows<{ longitude: number; raw: string; barangay_raw: string; municipality: string }>(
      `select ST_X(i.geom) as longitude, i.source_raw ->> 'longitude_raw' as raw, i.barangay_raw, m.name as municipality
       from interventions i join municipalities m on m.id = i.municipality_id
       where 'out_of_province' = any(i.qa_flags)`,
    );
    expect(malibago).toEqual({ longitude: 122.90523, raw: '122.90523', barangay_raw: 'Malibago', municipality: 'Torrijos' });
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

  it('runs the municipality check on every located record', async () => {
    // Recalculated here, separately from the trigger, against the same polygons and tolerance.
    const located = await rows<{ source_id: string; has_boundary: boolean; inside: boolean; flagged: boolean }>(
      `select i.source_id,
              m.boundary is not null as has_boundary,
              coalesce(ST_DWithin(m.boundary::geography, i.geom::geography, 250), false) as inside,
              'muni_mismatch' = any(i.qa_flags) as flagged
       from interventions i join municipalities m on m.id = i.municipality_id
       where i.geom is not null`,
    );

    expect(located).toHaveLength(199 - 26);
    expect(located.every((r) => r.has_boundary)).toBe(true);
    expect(located.filter((r) => r.flagged !== !r.inside)).toEqual([]);

    const mismatches = located.filter((r) => r.flagged);
    console.log(`muni_mismatch: ${mismatches.length} of ${located.length} located records`);
    expect(mismatches.map((r) => r.source_id)).toContain(id('103'));
  });

  it('runs the barangay check on every located, linked record', async () => {
    const linked = await rows<{ inside: boolean; flagged: boolean }>(
      `select ST_DWithin(b.boundary::geography, i.geom::geography, 250) as inside,
              'barangay_mismatch' = any(i.qa_flags) as flagged
       from interventions i join barangays b on b.id = i.barangay_id
       where i.geom is not null`,
    );
    expect(linked).toHaveLength(169);
    expect(linked.filter((r) => r.flagged !== !r.inside)).toEqual([]);
    console.log(`barangay_mismatch: ${linked.filter((r) => r.flagged).length} of ${linked.length} located, linked records`);
  });

  it('gives each mismatched point the "plotted in, encoded as" details', async () => {
    const [record] = await rows<{ plotted_barangay: string; plotted_municipality: string; barangay_raw: string; municipality: string }>(
      `select v.plotted_barangay, v.plotted_municipality, v.barangay_raw, m.name as municipality
       from interventions_v v join municipalities m on m.id = v.municipality_id
       where v.source_id = $1`,
      [id('099')],
    );
    expect(record).toEqual({
      plotted_barangay: 'Bognuyan',
      plotted_municipality: 'Gasan',
      barangay_raw: 'Tabi',
      municipality: 'Boac',
    });
  });

  it('counts a mismatched point under its encoded barangay', async () => {
    const links = await rows<{ name: string; link_source: string }>(
      `select b.name, l.link_source from intervention_barangays l
       join barangays b on b.id = l.barangay_id
       join interventions i on i.id = l.intervention_id
       where i.source_id = $1`,
      [id('099')],
    );
    expect(links).toEqual([{ name: 'Tabi', link_source: 'encoded' }]);
  });
});

describe('barangay coverage', () => {
  it('reaches 93 of 218 barangays through encoded barangays', async () => {
    const [{ covered }] = await rows<{ covered: number }>(
      'select count(distinct barangay_id)::int covered from intervention_barangays',
    );
    expect(covered).toBe(93);
  });

  it('leaves 9 records unassigned', async () => {
    expect(await count('barangay_id is null')).toBe(9);
  });
});

describe('beneficiary_name_check is a carried-over manual flag', () => {
  it('keeps the same 7 records as the CSV', async () => {
    const expected = csv.filter((r) => flagged(r, 'beneficiary_name_check')).map((r) => r.source_id).sort();
    expect(expected).toHaveLength(7);
    expect(await sourceIdsWithFlag('beneficiary_name_check')).toEqual(expected);
  });

  it('survives a flag refresh caused by a neighbouring record', async () => {
    const [target] = await rows<{ source_id: string }>(
      `select source_id from interventions
       where 'beneficiary_name_check' = any(qa_flags) and geom is not null
         and not 'duplicate_point' = any(qa_flags)
       limit 1`,
    );
    await db.query('begin');
    await db.query(
      `update interventions set geom = (select geom from interventions where source_id = $1)
       where source_id = (
         select source_id from interventions where source_id <> $1 and geom is not null order by source_id limit 1
       )`,
      [target.source_id],
    );
    const [after] = await rows<{ qa_flags: string[] }>('select qa_flags from interventions where source_id = $1', [
      target.source_id,
    ]);
    await db.query('rollback');
    expect(after.qa_flags).toContain('beneficiary_name_check');
    expect(after.qa_flags).toContain('duplicate_point');
  });
});

describe('unlocated records', () => {
  it('stores empty coordinates as null and never as 0', async () => {
    expect(await count('geom is null')).toBe(26);
    expect(await count('geom is not null and (ST_X(geom) = 0 or ST_Y(geom) = 0)')).toBe(0);
  });

  it('keeps the raw 0 for the two records that had it in the source', async () => {
    expect(await count(`geom is null and source_raw ->> 'latitude_raw' = '0' and source_raw ->> 'longitude_raw' = '0'`)).toBe(2);
  });
});

describe('raw values are kept', () => {
  it('stores the complete source row in source_raw', async () => {
    const stored = await rows<{ source_id: string; source_raw: SeedRow; barangay_raw: string | null }>(
      'select source_id, source_raw, barangay_raw from interventions',
    );
    const bySourceId = new Map(stored.map((r) => [r.source_id, r]));
    for (const row of csv) {
      const record = bySourceId.get(row.source_id)!;
      expect(record.source_raw).toEqual(row);
      expect(record.barangay_raw).toBe(row.barangay === '' ? null : row.barangay);
    }
  });

  it('keeps the long CSV data source in source_raw', async () => {
    expect(await count(`source_raw ->> 'data_source' like 'ABEMIS Inventory%'`)).toBe(199);
  });

  it('standardizes the municipality and keeps the two Sta. Cruz spellings raw', async () => {
    const [{ n }] = await rows<{ n: number }>(
      `select count(*)::int n from interventions i join municipalities m on m.id = i.municipality_id
       where m.name = 'Santa Cruz' and i.source_raw ->> 'municipality_raw' in ('Sta. Cruz', 'Sta Cruz')`,
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

  it('matches n-tilde as both n and ny', () => {
    expect(barangayNameKeys('Kiñaman')).toEqual(['kinaman', 'kinyaman']);
    expect(barangayNameKeys('KIÑAMAN')).toEqual(['kinaman', 'kinyaman']);
    expect(barangayNameKeys('Kiñaman')).toEqual(['kinaman', 'kinyaman']); // n + combining tilde
    expect(barangayNameKeys('Kinyaman')).toEqual(['kinyaman']);
    expect(barangayNameKeys('Tawiran')).toEqual(['tawiran']);
  });

  it('does not treat different names as the same', () => {
    expect(normalizeBarangayName('Pingan')).not.toBe(normalizeBarangayName('Pinggan'));
    expect(normalizeBarangayName('Pob')).not.toBe(normalizeBarangayName('Poblete'));
  });

  it('links Kiñaman to Kinyaman through the ny rule', async () => {
    const [record] = await rows<{ name: string; barangay_raw: string; qa_flags: string[] }>(
      `select b.name, i.barangay_raw, i.qa_flags from interventions i join barangays b on b.id = i.barangay_id
       where i.source_id = $1`,
      [id('130')],
    );
    expect(record.name).toBe('Kinyaman');
    expect(record.barangay_raw).toBe('Kiñaman');
    expect(record.qa_flags).not.toContain('barangay_unmatched');
    expect(record.qa_flags).toContain('barangay_mismatch'); // the point is in Libjo, 440 m away
  });

  it('accounts for every record: matched, blank or unmatched', async () => {
    const matched = await count('barangay_id is not null');
    const blank = await count(`barangay_id is null and barangay_raw is null and 'no_barangay' = any(qa_flags)`);
    const unmatched = await count(`barangay_id is null and barangay_raw is not null and 'barangay_unmatched' = any(qa_flags)`);
    expect({ matched, blank, unmatched }).toEqual({ matched: 190, blank: 5, unmatched: 4 });
    expect(report.unmatchedBarangays.map((u) => u.name).sort()).toEqual(['Barangay 367', 'Pag asa', 'Pagasa', 'Pingan']);
  });

  it('reports closest candidates for every unmatched name', async () => {
    for (const unmatched of report.unmatchedBarangays) {
      expect(unmatched.sameMunicipality.length).toBeGreaterThan(0);
      expect(unmatched.sameMunicipality.every((c) => c.municipality === unmatched.municipality)).toBe(true);
      expect(unmatched.otherMunicipalities.every((c) => c.municipality !== unmatched.municipality)).toBe(true);
    }
    expect(report.unmatchedBarangays.find((u) => u.name === 'Pingan')?.sameMunicipality[0].name).toBe('Pinggan');
    expect(await sourceIdsWithFlag('barangay_unmatched')).toEqual(report.unmatchedBarangays.map((u) => u.sourceId).sort());
  });
});

describe('corrections file', () => {
  const confirm = (c: Correction): Correction => ({
    ...c,
    status: 'confirmed',
    confirmed_by: 'Test Reviewer',
    confirmed_date: '2026-11-05',
  });
  const barangayRow = (over: Partial<Correction> = {}): Correction => ({
    source_id: id('051'),
    field: 'barangay',
    raw_value: 'Pingan',
    corrected_value: 'Pinggan',
    evidence: 'test',
    status: 'confirmed',
    confirmed_by: 'Test Reviewer',
    confirmed_date: '2026-11-05',
    ...over,
  });

  it('pre-fills the four records as proposed, with evidence', () => {
    expect(correctionsFile.map((c) => [c.source_id.slice(-3), c.field, c.corrected_value])).toEqual(
      expect.arrayContaining([
        ['051', 'barangay', 'Pinggan'],
        ['130', 'barangay', 'Kinyaman'],
        ['099', 'municipality', 'Gasan'],
        ['099', 'barangay', 'Bognuyan'],
        ['160', 'municipality', 'Torrijos'],
        ['160', 'barangay', 'Kay Duke'],
      ]),
    );
    expect(correctionsFile.every((c) => c.evidence.trim().length > 0)).toBe(true);
  });

  it('has only valid rows in the real file', () => {
    expect(() => checkCorrections(correctionsFile, csv)).not.toThrow();
    expect(() => checkCorrections(correctionsFile.map(confirm), csv)).not.toThrow();
  });

  it('reads a file saved by Excel with a byte-order mark', () => {
    const parsed = parseCorrections(
      '﻿source_id,field,raw_value,corrected_value,evidence,status,confirmed_by,confirmed_date\r\nA,barangay,x,y,z,proposed,,\r\n',
    );
    expect(parsed[0].source_id).toBe('A');
  });

  it.each([
    ['an invalid status', { status: 'maybe' }, /invalid status/],
    ['an unsupported field', { field: 'year_funded' }, /unsupported field/],
    ['an unknown record', { source_id: 'NOPE' }, /no such record/],
    ['a raw value that differs from the source', { raw_value: 'Something else' }, /doesn't match the source/],
    ['a confirmed row with no reviewer', { confirmed_by: '' }, /need confirmed_by/],
    ['a confirmed row with no date', { confirmed_date: ' ' }, /need confirmed_by/],
  ])('rejects %s', (_label, over, message) => {
    expect(() => checkCorrections([barangayRow(over)], csv)).toThrow(message);
  });

  it('rejects the same field confirmed twice', () => {
    expect(() => checkCorrections([barangayRow(), barangayRow()], csv)).toThrow(/more than once/);
  });

  it('ignores the raw value on a rejected row', () => {
    expect(() => checkCorrections([barangayRow({ status: 'rejected', raw_value: 'old' })], csv)).not.toThrow();
  });

  describe('applied to a fresh database', () => {
    let fresh: PGlite;
    const recordOf = async (n: string, target = fresh) => {
      const [record] = await rows<{
        qa_flags: string[];
        barangay: string | null;
        municipality: string;
        barangay_raw: string | null;
        source_raw: SeedRow;
      }>(
        `select i.qa_flags, b.name as barangay, m.name as municipality, i.barangay_raw, i.source_raw
         from interventions i
         join municipalities m on m.id = i.municipality_id
         left join barangays b on b.id = i.barangay_id
         where i.source_id = $1`,
        [id(n)],
        target,
      );
      return record;
    };
    const auditOf = async (n: string, target = fresh) => {
      const [record] = await rows<{ id: string }>('select id from interventions where source_id = $1', [id(n)], target);
      return rows<{ action: string; context: { corrections: { corrected_value: string; confirmed_by: string; evidence: string }[] } | null }>(
        `select action, context from audit_log where table_name = 'interventions' and record_id = $1 order by id`,
        [record.id],
        target,
      );
    };

    beforeAll(async () => {
      fresh = await createTestDb();
      await seedInterventions(fresh, csv, correctionsFile.map(confirm));
    }, 120_000);

    afterAll(async () => {
      await fresh.close();
    });

    it('fixes 051 and clears its flag, keeping the raw name', async () => {
      const record = await recordOf('051');
      expect(record.barangay).toBe('Pinggan');
      expect(record.barangay_raw).toBe('Pingan');
      expect(record.source_raw.barangay).toBe('Pingan');
      expect(record.qa_flags).not.toContain('barangay_unmatched');
      expect(record.qa_flags).not.toContain('barangay_mismatch');
    });

    it('moves 099 to Bognuyan, Gasan and clears both mismatch flags', async () => {
      const record = await recordOf('099');
      expect(record.municipality).toBe('Gasan');
      expect(record.barangay).toBe('Bognuyan');
      expect(record.source_raw.municipality).toBe('Boac');
      expect(record.source_raw.barangay).toBe('Tabi');
      expect(record.qa_flags).not.toContain('muni_mismatch');
      expect(record.qa_flags).not.toContain('barangay_mismatch');
    });

    it('moves 160 to Kay Duke, Torrijos and clears its flags', async () => {
      const record = await recordOf('160');
      expect(record.municipality).toBe('Torrijos');
      expect(record.barangay).toBe('Kay Duke');
      expect(record.barangay_raw).toBeNull();
      expect(record.qa_flags).not.toContain('no_barangay');
      expect(record.qa_flags).not.toContain('muni_mismatch');
      expect(record.qa_flags).not.toContain('barangay_mismatch');
    });

    it('leaves 130 flagged, because its point is still outside Kinyaman', async () => {
      const record = await recordOf('130');
      expect(record.barangay).toBe('Kinyaman');
      expect(record.qa_flags).toContain('barangay_mismatch');
    });

    it('writes each correction to the audit log with its evidence', async () => {
      const entries = await auditOf('099');
      expect(entries.map((e) => e.action)).toEqual(['insert', 'update']);
      const { corrections } = entries[1].context!;
      expect(corrections.map((c) => c.corrected_value).sort()).toEqual(['Bognuyan', 'Gasan']);
      expect(corrections[0].confirmed_by).toBe('Test Reviewer');
      expect(corrections[0].evidence).toMatch(/Bognuyan/);
    });

    it('does not attach correction details to other records', async () => {
      const entries = await auditOf('001');
      expect(entries.map((e) => e.action)).toEqual(['insert']);
      expect(entries[0].context).toBeNull();
    });
  });

  describe('selective confirmation', () => {
    let fresh: PGlite;

    beforeAll(async () => {
      fresh = await createTestDb();
    }, 60_000);

    afterAll(async () => {
      await fresh.close();
    });

    it('applies only confirmed rows, and handles a municipality fix without its barangay', async () => {
      const selection = correctionsFile.map((c) => {
        if (c.source_id === id('051')) return { ...c, status: 'rejected' };
        if (c.source_id === id('099') && c.field === 'municipality') return confirm(c);
        return c; // the rest stay proposed
      });
      const result = await seedInterventions(fresh, csv, selection);
      expect(result.corrections).toEqual({ applied: 1, proposed: 4, rejected: 1 });

      const flagsOf = async (n: string) => {
        const [record] = await rows<{ qa_flags: string[]; barangay_id: number | null }>(
          'select qa_flags, barangay_id from interventions where source_id = $1',
          [id(n)],
          fresh,
        );
        return record;
      };

      // Tabi isn't in Gasan, so the record is kept, unlinked and flagged rather than failing.
      const partial = await flagsOf('099');
      expect(partial.barangay_id).toBeNull();
      expect(partial.qa_flags).toContain('barangay_unmatched');
      expect(partial.qa_flags).not.toContain('muni_mismatch');

      expect((await flagsOf('051')).qa_flags).toContain('barangay_unmatched'); // rejected
      expect((await flagsOf('160')).qa_flags).toContain('no_barangay'); // proposed
    });
  });

  it('refuses a confirmed barangay that is not in the municipality, and rolls back', async () => {
    const fresh = await createTestDb();
    const bad = barangayRow({ corrected_value: 'Tawiran' }); // Tawiran is in Santa Cruz, not Gasan
    await expect(seedInterventions(fresh, csv, [bad])).rejects.toThrow(/isn't in Gasan/);
    const [{ n }] = await rows<{ n: number }>('select count(*)::int n from interventions', [], fresh);
    expect(n).toBe(0);
    await fresh.close();
  }, 120_000);
});

describe('field verification sheet', () => {
  let sheet: VerificationRow[];
  const rowFor = (n: string) => sheet.find((r) => r.ID === id(n))!;

  beforeAll(async () => {
    sheet = await buildVerificationRows(db, correctionsFile);
  });

  it('lists flagged records, leaving out those flagged only for shared coordinates', async () => {
    const [{ n }] = await rows<{ n: number }>(
      `select count(*)::int n from interventions
       where cardinality(array_remove(qa_flags, 'duplicate_point')) > 0
          or source_raw ->> 'qa_flags' like '%possible_duplicate%'`,
    );
    expect(sheet).toHaveLength(n);

    const onlyShared = await rows<{ source_id: string }>(
      `select source_id from interventions
       where qa_flags = array['duplicate_point'] and source_raw ->> 'qa_flags' not like '%possible_duplicate%'`,
    );
    expect(onlyShared.length).toBeGreaterThan(0);
    const listed = new Set(sheet.map((r) => r.ID));
    expect(onlyShared.filter((r) => listed.has(r.source_id))).toEqual([]);
    expect(new Set(sheet.map((r) => r.ID)).size).toBe(n);
    console.log(`field verification sheet: ${sheet.length} records`);
  });

  it('has the requested columns, with the verification columns blank', () => {
    expect(Object.keys(sheet[0])).toEqual([
      'ID',
      'Type',
      'Machine / project',
      'Beneficiary',
      'Municipality (encoded)',
      'Barangay (encoded)',
      'Issue',
      'Suggested value',
      'Verified barangay',
      'Verified latitude',
      'Verified longitude',
      'Location basis',
    ]);
    for (const row of sheet) {
      expect([row['Verified barangay'], row['Verified latitude'], row['Verified longitude'], row['Location basis']]).toEqual(['', '', '', '']);
      expect(row.Issue).not.toBe('');
    }
  });

  it('groups rows by municipality, so each MAO gets theirs together', () => {
    const municipalities = sheet.map((r) => r['Municipality (encoded)']);
    expect(municipalities).toEqual([...municipalities].sort());
  });

  it('shows the suggested values from proposed corrections', () => {
    expect(rowFor('051')['Suggested value']).toBe('Barangay: Pinggan');
    expect(rowFor('099')['Suggested value']).toBe('Municipality: Gasan; Barangay: Bognuyan');
    expect(rowFor('160')['Suggested value']).toBe('Municipality: Torrijos; Barangay: Kay Duke');
  });

  it('describes a mismatch as plotted in and encoded as', () => {
    expect(rowFor('031').Issue).toContain('Plotted in Bangbangalon, Boac, encoded as Antipolo, Gasan');
    expect(rowFor('031')['Suggested value']).toBe('Point is in Bangbangalon, Boac');
  });

  it('points Malibago at where the barangay really is, without guessing a value', () => {
    const malibago = rowFor('103');
    expect(malibago.Issue).toContain('outside Marinduque');
    expect(malibago['Suggested value']).toMatch(/^Check coordinates; Malibago lies near 13\.\d+, 12[12]\.\d+$/);
  });

  it('covers the other issue kinds', () => {
    expect(rowFor('191').Issue).toContain('No coordinates');
    expect(rowFor('191').Issue).toContain('No barangay encoded');
    expect(rowFor('189').Issue).toContain('Barangay "Barangay 367" is not on the official list');
    expect(rowFor('175').Issue).toContain('Beneficiary name');
    expect(rowFor('035').Issue).toContain('Possible duplicate');
  });

  it('writes a CSV that Excel reads correctly, with n-tilde intact', () => {
    const output = verificationCsv(sheet);
    expect(output.startsWith('﻿')).toBe(true);
    expect(output).toContain('\r\n');
    expect(output).toContain('Kiñaman');

    const parsed = Papa.parse<VerificationRow>(output.replace(/^﻿/, ''), { header: true, skipEmptyLines: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toHaveLength(sheet.length);
  });

  it('carries a note the report can\'t give, after the record\'s own issue', () => {
    expect(rowFor('183').Issue).toBe(
      'Plotted in Bangbangalon, Boac, encoded as Buliasnin, Boac; Test move on 2026-11-06 — RAED source says Buliasnin, 13.4423992, 121.82795; confirm actual location with Boac MAO',
    );
    expect(sheet.filter((row) => row.Issue.includes('Test move'))).toHaveLength(1);
  });

  it('leaves out proposals that were rejected', async () => {
    const rejected = correctionsFile.map((c) => ({ ...c, status: 'rejected' }));
    const without = await buildVerificationRows(db, rejected);
    const row = without.find((r) => r.ID === id('051'))!;
    expect(row['Suggested value']).toBe('Point is in Pinggan, Gasan');
  });
});

describe('local dataset through the map logic', () => {
  async function mapData() {
    return toMapData(JSON.parse(JSON.stringify(await buildLocalSeed(db))) as LocalSeed);
  }
  const defaultView: ViewFilters = {
    mode: 'gap',
    pickedProgramId: null,
    pickedTypeId: null,
    hiddenTypeIds: [],
    programId: null,
    yearFrom: null,
    yearTo: null,
  };

  it('finds the same coverage as the database', async () => {
    const data = await mapData();
    const records = recordsInView(liveRecords(data.interventions, data.types), defaultView);
    expect(records).toHaveLength(199);

    const shading = buildShading('gap', 'Gap', countByBarangay(records, data.links), data.barangays);
    expect(shading.barangaysWithRecords).toBe(93);
    expect(shading.barangaysWithout).toBe(125);
    expect(unassignedRecords(records, data.links)).toHaveLength(9);
  });

  it('leaves 26 unlocated and 1 out-of-province record off the map', async () => {
    const data = await mapData();
    expect(data.interventions.filter(isOnMap)).toHaveLength(199 - 26 - 1);
  });

  it('keeps the RAED status date exact, as an as-of date', async () => {
    const data = await mapData();
    expect(data.statusHistory).toHaveLength(199);
    expect(new Set(data.statusHistory.map(statusDateLabel))).toEqual(new Set(['as of 2026-10-21 (RAED report)']));
  });

  it('has only Farm Machinery and SSIP as active types', async () => {
    const data = await mapData();
    expect(data.types.filter((t) => t.is_active).map((t) => t.name).sort()).toEqual(['Farm Machinery', 'SSIP']);
  });

  it('links every barangay to its polygon by PSGC code', async () => {
    const data = await mapData();
    const geojson = JSON.parse(readFileSync('public/boundaries/barangays.geojson', 'utf8')) as {
      features: { properties: { adm4_pcode: string } }[];
    };
    expect(geojson.features.map((f) => f.properties.adm4_pcode).sort()).toEqual(
      data.barangays.map((b) => b.psgc_code).sort(),
    );
  });
});

describe('local dataset', () => {
  it('holds the data local mode needs, with no polygons', async () => {
    const seed = await buildLocalSeed(db);
    expect(seed.interventions).toHaveLength(199);
    expect(seed.barangays).toHaveLength(218);
    expect(seed.status_history).toHaveLength(199);
    expect(seed.municipalities).toHaveLength(6);
    expect(seed.lookups.intervention_types).toHaveLength(7);
    expect(seed.lookups.location_bases).toHaveLength(4);

    expect(seed.barangays[0]).not.toHaveProperty('boundary');
    expect(seed.municipalities[0]).not.toHaveProperty('boundary');

    const malibago = (seed.interventions as { source_id: string; geojson: { coordinates: number[] }; qa_flags: string[]; geom?: unknown }[]).find(
      (i) => i.source_id === id('103'),
    )!;
    expect(malibago.geojson.coordinates).toEqual([122.90523, 13.290806]);
    expect(malibago.qa_flags).toContain('out_of_province');
    expect(malibago).not.toHaveProperty('geom');
  });
});
