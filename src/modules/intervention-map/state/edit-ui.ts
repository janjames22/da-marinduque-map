import { create } from 'zustand';
import type { LatLng } from '../lib/coordinates';

export type EditPanel =
  | { kind: 'add'; prefill?: { municipality_id: number; barangay_id: number } }
  | { kind: 'edit'; id: string }
  | { kind: 'status'; id: string }
  | { kind: 'resolve'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'history'; id: string }
  | { kind: 'deleted' };

export interface PendingMove {
  recordId: string;
  version: number; // as it was when dragged
  to: LatLng;
}

interface EditUiState {
  panel: EditPanel | null;
  // The location being set in a form. It shows on the map as a draggable marker.
  draft: LatLng | null;
  // Set when the location came from somewhere other than the map, so the map should go to it.
  draftNonce: number;
  picking: boolean; // the next map click sets the draft
  pendingMove: PendingMove | null;
  moveNonce: number; // a finished drag, so markers can be rebuilt where they belong
  photoId: string | null;
  notice: string | null;

  openPanel(panel: EditPanel, options?: { draft?: LatLng | null; picking?: boolean }): void;
  closePanel(): void;
  setDraft(point: LatLng | null, options?: { goTo?: boolean }): void;
  setPicking(picking: boolean): void;
  startMove(move: PendingMove): void;
  finishMove(): void;
  showPhoto(id: string | null): void;
  setNotice(notice: string | null): void;
}

export const useEditUi = create<EditUiState>((set) => ({
  panel: null,
  draft: null,
  draftNonce: 0,
  picking: false,
  pendingMove: null,
  moveNonce: 0,
  photoId: null,
  notice: null,

  openPanel: (panel, options) =>
    set((state) => ({
      panel,
      draft: options?.draft ?? null,
      picking: options?.picking ?? false,
      moveNonce: state.pendingMove ? state.moveNonce + 1 : state.moveNonce,
      pendingMove: null,
    })),
  closePanel: () => set({ panel: null, draft: null, picking: false }),
  setDraft: (draft, options) =>
    set((state) => ({ draft, picking: false, draftNonce: options?.goTo ? state.draftNonce + 1 : state.draftNonce })),
  setPicking: (picking) => set({ picking }),
  startMove: (pendingMove) => set({ pendingMove }),
  finishMove: () => set((state) => ({ pendingMove: null, moveNonce: state.moveNonce + 1 })),
  showPhoto: (photoId) => set({ photoId }),
  setNotice: (notice) => set({ notice }),
}));

// Forms hold unsaved work, so the map shouldn't navigate away from under them.
export function isFormOpen(panel: EditPanel | null): boolean {
  return panel !== null && panel.kind !== 'history' && panel.kind !== 'deleted';
}
