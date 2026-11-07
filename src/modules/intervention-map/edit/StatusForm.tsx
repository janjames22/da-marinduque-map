import { useState, type FormEvent } from 'react';
import { ConflictError, ValidationError } from '../data/store';
import type { Intervention, MapData } from '../data/types';
import { manilaToday } from '../lib/dates';
import { statusChoices } from '../lib/form-values';
import { isOnMap, recordName, statusDateLabel, statusTimeline } from '../lib/display';
import { PHOTO_ACCEPT, photoProblem } from '../lib/photo-meta';
import { validateStatus, type FieldErrors } from '../lib/validation';
import { useEditUi } from '../state/edit-ui';
import { useMapUi } from '../state/map-ui';
import { useStore } from '../state/store-context';
import { ErrorText, PanelFrame, SelectField, TextField } from './FormParts';

export function StatusForm({ data, record }: { data: MapData; record: Intervention }) {
  const { store } = useStore();
  const closePanel = useEditUi((state) => state.closePanel);
  const setNotice = useEditUi((state) => state.setNotice);
  const zoomToRecord = useMapUi((state) => state.zoomToRecord);

  const [statusId, setStatusId] = useState('');
  const [date, setDate] = useState(manilaToday());
  const [remarks, setRemarks] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const options = statusChoices(data, record.intervention_type_id);

  const current = statusTimeline(record.id, data.statusHistory).at(-1);
  const currentName = data.statuses.find((s) => s.id === record.status_id)?.name;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const status = { status_id: statusId === '' ? null : Number(statusId), status_date: date };
    const found = validateStatus(status, record.intervention_type_id, data.typeStatuses);
    if (photo) {
      const problem = photoProblem(photo);
      if (problem) found.photo = problem;
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    setErrors({});
    setFailure(null);
    setSaving(true);
    try {
      await store.addStatus(
        record.id,
        { status_id: Number(statusId), status_date: date, remarks: remarks.trim() || null, photo },
        { kind: 'status' },
      );
      closePanel();
      setNotice('Status updated.');
      if (isOnMap(record)) zoomToRecord(record.id);
    } catch (error) {
      if (error instanceof ValidationError) setErrors(error.fields);
      else if (error instanceof ConflictError) setFailure('This record no longer exists.');
      else setFailure(`Could not save: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelFrame title="Update status" subtitle={recordName(record, data)} onClose={closePanel}>
      <form className="edit-form" onSubmit={submit} noValidate aria-label="Update status">
        {current && currentName && (
          <p className="field-hint">
            Now: {currentName}, {statusDateLabel(current)}
          </p>
        )}
        <SelectField
          label="New status"
          required
          value={statusId}
          placeholder="Choose"
          options={options}
          onChange={setStatusId}
          error={errors.status_id}
        />
        <TextField label="Date of this status" required type="date" value={date} onChange={setDate} error={errors.status_date} />
        <TextField label="Remarks" multiline value={remarks} onChange={setRemarks} />
        <div className="form-field">
          <label htmlFor="status-photo">Photo (optional)</label>
          <input
            id="status-photo"
            type="file"
            accept={PHOTO_ACCEPT}
            onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
          />
          <ErrorText id="status-photo-error" message={errors.photo} />
        </div>
        <p className="field-hint">This adds to the record's history. Earlier statuses are kept.</p>
        {failure && (
          <p className="field-error" role="alert">
            {failure}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={saving}>
            Save status
          </button>
          <button type="button" className="secondary-button" onClick={closePanel}>
            Cancel
          </button>
        </div>
      </form>
    </PanelFrame>
  );
}
