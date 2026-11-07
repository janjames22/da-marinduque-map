// Which records an export takes, and how its file is named. This part has no file-format code, so
// the dialog can count records without loading any of it.
import type { Intervention, InterventionBarangay, MapData } from '../data/types';
import { visibleRecords, type ViewFilters } from '../lib/choropleth';
import { describeFieldFilter, viewFields } from '../lib/view-fields';

export type ExportFormat = 'kmz' | 'kml' | 'csv' | 'geojson' | 'shp';

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ExportSelection {
  view: ViewFilters;
  // From a barangay's own Export button. It replaces any place filter on the map.
  barangayId?: number | null;
  // Only what's in the current map view.
  mapBounds?: GeoBounds | null;
  // From the records table: exactly its rows, in its order, and what it was searched for.
  recordIds?: string[] | null;
  search?: string | null;
}

function eachPosition(geometry: GeoJSON.Geometry, visit: (position: number[]) => void) {
  if (geometry.type === 'GeometryCollection') {
    geometry.geometries.forEach((part) => eachPosition(part, visit));
    return;
  }
  const walk = (value: unknown): void => {
    if (typeof (value as unknown[])[0] === 'number') visit(value as number[]);
    else (value as unknown[]).forEach(walk);
  };
  walk(geometry.coordinates);
}

export function geometryBounds(geometry: GeoJSON.Geometry): GeoBounds {
  const bounds: GeoBounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  eachPosition(geometry, ([longitude, latitude]) => {
    bounds.west = Math.min(bounds.west, longitude);
    bounds.east = Math.max(bounds.east, longitude);
    bounds.south = Math.min(bounds.south, latitude);
    bounds.north = Math.max(bounds.north, latitude);
  });
  return bounds;
}

export const overlaps = (a: GeoBounds, b: GeoBounds) => a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;

export function selectionView({ view, barangayId }: ExportSelection, data: Pick<MapData, 'barangays'>): ViewFilters {
  if (barangayId == null) return view;
  const barangay = data.barangays.find((b) => b.id === barangayId);
  return { ...view, barangayId, municipalityId: barangay?.municipality_id ?? null };
}

// Exactly what the map's filters show, so the map and its exports can't disagree. Unlike the map, it
// also takes records that can't be plotted, as each format has its own way of keeping them.
export function selectExportRecords(
  records: Intervention[],
  links: InterventionBarangay[],
  selection: ExportSelection,
  data: Pick<MapData, 'barangays'>,
): Intervention[] {
  const chosen = visibleRecords(records, selectionView(selection, data), links);
  const { mapBounds, recordIds } = selection;
  const inView = mapBounds ? chosen.filter((record) => record.geojson !== null && overlaps(geometryBounds(record.geojson), mapBounds)) : chosen;
  if (!recordIds) return inView;
  // A record changed since the table was read may have left the filters, and doesn't come back here.
  const byId = new Map(inView.map((record) => [record.id, record]));
  return recordIds.map((id) => byId.get(id)).filter((record): record is Intervention => record !== undefined);
}

// A record with no coordinates has nowhere to go in a map file.
export const isLocated = (record: Intervention) => record.geojson !== null;

// Its coordinates are outside Marinduque, so they can't be trusted to show where it really is.
export const NEEDS_LOCATION_CHECK = 'QA – needs location check';
export const needsLocationCheck = (record: Intervention) => record.qa_flags.includes('out_of_province');

// The filters in force, as names people can read. They go in the dialog, the file and the audit log.
export interface ExportFilters {
  types: string[];
  allTypes: boolean;
  program: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  municipality: string | null;
  barangay: string | null;
  mapView: boolean;
  fields: string[];
  search: string | null;
}

export function describeFilters(selection: ExportSelection, data: MapData): ExportFilters {
  const view = selectionView(selection, data);
  const activeTypes = data.types.filter((t) => t.is_active).sort((a, b) => a.sort_order - b.sort_order);
  const shownTypes = activeTypes.filter((t) => (view.mode === 'type' ? t.id === view.pickedTypeId : true) && !view.hiddenTypeIds.includes(t.id));
  const programId = view.mode === 'program' ? view.pickedProgramId : view.programId;
  const fields = view.fieldFilters?.length ? viewFields(data) : [];
  return {
    types: shownTypes.map((t) => t.name),
    allTypes: shownTypes.length === activeTypes.length,
    program: data.programs.find((p) => p.id === programId)?.name ?? null,
    yearFrom: view.yearFrom,
    yearTo: view.yearTo,
    municipality: data.municipalities.find((m) => m.id === view.municipalityId)?.name ?? null,
    barangay: data.barangays.find((b) => b.id === view.barangayId)?.name ?? null,
    mapView: Boolean(selection.mapBounds),
    fields: (view.fieldFilters ?? []).map((filter) => describeFieldFilter(filter, fields)).filter((line): line is string => line !== null),
    search: selection.search?.trim() || null,
  };
}

export function yearLabel(from: number | null, to: number | null): string | null {
  if (from !== null && to !== null) return from === to ? String(from) : `${from}-${to}`;
  if (from !== null) return `From ${from}`;
  if (to !== null) return `To ${to}`;
  return null;
}

export function filterLines(filters: ExportFilters): string[] {
  const years = yearLabel(filters.yearFrom, filters.yearTo);
  return [
    filters.barangay ? `Barangay: ${filters.barangay}, ${filters.municipality}` : filters.municipality ? `Municipality: ${filters.municipality}` : null,
    filters.allTypes ? null : `Type: ${filters.types.join(', ') || 'none'}`,
    filters.program ? `Program: ${filters.program}` : null,
    years ? `Year funded: ${years}` : null,
    ...filters.fields,
    filters.search ? `Search: "${filters.search}"` : null,
    filters.mapView ? 'Only the current map view' : null,
  ].filter((line): line is string => line !== null);
}

// "Santa Cruz" becomes SantaCruz, and letters like ñ become their plain form, so a file name
// survives every device and email system it passes through.
function namePart(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
}

export function exportFileStem(filters: ExportFilters, date: string): string {
  const years = yearLabel(filters.yearFrom, filters.yearTo);
  const scope = [
    ...[filters.municipality, filters.barangay, ...(filters.allTypes ? [] : filters.types), filters.program]
      .filter((part): part is string => Boolean(part))
      .map(namePart),
    years?.replace(' ', ''), // the hyphen in 2020-2024 stays
    // Too long to spell out, and a search can be someone's name. The dialog, the audit log and a KML's Read me list them.
    filters.fields.length > 0 || filters.search ? 'Filtered' : null,
    filters.mapView ? 'MapView' : null,
  ].filter(Boolean);
  return `Marinduque_${scope.join('_') || 'Province'}_${date}`;
}
