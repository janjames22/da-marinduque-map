import { create } from 'zustand';
import type { ChoroplethMode, ViewFilters } from '../lib/choropleth';
import type { BasemapId, MapExtent, ViewConfig } from '../lib/saved-views';
import { DEFAULT_COLOR_BY, type FieldFilter } from '../lib/view-fields';

export type { BasemapId } from '../lib/saved-views';

export type InsightsTab = 'dashboard' | 'records';

// The dashboard sits beside the map when there's room for both. On a phone the two take turns.
const WIDE_ENOUGH = '(min-width: 1100px)';
const INSIGHTS_KEY = 'da-map-insights-closed';

function insightsAtStart(): InsightsTab | null {
  try {
    if (globalThis.localStorage?.getItem(INSIGHTS_KEY) === 'yes') return null;
    return globalThis.matchMedia?.(WIDE_ENOUGH).matches ? 'dashboard' : null;
  } catch {
    return null;
  }
}

function rememberInsights(closed: boolean) {
  try {
    if (closed) globalThis.localStorage?.setItem(INSIGHTS_KEY, 'yes');
    else globalThis.localStorage?.removeItem(INSIGHTS_KEY);
  } catch {
    // Only a convenience, so a browser that won't store it just opens as usual next time.
  }
}

interface MapUiState extends ViewFilters {
  fieldFilters: FieldFilter[];
  colorBy: string;
  basemap: BasemapId;
  showMunicipal: boolean;
  showProvince: boolean;
  panelOpen: boolean;
  showUnassigned: boolean;
  insights: InsightsTab | null;
  insightsWide: boolean;
  limitToMapView: boolean;
  focusRecord: { id: string; nonce: number } | null;
  focusBarangay: { id: number; nonce: number } | null;
  focusExtent: (MapExtent & { nonce: number }) | null;
  defaultViewHandled: boolean;

  setBasemap(basemap: BasemapId): void;
  setShowMunicipal(show: boolean): void;
  setShowProvince(show: boolean): void;
  setPanelOpen(open: boolean): void;
  setShowUnassigned(show: boolean): void;
  setMode(mode: ChoroplethMode): void;
  setPickedProgram(id: number): void;
  setPickedType(id: number): void;
  toggleType(id: number): void;
  setProgramFilter(id: number | null): void;
  setYearFrom(year: number | null): void;
  setYearTo(year: number | null): void;
  setMunicipalityFilter(id: number | null): void;
  setBarangayFilter(id: number | null): void;
  addFieldFilter(filter: FieldFilter): void;
  updateFieldFilter(filter: FieldFilter): void;
  removeFieldFilter(field: string): void;
  setColorBy(field: string): void;
  clearFilters(): void;
  showEverything(): void;
  setInsights(tab: InsightsTab | null): void;
  setInsightsWide(wide: boolean): void;
  setLimitToMapView(limit: boolean): void;
  applyView(view: ViewConfig): void;
  markDefaultViewHandled(): void;
  zoomToRecord(id: string): void;
  zoomToBarangay(id: number): void;
}

let nonce = 0;

export const useMapUi = create<MapUiState>((set) => ({
  mode: 'count',
  pickedProgramId: null,
  pickedTypeId: null,
  hiddenTypeIds: [],
  programId: null,
  yearFrom: null,
  yearTo: null,
  municipalityId: null,
  barangayId: null,
  fieldFilters: [],
  colorBy: DEFAULT_COLOR_BY,
  basemap: 'osm',
  showMunicipal: true,
  showProvince: true,
  panelOpen: false,
  showUnassigned: false,
  insights: insightsAtStart(),
  insightsWide: false,
  limitToMapView: false,
  focusRecord: null,
  focusBarangay: null,
  focusExtent: null,
  defaultViewHandled: false,

  setBasemap: (basemap) => set({ basemap }),
  setShowMunicipal: (showMunicipal) => set({ showMunicipal }),
  setShowProvince: (showProvince) => set({ showProvince }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setShowUnassigned: (showUnassigned) => set({ showUnassigned }),
  setMode: (mode) => set({ mode }),
  setPickedProgram: (pickedProgramId) => set({ pickedProgramId }),
  setPickedType: (pickedTypeId) => set({ pickedTypeId }),
  toggleType: (id) =>
    set((state) => ({
      hiddenTypeIds: state.hiddenTypeIds.includes(id)
        ? state.hiddenTypeIds.filter((hidden) => hidden !== id)
        : [...state.hiddenTypeIds, id],
    })),
  setProgramFilter: (programId) => set({ programId }),
  setYearFrom: (yearFrom) => set({ yearFrom }),
  setYearTo: (yearTo) => set({ yearTo }),
  setMunicipalityFilter: (municipalityId) => set({ municipalityId, barangayId: null }),
  setBarangayFilter: (barangayId) => set({ barangayId }),
  addFieldFilter: (filter) => set((state) => ({ fieldFilters: [...state.fieldFilters.filter((other) => other.field !== filter.field), filter] })),
  updateFieldFilter: (filter) => set((state) => ({ fieldFilters: state.fieldFilters.map((other) => (other.field === filter.field ? filter : other)) })),
  removeFieldFilter: (field) => set((state) => ({ fieldFilters: state.fieldFilters.filter((other) => other.field !== field) })),
  setColorBy: (colorBy) => set({ colorBy }),
  clearFilters: () => set({ programId: null, yearFrom: null, yearTo: null, municipalityId: null, barangayId: null, fieldFilters: [] }),
  // For a link to one record, which has to be showing whatever was on before.
  showEverything: () => set({ programId: null, yearFrom: null, yearTo: null, municipalityId: null, barangayId: null, fieldFilters: [], hiddenTypeIds: [], mode: 'count' }),
  setInsights: (insights) => {
    rememberInsights(insights === null);
    set({ insights });
  },
  setInsightsWide: (insightsWide) => set({ insightsWide }),
  setLimitToMapView: (limitToMapView) => set({ limitToMapView }),
  applyView: (view) =>
    set((state) => ({
      hiddenTypeIds: view.layers.hiddenTypeIds,
      showMunicipal: view.layers.showMunicipal,
      showProvince: view.layers.showProvince,
      programId: view.filters.programId,
      yearFrom: view.filters.yearFrom,
      yearTo: view.filters.yearTo,
      municipalityId: view.filters.municipalityId,
      barangayId: view.filters.barangayId,
      fieldFilters: view.filters.fieldFilters,
      mode: view.style.mode,
      pickedProgramId: view.style.pickedProgramId ?? state.pickedProgramId,
      pickedTypeId: view.style.pickedTypeId ?? state.pickedTypeId,
      colorBy: view.style.colorBy,
      basemap: view.basemap,
      focusExtent: view.extent ? { ...view.extent, nonce: ++nonce } : state.focusExtent,
    })),
  markDefaultViewHandled: () => set({ defaultViewHandled: true }),
  zoomToRecord: (id) => set({ focusRecord: { id, nonce: ++nonce }, panelOpen: false }),
  zoomToBarangay: (id) => set({ focusBarangay: { id, nonce: ++nonce }, panelOpen: false }),
}));
