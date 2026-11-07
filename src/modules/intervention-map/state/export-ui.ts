import { create } from 'zustand';
import type { GeoBounds } from '../export/records';
import type { MapExtent } from '../lib/saved-views';

// The records table's own rows, for exporting exactly what it shows.
export interface TableExport {
  recordIds: string[];
  search: string | null;
  onlyMapView: boolean;
}

// Kept apart from the map's other state, as the map's position changes every time it moves and few
// things care.
interface ExportUiState {
  open: { barangayId: number | null; table: TableExport | null } | null;
  mapBounds: GeoBounds | null;
  mapExtent: MapExtent | null;
  openExport(barangayId?: number | null): void;
  openTableExport(table: TableExport): void;
  closeExport(): void;
  setMapPosition(bounds: GeoBounds, extent: MapExtent): void;
}

export const useExportUi = create<ExportUiState>((set) => ({
  open: null,
  mapBounds: null,
  mapExtent: null,
  openExport: (barangayId = null) => set({ open: { barangayId, table: null } }),
  openTableExport: (table) => set({ open: { barangayId: null, table } }),
  closeExport: () => set({ open: null }),
  setMapPosition: (mapBounds, mapExtent) => set({ mapBounds, mapExtent }),
}));
