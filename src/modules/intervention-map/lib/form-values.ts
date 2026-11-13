// Forms hold everything as text while it's being typed. These turn that into stored values and back.
import type { InterventionPatch, InterventionValues, LinePositions } from '../data/store';
import type { FieldDefinition, FieldSchema, Intervention, MapData } from '../data/types';
import type { LatLng } from './coordinates';
import { manilaToday } from './dates';
import { linePositionsOf, pointOf, sameLine, samePoint } from './qa';

export interface FormState {
  intervention_type_id: string;
  category_id: string;
  title: string;
  banner_program_id: string;
  year_funded: string;
  quantity: string;
  unit_cost: string;
  fund_source: string;
  beneficiary: string;
  beneficiary_type_id: string;
  municipality_id: string;
  barangay_id: string;
  location_basis_id: string;
  remarks: string;
  attributes: Record<string, string>;
  status_id: string;
  status_date: string;
  status_remarks: string;
}

// What a photo field holds from choosing a file until the save gives it a photo's id.
export const PENDING_PHOTO = 'pending';

const text = (value: string | number | null | undefined) => (value === null || value === undefined ? '' : String(value));

export function attributeToText(field: FieldDefinition, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (field.input === 'yes_no') return value ? 'yes' : 'no';
  return String(value);
}

export function attributesToText(schema: FieldSchema, attributes: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(schema.fields.map((field) => [field.key, attributeToText(field, attributes[field.key])]));
}

// Blank means not set, so the key is removed. Values of archived fields are kept untouched.
export function attributesFromText(
  schema: FieldSchema,
  entered: Record<string, string>,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...existing };
  for (const field of schema.fields) {
    if (field.archived) continue;
    const raw = (entered[field.key] ?? '').trim();
    if (raw === '') {
      delete result[field.key];
    } else if (field.input === 'number') {
      result[field.key] = Number(raw);
    } else if (field.input === 'yes_no') {
      result[field.key] = raw === 'yes';
    } else {
      result[field.key] = raw;
    }
  }
  return result;
}

// A status that was archived stays in a record's past, but isn't offered for new entries.
export function statusChoices(data: Pick<MapData, 'typeStatuses' | 'statuses'>, typeId: number): { value: number; label: string }[] {
  const named = new Map(data.statuses.map((status) => [status.id, status]));
  return data.typeStatuses
    .filter((s) => s.intervention_type_id === typeId && named.get(s.status_id)?.is_active)
    .map((s) => ({ value: s.status_id, label: named.get(s.status_id)?.name ?? '' }));
}

export function defaultStatusId(data: Pick<MapData, 'typeStatuses' | 'statuses'>, typeId: number): string {
  const offered = new Set(statusChoices(data, typeId).map((choice) => choice.value));
  const list = data.typeStatuses.filter((s) => s.intervention_type_id === typeId && offered.has(s.status_id));
  return text((list.find((s) => s.is_default) ?? list[0])?.status_id);
}

export function blankForm(data: Pick<MapData, 'types' | 'typeStatuses' | 'statuses'>, prefill?: { municipality_id: number; barangay_id: number }): FormState {
  const type = data.types.filter((t) => t.is_active).sort((a, b) => a.sort_order - b.sort_order)[0];
  return {
    intervention_type_id: text(type?.id),
    category_id: '',
    title: '',
    banner_program_id: '',
    year_funded: '',
    quantity: '1',
    unit_cost: '',
    fund_source: '',
    beneficiary: '',
    beneficiary_type_id: '',
    municipality_id: text(prefill?.municipality_id),
    barangay_id: text(prefill?.barangay_id),
    location_basis_id: '',
    remarks: '',
    attributes: {},
    status_id: type ? defaultStatusId(data, type.id) : '',
    status_date: manilaToday(),
    status_remarks: '',
  };
}

export function formFromRecord(record: Intervention, schema: FieldSchema): FormState {
  return {
    intervention_type_id: text(record.intervention_type_id),
    category_id: text(record.category_id),
    title: text(record.title),
    banner_program_id: text(record.banner_program_id),
    year_funded: text(record.year_funded),
    quantity: text(record.quantity),
    unit_cost: text(record.unit_cost),
    fund_source: text(record.fund_source),
    beneficiary: text(record.beneficiary),
    beneficiary_type_id: text(record.beneficiary_type_id),
    municipality_id: text(record.municipality_id),
    barangay_id: text(record.barangay_id),
    location_basis_id: text(record.location_basis_id),
    remarks: text(record.remarks),
    attributes: attributesToText(schema, record.attributes),
    status_id: '',
    status_date: '',
    status_remarks: '',
  };
}

export function valuesFromRecord(record: Intervention): InterventionValues {
  return {
    intervention_type_id: record.intervention_type_id,
    category_id: record.category_id,
    title: record.title,
    banner_program_id: record.banner_program_id,
    year_funded: record.year_funded,
    quantity: record.quantity,
    unit_cost: record.unit_cost,
    fund_source: record.fund_source,
    beneficiary: record.beneficiary,
    beneficiary_type_id: record.beneficiary_type_id,
    municipality_id: record.municipality_id,
    barangay_id: record.barangay_id,
    location_basis_id: record.location_basis_id,
    point: pointOf(record),
    // Only a one-part line: a line in several parts stays as it is, as the editor can't reshape it.
    ...(linePositionsOf(record) ? { line: linePositionsOf(record) } : {}),
    attributes: record.attributes,
    remarks: record.remarks,
  };
}

const optionalId = (value: string) => (value === '' ? null : Number(value));
const optionalText = (value: string) => (value.trim() === '' ? null : value.trim());
const optionalNumber = (value: string) => (value.trim() === '' ? null : Number(value));

// A road's form passes its line too: the positions, or null for none. A point type's form leaves it out.
export function valuesFromForm(
  form: FormState,
  point: LatLng | null,
  schema: FieldSchema,
  existing?: Record<string, unknown>,
  line?: LinePositions | null,
): InterventionValues {
  return {
    intervention_type_id: Number(form.intervention_type_id),
    category_id: optionalId(form.category_id),
    title: optionalText(form.title),
    banner_program_id: optionalId(form.banner_program_id),
    year_funded: optionalNumber(form.year_funded),
    quantity: form.quantity.trim() === '' ? Number.NaN : Number(form.quantity),
    unit_cost: optionalNumber(form.unit_cost),
    fund_source: optionalText(form.fund_source),
    beneficiary: optionalText(form.beneficiary),
    beneficiary_type_id: optionalId(form.beneficiary_type_id),
    municipality_id: optionalId(form.municipality_id) ?? 0,
    barangay_id: optionalId(form.barangay_id),
    location_basis_id: optionalId(form.location_basis_id),
    point,
    ...(line !== undefined ? { line } : {}),
    attributes: attributesFromText(schema, form.attributes, existing),
    remarks: optionalText(form.remarks),
  };
}

// Only what this person changed goes in the patch. So if someone else edited other fields in the
// meantime, saving over their version keeps their edits. Custom fields merge the same way.
export function buildPatch(base: Intervention, values: InterventionValues, latest: Intervention): InterventionPatch {
  const patch: InterventionPatch = {};
  const keys = [
    'category_id',
    'title',
    'banner_program_id',
    'year_funded',
    'quantity',
    'unit_cost',
    'fund_source',
    'beneficiary',
    'beneficiary_type_id',
    'municipality_id',
    'barangay_id',
    'location_basis_id',
    'remarks',
  ] as const;
  for (const key of keys) {
    if (values[key] !== base[key]) Object.assign(patch, { [key]: values[key] });
  }

  const basePoint = pointOf(base);
  const movedOrCleared = values.point === null ? basePoint !== null : !samePoint(basePoint, values.point);
  if (movedOrCleared) patch.point = values.point;
  // A road's line goes in only when it changed. Left out, the line stays as it is.
  if (values.line !== undefined && !sameLine(linePositionsOf(base), values.line)) patch.line = values.line;

  const attributes: Record<string, unknown> = { ...latest.attributes };
  let attributesChanged = false;
  for (const key of new Set([...Object.keys(base.attributes), ...Object.keys(values.attributes)])) {
    if (JSON.stringify(base.attributes[key]) === JSON.stringify(values.attributes[key])) continue;
    attributesChanged = true;
    if (values.attributes[key] === undefined) delete attributes[key];
    else attributes[key] = values.attributes[key];
  }
  if (attributesChanged) patch.attributes = attributes;
  if (values.field_photos && Object.keys(values.field_photos).length > 0) patch.field_photos = values.field_photos;

  return patch;
}
