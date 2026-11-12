import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import L from './leaflet-setup';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import type { Intervention, MapData } from '../data/types';
import { roundPoint } from '../lib/coordinates';
import { copyText } from '../lib/copy-text';
import { isOnMap, popupHtml, recordIcon, whiteIconSvg, type PopupAction } from '../lib/display';
import { openRecordPanel } from '../edit/open-panel';
import { useEditUi } from '../state/edit-ui';
import { useMapUi } from '../state/map-ui';
import { usePermissions } from '../state/store-context';

const FOCUS_WAIT_MS = 3000;
// How long a record just shown keeps its popup through a reload. After that it's the person's.
const FOCUS_HOLD_MS = 2000;
// A popup folded away by a redraw is opened again after this long, this many times at most.
const REOPEN_DELAY_MS = 150;
const MAX_REOPENS = 3;

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
// Returns a function that cancels anything still waiting.
function revealMarker(map: L.Map, cluster: L.MarkerClusterGroup, marker: L.Marker): () => void {
  const open = () => marker.openPopup();
  const spiderfy = (visible: L.MarkerCluster) => {
    cluster.off('spiderfied'); // only the latest request should open a popup
    cluster.once('spiderfied', open);
    visible.spiderfy();
  };
  const parent = cluster.getVisibleParent(marker);

  // Already showing, on its own or spiderfied. The popup pans itself into view.
  if (parent === marker) {
    open();
    return () => {};
  }

  if (parent instanceof L.MarkerCluster) {
    const bounds = parent.getBounds();
    const samePoint = bounds.getNorthEast().equals(bounds.getSouthWest());
    if (samePoint || map.getZoom() >= map.getMaxZoom()) {
      map.setView(marker.getLatLng(), map.getZoom(), { animate: false });
      const visible = cluster.getVisibleParent(marker);
      if (visible instanceof L.MarkerCluster) {
        spiderfy(visible);
        return () => {};
      }
    }
  }

  // A marker on the same spot as another, seen from further out. Zooming in step by step can stall
  // before the two separate, such as while the map is still settling after it first opens, so go
  // straight to full zoom there and spread them out.
  const point = marker.getLatLng();
  const sharesItsPoint = cluster.getLayers().some((other) => other !== marker && other instanceof L.Marker && other.getLatLng().equals(point));
  if (sharesItsPoint) {
    map.setView(point, map.getMaxZoom(), { animate: false });
    return whenSettled(map, cluster, () => {
      const visible = cluster.getVisibleParent(marker);
      if (visible === marker) open();
      else if (visible instanceof L.MarkerCluster) spiderfy(visible);
    });
  }
  cluster.zoomToShowLayer(marker, open);
  return () => {};
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
  colorOf(record: Intervention): string;
}

export function InterventionLayer({ data, records, colorOf }: InterventionLayerProps) {
  const map = useMap();
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const shown = useRef(new Map<string, ShownMarker>());
  const pendingFocus = useRef<{ id: string; until: number; release?: () => void; reopened?: number } | null>(null);
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
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const iconFor = useMemo(() => {
    const cache = new Map<string, L.DivIcon>();
    return (record: Intervention) => {
      const color = colorOf(record);
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
  }, [colorOf, data.types, data.icons, data.categories]);

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
          element.addEventListener('click', (event) => void onPopupClick(event, current, navigateRef.current));
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
    if (marker.isPopupOpen()) return; // already showing
    // The request is kept until the popup has stayed open a moment. A reload, such as the one that
    // follows a save, can redraw a cluster and fold up its markers just as the popup opens, and the
    // next call then opens it again.
    pending.until = Math.max(pending.until, Date.now() + FOCUS_WAIT_MS);
    pending.release?.();
    let hold: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      pending.release?.();
      if (pendingFocus.current === pending) pendingFocus.current = null;
    };
    // Closed while its marker is still on the map, the person closed it: by its button, a drag or a
    // click elsewhere. That stays closed. If the marker has left the map, a redraw or a move as the
    // page settles folded it into its cluster, so it's opened again. Nothing else may call for it,
    // as the data hasn't changed, so this asks itself, a few times at most.
    const closed = () => {
      setTimeout(() => {
        if (map.hasLayer(marker)) done();
        else if (pendingFocus.current === pending && (pending.reopened ?? 0) < MAX_REOPENS) {
          pending.reopened = (pending.reopened ?? 0) + 1;
          setTimeout(tryFocus, REOPEN_DELAY_MS);
        }
      }, 0);
    };
    const opened = () => {
      marker.off('popupclose', closed).on('popupclose', closed);
      clearTimeout(hold);
      hold = setTimeout(done, FOCUS_HOLD_MS);
    };
    marker.on('popupopen', opened);
    pending.release = () => {
      marker.off('popupopen', opened).off('popupclose', closed);
      clearTimeout(hold);
    };
    cancelFocus.current();
    cancelFocus.current = whenSettled(map, cluster, () => {
      cancelFocus.current = revealMarker(map, cluster, marker);
    });
  }

  useEffect(() => {
    if (!focusRecord) return;
    pendingFocus.current = { id: focusRecord.id, until: Date.now() + FOCUS_WAIT_MS };
    tryFocus();
    return () => cancelFocus.current();
  }, [focusRecord, map]);

  return null;
}

// The popup's buttons and links, for markers and roads alike.
export async function onPopupClick(event: MouseEvent, record: Intervention, navigate: NavigateFunction) {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!button) return;
  const action = button.dataset.action as PopupAction;

  switch (action) {
    case 'beneficiary':
      // A link, so it can open in a new tab too. A plain click stays in the app.
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      navigate(button.getAttribute('href') ?? '/reports/beneficiary');
      break;
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
