import type { AuditEntry, FieldSchema, MapData } from '../data/types';
import { formatPoint } from './coordinates';
import { fieldValue } from './display';

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
