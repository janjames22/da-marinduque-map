import type { AuditAction, AuditEntry, FieldSchema, MapData } from '../data/types';
import { formatPoint } from './coordinates';
import { fieldValue, recordName } from './display';

export interface AuditChange {
  field: string;
  from: string;
  to: string;
}

const EMPTY = '(none)';

type Lookups = Pick<MapData, 'categories' | 'programs' | 'beneficiaryTypes' | 'municipalities' | 'barangays' | 'locationBases' | 'statuses' | 'types'>;

const named = (items: { id: number; name: string }[]) => (value: unknown) =>
  items.find((item) => item.id === value)?.name ?? String(value);

function columns(lookups: Lookups): Record<string, { label: string; show: (value: unknown) => string }> {
  const plain = (value: unknown) => String(value);
  return {
    title: { label: 'Title', show: plain },
    category_id: { label: 'Category', show: named(lookups.categories) },
    banner_program_id: { label: 'Banner program', show: named(lookups.programs) },
    year_funded: { label: 'Year funded', show: plain },
    quantity: { label: 'Quantity', show: plain },
    unit_cost: { label: 'Unit cost', show: plain },
    fund_source: { label: 'Fund source', show: plain },
    beneficiary: { label: 'Beneficiary', show: plain },
    beneficiary_type_id: { label: 'Beneficiary type', show: named(lookups.beneficiaryTypes) },
    municipality_id: { label: 'Municipality', show: named(lookups.municipalities) },
    barangay_id: { label: 'Barangay', show: named(lookups.barangays) },
    location_basis_id: { label: 'Location basis', show: named(lookups.locationBases) },
    remarks: { label: 'Remarks', show: plain },
    geojson: {
      label: 'Location',
      show: (value) => {
        const point = value as GeoJSON.Point;
        return point.type === 'Point' ? formatPoint({ lat: point.coordinates[1], lng: point.coordinates[0] }) : point.type;
      },
    },
  };
}

function attributeChanges(schema: FieldSchema | undefined, before: Record<string, unknown>, after: Record<string, unknown>): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    const field = schema?.fields.find((f) => f.key === key);
    const show = (value: unknown) => (field ? fieldValue(field, value) : value === undefined ? null : String(value)) ?? EMPTY;
    changes.push({ field: field?.label ?? key, from: show(before[key]), to: show(after[key]) });
  }
  return changes;
}

// What changed in an edit, in words, leaving out bookkeeping columns such as version.
export function auditChanges(entry: AuditEntry, lookups: Lookups, schema?: FieldSchema): AuditChange[] {
  const before = entry.old_row;
  const after = entry.new_row;
  if (!before || !after) return [];

  const changes: AuditChange[] = [];
  for (const [column, { label, show }] of Object.entries(columns(lookups))) {
    const from = before[column] ?? null;
    const to = after[column] ?? null;
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes.push({ field: label, from: from === null ? EMPTY : show(from), to: to === null ? EMPTY : show(to) });
  }
  changes.push(...attributeChanges(schema, (before.attributes ?? {}) as Record<string, unknown>, (after.attributes ?? {}) as Record<string, unknown>));
  return changes;
}

export const ACTION_LABELS: Record<AuditAction, string> = {
  insert: 'Created',
  update: 'Edited',
  soft_delete: 'Deleted',
  restore: 'Restored',
  delete: 'Removed for good',
  export: 'Exported',
};

// Where each kind of change is managed, for the audit log page's links.
const LIST_PAGES: Record<string, { label: string; link: string }> = {
  programs: { label: 'Program', link: '/admin/programs' },
  categories: { label: 'Category', link: '/admin/categories' },
  statuses: { label: 'Status', link: '/admin/statuses' },
  category_groups: { label: 'Category group', link: '/admin/lists' },
  beneficiary_types: { label: 'Beneficiary type', link: '/admin/lists' },
  location_bases: { label: 'Location basis', link: '/admin/lists' },
  icons: { label: 'Icon', link: '/admin/lists' },
  barangay_field_schema: { label: 'Barangay fields', link: '/admin/barangay-fields' },
  intervention_type_statuses: { label: 'A type\'s status list', link: '/admin/types' },
  profiles: { label: 'Person', link: '/admin/users' },
  report_signatories: { label: 'Report signature', link: '/admin/signatures' },
};

export interface AuditTarget {
  label: string;
  link: string | null;
}

const textOf = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);

// What a line of the log is about, and where to go to see it.
export function auditTarget(entry: AuditEntry, data: Pick<MapData, 'interventions' | 'categories' | 'barangays' | 'types'>): AuditTarget {
  const row = entry.new_row ?? entry.old_row ?? {};
  const name = textOf(row.name) ?? textOf(row.full_name);

  if (entry.table_name === 'interventions' || entry.table_name === 'status_history' || entry.table_name === 'intervention_photos') {
    const id = entry.table_name === 'interventions' ? entry.record_id : textOf(row.intervention_id);
    const record = data.interventions.find((candidate) => candidate.id === id);
    const recordLabel = record ? [recordName(record, data), record.beneficiary].filter(Boolean).join(' – ') : (textOf(row.title) ?? textOf(row.beneficiary) ?? 'A record no longer here');
    return { label: recordLabel, link: id ? `/records/${id}` : null };
  }
  if (entry.table_name === 'barangays') {
    const barangay = data.barangays.find((candidate) => String(candidate.id) === entry.record_id);
    return { label: `Barangay ${barangay?.name ?? name ?? entry.record_id}`, link: entry.record_id ? `/barangays/${entry.record_id}` : null };
  }
  if (entry.table_name === 'intervention_types') {
    return { label: `Type: ${name ?? entry.record_id}`, link: entry.record_id ? `/admin/types/${entry.record_id}` : null };
  }
  if (entry.table_name === 'saved_views') return { label: `Saved view: ${name ?? entry.record_id}`, link: null };
  if (entry.table_name === 'exports') return { label: `Export: ${textOf(entry.context?.file_name) ?? 'a file'}`, link: null };
  if (entry.table_name === 'import_batches') return { label: `Import: ${textOf(row.file_name) ?? 'a file'}`, link: null };

  const list = LIST_PAGES[entry.table_name];
  if (list) return { label: name ? `${list.label}: ${name}` : list.label, link: list.link };
  return { label: entry.table_name.replace(/_/g, ' '), link: null };
}

const BOOKKEEPING = new Set(['id', 'version', 'created_at', 'updated_at', 'created_by', 'updated_by', 'owner_id']);

// Anything other than a record: what changed, in plain field names.
function rowChanges(entry: AuditEntry): string[] {
  const before = entry.old_row;
  const after = entry.new_row;
  if (!before || !after) return [];
  const lines: string[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (BOOKKEEPING.has(key) || JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    const show = (value: unknown) => (value === null || value === undefined ? EMPTY : typeof value === 'object' ? null : String(value));
    const from = show(before[key]);
    const to = show(after[key]);
    const field = key.replace(/_/g, ' ');
    lines.push(from === null || to === null ? `${field} changed` : `${field}: ${from} → ${to}`);
  }
  return lines;
}

// A line of the log in words, for the audit log page.
export function auditDetails(entry: AuditEntry, data: Lookups): string[] {
  const row = entry.new_row ?? entry.old_row;
  if (entry.table_name === 'status_history' || entry.table_name === 'intervention_photos') return [auditHeadline(entry, data)];
  if (entry.table_name === 'exports') {
    const count = entry.context?.record_count;
    return [[textOf(entry.context?.format)?.toUpperCase(), typeof count === 'number' ? `${count} record${count === 1 ? '' : 's'}` : null].filter(Boolean).join(', ')];
  }
  if (entry.table_name === 'interventions') {
    const schema = data.types.find((type) => type.id === row?.intervention_type_id)?.field_schema;
    return auditChanges(entry, data, schema).map((change) => `${change.field}: ${change.from} → ${change.to}`);
  }
  return rowChanges(entry);
}

export function auditHeadline(entry: AuditEntry, lookups: Pick<Lookups, 'statuses'>): string {
  const row = entry.new_row ?? entry.old_row;
  switch (entry.table_name) {
    case 'status_history': {
      const status = lookups.statuses.find((s) => s.id === row?.status_id)?.name ?? 'Unknown';
      return `Status set to ${status}`;
    }
    case 'intervention_photos':
      return 'Photo added';
    case 'barangays':
      return 'Baseline edited';
    default:
      break;
  }
  switch (entry.action) {
    case 'insert':
      return 'Record created';
    case 'soft_delete':
      return 'Record deleted';
    case 'restore':
      return 'Record restored';
    default:
      return 'Record edited';
  }
}
