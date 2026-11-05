import { useEffect, useState } from 'react';
import { createLocalStore } from '../data/local-store';
import type { MapData } from '../data/types';

export interface Boundaries {
  province: GeoJSON.FeatureCollection;
  municipalities: GeoJSON.FeatureCollection;
  barangays: GeoJSON.FeatureCollection;
}

export type MapDataState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; data: MapData; boundaries: Boundaries };

async function fetchBoundary(name: string): Promise<GeoJSON.FeatureCollection> {
  const response = await fetch(`/boundaries/${name}.geojson`);
  if (!response.ok) throw new Error(`Could not load the ${name} boundaries (${response.status})`);
  return (await response.json()) as GeoJSON.FeatureCollection;
}

export function useMapData(): MapDataState {
  const [state, setState] = useState<MapDataState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      createLocalStore().load(),
      fetchBoundary('province'),
      fetchBoundary('municipalities'),
      fetchBoundary('barangays'),
    ])
      .then(([data, province, municipalities, barangays]) => {
        if (!cancelled) setState({ status: 'ready', data, boundaries: { province, municipalities, barangays } });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ status: 'error', error });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
