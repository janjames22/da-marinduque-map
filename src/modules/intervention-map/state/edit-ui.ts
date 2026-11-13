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
  // A road's line being drawn or reshaped in a form, in order along it (Phase 16b). Null for none.
  draftLine: LatLng[] | null;
  // 'add': each map click adds a point at the end. 'shape': points can be dragged, and a bend made
  // between two. Null while the form isn't drawing.
  lineMode: LineMode | null;
  // The point a tap picked, for Remove this point.
  selectedPoint: number | null;

  openPanel(panel: EditPanel, options?: { draft?: LatLng | null; picking?: boolean; draftLine?: LatLng[] | null }): void;
  closePanel(): void;
  setDraft(point: LatLng | null, options?: { goTo?: boolean }): void;
  setPicking(picking: boolean): void;
  startMove(move: PendingMove): void;
  finishMove(): void;
  showPhoto(id: string | null): void;
  setNotice(notice: string | null): void;
  setDraftLine(line: LatLng[] | null, mode?: LineMode | null): void;
  setLineMode(mode: LineMode | null): void;
  addLinePoint(point: LatLng): void;
  moveLinePoint(index: number, point: LatLng): void;
  insertLinePoint(index: number, point: LatLng): void;
  removeLinePoint(index: number): void;
  selectLinePoint(index: number | null): void;
}

export type LineMode = 'add' | 'shape';

export const useEditUi = create<EditUiState>((set) => ({
  panel: null,
  draft: null,
  draftNonce: 0,
  picking: false,
  pendingMove: null,
  moveNonce: 0,
  photoId: null,
  notice: null,
  draftLine: null,
  lineMode: null,
  selectedPoint: null,

  openPanel: (panel, options) =>
    set((state) => ({
      panel,
      draft: options?.draft ?? null,
      picking: options?.picking ?? false,
      draftLine: options?.draftLine ?? null,
      // A road's line opens ready to reshape.
      lineMode: options?.draftLine ? 'shape' : null,
      selectedPoint: null,
      moveNonce: state.pendingMove ? state.moveNonce + 1 : state.moveNonce,
      pendingMove: null,
    })),
  closePanel: () => set({ panel: null, draft: null, picking: false, draftLine: null, lineMode: null, selectedPoint: null }),
  setDraft: (draft, options) =>
    set((state) => ({ draft, picking: false, draftNonce: options?.goTo ? state.draftNonce + 1 : state.draftNonce })),
  setPicking: (picking) => set({ picking }),
  startMove: (pendingMove) => set({ pendingMove }),
  finishMove: () => set((state) => ({ pendingMove: null, moveNonce: state.moveNonce + 1 })),
  showPhoto: (photoId) => set({ photoId }),
  setNotice: (notice) => set({ notice }),
  setDraftLine: (draftLine, mode) => set({ draftLine, lineMode: mode === undefined ? (draftLine ? 'shape' : null) : mode, selectedPoint: null, picking: false }),
  setLineMode: (lineMode) => set({ lineMode, selectedPoint: null, picking: false }),
  addLinePoint: (point) => set((state) => ({ draftLine: [...(state.draftLine ?? []), point], selectedPoint: null })),
  moveLinePoint: (index, point) => set((state) => ({ draftLine: (state.draftLine ?? []).map((at, i) => (i === index ? point : at)) })),
  insertLinePoint: (index, point) =>
    set((state) => {
      const line = [...(state.draftLine ?? [])];
      line.splice(index, 0, point);
      return { draftLine: line, selectedPoint: index };
    }),
  removeLinePoint: (index) =>
    set((state) => {
      const line = (state.draftLine ?? []).filter((_, i) => i !== index);
      return { draftLine: line.length > 0 ? line : null, selectedPoint: null, lineMode: line.length > 0 ? state.lineMode : null };
    }),
  selectLinePoint: (selectedPoint) => set({ selectedPoint }),
}));

// Forms hold unsaved work, so the map shouldn't navigate away from under them.
export function isFormOpen(panel: EditPanel | null): boolean {
  return panel !== null && panel.kind !== 'history' && panel.kind !== 'deleted';
}
