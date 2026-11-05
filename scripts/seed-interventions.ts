// Loads data/source/seed_interventions.csv into the interventions table.
//
// Usage: npx tsx scripts/seed-interventions.ts
//
// For now this is a dry run: it seeds a temporary in-memory database and prints the report.
// seedInterventions() only needs a query() method, so a live database can be added later.
//
// The database triggers work out the QA flags. The CSV's flags are only used to compare
// results, except beneficiary_name_check, which is a manual review flag carried over as is.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

export const SEED_CSV_PATH = resolve(import.meta.dirname, '..', 'data', 'source', 'seed_interventions.csv');

const CARRIED_OVER_FLAGS = ['beneficiary_name_check'];

// CSV flag -> the database flag that should agree with it.
const COMPARABLE_FLAGS: Record<string, string> = {
  no_coords: 'no_coords',
  out_of_province: 'out_of_province',
  no_barangay: 'no_barangay',
  shared_point: 'duplicate_point',
};
const STORED_OR_COMPARED_CSV_FLAGS = new Set([...Object.keys(COMPARABLE_FLAGS), ...CARRIED_OVER_FLAGS]);

const CANDIDATES_SHOWN = 3;

export interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface SeedRow {
  source_id: string;
  source_page: string;
  intervention_type: string;
  category: string;
  category_variant: string;
  category_group: string;
  name_raw: string;
  title: string;
  banner_program: string;
  year_funded: string;
  quantity: string;
  beneficiary: string;
  beneficiary_raw: string;
  status: string;
  stage: string;
  municipality: string;
  municipality_raw: string;
  barangay: string;
  latitude: string;
  longitude: string;
  latitude_raw: string;
  longitude_raw: string;
  qa_flags: string;
  data_source: string;
}

export interface BarangayCandidate {
  name: string;
  municipality: string;
  distance: number;
}

export interface UnmatchedBarangay {
  sourceId: string;
  municipality: string;
  name: string;
  sameMunicipality: BarangayCandidate[];
  otherMunicipalities: BarangayCandidate[];
}

export interface FlagDifference {
  csvFlag: string;
  dbFlag: string;
  onlyInCsv: string[];
  onlyInDb: string[];
}

export interface SeedReport {
  inserted: number;
  unmatchedBarangays: UnmatchedBarangay[];
  flagCounts: Record<string, number>;
  muniMismatches: { sourceId: string; municipality: string; barangay: string; alsoOutOfProvince: boolean }[];
  flagDifferences: FlagDifference[];
  csvOnlyFlags: { flag: string; sourceId: string }[];
}

export function parseSeedCsv(csvText: string): SeedRow[] {
  const { data, errors } = Papa.parse<SeedRow>(csvText, { header: true, skipEmptyLines: true });
  if (errors.length > 0) throw new Error(`CSV parse errors: ${JSON.stringify(errors.slice(0, 5))}`);
  return data;
}

// Handles case, spacing, hyphens, Pob./Poblacion and n-tilde. It never guesses at spelling:
// names that still differ go to the unmatched report for a person to resolve.
export function normalizeBarangayName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\bpoblacion\b/g, 'pob')
    .replace(/\bpob\./g, 'pob')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const emptyToNull = (value: string) => (value.trim() === '' ? null : value.trim());

function required<V>(map: Map<string, V>, key: string, kind: string, sourceId: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`${sourceId}: unknown ${kind} "${key}"`);
  return value;
}

function flagsOf(row: SeedRow): string[] {
  return row.qa_flags
    .split(';')
    .map((flag) => flag.trim())
    .filter(Boolean);
}

async function seedCategories(db: Queryable, rows: SeedRow[]) {
  const groups = new Map<string, string>();
  for (const { source_id, category, category_group } of rows) {
    const group = slug(category_group).replaceAll('-', '_');
    if (groups.has(category) && groups.get(category) !== group) {
      throw new Error(`${source_id}: category "${category}" appears in two groups`);
    }
    groups.set(category, group);
  }

  const sorted = [...groups].sort(([aName, aGroup], [bName, bGroup]) =>
    aGroup === bGroup ? aName.localeCompare(bName) : aGroup.localeCompare(bGroup),
  );
  for (const [index, [name, group]] of sorted.entries()) {
    await db.query(
      `insert into public.categories (code, name, group_code, sort_order)
       values ($1, $2, $3::public.category_group, $4)`,
      [slug(name), name, group, index + 1],
    );
  }
}

interface Barangay {
  id: number;
  name: string;
  municipality: string;
}

function indexBarangays(barangays: Barangay[]) {
  const index = new Map<string, Barangay>();
  for (const barangay of barangays) {
    const key = `${barangay.municipality}|${normalizeBarangayName(barangay.name)}`;
    const clash = index.get(key);
    if (clash) throw new Error(`"${clash.name}" and "${barangay.name}" normalize to the same name`);
    index.set(key, barangay);
  }
  return index;
}

function closestBarangays(name: string, municipality: string, barangays: Barangay[]) {
  const target = normalizeBarangayName(name);
  const ranked = barangays
    .map((b) => ({
      name: b.name,
      municipality: b.municipality,
      distance: levenshtein(target, normalizeBarangayName(b.name)),
    }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
  return {
    sameMunicipality: ranked.filter((c) => c.municipality === municipality).slice(0, CANDIDATES_SHOWN),
    otherMunicipalities: ranked.filter((c) => c.municipality !== municipality).slice(0, CANDIDATES_SHOWN),
  };
}

export async function seedInterventions(db: Queryable, rows: SeedRow[]): Promise<SeedReport> {
  await db.query('begin');
  try {
    const report = await seedInTransaction(db, rows);
    await db.query('commit');
    return report;
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

async function seedInTransaction(db: Queryable, rows: SeedRow[]): Promise<SeedReport> {
  await seedCategories(db, rows);

  const idsByName = async (table: string) => {
    const result = await db.query<{ id: number; name: string }>(`select id, name from public.${table}`);
    return new Map(result.rows.map(({ id, name }) => [name, id]));
  };
  const municipalityIds = await idsByName('municipalities');
  const programIds = await idsByName('programs');
  const categoryIds = await idsByName('categories');

  const { rows: barangays } = await db.query<Barangay>(
    `select b.id, b.name, m.name as municipality
     from public.barangays b join public.municipalities m on m.id = b.municipality_id`,
  );
  const barangayIndex = indexBarangays(barangays);

  const unmatchedBarangays: UnmatchedBarangay[] = [];

  for (const row of rows) {
    const barangayName = emptyToNull(row.barangay);
    const match = barangayName && barangayIndex.get(`${row.municipality}|${normalizeBarangayName(barangayName)}`);
    if (barangayName && !match) {
      unmatchedBarangays.push({
        sourceId: row.source_id,
        municipality: row.municipality,
        name: barangayName,
        ...closestBarangays(barangayName, row.municipality, barangays),
      });
    }

    await db.query(
      `insert into public.interventions (
         source_id, source_page, intervention_type, category_id, category_variant, name_raw, title,
         banner_program_id, year_funded, quantity, beneficiary, beneficiary_raw, status, stage,
         municipality_id, municipality_raw, barangay_id, barangay_raw,
         latitude, longitude, latitude_raw, longitude_raw, qa_flags, data_source
       ) values (
         $1, $2, $3::public.intervention_type, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13::public.intervention_status, $14::public.project_stage,
         $15, $16, $17, $18,
         $19, $20, $21, $22, $23, $24
       )`,
      [
        row.source_id,
        Number(row.source_page),
        row.intervention_type,
        required(categoryIds, row.category, 'category', row.source_id),
        emptyToNull(row.category_variant),
        row.name_raw,
        emptyToNull(row.title),
        required(programIds, row.banner_program, 'banner program', row.source_id),
        Number(row.year_funded),
        Number(row.quantity),
        row.beneficiary,
        row.beneficiary_raw,
        emptyToNull(row.status) ?? 'Unknown', // the SPIS table has no status column
        emptyToNull(row.stage),
        required(municipalityIds, row.municipality, 'municipality', row.source_id),
        row.municipality_raw,
        match ? match.id : null,
        barangayName,
        emptyToNull(row.latitude), // empty means unlocated: stored as null, never 0
        emptyToNull(row.longitude),
        emptyToNull(row.latitude_raw),
        emptyToNull(row.longitude_raw),
        flagsOf(row).filter((flag) => CARRIED_OVER_FLAGS.includes(flag)),
        row.data_source,
      ],
    );
  }

  return buildReport(db, rows, unmatchedBarangays);
}

async function buildReport(
  db: Queryable,
  rows: SeedRow[],
  unmatchedBarangays: UnmatchedBarangay[],
): Promise<SeedReport> {
  const { rows: seeded } = await db.query<{
    source_id: string;
    qa_flags: string[];
    municipality: string;
    barangay_raw: string | null;
  }>(
    `select i.source_id, i.qa_flags, m.name as municipality, i.barangay_raw
     from public.interventions i join public.municipalities m on m.id = i.municipality_id
     where i.source_id is not null
     order by i.source_id`,
  );

  const flagCounts: Record<string, number> = {};
  for (const { qa_flags } of seeded) {
    for (const flag of qa_flags) flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
  }

  const flagDifferences = Object.entries(COMPARABLE_FLAGS).map(([csvFlag, dbFlag]) => {
    const inCsv = rows.filter((r) => flagsOf(r).includes(csvFlag)).map((r) => r.source_id);
    const inDb = seeded.filter((r) => r.qa_flags.includes(dbFlag)).map((r) => r.source_id);
    return {
      csvFlag,
      dbFlag,
      onlyInCsv: inCsv.filter((id) => !inDb.includes(id)),
      onlyInDb: inDb.filter((id) => !inCsv.includes(id)),
    };
  });

  return {
    inserted: seeded.length,
    unmatchedBarangays,
    flagCounts,
    muniMismatches: seeded
      .filter((r) => r.qa_flags.includes('muni_mismatch'))
      .map((r) => ({
        sourceId: r.source_id,
        municipality: r.municipality,
        barangay: r.barangay_raw ?? '',
        alsoOutOfProvince: r.qa_flags.includes('out_of_province'),
      })),
    flagDifferences,
    csvOnlyFlags: rows.flatMap((r) =>
      flagsOf(r)
        .filter((flag) => !STORED_OR_COMPARED_CSV_FLAGS.has(flag))
        .map((flag) => ({ flag, sourceId: r.source_id })),
    ),
  };
}

export function printReport(report: SeedReport) {
  console.log(`Inserted: ${report.inserted}`);
  console.log('QA flags from the database:', report.flagCounts);

  console.log(`\nUnmatched barangay names: ${report.unmatchedBarangays.length}`);
  const describe = (candidates: BarangayCandidate[]) =>
    candidates.map((c) => `${c.name}, ${c.municipality} (${c.distance})`).join('; ');
  for (const u of report.unmatchedBarangays) {
    console.log(`  ${u.sourceId}  "${u.name}", ${u.municipality}`);
    console.log(`    same municipality: ${describe(u.sameMunicipality)}`);
    console.log(`    elsewhere:         ${describe(u.otherMunicipalities)}`);
  }

  console.log(`\nmuni_mismatch: ${report.muniMismatches.length}`);
  for (const m of report.muniMismatches) {
    const note = m.alsoOutOfProvince ? '  (also out_of_province)' : '';
    console.log(`  ${m.sourceId}  ${m.barangay}, ${m.municipality}${note}`);
  }

  console.log('\nDatabase flags compared with the CSV:');
  for (const d of report.flagDifferences) {
    const agree = d.onlyInCsv.length === 0 && d.onlyInDb.length === 0;
    console.log(`  ${d.csvFlag} vs ${d.dbFlag}: ${agree ? 'agree' : 'DIFFER'}`);
    if (d.onlyInCsv.length > 0) console.log(`    only in CSV: ${d.onlyInCsv.join(', ')}`);
    if (d.onlyInDb.length > 0) console.log(`    only in database: ${d.onlyInDb.join(', ')}`);
  }

  console.log(`\nCSV flags not stored in the database: ${report.csvOnlyFlags.length}`);
  for (const { flag, sourceId } of report.csvOnlyFlags) console.log(`  ${sourceId}  ${flag}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { createTestDb } = await import('../tests/helpers/db');
  const db = await createTestDb();
  console.log('Dry run on a temporary in-memory database.\n');
  printReport(await seedInterventions(db, parseSeedCsv(readFileSync(SEED_CSV_PATH, 'utf8'))));
  await db.close();
}
