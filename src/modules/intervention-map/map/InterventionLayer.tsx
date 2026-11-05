import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from './leaflet-setup';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import type { Intervention, MapData } from '../data/types';
import { isOnMap, popupHtml } from '../lib/display';
import { useMapUi } from '../state/map-ui';

const FALLBACK_COLOR = '#757575';

// Icons load through <img>, so scripts inside an icon's SVG can't run. Phase 5 adds uploads.
function iconDataUrl(svg: string): string {
  const white = svg.replace('<svg ', '<svg fill="white" color="white" ');
  return `data:image/svg+xml,${encodeURIComponent(white)}`;
}

function clusterIcon(cluster: L.MarkerCluster) {
  return L.divIcon({
    className: 'marker-cluster-count',
    html: `<span>${cluster.getChildCount()}</span>`,
    iconSize: [34, 34],
  });
}

// zoomToShowLayer waits for the map to move, which never happens for a marker that zooming can't
// separate from its cluster, so its callback would never run. Those are spiderfied directly.
function revealMarker(map: L.Map, cluster: L.MarkerClusterGroup, marker: L.Marker) {
  const open = () => marker.openPopup();
  const parent = cluster.getVisibleParent(marker);

  // Already showing, on its own or spiderfied. The popup pans itself into view.
  if (parent === marker) {
    open();
    return;
  }

  if (parent instanceof L.MarkerCluster) {
    const bounds = parent.getBounds();
    const samePoint = bounds.getNorthEast().equals(bounds.getSouthWest());
    if (samePoint || map.getZoom() >= map.getMaxZoom()) {
      map.setView(marker.getLatLng(), map.getZoom(), { animate: false });
      const visible = cluster.getVisibleParent(marker);
      if (visible instanceof L.MarkerCluster) {
        cluster.off('spiderfied'); // only the latest request should open a popup
        cluster.once('spiderfied', open);
        visible.spiderfy();
        return;
      }
    }
  }
  cluster.zoomToShowLayer(marker, open);
}

const SETTLE_POLL_MS = 50;
const SETTLE_MAX_TRIES = 60;

// The cluster library silently ignores a spiderfy during a zoom animation, so a record chosen
// while the map is still moving has to wait. Neither library has a public way to ask. Returns a
// function that cancels the wait.
function whenSettled(map: L.Map, cluster: L.MarkerClusterGroup, run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const attempt = (triesLeft: number) => {
    const busy =
      (map as unknown as { _animatingZoom?: boolean })._animatingZoom ||
      (cluster as unknown as { _inZoomAnimation?: number })._inZoomAnimation;
    if (busy && triesLeft > 0) timer = setTimeout(() => attempt(triesLeft - 1), SETTLE_POLL_MS);
    else run();
  };
  attempt(SETTLE_MAX_TRIES);
  return () => clearTimeout(timer);
}

interface InterventionLayerProps {
  data: MapData;
  records: Intervention[];
}

export function InterventionLayer({ data, records }: InterventionLayerProps) {
  const map = useMap();
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markerById = useRef(new Map<string, L.Marker>());
  const focusRecord = useMapUi((state) => state.focusRecord);

  const iconFor = useMemo(() => {
    const cache = new Map<string, L.DivIcon>();
    return (record: Intervention) => {
      const type = data.types.find((t) => t.id === record.intervention_type_id);
      const program = data.programs.find((p) => p.id === record.banner_program_id);
      const color = program?.color ?? type?.color ?? FALLBACK_COLOR;
      const icon = data.icons.find((i) => i.id === type?.icon_id);
      const key = `${color}-${icon?.id}`;

      let divIcon = cache.get(key);
      if (!divIcon) {
        const image = icon ? `<img src="${iconDataUrl(icon.image)}" alt="" />` : '';
        divIcon = L.divIcon({
          className: 'intervention-marker',
          html: `<span style="background:${color}">${image}</span>`,
          iconSize: [26, 26],
        });
        cache.set(key, divIcon);
      }
      return divIcon;
    };
  }, [data.types, data.programs, data.icons]);

  useEffect(() => {
    const cluster = L.markerClusterGroup({
      iconCreateFunction: clusterIcon,
      showCoverageOnHover: false,
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
    }).addTo(map);
    clusterRef.current = cluster;
    return () => {
      cluster.remove();
      clusterRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;

    cluster.clearLayers();
    markerById.current.clear();

    const markers: L.Marker[] = [];
    for (const record of records) {
      if (!isOnMap(record) || record.geojson?.type !== 'Point') continue;
      const [longitude, latitude] = record.geojson.coordinates;
      const marker = L.marker([latitude, longitude], { icon: iconFor(record), title: record.beneficiary ?? '' });
      // The top padding keeps a popup clear of the zoom buttons and the phone's layers button.
      marker.bindPopup(() => popupHtml(record, data), { maxWidth: 320, autoPanPaddingTopLeft: [10, 64] });
      markerById.current.set(record.id, marker);
      markers.push(marker);
    }
    cluster.addLayers(markers);
  }, [records, data, iconFor]);

  useEffect(() => {
    if (!focusRecord) return;
    const marker = markerById.current.get(focusRecord.id);
    const cluster = clusterRef.current;
    if (!marker || !cluster) return;
    return whenSettled(map, cluster, () => revealMarker(map, cluster, marker));
  }, [focusRecord, map]);

  return null;
}
