import type { Intervention } from '../data/types';
import { pointOf } from '../lib/qa';
import { useEditUi } from '../state/edit-ui';
import { useMapUi } from '../state/map-ui';

export type RecordPanelKind = 'edit' | 'status' | 'resolve' | 'delete' | 'history';

export function openRecordPanel(kind: RecordPanelKind, record: Intervention) {
  useMapUi.getState().setPanelOpen(false);
  const needsLocation = kind === 'edit' || kind === 'resolve';
  useEditUi.getState().openPanel({ kind, id: record.id }, { draft: needsLocation ? pointOf(record) : null });
}
