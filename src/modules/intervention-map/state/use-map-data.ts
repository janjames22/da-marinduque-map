import { useCallback, useEffect, useMemo, useState } from 'react';
import { createStore } from '../data/create-store';
import type { DataStore } from '../data/store';
import type { AppUser, MapData } from '../data/types';
import { buildPlaceIndex, type PlaceIndex } from '../lib/qa';
import { useConnection } from './connection';

export interface Boundaries {
  province: GeoJSON.FeatureCollection;
  municipalities: GeoJSON.FeatureCollection;
  barangays: GeoJSON.FeatureCollection;
}

export type MapDataState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; data: MapData; boundaries: Boundaries; store: DataStore; places: PlaceIndex };

async function fetchBoundary(name: string): Promise<GeoJSON.FeatureCollection> {
  const response = await fetch(`/boundaries/${name}.geojson`);
  if (!response.ok) throw new Error(`Could not load the ${name} boundaries (${response.status})`);
  return (await response.json()) as GeoJSON.FeatureCollection;
}

// Each reload builds new objects. Keeping the old ones for anything unchanged stops the map and
// panels redoing work, or losing their place, when one record changes.
function shareUnchanged(previous: MapData | null, next: MapData): MapData {
  if (!previous) return next;
  const merged = { ...next } as Record<keyof MapData, unknown>;
  for (const key of Object.keys(next) as (keyof MapData)[]) {
    if (JSON.stringify(previous[key]) === JSON.stringify(next[key])) merged[key] = previous[key];
  }
  return merged as MapData;
}

// One load per signed-in person, shared by every page. Before Phase 15a each page loaded the
// boundaries and every table again as it opened, which is what made moving between pages slow.
// Live updates keep the shared copy current while the person moves around.
interface Session {
  user: AppUser;
  state: MapDataState;
  listeners: Set<(state: MapDataState) => void>;
  stop(): void;
}

let session: Session | null = null;

function openSession(user: AppUser, setConnection: (live: boolean) => void): Session {
  // The same person keeps their session. A new sign-in, or a failed load, starts again.
  if (session && session.user === user && session.state.status !== 'error') return session;
  session?.stop();

  let cancelled = false;
  let unsubscribe = () => {};
  let stopWatching = () => {};
  const current: Session = {
    user,
    state: { status: 'loading' },
    listeners: new Set(),
    stop: () => {
      cancelled = true;
      unsubscribe();
      stopWatching();
    },
  };
  const publish = (next: MapDataState) => {
    current.state = next;
    for (const listener of current.listeners) listener(next);
  };

  (async () => {
    const [province, municipalities, barangays] = await Promise.all([
      fetchBoundary('province'),
      fetchBoundary('municipalities'),
      fetchBoundary('barangays'),
    ]);
    const store = await createStore({ boundaries: { barangays, municipalities }, user });
    const data = await store.load();
    if (cancelled) return;

    setConnection(true);
    const places = buildPlaceIndex({ barangays, municipalities }, data);
    const boundaries = { province, municipalities, barangays };
    publish({ status: 'ready', data, boundaries, store, places });

    // Only the latest reload may land, so an older, slower one can't overwrite it.
    let latestLoad = 0;
    unsubscribe = store.subscribe(() => {
      const thisLoad = ++latestLoad;
      store
        .load()
        .then((next) => {
          if (cancelled || thisLoad !== latestLoad) return;
          const ready = current.state;
          if (ready.status === 'ready') publish({ ...ready, data: shareUnchanged(ready.data, next) });
        })
        // What's on screen stays until a later reload works. The connection notice explains why.
        .catch(() => {});
    });
    stopWatching = store.watchConnection?.(setConnection) ?? stopWatching;
  })().catch((error: Error) => {
    if (!cancelled) publish({ status: 'error', error });
  });

  session = current;
  return current;
}

// A page that could not load offers to try again, which starts a fresh load.
export type MapDataView = Exclude<MapDataState, { status: 'error' }> | { status: 'error'; error: Error; retry(): void };

export function useMapData(user: AppUser): MapDataView {
  const setConnection = useConnection((current) => current.setLive);
  // A page opened after the first has the data at once, with no "Loading…".
  const [state, setState] = useState<MapDataState>(() => openSession(user, setConnection).state);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // A failed load isn't kept, so this starts again after a retry.
    const current = openSession(user, setConnection);
    current.listeners.add(setState);
    setState(current.state);
    return () => {
      current.listeners.delete(setState);
    };
  }, [user, setConnection, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return useMemo(() => (state.status === 'error' ? { ...state, retry } : state), [state, retry]);
}

// On signing in, start the load straight away, so it runs while a page's code is still arriving
// rather than after it. The page then picks up the same load.
export function startMapData(user: AppUser) {
  openSession(user, useConnection.getState().setLive);
}

// Calls back once this person's data has loaded, or failed to, so work that can wait, such as fetching
// other pages' code, doesn't compete with the first page. Returns a function that cancels it.
export function afterMapData(user: AppUser, callback: () => void): () => void {
  let done = false;
  const current = openSession(user, useConnection.getState().setLive);
  const listener = (state: MapDataState) => {
    if (done || state.status === 'loading') return;
    done = true;
    current.listeners.delete(listener);
    callback();
  };
  current.listeners.add(listener);
  listener(current.state);
  return () => {
    done = true;
    current.listeners.delete(listener);
  };
}

// On signing out: stop the live updates and forget the data, so the next person starts fresh.
export function closeMapDataSession(user: AppUser) {
  if (session?.user !== user) return; // someone newer already has it
  session.stop();
  session = null;
}
