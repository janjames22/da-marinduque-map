import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from './leaflet-setup';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import type { Intervention, MapData } from '../data/types';
import { roundPoint } from '../lib/coordinates';
import { copyText } from '../lib/copy-text';
import { isOnMap, popupHtml, recordColor, recordIcon, whiteIconSvg, type PopupAction } from '../lib/display';
import { openRecordPanel } from '../edit/open-panel';
import { useEditUi } from '../state/edit-ui';
import { useMapUi } from '../state/map-ui';
import { usePermissions } from '../state/store-context';

const FOCUS_WAIT_MS = 3000;

// Icons load through <img>, so even an uploaded icon couldn't run a script, and uploads are checked too.
function iconDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(whiteIconSvg(svg))}`;
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

interface ShownMarker {
  marker: L.Marker;
  key: string; // what the marker looks like and where it is
  // Waiting for its move to be confirmed. It sits on the map itself, as in the cluster it could be
  // swallowed by a neighbour, leaving the person nothing to look at while they decide.
  held: boolean;
}

function removeHeld(markers: Map<string, ShownMarker>) {
  for (const { marker, held } of markers.values()) {
    if (held) marker.remove();
  }
}

interface InterventionLayerProps {
  data: MapData;
  records: Intervention[];
}

export function InterventionLayer({ data, records }: InterventionLayerProps) {
  const map = useMap();
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const shown = useRef(new Map<string, ShownMarker>());
  const pendingFocus = useRef<{ id: string; until: number } | null>(null);
  const cancelFocus = useRef<() => void>(() => {});
  const focusRecord = useMapUi((state) => state.focusRecord);
  const moveNonce = useEditUi((state) => state.moveNonce);
  const pendingMove = useEditUi((state) => state.pendingMove);
  const lastMoveNonce = useRef(moveNonce);
  const permissions = usePermissions();

  // Popups are built when they open, and read the newest data from here.
  const latest = useRef(data);
  latest.current = data;
  const latestPermissions = useRef(permissions);
  latestPermissions.current = permissions;

  const iconFor = useMemo(() => {
    const cache = new Map<string, L.DivIcon>();
    return (record: Intervention) => {
      const color = recordColor(record, data);
      const icon = recordIcon(record, data);
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
      return { divIcon, key };
    };
  }, [data.types, data.programs, data.icons, data.categories]);

  useEffect(() => {
    const cluster = L.markerClusterGroup({
      iconCreateFunction: clusterIcon,
      showCoverageOnHover: false,
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
    }).addTo(map);
    clusterRef.current = cluster;
    const markers = shown.current;

    const container = map.getContainer();
    const markOpen = () => container.classList.add('popup-open');
    const markClosed = () => container.classList.remove('popup-open');
    map.on('popupopen', markOpen);
    map.on('popupclose', markClosed);

    return () => {
      map.off('popupopen', markOpen);
      map.off('popupclose', markClosed);
      removeHeld(markers);
      cluster.remove();
      clusterRef.current = null;
      markers.clear();
    };
  }, [map]);

  // Only markers that changed are replaced, so an edit elsewhere doesn't close the popup being read.
  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;
    const markers = shown.current;

    // A finished drag can leave the cluster library's own records wrong if the marker was
    // spiderfied, so everything is laid out afresh.
    if (moveNonce !== lastMoveNonce.current) {
      lastMoveNonce.current = moveNonce;
      removeHeld(markers);
      cluster.clearLayers();
      markers.clear();
    }

    const wanted = new Map<string, { record: Intervention; position: [number, number]; held: boolean; key: string }>();
    for (const record of records) {
      if (!isOnMap(record) || record.geojson?.type !== 'Point') continue;
      const [longitude, latitude] = record.geojson.coordinates;
      // A dragged marker stays where it was dropped until the move is confirmed or cancelled.
      const moving = pendingMove?.recordId === record.id ? pendingMove.to : null;
      const position: [number, number] = moving ? [moving.lat, moving.lng] : [latitude, longitude];
      wanted.set(record.id, { record, position, held: moving !== null, key: `${position.join()}|${moving ? 'held' : ''}|${iconFor(record).key}|${record.beneficiary ?? ''}` });
    }

    const stale: L.Marker[] = [];
    for (const [id, { marker, key, held }] of markers) {
      if (wanted.get(id)?.key !== key) {
        if (held) marker.remove();
        else stale.push(marker);
        markers.delete(id);
      }
    }
    cluster.removeLayers(stale);

    const added: L.Marker[] = [];
    for (const [id, { record, position, held, key }] of wanted) {
      if (markers.has(id)) continue;
      const marker = L.marker(position, {
        icon: iconFor(record).divIcon,
        title: record.beneficiary ?? '',
        draggable: permissions.canEdit,
        autoPan: true,
      });

      marker.bindPopup(
        () => {
          const current = latest.current.interventions.find((r) => r.id === id) ?? record;
          const element = document.createElement('div');
          element.innerHTML = popupHtml(current, latest.current, latestPermissions.current);
          element.addEventListener('click', (event) => void onPopupClick(event, current));
          return element;
        },
        // The top padding keeps a popup clear of the zoom buttons and the phone's layers button.
        { maxWidth: 320, autoPanPaddingTopLeft: [10, 64] },
      );
      marker.on('dragstart', () => marker.closePopup());
      marker.on('dragend', () => {
        const current = latest.current.interventions.find((r) => r.id === id) ?? record;
        useEditUi.getState().startMove({ recordId: id, version: current.version, to: roundPoint(marker.getLatLng()) });
      });

      markers.set(id, { marker, key, held });
      if (held) marker.addTo(map);
      else added.push(marker);
    }
    cluster.addLayers(added);

    // An open popup follows the data, such as a status added in another tab.
    for (const { marker } of markers.values()) {
      if (marker.isPopupOpen()) marker.getPopup()?.update();
    }

    tryFocus();
  }, [records, data, iconFor, moveNonce, pendingMove]);

  function tryFocus() {
    const pending = pendingFocus.current;
    const cluster = clusterRef.current;
    if (!pending || !cluster) return;
    if (Date.now() > pending.until) {
      pendingFocus.current = null;
      return;
    }
    const marker = shown.current.get(pending.id)?.marker;
    if (!marker) return; // the save hasn't reached the map yet
    pendingFocus.current = null;
    cancelFocus.current();
    cancelFocus.current = whenSettled(map, cluster, () => revealMarker(map, cluster, marker));
  }

  useEffect(() => {
    if (!focusRecord) return;
    pendingFocus.current = { id: focusRecord.id, until: Date.now() + FOCUS_WAIT_MS };
    tryFocus();
    return () => cancelFocus.current();
  }, [focusRecord, map]);

  return null;
}

async function onPopupClick(event: MouseEvent, record: Intervention) {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!button) return;
  const action = button.dataset.action as PopupAction;

  switch (action) {
    case 'copy-coordinates': {
      const copied = await copyText(button.dataset.coordinates ?? '');
      button.textContent = copied ? 'Copied' : 'Could not copy';
      setTimeout(() => {
        button.textContent = 'Copy coordinates';
      }, 2000);
      break;
    }
    case 'photo':
      useEditUi.getState().showPhoto(button.dataset.photoId ?? null);
      break;
    default:
      openRecordPanel(action, record);
  }
}
