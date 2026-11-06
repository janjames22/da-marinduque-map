import { create } from 'zustand';
import type { GeoBounds } from '../export/records';

// Kept apart from the map's other state, as the map's bounds change every time it moves and only
// the export dialog cares.
interface ExportUiState {
  open: { barangayId: number | null } | null;
  mapBounds: GeoBounds | null;
  openExport(barangayId?: number | null): void;
  closeExport(): void;
  setMapBounds(bounds: GeoBounds): void;
}

export const useExportUi = create<ExportUiState>((set) => ({
  open: null,
  mapBounds: null,
  openExport: (barangayId = null) => set({ open: { barangayId } }),
  closeExport: () => set({ open: null }),
  setMapBounds: (mapBounds) => set({ mapBounds }),
}));
