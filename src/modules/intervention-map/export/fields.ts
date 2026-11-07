// The one list of fields every format writes, so a value can't differ between a KMZ and a CSV.
import type { FieldDefinition, Intervention, MapData, StatusEntry } from '../data/types';
import { encodedPlace, FLAG_LABELS, statusDateLabel, statusTimeline } from '../lib/display';
import { geometryBounds, NEEDS_LOCATION_CHECK, needsLocationCheck } from './records';

export type FieldValue = string | number | null;

export interface ExportField {
  key: string; // the GeoJSON property and KML Data name
  label: string; // the CSV heading and balloon row
  numeric: boolean;
  // Custom fields only belong in the balloon of a record of their own type.
  typeIds?: Set<number>;
  read(record: Intervention): FieldValue;
}

const pascalCase = (text: string) =>
  text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');

// Where a record sits, for columns of latitude and longitude. A point is exact. For a line or
// polygon, it's the middle of its extent.
export function representativePoint(record: Intervention): { longitude: number; latitude: number } | null {
  if (!record.geojson) return null;
  if (record.geojson.type === 'Point') {
    const [longitude, latitude] = record.geojson.coordinates;
    return { longitude, latitude };
  }
  const { west, east, south, north } = geometryBounds(record.geojson);
  return { longitude: (west + east) / 2, latitude: (south + north) / 2 };
}

function customValue(definition: FieldDefinition | undefined, value: unknown): FieldValue {
  if (value === null || value === undefined || value === '') return null;
  if (definition?.input === 'yes_no') return value ? 'Yes' : 'No';
  if (definition?.input === 'photo') return 'Photo attached';
  if (definition?.input === 'dropdown') return definition.options?.find((option) => option.value === value)?.label ?? String(value);
  if (typeof value === 'number') return value;
  if (definition?.input === 'number' && Number.isFinite(Number(value))) return Number(value);
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

// Every custom field of the records' types, including archived ones and any value left over from a
// field no longer on the type, so nothing stored is missing from an export.
function customFields(records: Intervention[], data: Pick<MapData, 'types'>, usedKeys: Set<string>): ExportField[] {
  const found = new Map<string, { definition?: FieldDefinition; typeIds: Set<number> }>();
  const typeIds = new Set(records.map((record) => record.intervention_type_id));

  for (const type of data.types) {
    if (!typeIds.has(type.id)) continue;
    for (const definition of type.field_schema.fields) {
      const entry = found.get(definition.key) ?? { definition, typeIds: new Set<number>() };
      entry.typeIds.add(type.id);
      found.set(definition.key, entry);
    }
  }
  for (const record of records) {
    for (const key of Object.keys(record.attributes)) {
      const entry = found.get(key) ?? { typeIds: new Set<number>() };
      entry.typeIds.add(record.intervention_type_id);
      found.set(key, entry);
    }
  }

  return [...found].map(([attribute, { definition, typeIds: owners }]) => {
    const read = (record: Intervention) => customValue(definition, record.attributes[attribute]);
    const values = records.map(read).filter((value) => value !== null);
    const label = definition ? definition.label + (definition.unit ? ` (${definition.unit})` : '') : attribute;

    let key = pascalCase(attribute) || attribute;
    if (usedKeys.has(key)) key = `Attribute${key}`;
    usedKeys.add(key);

    return {
      key,
      label,
      numeric: definition?.input === 'number' && values.every((value) => typeof value === 'number'),
      typeIds: owners,
      read,
    };
  });
}

export function buildFields(records: Intervention[], data: MapData): ExportField[] {
  const nameOf = <T extends { id: number; name: string }>(items: T[], id: number | null) => items.find((item) => item.id === id)?.name ?? null;
  const person = (id: string | null | undefined) => data.members.find((member) => member.id === id)?.full_name ?? null;

  const latestStatus = new Map<string, StatusEntry>();
  for (const record of records) {
    const latest = statusTimeline(record.id, data.statusHistory).at(-1);
    if (latest) latestStatus.set(record.id, latest);
  }

  const fields: ExportField[] = [];
  const add = (key: string, label: string, read: ExportField['read'], numeric = false) => fields.push({ key, label, read, numeric });

  // First, so these are what a person sees on opening a table.
  add('QaLocationCheck', NEEDS_LOCATION_CHECK, (r) => (needsLocationCheck(r) ? 'Outside Marinduque' : null));
  add('QaFlags', 'QA flags', (r) => r.qa_flags.map((flag) => FLAG_LABELS[flag] ?? flag).join('; ') || null);
  add('RecordId', 'Record ID', (r) => r.id);
  add('SourceId', 'Source ID', (r) => r.source_id ?? null);
  add('SourcePage', 'Source page', (r) => r.source_page ?? null, true);
  add('Type', 'Type', (r) => nameOf(data.types, r.intervention_type_id));
  add('Category', 'Category', (r) => nameOf(data.categories, r.category_id));
  add('Title', 'Title', (r) => r.title);
  add('Program', 'Program', (r) => nameOf(data.programs, r.banner_program_id));
  add('YearFunded', 'Year funded', (r) => r.year_funded, true);
  add('Quantity', 'Quantity', (r) => r.quantity, true);
  add('UnitCost', 'Unit cost', (r) => r.unit_cost, true);
  add('FundSource', 'Fund source', (r) => r.fund_source);
  add('Beneficiary', 'Beneficiary', (r) => r.beneficiary);
  add('BeneficiaryType', 'Beneficiary type', (r) => nameOf(data.beneficiaryTypes, r.beneficiary_type_id));
  add('Municipality', 'Municipality', (r) => nameOf(data.municipalities, r.municipality_id));
  add('Barangay', 'Barangay', (r) => nameOf(data.barangays, r.barangay_id));
  add('BarangayAsEncoded', 'Barangay as encoded', (r) => r.barangay_raw);
  add('PlottedBarangay', 'Plotted in barangay', (r) => r.plotted_barangay);
  add('PlottedMunicipality', 'Plotted in municipality', (r) => r.plotted_municipality);
  add('LocationBasis', 'Location basis', (r) => nameOf(data.locationBases, r.location_basis_id));
  add('Latitude', 'Latitude', (r) => representativePoint(r)?.latitude ?? null, true);
  add('Longitude', 'Longitude', (r) => representativePoint(r)?.longitude ?? null, true);
  add('Status', 'Status', (r) => nameOf(data.statuses, r.status_id));
  add('StatusDate', 'Status as of', (r) => {
    const latest = latestStatus.get(r.id);
    return latest ? statusDateLabel(latest) : null;
  });
  add('DataSource', 'Data source', (r) => r.data_source);
  add('Remarks', 'Remarks', (r) => r.remarks);
  add('EncodedBy', 'Encoded by', (r) => person(r.created_by));
  add('UpdatedBy', 'Last updated by', (r) => person(r.updated_by));
  add('CreatedAt', 'Created', (r) => r.created_at);
  add('UpdatedAt', 'Last updated', (r) => r.updated_at);
  add('Version', 'Version', (r) => r.version, true);

  return [...fields, ...customFields(records, data, new Set(fields.map((field) => field.key)))];
}

// "Hand Tractor – Tumapon FA (2022)", leaving out any part that's blank.
export function placemarkName(record: Intervention, data: Pick<MapData, 'categories'>): string {
  const category = data.categories.find((c) => c.id === record.category_id)?.name ?? record.title;
  const main = [category, record.beneficiary].filter(Boolean).join(' – ') || 'Unnamed record';
  return record.year_funded === null ? main : `${main} (${record.year_funded})`;
}

// How a record without coordinates is named in the list that says it was left out.
export function unlocatedLine(record: Intervention, data: MapData): string {
  const place = encodedPlace(record, data);
  return place ? `${placemarkName(record, data)}, ${place}` : placemarkName(record, data);
}

