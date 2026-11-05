// Loads data/source/seed_interventions.csv into the interventions table, then applies the
// confirmed rows of data/corrections/corrections.csv.
//
// Usage: npx tsx scripts/seed-interventions.ts
//
// For now this is a dry run: it seeds a temporary in-memory database and prints the report.
// seedInterventions() only needs a query() method, so a live database can be added in Phase 4.
//
// The database triggers work out the QA flags. The CSV's flags are only used to compare
// results, except beneficiary_name_check, which is a manual review flag carried over as is.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

const DATA_DIR = resolve(import.meta.dirname, '..', 'data');
export const SEED_CSV_PATH = resolve(DATA_DIR, 'source', 'seed_interventions.csv');
export const CORRECTIONS_CSV_PATH = resolve(DATA_DIR, 'corrections', 'corrections.csv');

export const RAED_DATA_SOURCE = 'RAED 2026-10-21';
const RAED_FILE_NAME = 'seed_interventions.csv';
const RAED_STATUS_DATE = '2026-10-21'; // the report date; the report gives no status dates
const RAED_STATUS_REMARKS = 'As reported in the RAED Consolidated Inventory Report';
const RAED_LOCATION_BASIS = 'Unknown';

const TYPE_CODES: Record<string, string> = { machinery: 'farm-machinery', spis: 'spis' };

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

const CORRECTION_FIELDS = ['municipality', 'barangay', 'latitude', 'longitude', 'location_basis', 'beneficiary'] as const;
type CorrectionField = (typeof CORRECTION_FIELDS)[number];

export interface Correction {
  source_id: string;
  field: string;
  raw_value: string;
  corrected_value: string;
  evidence: string;
  status: string;
  confirmed_by: string;
  confirmed_date: string;
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

interface LocationMismatch {
  sourceId: string;
  encoded: string;
  plotted: string | null;
  alsoOutOfProvince: boolean;
}

export interface SeedReport {
  inserted: number;
  unmatchedBarangays: UnmatchedBarangay[];
  flagCounts: Record<string, number>;
  muniMismatches: LocationMismatch[];
  barangayMismatches: LocationMismatch[];
  flagDifferences: FlagDifference[];
  csvOnlyFlags: { flag: string; sourceId: string }[];
  corrections: { applied: number; proposed: number; rejected: number };
}

function parseCsv<T>(csvText: string): T[] {
  // Excel adds a byte-order mark when it saves a CSV as UTF-8.
  const { data, errors } = Papa.parse<T>(csvText.replace(/^﻿/, ''), { header: true, skipEmptyLines: true });
  if (errors.length > 0) throw new Error(`CSV parse errors: ${JSON.stringify(errors.slice(0, 5))}`);
  return data;
}

export const parseSeedCsv = (csvText: string) => parseCsv<SeedRow>(csvText);
export const parseCorrections = (csvText: string) => parseCsv<Correction>(csvText);

export function loadSeedFiles() {
  return {
    rows: parseSeedCsv(readFileSync(SEED_CSV_PATH, 'utf8')),
    corrections: parseCorrections(readFileSync(CORRECTIONS_CSV_PATH, 'utf8')),
  };
}

// Handles case, spacing, hyphens and Pob./Poblacion, and reads n-tilde as n. It never guesses at
// spelling: names that still differ go to the unmatched report for a person to resolve.
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

// Every form a name can match under. n-tilde is written as both n and ny (Kinaman, Kinyaman).
export function barangayNameKeys(name: string): string[] {
  const composed = name.normalize('NFC');
  const keys = [normalizeBarangayName(composed)];
  if (/ñ/i.test(composed)) keys.push(normalizeBarangayName(composed.replace(/ñ/gi, 'ny')));
  return keys;
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

interface Barangay {
  id: number;
  name: string;
  municipality: string;
}

class BarangayIndex {
  private keys = new Map<string, Barangay>();

  constructor(barangays: Barangay[]) {
    for (const barangay of barangays) {
      for (const key of barangayNameKeys(barangay.name)) {
        const fullKey = `${barangay.municipality}|${key}`;
        const clash = this.keys.get(fullKey);
        if (clash && clash.id !== barangay.id) {
          throw new Error(`"${clash.name}" and "${barangay.name}" normalize to the same name`);
        }
        this.keys.set(fullKey, barangay);
      }
    }
  }

  find(municipality: string, name: string): Barangay | undefined {
    for (const key of barangayNameKeys(name)) {
      const match = this.keys.get(`${municipality}|${key}`);
      if (match) return match;
    }
    return undefined;
  }
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

const sourceValue: Record<CorrectionField, (row: SeedRow) => string> = {
  municipality: (row) => row.municipality,
  barangay: (row) => row.barangay,
  latitude: (row) => row.latitude,
  longitude: (row) => row.longitude,
  location_basis: () => RAED_LOCATION_BASIS,
  beneficiary: (row) => row.beneficiary,
};

function isCorrectionField(field: string): field is CorrectionField {
  return (CORRECTION_FIELDS as readonly string[]).includes(field);
}

// Fails loudly rather than skipping a row: a confirmed fix that silently doesn't apply is worse
// than a seed that stops. This also catches a file garbled by saving from Excel in another encoding.
export function checkCorrections(corrections: Correction[], rows: SeedRow[]) {
  const bySourceId = new Map(rows.map((row) => [row.source_id, row]));
  const confirmed = new Set<string>();

  for (const c of corrections) {
    const label = `Correction ${c.source_id} ${c.field}`;
    if (!['proposed', 'confirmed', 'rejected'].includes(c.status)) throw new Error(`${label}: invalid status "${c.status}"`);
    if (!isCorrectionField(c.field)) throw new Error(`${label}: unsupported field`);

    const row = bySourceId.get(c.source_id);
    if (!row) throw new Error(`${label}: no such record`);

    if (c.status === 'rejected') continue;

    const current = sourceValue[c.field](row).trim().normalize('NFC');
    if (c.raw_value.trim().normalize('NFC') !== current) {
      throw new Error(`${label}: raw_value "${c.raw_value}" doesn't match the source value "${current}"`);
    }

    if (c.status === 'confirmed') {
      if (!c.confirmed_by.trim() || !c.confirmed_date.trim()) {
        throw new Error(`${label}: confirmed rows need confirmed_by and confirmed_date`);
      }
      const key = `${c.source_id}|${c.field}`;
      if (confirmed.has(key)) throw new Error(`${label}: confirmed more than once`);
      confirmed.add(key);
    }
  }
}

async function seedCategories(db: Queryable, rows: SeedRow[], typeIds: Map<string, number>) {
  const { rows: groups } = await db.query<{ id: number; code: string }>('select id, code from public.category_groups');
  const groupIds = new Map(groups.map(({ id, code }) => [code, id]));
  const { rows: existing } = await db.query<{ name: string }>('select name from public.categories');
  const existingNames = new Set(existing.map((c) => c.name));

  const fromCsv = new Map<string, SeedRow>();
  for (const row of rows) {
    const first = fromCsv.get(row.category);
    if (first && (first.category_group !== row.category_group || first.intervention_type !== row.intervention_type)) {
      throw new Error(`${row.source_id}: category "${row.category}" appears under two groups or types`);
    }
    fromCsv.set(row.category, row);
  }

  const sorted = [...fromCsv.values()].sort((a, b) =>
    a.category_group === b.category_group
      ? a.category.localeCompare(b.category)
      : a.category_group.localeCompare(b.category_group),
  );
  for (const [index, row] of sorted.entries()) {
    if (existingNames.has(row.category)) continue;
    await db.query(
      `insert into public.categories (code, name, intervention_type_id, category_group_id, sort_order)
       values ($1, $2, $3, $4, $5)`,
      [
        slug(row.category),
        row.category,
        required(typeIds, TYPE_CODES[row.intervention_type], 'intervention type', row.source_id),
        required(groupIds, slug(row.category_group).replaceAll('-', '_'), 'category group', row.source_id),
        100 + index,
      ],
    );
  }
}

async function seedBatches(db: Queryable, rows: SeedRow[], typeIds: Map<string, number>) {
  const batchIds = new Map<string, string>();
  for (const [csvType, typeCode] of Object.entries(TYPE_CODES)) {
    const { rows: inserted } = await db.query<{ id: string }>(
      `insert into public.import_batches (file_name, data_source, intervention_type_id, counts)
       values ($1, $2, $3, $4::jsonb) returning id`,
      [
        RAED_FILE_NAME,
        RAED_DATA_SOURCE,
        required(typeIds, typeCode, 'intervention type', csvType),
        JSON.stringify({ records: rows.filter((r) => r.intervention_type === csvType).length }),
      ],
    );
    batchIds.set(csvType, inserted[0].id);
  }
  return batchIds;
}

export async function seedInterventions(
  db: Queryable,
  rows: SeedRow[],
  corrections: Correction[] = [],
): Promise<SeedReport> {
  checkCorrections(corrections, rows);

  await db.query('begin');
  try {
    const report = await seedInTransaction(db, rows, corrections);
    await db.query('commit');
    return report;
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

async function seedInTransaction(db: Queryable, rows: SeedRow[], corrections: Correction[]): Promise<SeedReport> {
  const idsBy = async (table: string, column: string) => {
    const result = await db.query<{ id: number; key: string }>(`select id, ${column} as key from public.${table}`);
    return new Map(result.rows.map(({ id, key }) => [key, id]));
  };

  const typeIds = await idsBy('intervention_types', 'code');
  await seedCategories(db, rows, typeIds);
  const batchIds = await seedBatches(db, rows, typeIds);

  const municipalityIds = await idsBy('municipalities', 'name');
  const programIds = await idsBy('programs', 'name');
  const categoryIds = await idsBy('categories', 'name');
  const statusIds = await idsBy('statuses', 'name');
  const locationBasisIds = await idsBy('location_bases', 'name');

  const { rows: barangays } = await db.query<Barangay>(
    `select b.id, b.name, m.name as municipality
     from public.barangays b join public.municipalities m on m.id = b.municipality_id`,
  );
  const barangayIndex = new BarangayIndex(barangays);

  const unmatchedBarangays: UnmatchedBarangay[] = [];

  for (const row of rows) {
    const barangayName = emptyToNull(row.barangay);
    const match = barangayName ? barangayIndex.find(row.municipality, barangayName) : undefined;
    if (barangayName && !match) {
      unmatchedBarangays.push({
        sourceId: row.source_id,
        municipality: row.municipality,
        name: barangayName,
        ...closestBarangays(barangayName, row.municipality, barangays),
      });
    }

    const attributes = emptyToNull(row.category_variant) ? { variant: row.category_variant.trim() } : {};

    const { rows: inserted } = await db.query<{ id: string }>(
      `insert into public.interventions (
         intervention_type_id, category_id, title, banner_program_id, year_funded, quantity,
         beneficiary, municipality_id, barangay_id, barangay_raw, location_basis_id, geom,
         attributes, data_source, import_batch_id, source_id, source_page, source_raw, qa_flags
       ) values (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, ST_SetSRID(ST_MakePoint($12::float8, $13::float8), 4326),
         $14::jsonb, $15, $16, $17, $18, $19::jsonb, $20
       ) returning id`,
      [
        required(typeIds, TYPE_CODES[row.intervention_type], 'intervention type', row.source_id),
        required(categoryIds, row.category, 'category', row.source_id),
        emptyToNull(row.title),
        required(programIds, row.banner_program, 'banner program', row.source_id),
        Number(row.year_funded),
        Number(row.quantity),
        row.beneficiary,
        required(municipalityIds, row.municipality, 'municipality', row.source_id),
        match ? match.id : null,
        barangayName,
        required(locationBasisIds, RAED_LOCATION_BASIS, 'location basis', row.source_id),
        // Empty means unlocated: stored as null, never 0.
        emptyToNull(row.longitude) === null ? null : Number(row.longitude),
        emptyToNull(row.latitude) === null ? null : Number(row.latitude),
        JSON.stringify(attributes),
        RAED_DATA_SOURCE,
        batchIds.get(row.intervention_type),
        row.source_id,
        Number(row.source_page),
        JSON.stringify(row),
        flagsOf(row).filter((flag) => CARRIED_OVER_FLAGS.includes(flag)),
      ],
    );

    // The SPIS table has no status column; its Stage values are the SPIS status list.
    const statusName = emptyToNull(row.status) ?? emptyToNull(row.stage);
    if (!statusName) throw new Error(`${row.source_id}: no status or stage`);
    await db.query(
      `insert into public.status_history (intervention_id, status_id, status_date, remarks)
       values ($1, $2, $3, $4)`,
      [inserted[0].id, required(statusIds, statusName, 'status', row.source_id), RAED_STATUS_DATE, RAED_STATUS_REMARKS],
    );
  }

  await applyCorrections(db, rows, corrections, { municipalityIds, locationBasisIds, barangayIndex });

  return buildReport(db, rows, unmatchedBarangays, corrections);
}

interface CorrectionLookups {
  municipalityIds: Map<string, number>;
  locationBasisIds: Map<string, number>;
  barangayIndex: BarangayIndex;
}

// Only confirmed rows are applied. The raw values stay in source_raw and barangay_raw, the audit
// trigger records the change, and the QA trigger recalculates the flags. They are never cleared here.
async function applyCorrections(
  db: Queryable,
  rows: SeedRow[],
  corrections: Correction[],
  { municipalityIds, locationBasisIds, barangayIndex }: CorrectionLookups,
) {
  const confirmedBySource = new Map<string, Correction[]>();
  for (const c of corrections.filter((c) => c.status === 'confirmed')) {
    confirmedBySource.set(c.source_id, [...(confirmedBySource.get(c.source_id) ?? []), c]);
  }

  for (const [sourceId, confirmed] of confirmedBySource) {
    const row = rows.find((r) => r.source_id === sourceId)!;
    const corrected = (field: CorrectionField) => confirmed.find((c) => c.field === field)?.corrected_value.trim();

    const municipality = corrected('municipality') ?? row.municipality;
    const correctedBarangay = corrected('barangay');
    const barangayName = correctedBarangay ?? row.barangay;
    const barangay = barangayName.trim() ? barangayIndex.find(municipality, barangayName) : undefined;
    if (correctedBarangay && !barangay) {
      throw new Error(`Correction ${sourceId} barangay: "${correctedBarangay}" isn't in ${municipality}`);
    }

    const latitude = corrected('latitude') ?? row.latitude;
    const longitude = corrected('longitude') ?? row.longitude;
    if (!latitude.trim() !== !longitude.trim()) {
      throw new Error(`Correction ${sourceId}: a latitude and a longitude are both needed`);
    }

    const locationBasis = corrected('location_basis');
    const beneficiary = corrected('beneficiary');

    await db.query(`select set_config('app.audit_context', $1, true)`, [
      JSON.stringify({
        reason: 'reviewed correction',
        corrections: confirmed.map(({ field, raw_value, corrected_value, evidence, confirmed_by, confirmed_date }) => ({
          field,
          raw_value,
          corrected_value,
          evidence,
          confirmed_by,
          confirmed_date,
        })),
      }),
    ]);

    await db.query(
      `update public.interventions
       set municipality_id = $2,
           barangay_id = $3,
           geom = ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326),
           location_basis_id = coalesce($6, location_basis_id),
           beneficiary = coalesce($7, beneficiary),
           qa_flags = case when $7::text is null then qa_flags else array_remove(qa_flags, 'beneficiary_name_check') end
       where data_source = $8 and source_id = $1`,
      [
        sourceId,
        required(municipalityIds, municipality, 'municipality', sourceId),
        barangay ? barangay.id : null,
        longitude.trim() ? Number(longitude) : null,
        latitude.trim() ? Number(latitude) : null,
        locationBasis ? required(locationBasisIds, locationBasis, 'location basis', sourceId) : null,
        beneficiary ?? null,
        RAED_DATA_SOURCE,
      ],
    );

    await db.query(`select set_config('app.audit_context', '', true)`);
  }
}

async function buildReport(
  db: Queryable,
  rows: SeedRow[],
  unmatchedBarangays: UnmatchedBarangay[],
  corrections: Correction[],
): Promise<SeedReport> {
  const { rows: seeded } = await db.query<{
    source_id: string;
    qa_flags: string[];
    municipality: string;
    barangay: string | null;
    plotted_barangay: string | null;
    plotted_municipality: string | null;
  }>(
    `select v.source_id, v.qa_flags, m.name as municipality,
            coalesce(b.name, v.barangay_raw) as barangay, v.plotted_barangay, v.plotted_municipality
     from public.interventions_v v
     join public.municipalities m on m.id = v.municipality_id
     left join public.barangays b on b.id = v.barangay_id
     where v.data_source = $1
     order by v.source_id`,
    [RAED_DATA_SOURCE],
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

  const mismatches = (flag: string): LocationMismatch[] =>
    seeded
      .filter((r) => r.qa_flags.includes(flag))
      .map((r) => ({
        sourceId: r.source_id,
        encoded: [r.barangay, r.municipality].filter(Boolean).join(', '),
        plotted: r.plotted_barangay ? `${r.plotted_barangay}, ${r.plotted_municipality}` : null,
        alsoOutOfProvince: r.qa_flags.includes('out_of_province'),
      }));

  const countStatus = (status: string) => corrections.filter((c) => c.status === status).length;

  return {
    inserted: seeded.length,
    unmatchedBarangays,
    flagCounts,
    muniMismatches: mismatches('muni_mismatch'),
    barangayMismatches: mismatches('barangay_mismatch'),
    flagDifferences,
    csvOnlyFlags: rows.flatMap((r) =>
      flagsOf(r)
        .filter((flag) => !STORED_OR_COMPARED_CSV_FLAGS.has(flag))
        .map((flag) => ({ flag, sourceId: r.source_id })),
    ),
    corrections: {
      applied: countStatus('confirmed'),
      proposed: countStatus('proposed'),
      rejected: countStatus('rejected'),
    },
  };
}

export function printReport(report: SeedReport) {
  console.log(`Inserted: ${report.inserted}`);
  console.log('QA flags from the database:', report.flagCounts);
  const { applied, proposed, rejected } = report.corrections;
  console.log(`Corrections: ${applied} applied, ${proposed} proposed (not applied), ${rejected} rejected`);

  console.log(`\nUnmatched barangay names: ${report.unmatchedBarangays.length}`);
  const describe = (candidates: BarangayCandidate[]) =>
    candidates.map((c) => `${c.name}, ${c.municipality} (${c.distance})`).join('; ');
  for (const u of report.unmatchedBarangays) {
    console.log(`  ${u.sourceId}  "${u.name}", ${u.municipality}`);
    console.log(`    same municipality: ${describe(u.sameMunicipality)}`);
    console.log(`    elsewhere:         ${describe(u.otherMunicipalities)}`);
  }

  const printMismatches = (flag: string, list: LocationMismatch[]) => {
    console.log(`\n${flag}: ${list.length}`);
    for (const m of list) {
      const note = m.alsoOutOfProvince ? '  (also out_of_province)' : '';
      console.log(`  ${m.sourceId}  Plotted in ${m.plotted ?? 'no barangay'}, encoded as ${m.encoded}${note}`);
    }
  };
  printMismatches('muni_mismatch', report.muniMismatches);
  printMismatches('barangay_mismatch', report.barangayMismatches);

  console.log('\nDatabase flags compared with the CSV:');
  for (const d of report.flagDifferences) {
    const agree = d.onlyInCsv.length === 0 && d.onlyInDb.length === 0;
    console.log(`  ${d.csvFlag} vs ${d.dbFlag}: ${agree ? 'agree' : 'DIFFER'}`);
    if (d.onlyInCsv.length > 0) console.log(`    only in CSV: ${d.onlyInCsv.join(', ')}`);
    if (d.onlyInDb.length > 0) console.log(`    only in database: ${d.onlyInDb.join(', ')}`);
  }

  console.log(`\nCSV flags kept only in source_raw: ${report.csvOnlyFlags.length}`);
  for (const { flag, sourceId } of report.csvOnlyFlags) console.log(`  ${sourceId}  ${flag}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { createTestDb } = await import('../tests/helpers/db');
  const db = await createTestDb();
  console.log('Dry run on a temporary in-memory database.\n');
  const { rows, corrections } = loadSeedFiles();
  printReport(await seedInterventions(db, rows, corrections));
  await db.close();
}
