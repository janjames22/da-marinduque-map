// The browser's copy of the database's rules for lists and forms, so a screen can point at the exact
// field, and so local mode behaves the same. tests/admin.test.ts runs these against the real triggers
// in supabase/migrations/0007_admin.sql, so change them together.
import type { TypeStatusValues, TypeValues } from '../data/store';
import type { CoreFieldRule, FieldDefinition, FieldOption, FieldSchema, InterventionType, MapData } from '../data/types';
import type { FieldErrors } from './validation';

export const CORE_FIELDS = [
  'category_id',
  'title',
  'banner_program_id',
  'year_funded',
  'quantity',
  'unit_cost',
  'fund_source',
  'beneficiary',
  'beneficiary_type_id',
  'remarks',
] as const;

const COLOR = /^#[0-9a-fA-F]{6}$/;
const FIELD_KEY = /^[a-z][a-z0-9_]*$/;
const INPUT_KINDS: FieldDefinition['input'][] = ['text', 'number', 'date', 'dropdown', 'yes_no', 'photo'];
const ICON_MAX_LENGTH = 20000;

export const isColor = (value: string) => COLOR.test(value);

// A short, stable name made from a person's words. "Rice Program" becomes rice-program.
function plainWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function unique(base: string, taken: Iterable<string>, join: string): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${join}${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function newCode(name: string, taken: Iterable<string>): string {
  return unique(plainWords(name).join('-') || 'item', taken, '-');
}

export function newFieldKey(label: string, taken: Iterable<string>): string {
  const words = plainWords(label).join('_');
  return unique(/^[a-z]/.test(words) ? words : `field_${words}`.replace(/_$/, ''), taken, '_');
}

// Mirrors validate_field_schema. Returns what's wrong, or null.
export function fieldSchemaProblem(schema: FieldSchema): string | null {
  const seen = new Set<string>();
  for (const field of schema.fields) {
    if (!FIELD_KEY.test(field.key ?? '')) return `Invalid field key: ${field.key ?? '(none)'}`;
    if (seen.has(field.key)) return `Two fields use the key ${field.key}.`;
    seen.add(field.key);
    if ((field.label ?? '').trim() === '') return 'Every field needs a label.';
    if (!INPUT_KINDS.includes(field.input)) return `${field.label} has an unknown kind.`;
    if (field.input === 'dropdown') {
      if (!field.options?.length) return `${field.label} needs at least one option.`;
      const values = new Set<string>();
      for (const option of field.options) {
        if (option.value.trim() === '' || option.label.trim() === '') return `Every option of ${field.label} needs a label.`;
        if (values.has(option.value)) return `${field.label} has the option ${option.label} twice.`;
        values.add(option.value);
      }
    }
  }
  return null;
}

// Mirrors check_field_schema_change. Fields and options are archived, never removed, so existing
// values keep their meaning.
export function fieldSchemaChangeProblem(before: FieldSchema, after: FieldSchema): string | null {
  for (const old of before.fields) {
    const field = after.fields.find((f) => f.key === old.key);
    if (!field) return `${old.label} can't be removed. Archive it instead.`;
    if (field.input !== old.input) return `${old.label} can't change its kind.`;
    for (const option of old.options ?? []) {
      if (!field.options?.some((o) => o.value === option.value)) return `The option ${option.label} of ${old.label} can't be removed. Archive it instead.`;
    }
  }
  return null;
}

// Mirrors the rule checks in intervention_types_before_write.
export function coreRulesProblem(rules: Record<string, CoreFieldRule>): string | null {
  for (const [key, rule] of Object.entries(rules)) {
    if (!(CORE_FIELDS as readonly string[]).includes(key)) return `Unknown standard field: ${key}`;
    if (!['required', 'optional', 'hidden'].includes(rule)) return `Invalid rule for ${key}.`;
  }
  if (rules.category_id === 'hidden' && rules.title === 'hidden') {
    return 'Category and Title can\'t both be hidden, or records would have no name.';
  }
  return null;
}

// Mirrors icons_before_write. Returns what's wrong, or null.
export function iconProblem(svg: string): string | null {
  const text = svg.trim();
  if (text.length > ICON_MAX_LENGTH || !/^<svg\s/.test(text) || !/<\/svg>\s*$/.test(text) || !/\sviewBox\s*=/i.test(text)) {
    return 'An icon must be an SVG of up to 20 KB with a viewBox.';
  }
  if (
    /<\s*(script|style|image|foreignobject|iframe|embed|object|use|a|animate[a-z]*|set)[\s/>]/i.test(text) ||
    /\son[a-z]+\s*=/i.test(text) ||
    /href/i.test(text) ||
    /url\s*\(/i.test(text)
  ) {
    return 'An icon can only hold shapes, not scripts or links.';
  }
  return null;
}

export interface LookupRules {
  needsColor?: boolean;
  isIcon?: boolean;
  // A signature block: it needs a label, its lengths are limited, and one person can sign twice.
  isSignatory?: boolean;
}

// Mirrors report_signatories' checks.
export const SIGNATORY_LIMITS = { label: 60, name: 120, position: 160 };

export function validateLookup(
  values: { name?: string; color?: string; image?: string; label?: string; position?: string },
  rows: { id: number; name: string }[],
  id: number | null,
  rules: LookupRules = {},
): FieldErrors {
  const errors: FieldErrors = {};
  const name = (values.name ?? '').trim();
  if (name === '') errors.name = 'Enter a name.';
  else if (!rules.isSignatory && rows.some((row) => row.name === name && row.id !== id)) errors.name = 'That name is already used.';
  if (rules.isSignatory) {
    const label = (values.label ?? '').trim();
    if (label === '') errors.label = 'Enter a label, such as "Prepared by".';
    else if (label.length > SIGNATORY_LIMITS.label) errors.label = `Keep the label to ${SIGNATORY_LIMITS.label} characters.`;
    if (name.length > SIGNATORY_LIMITS.name) errors.name = `Keep the name to ${SIGNATORY_LIMITS.name} characters.`;
    if ((values.position ?? '').trim().length > SIGNATORY_LIMITS.position) errors.position = `Keep the position to ${SIGNATORY_LIMITS.position} characters.`;
  }
  if (rules.needsColor && !isColor(values.color ?? '')) errors.color = 'Choose a color.';
  if (rules.isIcon) {
    const problem = iconProblem(values.image ?? '');
    if (problem) errors.image = problem;
  }
  return errors;
}

// Mirrors the checks in save_intervention_type.
export function statusListProblem(list: TypeStatusValues[]): string | null {
  if (list.length === 0) return 'A type needs at least one status.';
  if (list.filter((entry) => entry.is_default).length !== 1) return 'Choose one status as the default.';
  return null;
}

// Drawing lines and polygons isn't built, so these types can be set up but not switched on. Their
// records would have no shape.
export const NEEDS_DRAWING = 'Needs drawing tools (not yet built)';
export const needsDrawing = (kind: InterventionType['geometry_kind']) => kind !== 'point';

// Everything the database would refuse about saving a type, keyed by what to fix. Mirrors
// intervention_types_before_write and type_status_before_delete.
export function validateTypeChange(
  id: number | null,
  values: TypeValues,
  statuses: TypeStatusValues[],
  data: Pick<MapData, 'types' | 'typeStatuses' | 'interventions'>,
): FieldErrors {
  const errors: FieldErrors = {};
  const before = data.types.find((type) => type.id === id);

  const name = values.name.trim();
  if (name === '') errors.name = 'Enter a name.';
  else if (data.types.some((type) => type.name === name && type.id !== id)) errors.name = 'That name is already used.';
  if (!isColor(values.color)) errors.color = 'Choose a color.';

  const rules = coreRulesProblem(values.core_field_rules);
  if (rules) errors.core_field_rules = rules;

  const schema = fieldSchemaProblem(values.field_schema) ?? (before ? fieldSchemaChangeProblem(before.field_schema, values.field_schema) : null);
  if (schema) errors.field_schema = schema;

  const list = statusListProblem(statuses);
  if (list) errors.statuses = list;

  if (before) {
    if (values.code !== before.code) errors.code = 'A type\'s code can\'t change.';
    const records = data.interventions.filter((record) => record.intervention_type_id === before.id);
    if (values.geometry_kind !== before.geometry_kind && records.length > 0) {
      errors.geometry_kind = 'The geometry can\'t change once a type has records.';
    }
    const kept = new Set(statuses.map((entry) => entry.status_id));
    const stranded = data.typeStatuses.find(
      (entry) =>
        entry.intervention_type_id === before.id &&
        !kept.has(entry.status_id) &&
        records.some((record) => record.status_id === entry.status_id && record.deleted_at === null),
    );
    if (stranded && !list) errors.statuses = 'Records are at a status you removed, so it stays on the list until they move on.';
  }
  if (values.is_active && needsDrawing(values.geometry_kind)) errors.is_active = NEEDS_DRAWING;
  return errors;
}

// A field while it's being built. A new field or option gets its permanent key when it's saved, from
// whatever its label says by then.
export interface FieldDraft extends Omit<FieldDefinition, 'options'> {
  draftId: string;
  options?: OptionDraft[];
}

export interface OptionDraft extends FieldOption {
  draftId: string;
}

let nextDraft = 0;
export const newDraftId = () => `draft-${++nextDraft}`;

export function draftsFromSchema(schema: FieldSchema): FieldDraft[] {
  return schema.fields.map((field) => ({
    ...field,
    draftId: newDraftId(),
    options: field.options?.map((option) => ({ ...option, draftId: newDraftId() })),
  }));
}

export function schemaFromDrafts(drafts: FieldDraft[]): FieldSchema {
  const taken = new Set(drafts.map((draft) => draft.key).filter(Boolean));
  const fields = drafts.map((draft): FieldDefinition => {
    const { draftId: _draftId, options, key, ...rest } = draft;
    let fieldKey = key;
    if (!fieldKey) {
      fieldKey = newFieldKey(draft.label, taken);
      taken.add(fieldKey);
    }

    const field: FieldDefinition = { ...rest, label: draft.label.trim(), key: fieldKey };
    if (draft.input === 'dropdown') {
      const values = new Set((options ?? []).map((option) => option.value).filter(Boolean));
      field.options = (options ?? []).map(({ draftId: _optionId, ...option }) => {
        let value = option.value;
        if (!value) {
          value = newFieldKey(option.label, values);
          values.add(value);
        }
        return { ...option, label: option.label.trim(), value };
      });
    } else {
      delete field.options;
    }
    if (draft.input !== 'number' || !draft.unit?.trim()) delete field.unit;
    else field.unit = draft.unit.trim();
    if (!field.required) delete field.required;
    if (!field.archived) delete field.archived;
    return field;
  });
  return { fields };
}

// What a person should fix before saving, by the draft it belongs to.
export function draftProblems(drafts: FieldDraft[]): Record<string, string> {
  const problems: Record<string, string> = {};
  const labels = new Map<string, string>();
  for (const draft of drafts) {
    const label = draft.label.trim();
    if (label === '') {
      problems[draft.draftId] = 'Enter a label.';
      continue;
    }
    if (!draft.archived) {
      const earlier = labels.get(label.toLowerCase());
      if (earlier) problems[draft.draftId] = 'Another field already has this label.';
      labels.set(label.toLowerCase(), draft.draftId);
    }
    if (draft.input === 'dropdown') {
      const options = draft.options ?? [];
      if (options.length === 0) problems[draft.draftId] = 'Add at least one option.';
      else if (options.some((option) => option.label.trim() === '')) problems[draft.draftId] = 'Every option needs a label.';
      else if (new Set(options.map((option) => option.label.trim().toLowerCase())).size !== options.length) problems[draft.draftId] = 'Two options have the same label.';
    }
  }
  return problems;
}
