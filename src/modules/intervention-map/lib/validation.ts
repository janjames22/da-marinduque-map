// The browser's copy of the database's field rules, so a form can point at the exact field before
// saving. The database still checks everything once the app is on Supabase.
import type { InterventionValues } from '../data/store';
import type { Barangay, Category, FieldDefinition, FieldSchema, InterventionType, TypeStatus } from '../data/types';
import { isValidDate, manilaToday, manilaYear } from './dates';

export type FieldErrors = Record<string, string>;

export const attributeKey = (key: string) => `attributes.${key}`;

export function activeFields(schema: FieldSchema): FieldDefinition[] {
  return schema.fields.filter((field) => !field.archived);
}

// Mirrors validate_attributes. A new required field doesn't apply until the values next change.
export function validateAttributes(schema: FieldSchema, attributes: Record<string, unknown>): FieldErrors {
  const errors: FieldErrors = {};

  for (const key of Object.keys(attributes)) {
    if (!schema.fields.some((field) => field.key === key)) errors[attributeKey(key)] = `Unknown field: ${key}`;
  }

  for (const field of schema.fields) {
    const value = attributes[field.key];
    const name = attributeKey(field.key);

    if (value === undefined || value === null) {
      if (field.required && !field.archived) errors[name] = `${field.label} is required.`;
      continue;
    }

    if ((field.input === 'text' || field.input === 'photo') && typeof value !== 'string') {
      errors[name] = `${field.label} must be text.`;
    } else if (field.input === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      errors[name] = `${field.label} must be a number.`;
    } else if (field.input === 'yes_no' && typeof value !== 'boolean') {
      errors[name] = `${field.label} must be yes or no.`;
    } else if (field.input === 'date' && (typeof value !== 'string' || !isValidDate(value))) {
      errors[name] = `${field.label} must be a date.`;
    } else if (field.input === 'dropdown' && !field.options?.some((option) => option.value === value)) {
      errors[name] = `${field.label} has an option that isn't on the list.`;
    }
  }
  return errors;
}

const CORE_LABELS: Record<string, string> = {
  category_id: 'Category',
  title: 'Title',
  banner_program_id: 'Banner program',
  year_funded: 'Year funded',
  unit_cost: 'Unit cost',
  fund_source: 'Fund source',
  beneficiary: 'Beneficiary',
  beneficiary_type_id: 'Beneficiary type',
  remarks: 'Remarks',
};

export const coreFieldLabel = (key: string) => CORE_LABELS[key] ?? key;

export interface ValidationContext {
  type: InterventionType;
  categories: Pick<Category, 'id' | 'intervention_type_id'>[];
  barangays: Pick<Barangay, 'id' | 'municipality_id'>[];
  now?: Date;
}

// Mirrors interventions_before_write. A rule that became required later doesn't block an edit of
// another field: as in the database, it only applies to a new record or to a value being removed.
export function validateIntervention(
  values: InterventionValues,
  previous: InterventionValues | null,
  { type, categories, barangays, now }: ValidationContext,
): FieldErrors {
  const errors: FieldErrors = {};

  // Mirrors interventions_need_a_shape. A point record can wait for its coordinates, but a line or
  // polygon record has nothing to show without its shape, and there's no way to draw one yet.
  if (previous === null && type.geometry_kind !== 'point' && values.point === null) {
    errors.intervention_type_id = `${type.name} needs a shape, and drawing tools aren't built yet.`;
  }

  if (!values.municipality_id) errors.municipality_id = 'Choose a municipality.';

  if (values.title === null && values.category_id === null) {
    errors.category_id = 'Choose a category or enter a title.';
  }

  for (const [key, rule] of Object.entries(type.core_field_rules)) {
    if (rule !== 'required') continue;
    const value = values[key as keyof InterventionValues];
    const old = previous?.[key as keyof InterventionValues];
    if (value === null && (previous === null || old !== null)) {
      errors[key] = `${coreFieldLabel(key)} is required for ${type.name}.`;
    }
  }

  if (values.category_id !== null) {
    const category = categories.find((c) => c.id === values.category_id);
    if (category?.intervention_type_id !== null && category?.intervention_type_id !== type.id) {
      errors.category_id = `That category doesn't belong to ${type.name}.`;
    }
  }

  if (values.year_funded !== null) {
    if (!Number.isInteger(values.year_funded) || values.year_funded < 2000) {
      errors.year_funded = 'Year funded must be 2000 or later.';
    } else if (values.year_funded > manilaYear(now)) {
      errors.year_funded = 'Year funded can\'t be in the future.';
    }
  }

  if (!Number.isInteger(values.quantity) || values.quantity <= 0) errors.quantity = 'Quantity must be a whole number above zero.';
  if (values.unit_cost !== null && (!Number.isFinite(values.unit_cost) || values.unit_cost < 0)) {
    errors.unit_cost = 'Unit cost can\'t be negative.';
  }

  if (values.barangay_id !== null) {
    const barangay = barangays.find((b) => b.id === values.barangay_id);
    if (barangay?.municipality_id !== values.municipality_id) errors.barangay_id = 'That barangay isn\'t in the chosen municipality.';
  }

  if (previous === null || JSON.stringify(values.attributes) !== JSON.stringify(previous.attributes)) {
    Object.assign(errors, validateAttributes(type.field_schema, values.attributes));
  }

  return errors;
}

export function validateStatus(
  status: { status_id: number | null; status_date: string },
  typeId: number,
  typeStatuses: TypeStatus[],
  now?: Date,
): FieldErrors {
  const errors: FieldErrors = {};
  if (status.status_id === null) {
    errors.status_id = 'Choose a status.';
  } else if (!typeStatuses.some((s) => s.intervention_type_id === typeId && s.status_id === status.status_id)) {
    errors.status_id = 'That status isn\'t on the list for this type.';
  }
  if (!isValidDate(status.status_date)) errors.status_date = 'Enter a valid date.';
  else if (status.status_date > manilaToday(now)) errors.status_date = 'The date can\'t be in the future.';
  return errors;
}
