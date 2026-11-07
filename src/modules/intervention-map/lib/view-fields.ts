// Every field a person can filter the map by or color its markers by, including each type's custom
// fields. A filter is worked out from the record alone, so the map, charts, table and exports can't
// disagree about what it matches.
import type { FieldDefinition, Intervention, MapData } from '../data/types';
import { manilaToday } from './dates';
import { FLAG_LABELS, recordColor } from './display';

// The choice that matches a record with no value at all.
export const NOT_SET = '__not_set__';
export const DEFAULT_COLOR_BY = 'program';

export type FieldKind = 'choice' | 'number' | 'date' | 'text';

export interface FieldChoice {
  value: string;
  label: string;
  color?: string;
}

export interface ViewField {
  id: string;
  label: string;
  group: string;
  kind: FieldKind;
  choices?: FieldChoice[];
  archived?: boolean;
  colorable: boolean;
}

export type FieldFilter =
  | { field: string; kind: 'choice'; values: string[] }
  | { field: string; kind: 'number'; min: number | null; max: number | null }
  | { field: string; kind: 'date'; from: string | null; to: string | null }
  | { field: string; kind: 'text'; text: string };

type FieldValue = string | number | string[] | null;

const idText = (id: number | null) => (id === null ? null : String(id));
const manilaDate = (timestamp: string | null | undefined) => (timestamp ? manilaToday(new Date(timestamp)) : null);

const CORE_READERS: Record<string, (record: Intervention) => FieldValue> = {
  program: (r) => idText(r.banner_program_id),
  status: (r) => idText(r.status_id),
  type: (r) => String(r.intervention_type_id),
  category: (r) => idText(r.category_id),
  year_funded: (r) => r.year_funded,
  location_basis: (r) => idText(r.location_basis_id),
  beneficiary_type: (r) => idText(r.beneficiary_type_id),
  municipality: (r) => String(r.municipality_id),
  qa_flags: (r) => r.qa_flags,
  has_coordinates: (r) => (r.geojson ? 'yes' : 'no'),
  data_source: (r) => r.data_source,
  fund_source: (r) => r.fund_source,
  quantity: (r) => r.quantity,
  unit_cost: (r) => r.unit_cost,
  created_on: (r) => manilaDate(r.created_at),
  updated_on: (r) => manilaDate(r.updated_at),
  encoded_by: (r) => r.created_by ?? null,
  updated_by: (r) => r.updated_by ?? null,
  beneficiary: (r) => r.beneficiary,
  title: (r) => r.title,
  remarks: (r) => r.remarks,
  source_id: (r) => r.source_id ?? null,
};

// A custom field belongs to one type, as two types can use the same key for different things.
const CUSTOM_FIELD = /^(attr|photo):(\d+):(.+)$/;

export function readField(record: Intervention, fieldId: string): FieldValue {
  const core = CORE_READERS[fieldId];
  if (core) {
    const value = core(record);
    return value === '' ? null : value;
  }
  const custom = CUSTOM_FIELD.exec(fieldId);
  if (!custom || record.intervention_type_id !== Number(custom[2])) return null;
  const value = record.attributes[custom[3]];
  if (custom[1] === 'photo') return value ? 'yes' : 'no';
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return value;
  return String(value);
}

// Ignores case, spacing and marks such as the tilde in Kiñaman, so a search finds what a person means.
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isActiveFilter(filter: FieldFilter): boolean {
  switch (filter.kind) {
    case 'choice':
      return filter.values.length > 0;
    case 'number':
      return filter.min !== null || filter.max !== null;
    case 'date':
      return Boolean(filter.from || filter.to);
    case 'text':
      return foldText(filter.text) !== '';
  }
}

// A filter still being filled in matches everything. Otherwise a record with no value only matches
// when "Not set" is chosen.
export function matchesFilter(record: Intervention, filter: FieldFilter): boolean {
  if (!isActiveFilter(filter)) return true;
  const value = readField(record, filter.field);
  switch (filter.kind) {
    case 'choice': {
      const held = Array.isArray(value) ? value : value === null ? [] : [String(value)];
      if (held.length === 0) return filter.values.includes(NOT_SET);
      return held.some((item) => filter.values.includes(item));
    }
    case 'number': {
      if (value === null || Array.isArray(value)) return false;
      const number = Number(value);
      if (!Number.isFinite(number)) return false;
      return (filter.min === null || number >= filter.min) && (filter.max === null || number <= filter.max);
    }
    case 'date': {
      if (typeof value !== 'string') return false;
      const day = value.slice(0, 10);
      return (!filter.from || day >= filter.from) && (!filter.to || day <= filter.to);
    }
    case 'text':
      return value !== null && !Array.isArray(value) && foldText(String(value)).includes(foldText(filter.text));
  }
}

export function emptyFilter(field: ViewField): FieldFilter {
  switch (field.kind) {
    case 'choice':
      return { field: field.id, kind: 'choice', values: [] };
    case 'number':
      return { field: field.id, kind: 'number', min: null, max: null };
    case 'date':
      return { field: field.id, kind: 'date', from: null, to: null };
    case 'text':
      return { field: field.id, kind: 'text', text: '' };
  }
}

const YES_NO: FieldChoice[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

type CatalogData = Pick<MapData, 'types' | 'categories' | 'programs' | 'statuses' | 'locationBases' | 'beneficiaryTypes' | 'municipalities' | 'members' | 'interventions'>;

function customField(typeId: number, typeName: string, definition: FieldDefinition): ViewField {
  const label = definition.label + (definition.unit ? ` (${definition.unit})` : '');
  const shared = { label, group: typeName, archived: definition.archived, colorable: true };
  switch (definition.input) {
    case 'dropdown':
      return { ...shared, id: `attr:${typeId}:${definition.key}`, kind: 'choice', choices: (definition.options ?? []).map(({ value, label: name }) => ({ value, label: name })) };
    case 'yes_no':
      return { ...shared, id: `attr:${typeId}:${definition.key}`, kind: 'choice', choices: YES_NO };
    case 'photo':
      return {
        ...shared,
        id: `photo:${typeId}:${definition.key}`,
        kind: 'choice',
        choices: [
          { value: 'yes', label: 'Has a photo' },
          { value: 'no', label: 'No photo' },
        ],
      };
    case 'number':
      return { ...shared, id: `attr:${typeId}:${definition.key}`, kind: 'number' };
    case 'date':
      return { ...shared, id: `attr:${typeId}:${definition.key}`, kind: 'date' };
    default:
      return { ...shared, id: `attr:${typeId}:${definition.key}`, kind: 'text' };
  }
}

// Everything on the map's records. Inactive types are hidden throughout, so their fields are too.
export function viewFields(data: CatalogData): ViewField[] {
  const record = 'Record';
  const used = (read: (r: Intervention) => number | null) => new Set(data.interventions.map(read));
  // An archived item stays a choice for as long as a record has it.
  const lookup = <T extends { id: number; name: string; is_active?: boolean; color?: string }>(items: T[], read: (r: Intervention) => number | null): FieldChoice[] => {
    const inUse = used(read);
    return items
      .filter((item) => item.is_active !== false || inUse.has(item.id))
      .map((item) => ({ value: String(item.id), label: item.name, ...(item.color ? { color: item.color } : {}) }));
  };
  const activeTypes = data.types.filter((type) => type.is_active);
  const activeTypeIds = new Set(activeTypes.map((type) => type.id));
  const categories = data.categories.filter((category) => category.intervention_type_id === null || activeTypeIds.has(category.intervention_type_id));
  const dataSources = [...new Set(data.interventions.map((r) => r.data_source).filter((source): source is string => Boolean(source)))].sort();
  const people = data.members.map((member) => ({ value: member.id, label: member.full_name ?? 'Unnamed' }));

  const fields: ViewField[] = [
    { id: 'program', label: 'Program', group: record, kind: 'choice', colorable: true, choices: lookup(data.programs, (r) => r.banner_program_id) },
    { id: 'status', label: 'Status', group: record, kind: 'choice', colorable: true, choices: lookup(data.statuses, (r) => r.status_id) },
    { id: 'type', label: 'Type', group: record, kind: 'choice', colorable: true, choices: activeTypes.map((type) => ({ value: String(type.id), label: type.name, color: type.color })) },
    { id: 'category', label: 'Category', group: record, kind: 'choice', colorable: true, choices: lookup(categories, (r) => r.category_id) },
    { id: 'year_funded', label: 'Year funded', group: record, kind: 'number', colorable: true },
    { id: 'location_basis', label: 'Location basis', group: record, kind: 'choice', colorable: true, choices: lookup(data.locationBases, (r) => r.location_basis_id) },
    { id: 'beneficiary_type', label: 'Beneficiary type', group: record, kind: 'choice', colorable: true, choices: lookup(data.beneficiaryTypes, (r) => r.beneficiary_type_id) },
    { id: 'municipality', label: 'Municipality', group: record, kind: 'choice', colorable: true, choices: data.municipalities.map((m) => ({ value: String(m.id), label: m.name })) },
    { id: 'qa_flags', label: 'QA flag', group: record, kind: 'choice', colorable: true, choices: Object.entries(FLAG_LABELS).map(([value, label]) => ({ value, label })) },
    { id: 'has_coordinates', label: 'Has coordinates', group: record, kind: 'choice', colorable: true, choices: YES_NO },
    { id: 'data_source', label: 'Data source', group: record, kind: 'choice', colorable: true, choices: dataSources.map((source) => ({ value: source, label: source })) },
    { id: 'fund_source', label: 'Fund source', group: record, kind: 'text', colorable: true },
    { id: 'quantity', label: 'Quantity', group: record, kind: 'number', colorable: true },
    { id: 'unit_cost', label: 'Unit cost', group: record, kind: 'number', colorable: true },
    { id: 'created_on', label: 'Date encoded', group: record, kind: 'date', colorable: true },
    { id: 'updated_on', label: 'Last updated', group: record, kind: 'date', colorable: true },
    ...(people.length > 0
      ? ([
          { id: 'encoded_by', label: 'Encoded by', group: record, kind: 'choice', colorable: true, choices: people },
          { id: 'updated_by', label: 'Last updated by', group: record, kind: 'choice', colorable: true, choices: people },
        ] satisfies ViewField[])
      : []),
    { id: 'beneficiary', label: 'Beneficiary', group: record, kind: 'text', colorable: false },
    { id: 'title', label: 'Title', group: record, kind: 'text', colorable: false },
    { id: 'remarks', label: 'Remarks', group: record, kind: 'text', colorable: false },
    { id: 'source_id', label: 'Source ID', group: record, kind: 'text', colorable: false },
  ];

  for (const type of activeTypes) {
    for (const definition of type.field_schema.fields) fields.push(customField(type.id, type.name, definition));
  }
  return fields;
}

const between = (low: string | number | null, high: string | number | null) => {
  if (low !== null && high !== null) return String(low) === String(high) ? String(low) : `${low} to ${high}`;
  return low !== null ? `from ${low}` : `up to ${high}`;
};

// A filter in words, for the panel, the export dialog, the file and the audit log.
export function describeFieldFilter(filter: FieldFilter, fields: ViewField[]): string | null {
  if (!isActiveFilter(filter)) return null;
  const field = fields.find((candidate) => candidate.id === filter.field);
  const label = field?.label ?? filter.field;
  switch (filter.kind) {
    case 'choice':
      return `${label}: ${filter.values.map((value) => (value === NOT_SET ? 'Not set' : (field?.choices?.find((choice) => choice.value === value)?.label ?? value))).join(', ')}`;
    case 'number':
      return `${label}: ${between(filter.min, filter.max)}`;
    case 'date':
      return `${label}: ${between(filter.from || null, filter.to || null)}`;
    case 'text':
      return `${label} contains "${filter.text.trim()}"`;
  }
}

// A fixed order, checked for color blindness as a set. A color follows its value, never its rank, so
// filtering a map can't repaint what's left. Beyond three, a map also leans on the legend's words.
export const CATEGORY_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
// One hue for anything in order. The lightest still shows on a map.
const RANGE_COLORS = ['#86b6ef', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const OTHER_COLOR = '#757575';
const NOT_SET_COLOR = '#bdbdbd';
const MOST_RANGES = RANGE_COLORS.length;

export interface ColorEntry {
  key: string;
  label: string;
  color: string;
}

export interface ColorScale {
  field: string;
  title: string;
  entries: ColorEntry[];
  keyOf(record: Intervention): string;
  colorOf(record: Intervention): string;
}

const OTHER = '__other__';
const firstValue = (value: FieldValue) => (Array.isArray(value) ? (value[0] ?? null) : value);

function choiceEntries(field: ViewField, records: Intervention[]): ColorEntry[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = firstValue(readField(record, field.id));
    if (value !== null) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  }

  const choices: FieldChoice[] = field.choices ?? [...counts.keys()].sort().map((value) => ({ value, label: value }));
  // Colors from the lists stay, as they're the same on the legend, charts and exports.
  if (choices.length > 0 && choices.every((choice) => choice.color)) {
    return choices.map((choice) => ({ key: choice.value, label: choice.label, color: choice.color! }));
  }
  if (choices.length <= CATEGORY_COLORS.length) {
    return choices.map((choice, index) => ({ key: choice.value, label: choice.label, color: CATEGORY_COLORS[index] }));
  }
  // Past the palette, the commonest keep a color and the rest fold into Other. This is decided over
  // all records, not the filtered ones, so a filter doesn't change which is which.
  const kept = choices
    .map((choice, order) => ({ choice, order, count: counts.get(choice.value) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, CATEGORY_COLORS.length - 1)
    .sort((a, b) => a.order - b.order);
  return [
    ...kept.map(({ choice }, index) => ({ key: choice.value, label: choice.label, color: CATEGORY_COLORS[index] })),
    { key: OTHER, label: 'Other', color: OTHER_COLOR },
  ];
}

function choiceScale(field: ViewField, records: Intervention[]): Pick<ColorScale, 'entries' | 'keyOf'> {
  const entries = choiceEntries(field, records);
  const known = new Set(entries.map((entry) => entry.key));
  return {
    entries: [...entries, { key: NOT_SET, label: 'Not set', color: NOT_SET_COLOR }],
    keyOf: (record) => {
      const value = firstValue(readField(record, field.id));
      if (value === null) return NOT_SET;
      return known.has(String(value)) ? String(value) : known.has(OTHER) ? OTHER : NOT_SET;
    },
  };
}

// Up to five ranges holding about as many records each, or one each if there are few values.
function rangeScale(field: ViewField, records: Intervention[], toNumber: (value: FieldValue) => number): Pick<ColorScale, 'entries' | 'keyOf'> {
  const numberOf = (record: Intervention) => toNumber(firstValue(readField(record, field.id)));
  const values = records.map(numberOf).filter(Number.isFinite).sort((a, b) => a - b);
  const distinct = [...new Set(values)];

  const ranges: { low: number; high: number }[] = [];
  if (distinct.length <= MOST_RANGES) {
    for (const value of distinct) ranges.push({ low: value, high: value });
  } else {
    let start = 0;
    for (let bin = 1; bin <= MOST_RANGES && start < values.length; bin++) {
      let end = bin === MOST_RANGES ? values.length - 1 : Math.ceil((values.length * bin) / MOST_RANGES) - 1;
      // A value never splits across two ranges.
      while (end + 1 < values.length && values[end + 1] === values[end]) end += 1;
      ranges.push({ low: values[start], high: values[end] });
      start = end + 1;
    }
  }

  // Spread across the ramp, so two ranges don't get its two nearest steps.
  const colorFor = (index: number) => RANGE_COLORS[ranges.length === 1 ? 2 : Math.round((index * (RANGE_COLORS.length - 1)) / (ranges.length - 1))];
  const label = ({ low, high }: { low: number; high: number }) => (low === high ? low.toLocaleString('en-US', { useGrouping: false }) : `${low.toLocaleString('en-US', { useGrouping: false })} to ${high.toLocaleString('en-US', { useGrouping: false })}`);
  const entries = ranges.map((range, index) => ({ key: `range-${index}`, label: label(range), color: colorFor(index) }));
  return {
    entries: [...entries, { key: NOT_SET, label: 'Not set', color: NOT_SET_COLOR }],
    keyOf: (record) => {
      const number = numberOf(record);
      if (!Number.isFinite(number)) return NOT_SET;
      const index = ranges.findIndex((range) => number >= range.low && number <= range.high);
      return index < 0 ? NOT_SET : `range-${index}`;
    },
  };
}

// The default: a marker has its program's color, or its type's if it has no program, which is what
// the exports use too.
function programScale(records: Intervention[], data: Pick<MapData, 'programs' | 'types'>): Pick<ColorScale, 'entries' | 'keyOf' | 'colorOf'> {
  const typesWithoutProgram = new Set(records.filter((record) => record.banner_program_id === null).map((record) => record.intervention_type_id));
  const entries: ColorEntry[] = [
    ...data.programs.filter((program) => program.is_active || records.some((record) => record.banner_program_id === program.id)).map((program) => ({ key: `program-${program.id}`, label: program.name, color: program.color })),
    ...data.types.filter((type) => typesWithoutProgram.has(type.id)).map((type) => ({ key: `type-${type.id}`, label: `${type.name}, no program`, color: type.color })),
  ];
  return {
    entries,
    keyOf: (record) => (record.banner_program_id === null ? `type-${record.intervention_type_id}` : `program-${record.banner_program_id}`),
    colorOf: (record) => recordColor(record, data),
  };
}

// Colors for a field, worked out over all the map's records, so filtering doesn't change them.
export function buildColorScale(fieldId: string, records: Intervention[], data: CatalogData, fields: ViewField[] = viewFields(data)): ColorScale {
  const field = fields.find((candidate) => candidate.id === fieldId && candidate.colorable) ?? fields.find((candidate) => candidate.id === DEFAULT_COLOR_BY)!;
  if (field.id === DEFAULT_COLOR_BY) {
    return { field: field.id, title: field.label, ...programScale(records, data) };
  }

  const scale =
    field.kind === 'number'
      ? rangeScale(field, records, (value) => (value === null ? NaN : Number(value)))
      : field.kind === 'date'
        ? rangeScale(field, records, (value) => (typeof value === 'string' ? Number(value.slice(0, 4)) : NaN))
        : choiceScale(field, records);
  const colorByKey = new Map(scale.entries.map((entry) => [entry.key, entry.color]));
  return {
    field: field.id,
    title: field.label,
    ...scale,
    colorOf: (record) => colorByKey.get(scale.keyOf(record)) ?? NOT_SET_COLOR,
  };
}
