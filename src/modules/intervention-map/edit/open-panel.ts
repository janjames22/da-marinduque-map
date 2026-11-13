import type { Intervention } from '../data/types';
import { linePositionsOf, pointOf } from '../lib/qa';
import { useEditUi } from '../state/edit-ui';
import { useMapUi } from '../state/map-ui';

export type RecordPanelKind = 'edit' | 'status' | 'resolve' | 'delete' | 'history';

export function openRecordPanel(kind: RecordPanelKind, record: Intervention) {
  useMapUi.getState().setPanelOpen(false);
  const needsLocation = kind === 'edit' || kind === 'resolve';
  // A road's Edit form opens with its line ready to reshape (Phase 16b).
  const line = kind === 'edit' ? linePositionsOf(record) : null;
  useEditUi.getState().openPanel(
    { kind, id: record.id },
    { draft: needsLocation ? pointOf(record) : null, draftLine: line ? line.map(([lng, lat]) => ({ lat, lng })) : null },
  );
}
