// What a saved view holds, and how to read one back. A view can outlive what it points at, so anything
// no longer there is ignored rather than treated as an error.
import type { MapData, SavedView } from '../data/types';
import type { ChoroplethMode } from './choropleth';
import { DEFAULT_COLOR_BY, viewFields, type FieldFilter } from './view-fields';

export type BasemapId = 'light' | 'osm' | 'imagery' | 'topo' | 'hybrid';

export interface MapExtent {
  center: [number, number];
  zoom: number;
}

export interface ViewConfig {
  layers: { hiddenTypeIds: number[]; showMunicipal: boolean; showProvince: boolean };
  filters: {
    programId: number | null;
    yearFrom: number | null;
    yearTo: number | null;
    municipalityId: number | null;
    barangayId: number | null;
    fieldFilters: FieldFilter[];
  };
  style: { mode: ChoroplethMode; pickedProgramId: number | null; pickedTypeId: number | null; colorBy: string };
  basemap: BasemapId;
  extent: MapExtent | null;
}

// The parts of the map's state a view keeps.
export interface ViewableState {
  hiddenTypeIds: number[];
  showMunicipal: boolean;
  showProvince: boolean;
  programId: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  municipalityId?: number | null;
  barangayId?: number | null;
  fieldFilters?: FieldFilter[];
  mode: ChoroplethMode;
  pickedProgramId: number | null;
  pickedTypeId: number | null;
  colorBy: string;
  basemap: BasemapId;
}

export function captureView(state: ViewableState, extent: MapExtent | null): ViewConfig {
  return {
    layers: { hiddenTypeIds: state.hiddenTypeIds, showMunicipal: state.showMunicipal, showProvince: state.showProvince },
    filters: {
      programId: state.programId,
      yearFrom: state.yearFrom,
      yearTo: state.yearTo,
      municipalityId: state.municipalityId ?? null,
      barangayId: state.barangayId ?? null,
      fieldFilters: state.fieldFilters ?? [],
    },
    style: { mode: state.mode, pickedProgramId: state.pickedProgramId, pickedTypeId: state.pickedTypeId, colorBy: state.colorBy },
    basemap: state.basemap,
    extent,
  };
}

const MODES: ChoroplethMode[] = ['off', 'count', 'program', 'type', 'gap'];
const BASEMAPS: BasemapId[] = ['light', 'osm', 'imagery', 'topo', 'hybrid'];

const asObject = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const asDay = (value: unknown): string | null => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

function readFilter(value: unknown, known: Map<string, ReturnType<typeof viewFields>[number]>): FieldFilter | null {
  const raw = asObject(value);
  const field = known.get(String(raw.field));
  if (!field || raw.kind !== field.kind) return null;
  switch (field.kind) {
    case 'choice':
      return { field: field.id, kind: 'choice', values: Array.isArray(raw.values) ? raw.values.map(String) : [] };
    case 'number':
      return { field: field.id, kind: 'number', min: asNumber(raw.min), max: asNumber(raw.max) };
    case 'date':
      return { field: field.id, kind: 'date', from: asDay(raw.from), to: asDay(raw.to) };
    case 'text':
      return { field: field.id, kind: 'text', text: typeof raw.text === 'string' ? raw.text : '' };
  }
}

type ViewData = Parameters<typeof viewFields>[0] & Pick<MapData, 'barangays'>;

// A view as it can be applied today, from whatever was stored.
export function readViewConfig(config: unknown, data: ViewData): ViewConfig {
  const stored = asObject(config);
  const layers = asObject(stored.layers);
  const filters = asObject(stored.filters);
  const style = asObject(stored.style);
  const extent = asObject(stored.extent);

  const known = new Map(viewFields(data).map((field) => [field.id, field]));
  const hasId = (items: { id: number }[], value: unknown) => {
    const id = asNumber(value);
    return id !== null && items.some((item) => item.id === id) ? id : null;
  };
  const municipalityId = hasId(data.municipalities, filters.municipalityId);
  const barangay = data.barangays.find((candidate) => candidate.id === asNumber(filters.barangayId) && candidate.municipality_id === municipalityId);
  const colorBy = typeof style.colorBy === 'string' && known.get(style.colorBy)?.colorable ? style.colorBy : DEFAULT_COLOR_BY;
  const center = Array.isArray(extent.center) ? extent.center.map(asNumber) : [];
  const zoom = asNumber(extent.zoom);

  return {
    layers: {
      hiddenTypeIds: Array.isArray(layers.hiddenTypeIds) ? layers.hiddenTypeIds.filter((id): id is number => data.types.some((type) => type.id === id)) : [],
      showMunicipal: layers.showMunicipal !== false,
      showProvince: layers.showProvince !== false,
    },
    filters: {
      programId: hasId(data.programs, filters.programId),
      yearFrom: asNumber(filters.yearFrom),
      yearTo: asNumber(filters.yearTo),
      municipalityId,
      barangayId: barangay?.id ?? null,
      fieldFilters: Array.isArray(filters.fieldFilters) ? filters.fieldFilters.map((filter) => readFilter(filter, known)).filter((filter): filter is FieldFilter => filter !== null) : [],
    },
    style: {
      mode: MODES.includes(style.mode as ChoroplethMode) ? (style.mode as ChoroplethMode) : 'count',
      pickedProgramId: hasId(data.programs, style.pickedProgramId),
      pickedTypeId: hasId(data.types, style.pickedTypeId),
      colorBy,
    },
    basemap: BASEMAPS.includes(stored.basemap as BasemapId) ? (stored.basemap as BasemapId) : 'light',
    extent: center.length === 2 && center[0] !== null && center[1] !== null && zoom !== null ? { center: [center[0], center[1]], zoom } : null,
  };
}

// Everything the database would refuse about saving a view, keyed by what to fix. Mirrors
// saved_views_before_write and the index that keeps one person's view names apart.
export function savedViewProblems(values: { name?: string; is_shared?: boolean }, views: SavedView[], ownerId: string, id: string | null): Record<string, string> {
  const errors: Record<string, string> = {};
  const current = views.find((view) => view.id === id);
  // Sharing or updating a view leaves its name alone, so there's nothing to judge. This also holds when
  // the view was made in another tab and isn't in this tab's list yet.
  if (id === null || values.name !== undefined) {
    const name = (values.name ?? '').trim();
    if (name === '') errors.name = 'Give the view a name.';
    else if (views.some((view) => view.owner_id === ownerId && view.id !== id && view.name.toLowerCase() === name.toLowerCase())) errors.name = 'You already have a view with that name.';
  }
  if (current?.is_default && values.is_shared === false) errors.is_shared = 'This view opens by default, so it has to stay shared. Choose another default first.';
  return errors;
}

export const viewsInOrder = (views: SavedView[]) => [...views].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
