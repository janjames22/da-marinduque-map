import { create } from 'zustand';
import type { ChoroplethMode, ViewFilters } from '../lib/choropleth';
import type { BasemapId, MapExtent, ViewConfig } from '../lib/saved-views';
import { DEFAULT_COLOR_BY, type FieldFilter } from '../lib/view-fields';

export type { BasemapId } from '../lib/saved-views';

export type InsightsTab = 'dashboard' | 'records';

// The map first, every time the Map is opened (the owner's choice at Phase 16c's Gate 1): the layers
// card and the dashboard start put away, with buttons to bring each, and the menu does too (AppShell).
// What is brought out stays out until the Map is left. On a phone the panels take turns as before.
// Replaces Phase 14's dashboard that stayed open next time for whoever opened it.

// How long a panel takes to leave, when the device hasn't asked for less motion.
const LEAVE_MS = 180;

const lessMotion = () => {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
};

// Runs `done` once a panel has had time to leave, or at once with less motion.
function afterLeaving(done: () => void) {
  if (lessMotion()) done();
  else setTimeout(done, LEAVE_MS);
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
  // On a computer: the layers card put away, and the panel on the right (a profile, a form or the
  // dashboard) put away without closing it. The panel comes back when another one opens. Each is
  // "leaving" for a moment first, so it can fade out.
  layersHidden: boolean;
  layersLeaving: boolean;
  sideHidden: boolean;
  sideLeaving: boolean;
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
  showLayers(): void;
  hideLayers(): void;
  showSide(): void;
  hideSide(): void;
  // Opening the Map: the map first, with the layers card and the dashboard put away.
  enterMap(): void;
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
  basemap: 'light',
  showMunicipal: true,
  showProvince: true,
  panelOpen: false,
  showUnassigned: false,
  insights: null,
  insightsWide: false,
  layersHidden: true,
  layersLeaving: false,
  sideHidden: false,
  sideLeaving: false,
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
  setInsights: (insights) => set({ insights }),
  setInsightsWide: (insightsWide) => set({ insightsWide }),
  showLayers: () => set({ layersHidden: false, layersLeaving: false }),
  hideLayers: () => {
    set({ layersLeaving: true });
    afterLeaving(() => set((state) => (state.layersLeaving ? { layersHidden: true, layersLeaving: false } : {})));
  },
  showSide: () => set({ sideHidden: false, sideLeaving: false }),
  hideSide: () => {
    set({ sideLeaving: true });
    afterLeaving(() => set((state) => (state.sideLeaving ? { sideHidden: true, sideLeaving: false } : {})));
  },
  enterMap: () => set({ layersHidden: true, layersLeaving: false, insights: null, sideHidden: false, sideLeaving: false, panelOpen: false }),
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

// Whether any filter is narrowing the records, as the filter bar and the layers card show it.
export function hasFilters(state: Pick<ViewFilters, 'programId' | 'yearFrom' | 'yearTo' | 'municipalityId' | 'barangayId' | 'fieldFilters'>): boolean {
  return state.programId !== null || state.yearFrom !== null || state.yearTo !== null || state.municipalityId !== null || state.barangayId !== null || (state.fieldFilters?.length ?? 0) > 0;
}

// Whether the records shown are fewer than all of them: a filter, a type layer switched off, or shading
// by one program or type. showEverything undoes all of it.
export function isNarrowed(state: ViewFilters): boolean {
  return hasFilters(state) || state.hiddenTypeIds.length > 0 || state.mode === 'type' || state.mode === 'program';
}
