import { useEffect, useState, type FormEvent } from 'react';
import { ConflictError } from '../data/store';
import type { Intervention, MapData } from '../data/types';
import { ChangeHistory } from './ChangeHistory';
import { manilaDate } from '../lib/dates';
import { encodedPlace, isOnMap, recordName } from '../lib/display';
import { openRecordPanel } from './open-panel';
import { useEditUi } from '../state/edit-ui';
import { useMapUi } from '../state/map-ui';
import { useConnection } from '../state/connection';
import { useStore } from '../state/store-context';
import { PanelFrame, TextField } from './FormParts';

export function DeleteForm({ data, record: latest }: { data: MapData; record: Intervention }) {
  // As it was when opened, so a change made elsewhere is noticed before deleting.
  const [record] = useState(latest);
  const { store } = useStore();
  const closePanel = useEditUi((state) => state.closePanel);
  const setNotice = useEditUi((state) => state.setNotice);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      const note = reason.trim() ? { kind: 'delete' as const, reason: reason.trim() } : { kind: 'delete' as const };
      await store.softDeleteIntervention(record.id, record.version, note);
      closePanel();
      setNotice('Record deleted. It can be restored from Deleted records in the layers panel.');
    } catch (error) {
      setFailure(
        error instanceof ConflictError
          ? 'Someone else just changed this record. Close this panel and check it again before deleting.'
          : `Could not delete: ${(error as Error).message}`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <PanelFrame title="Delete record" subtitle={recordName(record, data)} onClose={closePanel}>
      <form className="edit-form" onSubmit={submit} aria-label="Delete record">
        <p>
          {[record.beneficiary, record.year_funded, encodedPlace(record, data)].filter(Boolean).join(' · ')}
        </p>
        <p className="field-hint">The record leaves the map and all counts, but it isn't erased. It can be restored at any time.</p>
        <TextField label="Reason (optional)" multiline value={reason} onChange={setReason} />
        {failure && (
          <p className="field-error" role="alert">
            {failure}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="danger-button" disabled={saving}>
            Delete record
          </button>
          <button type="button" className="secondary-button" onClick={closePanel}>
            Cancel
          </button>
        </div>
      </form>
    </PanelFrame>
  );
}

export function DeletedPanel({ data }: { data: MapData }) {
  const { store } = useStore();
  const closePanel = useEditUi((state) => state.closePanel);
  const setNotice = useEditUi((state) => state.setNotice);
  const zoomToRecord = useMapUi((state) => state.zoomToRecord);
  const [failure, setFailure] = useState<string | null>(null);

  const records = data.interventions
    .filter((r) => r.deleted_at !== null)
    .sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? ''));

  const restore = async (record: Intervention) => {
    setFailure(null);
    try {
      const saved = await store.restoreIntervention(record.id, record.version, { kind: 'restore' });
      setNotice('Record restored.');
      if (isOnMap(saved)) zoomToRecord(saved.id);
    } catch (error) {
      setFailure(`Could not restore: ${(error as Error).message}`);
    }
  };

  return (
    <PanelFrame title="Deleted records" subtitle={`${records.length} deleted`} onClose={closePanel}>
      {records.length === 0 ? (
        <p className="empty-note">No deleted records.</p>
      ) : (
        <ul className="record-list">
          {records.map((record) => (
            <li key={record.id} className="record-row">
              <span className="record-name">{recordName(record, data)}</span>
              <div className="record-meta">{[record.beneficiary, record.year_funded, encodedPlace(record, data)].filter(Boolean).join(' · ')}</div>
              <div className="record-meta">Deleted {record.deleted_at && manilaDate(record.deleted_at)}</div>
              <div className="form-actions">
                <button type="button" className="secondary-button" onClick={() => void restore(record)}>
                  Restore
                </button>
                <button type="button" className="secondary-button" onClick={() => openRecordPanel('history', record)}>
                  History
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {failure && (
        <p className="field-error" role="alert">
          {failure}
        </p>
      )}
    </PanelFrame>
  );
}

export function HistoryPanel({ data, record }: { data: MapData; record: Intervention }) {
  const closePanel = useEditUi((state) => state.closePanel);
  return (
    <PanelFrame title="Change history" subtitle={recordName(record, data)} onClose={closePanel}>
      <ChangeHistory data={data} record={record} />
    </PanelFrame>
  );
}

export function PhotoDialog() {
  const { store } = useStore();
  const photoId = useEditUi((state) => state.photoId);
  const showPhoto = useEditUi((state) => state.showPhoto);
  const [url, setUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!photoId) return;
    let cancelled = false;
    let created: string | null = null;
    setFailure(null);
    store
      .photoUrl(photoId)
      .then((found) => {
        if (cancelled) {
          if (found) URL.revokeObjectURL(found);
          return;
        }
        created = found;
        setUrl(found);
        if (!found) setFailure('This photo could not be found.');
      })
      .catch((error: Error) => {
        if (!cancelled) setFailure(error.message);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [photoId, store]);

  useEffect(() => {
    if (!photoId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') showPhoto(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [photoId, showPhoto]);

  if (!photoId) return null;
  return (
    <div className="photo-dialog" role="dialog" aria-modal="true" aria-label="Status photo" onClick={() => showPhoto(null)}>
      <button type="button" className="close-button" aria-label="Close photo" autoFocus onClick={() => showPhoto(null)}>
        ×
      </button>
      {url ? <img src={url} alt="Taken with this status update" /> : <p>{failure ?? 'Loading…'}</p>}
    </div>
  );
}

const RECONNECT_GRACE_MS = 5000;

// A map that has quietly stopped updating is worse than one that says so, especially on a phone
// moving in and out of signal. A short drop isn't worth interrupting anyone for.
export function ConnectionNotice() {
  const live = useConnection((state) => state.live);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (live) {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), RECONNECT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [live]);

  if (!show) return null;
  return (
    <div className="connection-notice" role="status">
      Live updates paused. Reconnecting… Changes by others may not show until then.
    </div>
  );
}

export function Notice() {
  const notice = useEditUi((state) => state.notice);
  const setNotice = useEditUi((state) => state.setNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  return (
    <div className="edit-notice-area" role="status">
      {notice && <div className="edit-notice">{notice}</div>}
    </div>
  );
}
