import { useState } from 'react';
import { ConflictError, type InterventionPatch } from '../data/store';
import type { MapData } from '../data/types';
import { formatPoint } from '../lib/coordinates';
import { recordName } from '../lib/display';
import { editWarnings } from '../lib/qa';
import { useEditUi } from '../state/edit-ui';
import { useStore } from '../state/store-context';

// A dragged marker doesn't move until this is confirmed, so a slip of the finger changes nothing.
export function MoveConfirm({ data }: { data: MapData }) {
  const { store, places } = useStore();
  const pendingMove = useEditUi((state) => state.pendingMove);
  const finishMove = useEditUi((state) => state.finishMove);
  const setNotice = useEditUi((state) => state.setNotice);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!pendingMove) return null;
  const record = data.interventions.find((r) => r.id === pendingMove.recordId);
  if (!record) return null;

  const result = editWarnings(
    {
      id: record.id,
      point: pendingMove.to,
      municipality_id: record.municipality_id,
      barangay_id: record.barangay_id,
      barangay_raw: record.barangay_raw,
      qa_flags: [],
      deleted_at: null,
      // Moving doesn't change who or what it is, so this can't make it a new duplicate.
      category_id: null,
      beneficiary: null,
      year_funded: null,
    },
    data.interventions,
    places,
    data,
  );
  const { plotted } = result;
  const canSetBarangay = plotted && (plotted.barangayId !== record.barangay_id || plotted.municipalityId !== record.municipality_id);

  const confirm = async (patch: InterventionPatch) => {
    setSaving(true);
    setFailure(null);
    try {
      await store.updateIntervention(record.id, pendingMove.version, { point: pendingMove.to, ...patch }, { kind: 'move' });
      finishMove();
      setNotice('Marker moved.');
    } catch (error) {
      setFailure(
        error instanceof ConflictError
          ? 'Someone else just changed this record. Cancel, then try again.'
          : `Could not move: ${(error as Error).message}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setFailure(null);
    finishMove();
  };

  return (
    <div className="move-confirm" role="dialog" aria-label="Confirm move">
      <p>
        <strong>Move {recordName(record, data)} here?</strong>
      </p>
      <p className="record-meta">
        {formatPoint(pendingMove.to)}
        {plotted && ` · in ${plotted.label}`}
      </p>
      {result.warnings.length > 0 && (
        <ul className="edit-warnings-compact" aria-label="Warnings">
          {result.warnings.map((warning) => (
            <li key={warning.code} data-warning={warning.code}>
              {warning.message}
            </li>
          ))}
        </ul>
      )}
      {failure && (
        <p className="field-error" role="alert">
          {failure}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="primary-button" disabled={saving} onClick={() => void confirm({})}>
          Confirm move
        </button>
        <button type="button" className="secondary-button" disabled={saving} onClick={cancel}>
          Cancel
        </button>
        {canSetBarangay && (
          <button
            type="button"
            className="secondary-button"
            disabled={saving}
            onClick={() => void confirm({ municipality_id: plotted.municipalityId, barangay_id: plotted.barangayId })}
          >
            Move and set barangay to {plotted.label}
          </button>
        )}
      </div>
    </div>
  );
}
