import { create } from 'zustand';
import type { ChoroplethMode, ViewFilters } from '../lib/choropleth';

export type BasemapId = 'osm' | 'imagery' | 'topo' | 'hybrid';

interface MapUiState extends ViewFilters {
  basemap: BasemapId;
  showMunicipal: boolean;
  showProvince: boolean;
  panelOpen: boolean;
  showUnassigned: boolean;
  focusRecord: { id: string; nonce: number } | null;
  focusBarangay: { id: number; nonce: number } | null;

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
  clearFilters(): void;
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
  basemap: 'osm',
  showMunicipal: true,
  showProvince: true,
  panelOpen: false,
  showUnassigned: false,
  focusRecord: null,
  focusBarangay: null,

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
  clearFilters: () => set({ programId: null, yearFrom: null, yearTo: null }),
  zoomToRecord: (id) => set({ focusRecord: { id, nonce: ++nonce }, panelOpen: false }),
  zoomToBarangay: (id) => set({ focusBarangay: { id, nonce: ++nonce }, panelOpen: false }),
}));
