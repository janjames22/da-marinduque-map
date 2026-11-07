import type { Barangay, Intervention, InterventionBarangay, InterventionType } from '../data/types';
import { matchesFilter, type FieldFilter } from './view-fields';

export type ChoroplethMode = 'off' | 'count' | 'program' | 'type' | 'gap';

export interface ViewFilters {
  mode: ChoroplethMode;
  pickedProgramId: number | null;
  pickedTypeId: number | null;
  hiddenTypeIds: number[];
  programId: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  municipalityId?: number | null;
  barangayId?: number | null;
  // Any field, including custom ones.
  fieldFilters?: FieldFilter[];
}

// Just the filters from the map's state. Everything that shows records starts from these.
export function pickViewFilters({ mode, pickedProgramId, pickedTypeId, hiddenTypeIds, programId, yearFrom, yearTo, municipalityId, barangayId, fieldFilters }: ViewFilters): ViewFilters {
  return { mode, pickedProgramId, pickedTypeId, hiddenTypeIds, programId, yearFrom, yearTo, municipalityId, barangayId, fieldFilters };
}

// A single blue ramp for magnitude, more is darker. Zero has its own neutral so that
// "none" doesn't read as "a little".
export const COUNT_BINS = [
  { min: 1, max: 1, label: '1', color: '#cde2fb' },
  { min: 2, max: 2, label: '2', color: '#86b6ef' },
  { min: 3, max: 4, label: '3–4', color: '#3987e5' },
  { min: 5, max: 9, label: '5–9', color: '#1c5cab' },
  { min: 10, max: Infinity, label: '10+', color: '#0d366b' },
] as const;

export const ZERO_COLOR = '#f0efec';
export const GAP_NONE_COLOR = '#eb6834'; // the view exists to make these stand out
export const GAP_SOME_COLOR = '#d9d8d3';

export interface LegendEntry {
  label: string;
  color: string;
  barangays: number;
}

export interface Shading {
  title: string;
  fillFor(barangayId: number): { color: string; opacity: number };
  legend: LegendEntry[];
  barangaysWithRecords: number;
  barangaysWithout: number;
}

const FILL_OPACITY = 0.7;

// Inactive types are hidden throughout the UI, and deleted records aren't shown at all.
export function liveRecords(records: Intervention[], types: InterventionType[]): Intervention[] {
  const active = new Set(types.filter((t) => t.is_active).map((t) => t.id));
  return records.filter((r) => r.deleted_at === null && active.has(r.intervention_type_id));
}

export function recordsInView(records: Intervention[], view: ViewFilters, links: InterventionBarangay[] = []): Intervention[] {
  const program = view.mode === 'program' ? view.pickedProgramId : view.programId;
  // In a barangay means what its profile means: linked to it, as encoded or where it's plotted.
  const inBarangay =
    view.barangayId == null ? null : new Set(links.filter((l) => l.barangay_id === view.barangayId).map((l) => l.intervention_id));

  return records.filter((r) => {
    if (view.mode === 'type') {
      if (r.intervention_type_id !== view.pickedTypeId) return false;
    } else if (view.hiddenTypeIds.includes(r.intervention_type_id)) {
      return false;
    }
    if (program !== null && r.banner_program_id !== program) return false;
    if (view.yearFrom !== null && (r.year_funded === null || r.year_funded < view.yearFrom)) return false;
    if (view.yearTo !== null && (r.year_funded === null || r.year_funded > view.yearTo)) return false;
    if (view.municipalityId != null && r.municipality_id !== view.municipalityId) return false;
    if (inBarangay && !inBarangay.has(r.id)) return false;
    if (view.fieldFilters && !view.fieldFilters.every((filter) => matchesFilter(r, filter))) return false;
    return true;
  });
}

// What the map's markers show, and so what an export takes. By-type shading follows the picked
// type, but markers always respect the layer switches.
export function visibleRecords(records: Intervention[], view: ViewFilters, links: InterventionBarangay[] = []): Intervention[] {
  return recordsInView(records, view, links).filter((r) => !view.hiddenTypeIds.includes(r.intervention_type_id));
}

// With a place filter on, only that place is shaded and counted. The rest aren't gaps.
export function barangaysInScope<T extends Pick<Barangay, 'id' | 'municipality_id'>>(
  barangays: T[],
  view: Pick<ViewFilters, 'municipalityId' | 'barangayId'>,
): T[] {
  if (view.barangayId != null) return barangays.filter((b) => b.id === view.barangayId);
  if (view.municipalityId != null) return barangays.filter((b) => b.municipality_id === view.municipalityId);
  return barangays;
}

// A record counts once in each barangay it's linked to. A road crossing three counts in all three.
export function countByBarangay(records: Intervention[], links: InterventionBarangay[]): Map<number, number> {
  const included = new Set(records.map((r) => r.id));
  const counts = new Map<number, number>();
  for (const link of links) {
    if (included.has(link.intervention_id)) {
      counts.set(link.barangay_id, (counts.get(link.barangay_id) ?? 0) + 1);
    }
  }
  return counts;
}

// Records linked to no barangay, shown separately so a blank barangay isn't mistaken for a true gap.
export function unassignedRecords(records: Intervention[], links: InterventionBarangay[]): Intervention[] {
  const linked = new Set(links.map((l) => l.intervention_id));
  return records.filter((r) => !linked.has(r.id));
}

export function binFor(count: number) {
  return COUNT_BINS.find((bin) => count >= bin.min && count <= bin.max) ?? null;
}

export function buildShading(
  mode: ChoroplethMode,
  title: string,
  counts: Map<number, number>,
  barangays: Pick<Barangay, 'id'>[],
): Shading {
  const countOf = (id: number) => counts.get(id) ?? 0;
  const barangaysWithRecords = barangays.filter((b) => countOf(b.id) > 0).length;
  const barangaysWithout = barangays.length - barangaysWithRecords;
  const summary = { title, barangaysWithRecords, barangaysWithout };
  const inScope = new Set(barangays.map((b) => b.id));
  const outside = { color: ZERO_COLOR, opacity: 0 };

  if (mode === 'off') {
    return {
      ...summary,
      fillFor: () => ({ color: ZERO_COLOR, opacity: 0 }),
      legend: [],
    };
  }

  if (mode === 'gap') {
    return {
      ...summary,
      fillFor: (id) => (inScope.has(id) ? { color: countOf(id) === 0 ? GAP_NONE_COLOR : GAP_SOME_COLOR, opacity: FILL_OPACITY } : outside),
      legend: [
        { label: 'None encoded yet', color: GAP_NONE_COLOR, barangays: barangaysWithout },
        { label: 'At least one', color: GAP_SOME_COLOR, barangays: barangaysWithRecords },
      ],
    };
  }

  return {
    ...summary,
    fillFor: (id) => (inScope.has(id) ? { color: binFor(countOf(id))?.color ?? ZERO_COLOR, opacity: FILL_OPACITY } : outside),
    legend: [
      { label: '0', color: ZERO_COLOR, barangays: barangaysWithout },
      ...COUNT_BINS.map((bin) => ({
        label: bin.label,
        color: bin.color,
        barangays: barangays.filter((b) => binFor(countOf(b.id)) === bin).length,
      })),
    ],
  };
}
