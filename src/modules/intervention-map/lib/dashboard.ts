// The dashboard's numbers, from whichever records the map's filters leave. Units are what a record
// counts for: one record can hold several machines.
import type { Barangay, Intervention, MapData } from '../data/types';
import { countByBarangay } from './choropleth';
import { dismissedKeys, needsReview } from './display';
import { beneficiaryKey } from './text';

export interface BarRow {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export interface StatusSeries {
  key: string;
  label: string;
  color: string;
}

export interface StatusRow {
  key: string;
  label: string;
  total: number;
  values: Record<string, number>;
}

export interface TypeTile {
  typeId: number;
  label: string;
  units: number;
}

// Out of the units whose condition has been checked. Those at a status that doesn't count as
// assessed, such as Turned-over, are counted apart, by status, so it's clear how many are waiting.
export interface OperationalShare {
  percent: number | null;
  units: number;
  assessed: number;
  notAssessed: { key: string; label: string; units: number }[];
  noStatus: number;
}

export interface DashboardNumbers {
  records: number;
  types: TypeTile[];
  beneficiaries: number;
  operational: OperationalShare;
  barangaysWithout: number;
  barangaysTotal: number;
  needingQa: number;
  byMunicipality: BarRow[];
  byProgram: BarRow[];
  byYear: BarRow[];
  noYearUnits: number;
  byCategory: BarRow[];
  categoriesLeftOut: number;
  unitsLeftOut: number;
  statusSeries: StatusSeries[];
  byStatus: StatusRow[];
}

const TOP_CATEGORIES = 15;
const NO_VALUE_COLOR = '#bdbdbd';

// What each type's tile is called. A new type gets one of its own, named after it.
const TILE_LABELS: Record<string, string> = {
  'farm-machinery': 'Machinery units',
  ssip: 'SSIPs',
};

// An approximate count until there's a proper list of beneficiaries.
export { beneficiaryKey } from './text';

const ranked = (rows: BarRow[]) => rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

function tally(records: Intervention[], rowFor: (record: Intervention) => Omit<BarRow, 'value'>): BarRow[] {
  const rows = new Map<string, BarRow>();
  for (const record of records) {
    const row = rowFor(record);
    const existing = rows.get(row.key);
    if (existing) existing.value += record.quantity;
    else rows.set(row.key, { ...row, value: record.quantity });
  }
  return [...rows.values()];
}

// A status that doesn't count as assessed, such as Turned-over or Unknown, says nothing about whether
// a unit works, so its units are left out rather than counted as not working. Which statuses those
// are is set in Admin, Statuses. What counts as operational is each type's own list.
function operationalShare(records: Intervention[], data: Pick<MapData, 'typeStatuses' | 'statuses'>): OperationalShare {
  const statusById = new Map(data.statuses.map((status) => [status.id, status]));
  const working = new Set(data.typeStatuses.filter((entry) => entry.counts_as_operational).map((entry) => `${entry.intervention_type_id}:${entry.status_id}`));
  const waiting = new Map<number, number>();
  let units = 0;
  let assessed = 0;
  let noStatus = 0;
  for (const record of records) {
    const status = record.status_id === null ? undefined : statusById.get(record.status_id);
    if (!status) {
      noStatus += record.quantity;
      continue;
    }
    if (status.counts_as_assessed === false) {
      waiting.set(status.id, (waiting.get(status.id) ?? 0) + record.quantity);
      continue;
    }
    assessed += record.quantity;
    if (working.has(`${record.intervention_type_id}:${status.id}`)) units += record.quantity;
  }
  const notAssessed = [...data.statuses]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter((status) => waiting.has(status.id))
    .map((status) => ({ key: String(status.id), label: status.name, units: waiting.get(status.id)! }));
  return { percent: assessed === 0 ? null : Math.round((units / assessed) * 100), units, assessed, notAssessed, noStatus };
}

type DashboardData = Pick<MapData, 'types' | 'typeStatuses' | 'statuses' | 'municipalities' | 'programs' | 'categories' | 'links'> & Partial<Pick<MapData, 'qaDismissals'>>;

export function buildDashboard(records: Intervention[], data: DashboardData, barangays: Pick<Barangay, 'id'>[]): DashboardNumbers {
  const municipalityName = new Map(data.municipalities.map((m) => [m.id, m.name]));
  const shownTypes = new Set(records.map((record) => record.intervention_type_id));

  const types = data.types
    .filter((type) => type.is_active || shownTypes.has(type.id))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((type) => ({
      typeId: type.id,
      label: TILE_LABELS[type.code] ?? `${type.name} units`,
      units: records.filter((record) => record.intervention_type_id === type.id).reduce((sum, record) => sum + record.quantity, 0),
    }));

  const names = new Set(records.map((record) => beneficiaryKey(record.beneficiary)).filter(Boolean));
  const counts = countByBarangay(records, data.links);
  const dismissed = dismissedKeys(data.qaDismissals);

  const byMunicipality = ranked(tally(records, (record) => ({ key: String(record.municipality_id), label: municipalityName.get(record.municipality_id) ?? 'Unknown' })));

  const byProgram = ranked(
    tally(records, (record) => {
      const program = data.programs.find((candidate) => candidate.id === record.banner_program_id);
      return program ? { key: String(program.id), label: program.name, color: program.color } : { key: 'none', label: 'No program', color: NO_VALUE_COLOR };
    }),
  );

  const dated = records.filter((record) => record.year_funded !== null);
  const years = dated.map((record) => record.year_funded as number);
  const byYear: BarRow[] = [];
  if (years.length > 0) {
    const unitsInYear = new Map<number, number>();
    for (const record of dated) unitsInYear.set(record.year_funded as number, (unitsInYear.get(record.year_funded as number) ?? 0) + record.quantity);
    // Every year from first to last, so a year with nothing shows as nothing.
    for (let year = Math.min(...years); year <= Math.max(...years); year++) byYear.push({ key: String(year), label: String(year), value: unitsInYear.get(year) ?? 0 });
  }
  const noYearUnits = records.filter((record) => record.year_funded === null).reduce((sum, record) => sum + record.quantity, 0);

  const allCategories = ranked(
    tally(records, (record) => {
      const category = data.categories.find((candidate) => candidate.id === record.category_id);
      return category ? { key: String(category.id), label: category.name } : { key: 'none', label: 'No category' };
    }),
  );
  const leftOut = allCategories.slice(TOP_CATEGORIES);

  const statuses = [...data.statuses].sort((a, b) => a.sort_order - b.sort_order);
  const statusKey = (record: Intervention) => (record.status_id === null ? 'none' : String(record.status_id));
  const used = new Set(records.map(statusKey));
  const statusSeries: StatusSeries[] = [
    ...statuses.filter((status) => used.has(String(status.id))).map((status) => ({ key: String(status.id), label: status.name, color: status.color })),
    ...(used.has('none') ? [{ key: 'none', label: 'No status', color: NO_VALUE_COLOR }] : []),
  ];
  const statusRows = new Map<number, StatusRow>();
  for (const record of records) {
    const row = statusRows.get(record.municipality_id) ?? { key: String(record.municipality_id), label: municipalityName.get(record.municipality_id) ?? 'Unknown', total: 0, values: {} };
    row.total += record.quantity;
    row.values[statusKey(record)] = (row.values[statusKey(record)] ?? 0) + record.quantity;
    statusRows.set(record.municipality_id, row);
  }

  return {
    records: records.length,
    types,
    beneficiaries: names.size,
    operational: operationalShare(records, data),
    barangaysWithout: barangays.filter((barangay) => (counts.get(barangay.id) ?? 0) === 0).length,
    barangaysTotal: barangays.length,
    // A flag a person has dismissed has been dealt with.
    needingQa: records.filter((record) => needsReview(record, dismissed)).length,
    byMunicipality,
    byProgram,
    byYear,
    noYearUnits,
    byCategory: allCategories.slice(0, TOP_CATEGORIES),
    categoriesLeftOut: leftOut.length,
    unitsLeftOut: leftOut.reduce((sum, row) => sum + row.value, 0),
    statusSeries,
    // By name, so each municipality stays in the same place as filters change.
    byStatus: [...statusRows.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}
