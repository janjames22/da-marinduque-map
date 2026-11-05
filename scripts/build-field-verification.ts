// Builds data/corrections/for-field-verification.csv: the flagged records for the MAOs to check
// in the field. Records flagged only for shared coordinates are left out, because that's normal
// when one FCA has several machines. The file opens correctly in Excel, including n-tilde.
//
// Usage: npx tsx scripts/build-field-verification.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { CORRECTIONS_CSV_PATH, loadSeedFiles, seedInterventions, type Correction, type Queryable } from './seed-interventions';

const OUTPUT_PATH = resolve(dirname(CORRECTIONS_CSV_PATH), 'for-field-verification.csv');

export interface VerificationRow {
  ID: string;
  Type: string;
  'Machine / project': string;
  Beneficiary: string;
  'Municipality (encoded)': string;
  'Barangay (encoded)': string;
  Issue: string;
  'Suggested value': string;
  'Verified barangay': string;
  'Verified latitude': string;
  'Verified longitude': string;
  'Location basis': string;
}

interface FlaggedRecord {
  source_id: string;
  type: string;
  category: string | null;
  title: string | null;
  variant: string | null;
  beneficiary: string | null;
  municipality: string;
  barangay_raw: string | null;
  qa_flags: string[];
  csv_flags: string | null;
  plotted_barangay: string | null;
  plotted_municipality: string | null;
  encoded_barangay_lat: number | null;
  encoded_barangay_lon: number | null;
}

const CORRECTION_LABELS: Record<string, string> = {
  municipality: 'Municipality',
  barangay: 'Barangay',
  latitude: 'Latitude',
  longitude: 'Longitude',
  location_basis: 'Location basis',
  beneficiary: 'Beneficiary',
};

function plottedIn(record: FlaggedRecord): string | null {
  return record.plotted_barangay ? `${record.plotted_barangay}, ${record.plotted_municipality}` : null;
}

function describeIssues(record: FlaggedRecord): string {
  const flags = new Set(record.qa_flags);
  const csvFlags = (record.csv_flags ?? '').split(';').map((flag) => flag.trim());
  const issues: string[] = [];

  if (flags.has('no_coords')) issues.push('No coordinates');
  if (flags.has('out_of_province')) issues.push('Coordinates are outside Marinduque');
  if ((flags.has('muni_mismatch') || flags.has('barangay_mismatch')) && plottedIn(record)) {
    const encoded = [record.barangay_raw, record.municipality].filter(Boolean).join(', ');
    issues.push(`Plotted in ${plottedIn(record)}, encoded as ${encoded}`);
  }
  if (flags.has('no_barangay')) issues.push('No barangay encoded');
  if (flags.has('barangay_unmatched')) issues.push(`Barangay "${record.barangay_raw}" is not on the official list`);
  if (flags.has('beneficiary_name_check')) issues.push('Beneficiary name mentions a place outside Marinduque; confirm the name');
  if (csvFlags.includes('possible_duplicate')) issues.push('Possible duplicate of another record');
  if (flags.has('duplicate_point')) issues.push('Shares exact coordinates with another record');

  return issues.join('; ');
}

function suggest(record: FlaggedRecord, proposals: Correction[]): string {
  if (proposals.length > 0) {
    return proposals.map((c) => `${CORRECTION_LABELS[c.field]}: ${c.corrected_value}`).join('; ');
  }

  const flags = new Set(record.qa_flags);
  if (flags.has('out_of_province') && record.encoded_barangay_lat !== null) {
    const near = `${record.encoded_barangay_lat.toFixed(4)}, ${record.encoded_barangay_lon!.toFixed(4)}`;
    return `Check coordinates; ${record.barangay_raw} lies near ${near}`;
  }
  const locationIssue = ['muni_mismatch', 'barangay_mismatch', 'no_barangay', 'barangay_unmatched'].some((f) => flags.has(f));
  if (locationIssue && plottedIn(record)) return `Point is in ${plottedIn(record)}`;
  return '';
}

export async function buildVerificationRows(db: Queryable, corrections: Correction[]): Promise<VerificationRow[]> {
  const { rows: records } = await db.query<FlaggedRecord>(
    `select v.source_id, t.name as type, c.name as category, v.title,
            v.attributes ->> 'variant' as variant, v.beneficiary, m.name as municipality, v.barangay_raw,
            v.qa_flags, v.source_raw ->> 'qa_flags' as csv_flags,
            v.plotted_barangay, v.plotted_municipality,
            ST_Y(ST_PointOnSurface(b.boundary)) as encoded_barangay_lat,
            ST_X(ST_PointOnSurface(b.boundary)) as encoded_barangay_lon
     from public.interventions_v v
     join public.intervention_types t on t.id = v.intervention_type_id
     join public.municipalities m on m.id = v.municipality_id
     left join public.categories c on c.id = v.category_id
     left join public.barangays b on b.id = v.barangay_id
     where v.source_id is not null
       and (
         cardinality(array_remove(v.qa_flags, 'duplicate_point')) > 0
         or v.source_raw ->> 'qa_flags' like '%possible_duplicate%'
       )
     order by m.name, v.barangay_raw nulls first, v.source_id`,
  );

  return records.map((record) => ({
    ID: record.source_id,
    Type: record.type,
    'Machine / project': [record.title ?? record.category, record.variant].filter(Boolean).join(' - '),
    Beneficiary: record.beneficiary ?? '',
    'Municipality (encoded)': record.municipality,
    'Barangay (encoded)': record.barangay_raw ?? '',
    Issue: describeIssues(record),
    'Suggested value': suggest(
      record,
      corrections.filter((c) => c.source_id === record.source_id && c.status === 'proposed'),
    ),
    'Verified barangay': '',
    'Verified latitude': '',
    'Verified longitude': '',
    'Location basis': '',
  }));
}

export function verificationCsv(rows: VerificationRow[]): string {
  return `﻿${Papa.unparse(rows, { newline: '\r\n' })}\r\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { createTestDb } = await import('../tests/helpers/db');
  const db = await createTestDb();
  const { rows, corrections } = loadSeedFiles();
  await seedInterventions(db, rows, corrections);
  const sheet = await buildVerificationRows(db, corrections);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, verificationCsv(sheet));
  console.log(`Wrote ${sheet.length} records to ${OUTPUT_PATH}`);
  await db.close();
}
