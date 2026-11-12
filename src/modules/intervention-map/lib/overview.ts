// Figures for the Home and Dashboard pages that the map's dashboard panel doesn't show: units by
// category group, and the records waiting for verified coordinates. Everything else on those pages
// comes from buildDashboard, so the pages, the map and the exports can't disagree.
import type { Intervention, MapData } from '../data/types';
import type { BarRow } from './dashboard';
import { isOnMap, recordName } from './display';
import { isLineType } from './roads';
import { CATEGORY_COLORS } from './view-fields';

const NO_GROUP_COLOR = '#bdbdbd';
const byId = <T extends { id: number }>(rows: T[], id: number | null) => (id === null ? undefined : rows.find((row) => row.id === id));

// Each group keeps its color whatever the filters, as the map's colors do: it follows the group's
// place in Admin, not its rank.
export function unitsByCategoryGroup(records: Intervention[], data: Pick<MapData, 'categories' | 'categoryGroups'>): BarRow[] {
  const groups = [...data.categoryGroups].sort((a, b) => a.sort_order - b.sort_order);
  const colorOf = new Map(groups.map((group, index) => [group.id, CATEGORY_COLORS[index % CATEGORY_COLORS.length]]));
  const rows = new Map<string, BarRow>();
  for (const record of records) {
    const groupId = byId(data.categories, record.category_id)?.category_group_id ?? null;
    const group = byId(groups, groupId);
    const key = group ? String(group.id) : 'none';
    const row = rows.get(key) ?? { key, label: group?.name ?? 'No group', value: 0, color: group ? colorOf.get(group.id) : NO_GROUP_COLOR };
    row.value += record.quantity;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export interface AwaitingRecord {
  record: Intervention;
  issue: string;
}

export interface AwaitingGroup {
  municipalityId: number;
  municipality: string;
  records: AwaitingRecord[];
}

function issueOf(record: Intervention, isLine: boolean): string {
  const outside = record.qa_flags.includes('out_of_province');
  const parts = [isLine ? (outside ? 'Line runs outside Marinduque' : 'No traced line yet') : outside ? 'Coordinates are outside Marinduque' : 'No coordinates yet'];
  if (record.qa_flags.includes('barangay_not_in_marinduque')) parts.push('barangay not in Marinduque');
  else if (record.barangay_id === null) parts.push('no barangay');
  return parts.join(', ');
}

// The records counted in every total but not drawn on the map, until the region confirms where they
// are. By municipality, then by ID, as the verification sheet for the MAOs runs.
// Given the types, a road's issue is its missing line.
export function awaitingLocation(records: Intervention[], data: Pick<MapData, 'municipalities'> & Partial<Pick<MapData, 'types'>>): AwaitingGroup[] {
  const groups = new Map<number, AwaitingGroup>();
  const lineTypes = new Set((data.types ?? []).filter(isLineType).map((type) => type.id));
  for (const record of records) {
    if (isOnMap(record)) continue;
    const group = groups.get(record.municipality_id) ?? {
      municipalityId: record.municipality_id,
      municipality: byId(data.municipalities, record.municipality_id)?.name ?? 'Unknown',
      records: [],
    };
    group.records.push({ record, issue: issueOf(record, lineTypes.has(record.intervention_type_id)) });
    groups.set(record.municipality_id, group);
  }
  const sortKey = (record: Intervention) => record.source_id ?? record.id;
  for (const group of groups.values()) group.records.sort((a, b) => sortKey(a.record).localeCompare(sortKey(b.record)));
  return [...groups.values()].sort((a, b) => a.municipality.localeCompare(b.municipality));
}

export const awaitingCount = (groups: AwaitingGroup[]) => groups.reduce((sum, group) => sum + group.records.length, 0);

// The columns of data/corrections/for-field-verification.csv, so the region gets the sheet it already
// knows. The last four are for the MAO to fill in.
export const VERIFICATION_COLUMNS = [
  'ID',
  'Type',
  'Machine / project',
  'Beneficiary',
  'Municipality (encoded)',
  'Barangay (encoded)',
  'Issue',
  'Suggested value',
  'Verified barangay',
  'Verified latitude',
  'Verified longitude',
  'Location basis',
] as const;

export function verificationRows(groups: AwaitingGroup[], data: Pick<MapData, 'types' | 'categories' | 'barangays'>): Record<(typeof VERIFICATION_COLUMNS)[number], string>[] {
  return groups.flatMap((group) =>
    group.records.map(({ record, issue }) => ({
      ID: record.source_id ?? record.id,
      Type: byId(data.types, record.intervention_type_id)?.name ?? '',
      'Machine / project': recordName(record, data),
      Beneficiary: record.beneficiary ?? '',
      'Municipality (encoded)': group.municipality,
      'Barangay (encoded)': byId(data.barangays, record.barangay_id)?.name ?? record.barangay_raw ?? '',
      Issue: issue,
      'Suggested value': '',
      'Verified barangay': '',
      'Verified latitude': '',
      'Verified longitude': '',
      'Location basis': '',
    })),
  );
}

// The Farm-to-Market Road type is off until an Admin switches it on, and then Home and the Dashboard
// show the roads in place of the "Data to follow" card.
export const hasRoads = (data: Pick<MapData, 'types'>) => data.types.some((type) => type.code === 'fmr' && type.is_active);
