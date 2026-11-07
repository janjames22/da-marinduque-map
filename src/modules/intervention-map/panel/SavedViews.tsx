import { useState, type FormEvent } from 'react';
import { ValidationError } from '../data/store';
import type { MapData, SavedView } from '../data/types';
import { captureView, readViewConfig, viewsInOrder } from '../lib/saved-views';
import { useExportUi } from '../state/export-ui';
import { useMapUi } from '../state/map-ui';
import { usePermissions, useStore } from '../state/store-context';

export function SavedViews({ data }: { data: MapData }) {
  const { store } = useStore();
  const { canManageSharedViews } = usePermissions();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const currentConfig = () => captureView(useMapUi.getState(), useExportUi.getState().mapExtent);

  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      await work();
      setNotice(done);
      return true;
    } catch (error) {
      setFailure(error instanceof ValidationError ? error.message : (error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const open = (view: SavedView) => {
    setFailure(null);
    setNotice(`Opened "${view.name}".`);
    useMapUi.getState().applyView(readViewConfig(view.config, data));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(() => store.saveView(null, { name, config: currentConfig(), is_shared: shared }), `Saved "${name.trim()}".`);
    if (saved) {
      setAdding(false);
      setName('');
      setShared(false);
    }
  };

  const ownerName = (view: SavedView) => data.members.find((member) => member.id === view.owner_id)?.full_name ?? 'someone else';

  return (
    <section aria-label="Saved views">
      <h2 className="section-title">Saved views</h2>
      {data.savedViews.length === 0 && <p className="field-hint">Layers, filters, colors, basemap and map position, ready to reopen.</p>}
      <ul className="saved-views">
        {viewsInOrder(data.savedViews).map((view) => {
          const mine = view.owner_id === store.user.id;
          return (
            <li key={view.id} data-view={view.name}>
              <button type="button" className="link-button saved-view-name" onClick={() => open(view)}>
                {view.name}
              </button>
              <div className="field-hint">
                {view.is_shared ? (mine ? 'Shared by you' : `Shared by ${ownerName(view)}`) : 'Personal'}
                {view.is_default && ' · Opens by default'}
              </div>
              <div className="saved-view-actions">
                {mine && (
                  <button type="button" className="link-button" disabled={busy} onClick={() => void run(() => store.saveView(view.id, { config: currentConfig() }), `Updated "${view.name}".`)}>
                    Update<span className="visually-hidden"> {view.name} to what's showing now</span>
                  </button>
                )}
                {mine && (
                  <button type="button" className="link-button" disabled={busy} onClick={() => void run(() => store.saveView(view.id, { is_shared: !view.is_shared }), view.is_shared ? `"${view.name}" is personal now.` : `"${view.name}" is shared with everyone.`)}>
                    {view.is_shared ? 'Make personal' : 'Share'}
                    <span className="visually-hidden"> {view.name}</span>
                  </button>
                )}
                {canManageSharedViews && view.is_shared && (
                  <button type="button" className="link-button" disabled={busy} onClick={() => void run(() => store.setDefaultView(view.is_default ? null : view.id), view.is_default ? 'The map now opens as usual.' : `The map now opens on "${view.name}".`)}>
                    {view.is_default ? 'Stop opening on this' : 'Open on this'}
                    <span className="visually-hidden"> {view.name}</span>
                  </button>
                )}
                {(mine || (canManageSharedViews && view.is_shared)) && (
                  <button
                    type="button"
                    className="link-button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Delete the view "${view.name}"?`)) void run(() => store.deleteView(view.id), `Deleted "${view.name}".`);
                    }}
                  >
                    Delete<span className="visually-hidden"> {view.name}</span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {adding ? (
        <form className="saved-view-form" aria-label="Save this view" onSubmit={(event) => void save(event)}>
          <label className="field">
            <span>Name</span>
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="choice">
            <input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} />
            Share with everyone
          </label>
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={busy}>
              Save view
            </button>
            <button type="button" className="secondary-button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="secondary-button" onClick={() => setAdding(true)}>
          Save this view
        </button>
      )}
      {failure && (
        <p className="field-error" role="alert">
          {failure}
        </p>
      )}
      {notice && (
        <p className="field-hint" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
