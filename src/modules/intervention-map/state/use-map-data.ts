import { useEffect, useState } from 'react';
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

export function useMapData(user: AppUser): MapDataState {
  const [state, setState] = useState<MapDataState>({ status: 'loading' });
  const setConnection = useConnection((current) => current.setLive);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    let stopWatching = () => {};

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
      setState({ status: 'ready', data, boundaries, store, places });

      // Only the latest reload may land, so an older, slower one can't overwrite it.
      let latestLoad = 0;
      unsubscribe = store.subscribe(() => {
        const thisLoad = ++latestLoad;
        store
          .load()
          .then((next) => {
            if (cancelled || thisLoad !== latestLoad) return;
            setState((current) =>
              current.status === 'ready' ? { ...current, data: shareUnchanged(current.data, next) } : current,
            );
          })
          // What's on screen stays until a later reload works. The connection notice explains why.
          .catch(() => {});
      });
      stopWatching = store.watchConnection?.(setConnection) ?? stopWatching;
    })().catch((error: Error) => {
      if (!cancelled) setState({ status: 'error', error });
    });

    return () => {
      cancelled = true;
      unsubscribe();
      stopWatching();
    };
  }, [user, setConnection]);

  return state;
}
