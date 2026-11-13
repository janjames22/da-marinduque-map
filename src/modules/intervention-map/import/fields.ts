// What a file's columns can become for a given intervention type, and a first guess at which is which.
// A person checks and changes the guess before anything is imported.
import type { InterventionType } from '../data/types';
import { coreFieldLabel } from '../lib/validation';
import { looseKey } from '../lib/matching';

export type ListName = 'categories' | 'programs' | 'beneficiaryTypes' | 'locationBases' | 'municipalities' | 'statuses' | 'options';

export interface Target {
  id: string;
  label: string;
  required: boolean;
  // A column whose values have to be found in a list, such as programs.
  list?: ListName;
  // For a custom field.
  field?: { key: string; input: 'text' | 'number' | 'date' | 'dropdown' | 'yes_no' };
}

// The record's own columns, with the list each is chosen from. Each maps to a column of the record.
const CORE: { id: string; label: string; column?: string; list?: ListName }[] = [
  { id: 'source_id', label: 'ID in the file' },
  { id: 'title', label: 'Title', column: 'title' },
  { id: 'category', label: 'Category', column: 'category_id', list: 'categories' },
  { id: 'banner_program', label: 'Banner program', column: 'banner_program_id', list: 'programs' },
  { id: 'year_funded', label: 'Year funded', column: 'year_funded' },
  { id: 'quantity', label: 'Quantity', column: 'quantity' },
  { id: 'unit_cost', label: 'Unit cost', column: 'unit_cost' },
  { id: 'fund_source', label: 'Fund source', column: 'fund_source' },
  { id: 'beneficiary', label: 'Beneficiary', column: 'beneficiary' },
  { id: 'beneficiary_type', label: 'Beneficiary type', column: 'beneficiary_type_id', list: 'beneficiaryTypes' },
  { id: 'municipality', label: 'Municipality', list: 'municipalities' },
  { id: 'barangay', label: 'Barangay' },
  { id: 'location_basis', label: 'Location basis', column: 'location_basis_id', list: 'locationBases' },
  { id: 'latitude', label: 'Latitude' },
  { id: 'longitude', label: 'Longitude' },
  { id: 'coordinates', label: 'Coordinates (both in one column)' },
  { id: 'status', label: 'Status', list: 'statuses' },
  { id: 'status_date', label: 'Status date' },
  { id: 'remarks', label: 'Remarks', column: 'remarks' },
];

// What these columns are often called. Compared without case, spaces or punctuation.
const NAMES: Record<string, string[]> = {
  source_id: ['id', 'sourceid', 'recordid', 'referenceno', 'refno', 'reference', 'controlno', 'no'],
  title: ['title', 'project', 'projectname', 'projecttitle', 'nameofproject'],
  category: ['category', 'equipment', 'machinery', 'machine', 'item', 'intervention', 'typeofmachinery', 'kindofmachinery', 'commodity'],
  banner_program: ['program', 'bannerprogram', 'programme'],
  year_funded: ['year', 'yearfunded', 'fy', 'fundingyear', 'yearofprocurement', 'yearprocured'],
  quantity: ['quantity', 'qty', 'units', 'noofunits', 'numberofunits'],
  unit_cost: ['unitcost', 'cost', 'amount', 'price', 'unitprice', 'acquisitioncost'],
  fund_source: ['fundsource', 'sourceoffund', 'sourceoffunds', 'fundingsource', 'fund'],
  beneficiary: ['beneficiary', 'beneficiaries', 'recipient', 'nameofbeneficiary', 'nameoffca', 'fca', 'association', 'cooperative', 'organization'],
  beneficiary_type: ['beneficiarytype', 'typeofbeneficiary'],
  municipality: ['municipality', 'town', 'city', 'municipalitycity', 'citymunicipality', 'lgu'],
  barangay: ['barangay', 'brgy', 'village'],
  location_basis: ['locationbasis'],
  latitude: ['latitude', 'lat', 'latitudefromthemapfile'],
  longitude: ['longitude', 'long', 'lng', 'lon', 'longitudefromthemapfile'],
  coordinates: ['coordinates', 'coordinate', 'gps', 'gpscoordinates', 'latlong', 'latlng', 'geotag', 'location'],
  status: ['status', 'stage', 'condition', 'currentstatus'],
  status_date: ['statusdate', 'dateturnedover', 'turnoverdate', 'datedelivered', 'deliverydate', 'dateofturnover', 'asof'],
  remarks: ['remarks', 'notes', 'note', 'comments'],
};

// A point's own columns. A line type's records take their line from a map file instead (Phase 16c).
const POINT_TARGETS = new Set(['latitude', 'longitude', 'coordinates']);

export function targetsFor(type: InterventionType): Target[] {
  const rules = type.core_field_rules;
  const offered = CORE.filter((target) => (!target.column || rules[target.column] !== 'hidden') && !(type.geometry_kind === 'line' && POINT_TARGETS.has(target.id)));
  const core = offered.map((target) => ({
    id: target.id,
    label: target.column ? coreFieldLabel(target.column) : target.label,
    required: target.id === 'municipality' || (target.column !== undefined && rules[target.column] === 'required'),
    ...(target.list ? { list: target.list } : {}),
  }));
  const custom = type.field_schema.fields
    .filter((field) => !field.archived && field.input !== 'photo')
    .map((field) => ({
      id: `attr:${field.key}`,
      label: field.label + (field.unit ? ` (${field.unit})` : ''),
      required: Boolean(field.required),
      ...(field.input === 'dropdown' ? { list: 'options' as const } : {}),
      field: { key: field.key, input: field.input as 'text' | 'number' | 'date' | 'dropdown' | 'yes_no' },
    }));
  return [...core, ...custom];
}

// Which of the file's columns is which. A column left out maps to ''.
export type ColumnMapping = Record<string, string>;

// From what the columns are called, or what the last file from the same source was mapped to. Each
// field takes one column at most, the first that fits.
export function guessMapping(columns: string[], targets: Target[], remembered: ColumnMapping = {}): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();
  const offered = new Set(targets.map((target) => target.id));

  for (const column of columns) {
    const earlier = remembered[column];
    if (earlier !== undefined && (earlier === '' || (offered.has(earlier) && !taken.has(earlier)))) {
      mapping[column] = earlier;
      if (earlier) taken.add(earlier);
    }
  }
  // A column named exactly as a field goes to that field first, so "Date turned over" fills the custom
  // field of that name rather than the status date it is also a usual name for.
  const exact = (target: Target, key: string) => key === looseKey(target.label) || (target.field !== undefined && key === looseKey(target.field.key));
  const usual = (target: Target, key: string) => !target.field && (NAMES[target.id] ?? []).includes(key);
  for (const fits of [exact, usual]) {
    for (const column of columns) {
      if (column in mapping) continue;
      const key = looseKey(column);
      const match = targets.find((target) => !taken.has(target.id) && fits(target, key));
      if (!match) continue;
      mapping[column] = match.id;
      taken.add(match.id);
    }
  }
  for (const column of columns) if (!(column in mapping)) mapping[column] = '';
  return mapping;
}

export const columnFor = (mapping: ColumnMapping, target: string) => Object.keys(mapping).find((column) => mapping[column] === target);
