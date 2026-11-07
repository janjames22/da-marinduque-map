// What the database does for an Admin's changes to the lists and forms, for local mode.
// tests/admin.test.ts checks these rules against the real triggers.
import { fieldSchemaChangeProblem, fieldSchemaProblem, validateLookup, validateTypeChange, type LookupRules } from '../lib/admin-rules';
import { audit, type EngineContext, type LocalRows } from './local-engine';
import { ConflictError, ValidationError, type LookupTable, type LookupValues, type TypeStatusValues, type TypeValues } from './store';
import type { InterventionType } from './types';

type Row = { id: number; name: string; code?: string; color?: string; image?: string } & Record<string, unknown>;

const LISTS: Record<LookupTable, { key: keyof EngineContext['lists']; rules: LookupRules; defaults: Record<string, unknown> }> = {
  programs: { key: 'programs', rules: { needsColor: true }, defaults: { sort_order: 0, is_active: true } },
  categories: { key: 'categories', rules: {}, defaults: { sort_order: 0, is_active: true, icon_id: null, intervention_type_id: null, category_group_id: null } },
  category_groups: { key: 'categoryGroups', rules: {}, defaults: { sort_order: 0, icon_id: null } },
  statuses: { key: 'statuses', rules: { needsColor: true }, defaults: { sort_order: 0, is_active: true } },
  beneficiary_types: { key: 'beneficiaryTypes', rules: {}, defaults: { sort_order: 0, is_active: true } },
  location_bases: { key: 'locationBases', rules: { needsColor: true }, defaults: { sort_order: 0, is_active: true } },
  icons: { key: 'icons', rules: { isIcon: true }, defaults: { is_active: true } },
};

const nextId = (rows: { id: number }[]) => rows.reduce((highest, row) => Math.max(highest, row.id), 0) + 1;

export function saveLookup(rows: LocalRows, context: EngineContext, table: LookupTable, id: number | null, values: LookupValues) {
  const list = LISTS[table];
  const items = context.lists[list.key] as unknown as Row[];
  const current = items.find((row) => row.id === id);
  if (id !== null && !current) throw new ConflictError(null);

  const errors = validateLookup({ ...current, ...values }, items, id, list.rules);
  if (values.code !== undefined && current?.code !== undefined && values.code !== current.code) errors.code = 'A code can\'t change.';
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const name = values.name?.trim();
  const clean = { ...values, ...(name === undefined ? {} : { name }) };

  if (current) {
    const before = { ...current };
    Object.assign(current, clean);
    audit(rows, context, table, String(current.id), 'update', before, { ...current }, { kind: 'admin' });
    return;
  }

  const row = { ...list.defaults, ...clean, id: nextId(items) } as unknown as Row;
  // A new category takes its group's icon unless it's given one, as in the database.
  if (table === 'categories' && !row.icon_id) {
    row.icon_id = context.lists.categoryGroups.find((group) => group.id === row.category_group_id)?.icon_id ?? null;
  }
  items.push(row);
  audit(rows, context, table, String(row.id), 'insert', null, { ...row }, { kind: 'admin' });
}

export function saveType(
  rows: LocalRows,
  context: EngineContext,
  id: number | null,
  expectedVersion: number | null,
  values: TypeValues,
  statuses: TypeStatusValues[],
): InterventionType {
  const { lists } = context;
  const current = lists.types.find((type) => type.id === id);
  if (id !== null && (!current || current.version !== expectedVersion)) throw new ConflictError(null);

  const errors = validateTypeChange(id, values, statuses, { types: lists.types, typeStatuses: lists.typeStatuses, interventions: rows.interventions });
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const clean = { ...values, name: values.name.trim() };
  let saved: InterventionType;
  if (current) {
    const before = { ...current };
    Object.assign(current, clean, { version: current.version + 1 });
    saved = current;
    audit(rows, context, 'intervention_types', String(saved.id), 'update', before, { ...saved }, { kind: 'admin' });
  } else {
    saved = { ...clean, id: nextId(lists.types), version: 1 };
    lists.types.push(saved);
    audit(rows, context, 'intervention_types', String(saved.id), 'insert', null, { ...saved }, { kind: 'admin' });
  }

  lists.typeStatuses = [
    ...lists.typeStatuses.filter((entry) => entry.intervention_type_id !== saved.id),
    ...statuses.map((entry, index) => ({ ...entry, intervention_type_id: saved.id, sort_order: index + 1 })),
  ];
  return saved;
}

export function saveBarangayFields(rows: LocalRows, context: EngineContext, expectedVersion: number, schema: Parameters<typeof fieldSchemaProblem>[0]) {
  const { lists } = context;
  if (lists.barangayFieldsVersion !== expectedVersion) throw new ConflictError(null);

  const problem =
    fieldSchemaProblem(schema) ??
    fieldSchemaChangeProblem(lists.barangayFields, schema) ??
    (schema.fields.some((field) => field.input === 'photo') ? 'Barangay fields can\'t be photos.' : null);
  if (problem) throw new ValidationError({ field_schema: problem });

  const before = { field_schema: lists.barangayFields, version: lists.barangayFieldsVersion };
  lists.barangayFields = schema;
  lists.barangayFieldsVersion += 1;
  audit(rows, context, 'barangay_field_schema', 'true', 'update', before, { field_schema: schema, version: lists.barangayFieldsVersion }, { kind: 'admin' });
}
