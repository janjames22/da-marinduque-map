// What each report says, worked out from the data alone, so the screen, the PDF and the Excel file can't
// disagree. Reports cover every record on the map, whatever the map's filters, as an office report
// should: deleted records and inactive types are left out, as they are from the map.
import type { Barangay, Intervention, InterventionType, MapData, Municipality, ReportSignatory, StatusEntry } from '../data/types';
import { countByBarangay } from '../lib/choropleth';
import { beneficiaryKey, buildDashboard, type DashboardNumbers } from '../lib/dashboard';
import { statusDateLabel, statusTimeline } from '../lib/display';

export const REGION = 'MIMAROPA (Region IV-B)';
export const PROVINCE = 'Marinduque';
export const OFFICE = 'Department of Agriculture – Provincial Agriculture Office, Marinduque';
export const BOUNDARY_SOURCE = 'Boundaries: NAMRIA, PSA via HDX (CC BY-IGO)';

type ReportData = Pick<
  MapData,
  'interventions' | 'types' | 'categories' | 'programs' | 'statuses' | 'typeStatuses' | 'municipalities' | 'barangays' | 'links' | 'statusHistory' | 'qaDismissals' | 'dataSources'
>;

const byId = <T extends { id: number }>(items: T[], id: number | null) => (id === null ? undefined : items.find((item) => item.id === id));

export function reportRecords(data: Pick<MapData, 'interventions' | 'types'>): Intervention[] {
  const active = new Set(data.types.filter((type) => type.is_active).map((type) => type.id));
  return data.interventions.filter((record) => record.deleted_at === null && active.has(record.intervention_type_id));
}

const barangayName = (record: Intervention, data: Pick<MapData, 'barangays'>) => byId(data.barangays, record.barangay_id)?.name ?? record.barangay_raw ?? '';
const pointOf = (record: Intervention) => (record.geojson?.type === 'Point' ? { lng: record.geojson.coordinates[0], lat: record.geojson.coordinates[1] } : null);
// As the RAED report writes them: up to six decimals, nothing when there are none.
const coordinate = (value: number | undefined) => (value === undefined ? '' : String(Math.round(value * 1e6) / 1e6));

// ---------------------------------------------------------------------------
// Inventory, in the RAED Consolidated Inventory Report's columns
// ---------------------------------------------------------------------------

export interface InventoryFilters {
  municipalityId: number | null;
  programId: number | null;
  year: number | null;
}

export const NO_INVENTORY_FILTERS: InventoryFilters = { municipalityId: null, programId: null, year: null };

// A machine is named by what it is. A project, such as an SPIS, by its kind and its own title.
export type InventoryLayout = 'machine' | 'project';

const LOCATION_COLUMNS = ['Region', 'Province', 'Municipality', 'Barangay', 'Latitude', 'Longitude'];
export const INVENTORY_COLUMNS: Record<InventoryLayout, string[]> = {
  machine: ['Machine Name', 'Year Funded', 'Banner Program', 'Beneficiary', 'Status', ...LOCATION_COLUMNS],
  project: ['Project Type', 'Project Title', 'Banner Program', 'Year Funded', 'Beneficiary', ...LOCATION_COLUMNS, 'Stage'],
};

export interface InventorySection {
  type: InterventionType;
  layout: InventoryLayout;
  columns: string[];
  rows: string[][];
  records: Intervention[];
  units: number;
}

export function inventorySections(data: ReportData, filters: InventoryFilters): InventorySection[] {
  const programOrder = (record: Intervention) => byId(data.programs, record.banner_program_id)?.sort_order ?? Number.MAX_SAFE_INTEGER;
  const municipalityName = (record: Intervention) => byId(data.municipalities, record.municipality_id)?.name ?? '';
  const records = reportRecords(data).filter(
    (record) =>
      (filters.municipalityId === null || record.municipality_id === filters.municipalityId) &&
      (filters.programId === null || record.banner_program_id === filters.programId) &&
      (filters.year === null || record.year_funded === filters.year),
  );

  return [...data.types]
    .filter((type) => type.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((type) => {
      const name = (record: Intervention) => {
        const category = byId(data.categories, record.category_id)?.name ?? '';
        const variant = typeof record.attributes.variant === 'string' && record.attributes.variant ? ` (${record.attributes.variant})` : '';
        return `${category}${variant}`;
      };
      const ofType = records
        .filter((record) => record.intervention_type_id === type.id)
        // As the RAED report runs: by program, then year, then what it is and where.
        .sort(
          (a, b) =>
            programOrder(a) - programOrder(b) ||
            (a.year_funded ?? 0) - (b.year_funded ?? 0) ||
            name(a).localeCompare(name(b)) ||
            municipalityName(a).localeCompare(municipalityName(b)) ||
            barangayName(a, data).localeCompare(barangayName(b, data)) ||
            (a.beneficiary ?? '').localeCompare(b.beneficiary ?? ''),
        );
      const layout: InventoryLayout = ofType.some((record) => record.title) ? 'project' : 'machine';
      // The RAED report has a row for each unit. A record of several units says how many.
      const withQuantity = ofType.some((record) => record.quantity > 1);
      const columns = [...INVENTORY_COLUMNS[layout]];
      if (withQuantity) columns.splice(1, 0, 'Qty');

      const rows = ofType.map((record) => {
        const point = pointOf(record);
        const program = byId(data.programs, record.banner_program_id)?.name ?? '';
        const status = byId(data.statuses, record.status_id)?.name ?? '';
        const year = record.year_funded === null ? '' : String(record.year_funded);
        const place = [REGION, PROVINCE, municipalityName(record), barangayName(record, data), coordinate(point?.lat), coordinate(point?.lng)];
        const row =
          layout === 'machine'
            ? [name(record), year, program, record.beneficiary ?? '', status, ...place]
            : [byId(data.categories, record.category_id)?.name ?? '', record.title ?? '', program, year, record.beneficiary ?? '', ...place, status];
        if (withQuantity) row.splice(1, 0, String(record.quantity));
        return row;
      });
      return { type, layout, columns, rows, records: ofType, units: ofType.reduce((sum, record) => sum + record.quantity, 0) };
    })
    .filter((section) => section.records.length > 0);
}

// The title block, as on the RAED report's cover: what, which types, and where.
export function inventoryTitle(sections: InventorySection[], filters: InventoryFilters, data: Pick<MapData, 'municipalities' | 'programs'>) {
  const municipality = byId(data.municipalities, filters.municipalityId);
  const program = byId(data.programs, filters.programId);
  const types = sections.map((section) => section.type.name);
  return {
    title: 'CONSOLIDATED INVENTORY REPORT',
    subtitle: types.length === 0 ? 'Interventions' : types.length === 1 ? types[0] : `${types.slice(0, -1).join(', ')} and ${types.at(-1)}`,
    place: municipality ? `Municipality of ${municipality.name}, Province of ${PROVINCE}` : `Province of ${PROVINCE}`,
    filters: [program ? `Banner program: ${program.name}` : null, filters.year === null ? null : `Year funded: ${filters.year}`].filter((line): line is string => line !== null),
  };
}

// ---------------------------------------------------------------------------
// Municipal profile
// ---------------------------------------------------------------------------

export interface TallyRow {
  label: string;
  records: number;
  units: number;
}

export interface MunicipalProfile {
  municipality: Municipality;
  records: Intervention[];
  numbers: DashboardNumbers;
  byProgram: TallyRow[];
  byCategory: TallyRow[];
  byStatus: TallyRow[];
  // Barangays with no intervention on the map yet: what's encoded, not what's on the ground.
  gaps: Barangay[];
  barangays: Barangay[];
}

function tally(records: Intervention[], label: (record: Intervention) => string): TallyRow[] {
  const rows = new Map<string, TallyRow>();
  for (const record of records) {
    const key = label(record);
    const row = rows.get(key) ?? { label: key, records: 0, units: 0 };
    row.records += 1;
    row.units += record.quantity;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.units - a.units || a.label.localeCompare(b.label));
}

export function municipalProfile(data: ReportData, municipalityId: number): MunicipalProfile | null {
  const municipality = byId(data.municipalities, municipalityId);
  if (!municipality) return null;
  const records = reportRecords(data).filter((record) => record.municipality_id === municipalityId);
  const barangays = data.barangays.filter((barangay) => barangay.municipality_id === municipalityId).sort((a, b) => a.name.localeCompare(b.name));
  const counts = countByBarangay(records, data.links);
  const statusOrder = new Map(data.statuses.map((status) => [status.name, status.sort_order]));
  return {
    municipality,
    records,
    numbers: buildDashboard(records, data, barangays),
    byProgram: tally(records, (record) => byId(data.programs, record.banner_program_id)?.name ?? 'No program'),
    byCategory: tally(records, (record) => byId(data.categories, record.category_id)?.name ?? 'No category'),
    byStatus: tally(records, (record) => byId(data.statuses, record.status_id)?.name ?? 'No status').sort(
      (a, b) => (statusOrder.get(a.label) ?? 999) - (statusOrder.get(b.label) ?? 999),
    ),
    gaps: barangays.filter((barangay) => (counts.get(barangay.id) ?? 0) === 0),
    barangays,
  };
}

// ---------------------------------------------------------------------------
// Beneficiaries
// ---------------------------------------------------------------------------

// One beneficiary, however its name was written: "Bantad F.C.A." and "bantad fca" are the same. This is
// the same matching the dashboard's "Beneficiaries (approx.)" uses, until there's a proper list.
export interface BeneficiaryGroup {
  key: string;
  name: string;
  spellings: string[];
  records: Intervention[];
  units: number;
  municipalities: string[];
}

export function beneficiaryGroups(data: Pick<MapData, 'interventions' | 'types' | 'municipalities'>): BeneficiaryGroup[] {
  const groups = new Map<string, Intervention[]>();
  for (const record of reportRecords(data)) {
    const key = beneficiaryKey(record.beneficiary);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.entries()]
    .map(([key, records]) => {
      const counts = new Map<string, number>();
      for (const record of records) counts.set(record.beneficiary!.trim(), (counts.get(record.beneficiary!.trim()) ?? 0) + 1);
      // The spelling used most, then the first in alphabetical order.
      const spellings = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([spelling]) => spelling);
      const municipalities = [...new Set(records.map((record) => byId(data.municipalities, record.municipality_id)?.name ?? ''))].filter(Boolean).sort();
      return { key, name: spellings[0], spellings, records, units: records.reduce((sum, record) => sum + record.quantity, 0), municipalities };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface BeneficiaryRecord {
  record: Intervention;
  name: string;
  type: string;
  program: string;
  year: string;
  place: string;
  point: { lat: number; lng: number } | null;
  status: string;
  history: { status: string; when: string; remarks: string | null; entry: StatusEntry }[];
}

export function beneficiaryRecords(group: BeneficiaryGroup, data: ReportData): BeneficiaryRecord[] {
  return [...group.records]
    .sort((a, b) => (a.year_funded ?? 0) - (b.year_funded ?? 0) || (byId(data.categories, a.category_id)?.name ?? '').localeCompare(byId(data.categories, b.category_id)?.name ?? ''))
    .map((record) => {
      const category = byId(data.categories, record.category_id)?.name ?? '';
      const municipality = byId(data.municipalities, record.municipality_id)?.name ?? '';
      return {
        record,
        name: record.title ?? `${category}${typeof record.attributes.variant === 'string' && record.attributes.variant ? ` (${record.attributes.variant})` : ''}`,
        type: data.types.find((type) => type.id === record.intervention_type_id)?.name ?? '',
        program: byId(data.programs, record.banner_program_id)?.name ?? '',
        year: record.year_funded === null ? '' : String(record.year_funded),
        place: [barangayName(record, data), municipality].filter(Boolean).join(', '),
        point: pointOf(record),
        status: byId(data.statuses, record.status_id)?.name ?? '',
        history: statusTimeline(record.id, data.statusHistory).map((entry) => ({
          status: byId(data.statuses, entry.status_id)?.name ?? 'Unknown',
          when: statusDateLabel(entry),
          remarks: entry.remarks,
          entry,
        })),
      };
    });
}

// The signature blocks that print, in their order.
export const activeSignatories = (signatories: ReportSignatory[]) => signatories.filter((signatory) => signatory.is_active).sort((a, b) => a.sort_order - b.sort_order);

export const manilaDateTime = (now: Date) => now.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short' });
export const manilaLongDate = (now: Date) => now.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long' });

// What the records came from, for a report's "Data source" line.
export function dataSourceLine(records: Intervention[]): string {
  const sources = [...new Set(records.map((record) => record.data_source).filter((source): source is string => Boolean(source)))].sort();
  return sources.length > 0 ? `Intervention Map records (${sources.join('; ')})` : 'Intervention Map records';
}
