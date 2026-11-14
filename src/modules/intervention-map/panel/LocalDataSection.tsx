import { useEffect, useState } from 'react';
import { isDemo } from '../data/app-config';
import type { MapData } from '../data/types';
import { MAP_PATH } from '../lib/map-paths';
import { useEditUi } from '../state/edit-ui';
import { useStore } from '../state/store-context';

// Local mode keeps changes in this browser only, so people need to be able to see that, and to
// start again from the seed once it has been rebuilt. The demo site works the same way, in words for
// its visitors.
const DEMO = isDemo;

export function LocalDataSection({ data }: { data: MapData }) {
  const { store } = useStore();
  const [changes, setChanges] = useState(0);
  const local = store.local;

  useEffect(() => {
    let cancelled = false;
    void local?.changeCount().then((count) => {
      if (!cancelled) setChanges(count);
    });
    return () => {
      cancelled = true;
    };
  }, [local, data]);

  if (!local) return null;
  const newerSeed = local.newerSeedAvailable();

  const reset = async () => {
    const message = DEMO
      ? `Discard your ${changes === 1 ? 'change' : `${changes} changes`} and go back to the demo's starting data? This can't be undone.`
      : `Discard ${changes} local ${changes === 1 ? 'change' : 'changes'} and go back to the seed data? This can't be undone.`;
    if (!window.confirm(message)) return;
    useEditUi.getState().closePanel();
    await local.reset();
    // Back to the map, where the button is. / is Home.
    window.location.assign(MAP_PATH);
  };

  return (
    <section>
      <h2 className="section-title">{DEMO ? 'Demo data' : 'Local data'}</h2>
      <p className="panel-note" data-testid="local-changes">
        {changes === 0 ? 'No changes yet.' : `${changes} ${changes === 1 ? 'change' : 'changes'} saved in this browser only.`}
      </p>
      {newerSeed && (
        <p className="record-warning" role="status">
          {DEMO
            ? 'The demo has been updated. Your changes are still here, and the new version loads once you discard them.'
            : "The seed data was rebuilt. Your local changes are still here, and the new seed isn't loaded until you discard them."}
        </p>
      )}
      {(changes > 0 || newerSeed) && (
        <button type="button" className="link-button" onClick={() => void reset()}>
          {DEMO ? 'Discard my changes' : 'Discard local changes'}
        </button>
      )}
    </section>
  );
}
