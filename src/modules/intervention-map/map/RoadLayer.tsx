// Lines on the map, such as Farm-to-Market Roads (Phase 16, requirement M-11): a line in the record's
// color with a white casing, dashed while the road isn't finished, and labelled with its length once
// the map is close enough to read it. A line with no traced shape, or outside the province, isn't drawn.
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import L from './leaflet-setup';
import type { Intervention, MapData } from '../data/types';
import { isOnMap, popupHtml } from '../lib/display';
import { linePartsOf, pointOnLine } from '../lib/qa';
import { formatKm, isUnfinished, lineLength } from '../lib/roads';
import { useEditUi } from '../state/edit-ui';
import { useMapUi } from '../state/map-ui';
import { usePermissions } from '../state/store-context';
import { onPopupClick } from './InterventionLayer';

// Above the barangays and their labels, below the markers, so a point on a road stays clickable.
const PANE = 'roads';
const PANE_Z = '450';
// The lengths are read from this zoom in. Further out, a province of labels would hide the roads.
const LABEL_ZOOM = 13;
const LABELS_CLASS = 'show-road-labels';
const SETTLE_POLL_MS = 50;
const SETTLE_MAX_TRIES = 60;

interface ShownRoad {
  key: string;
  layers: L.Polyline[];
  hit: L.Polyline;
}

interface RoadLayerProps {
  data: MapData;
  records: Intervention[];
  colorOf(record: Intervention): string;
}

export function RoadLayer({ data, records, colorOf }: RoadLayerProps) {
  const map = useMap();
  const groupRef = useRef<L.LayerGroup | null>(null);
  const shown = useRef(new Map<string, ShownRoad>());
  const focusRecord = useMapUi((state) => state.focusRecord);
  // The road an Edit or Resolve flag form is open on: its draft takes its place on the map until the
  // form closes, even with the draft cleared, as that's what saving would do.
  const editingId = useEditUi((state) => (state.panel?.kind === 'edit' || state.panel?.kind === 'resolve' ? state.panel.id : null));
  const permissions = usePermissions();
  const navigate = useNavigate();

  // A popup is built when it opens, from the newest data.
  const latest = useRef({ data, permissions, navigate });
  latest.current = { data, permissions, navigate };

  useEffect(() => {
    if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = PANE_Z;
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    const roads = shown.current;

    const container = map.getContainer();
    const labels = () => container.classList.toggle(LABELS_CLASS, map.getZoom() >= LABEL_ZOOM);
    labels();
    map.on('zoomend', labels);
    return () => {
      map.off('zoomend', labels);
      container.classList.remove(LABELS_CLASS);
      group.remove();
      groupRef.current = null;
      roads.clear();
    };
  }, [map]);

  // Only roads that changed are drawn again, so an edit elsewhere doesn't close the popup being read.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const roads = shown.current;

    const wanted = new Map<string, { record: Intervention; latlngs: L.LatLngExpression[][]; color: string; dashed: boolean; km: number | null; key: string }>();
    for (const record of records) {
      // A line in several parts can't be reshaped, so it stays drawn while its form is open.
      const beingReshaped = record.id === editingId && record.geojson?.type === 'LineString';
      const parts = isOnMap(record) && !beingReshaped ? linePartsOf(record) : null;
      if (!parts) continue;
      const latlngs = parts.map((part) => part.map(([lng, lat]) => [lat, lng] as L.LatLngTuple));
      const color = colorOf(record);
      const dashed = isUnfinished(record, data);
      const { km } = lineLength(record);
      wanted.set(record.id, { record, latlngs, color, dashed, km, key: JSON.stringify([parts, color, dashed, km, record.title]) });
    }

    for (const [id, road] of roads) {
      if (wanted.get(id)?.key === road.key) continue;
      for (const layer of road.layers) group.removeLayer(layer);
      roads.delete(id);
    }

    for (const [id, { record, latlngs, color, dashed, km, key }] of wanted) {
      if (roads.has(id)) continue;
      const casing = L.polyline(latlngs, { pane: PANE, color: '#ffffff', weight: 8, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false });
      const line = L.polyline(latlngs, {
        pane: PANE,
        color,
        weight: 4,
        opacity: 1,
        lineJoin: 'round',
        lineCap: dashed ? 'butt' : 'round',
        dashArray: dashed ? '9 7' : undefined,
        interactive: false,
        className: `road-line${dashed ? ' is-unfinished' : ''}`,
      });
      // Wider than it looks, so a finger can find it on a phone.
      const hit = L.polyline(latlngs, { pane: PANE, color: '#000000', weight: 18, opacity: 0, className: 'road-hit', bubblingMouseEvents: false });
      hit.bindPopup(
        () => {
          const now = latest.current;
          const current = now.data.interventions.find((candidate) => candidate.id === id) ?? record;
          const element = document.createElement('div');
          element.innerHTML = popupHtml(current, now.data, now.permissions);
          element.addEventListener('click', (event) => void onPopupClick(event, current, now.navigate));
          return element;
        },
        { maxWidth: 320, autoPanPaddingTopLeft: [10, 64] },
      );
      if (km !== null) {
        line.bindTooltip(formatKm(km), { permanent: true, direction: 'center', className: 'road-label', opacity: 1 });
      }
      group.addLayer(casing).addLayer(line).addLayer(hit);
      roads.set(id, { key, layers: [casing, line, hit], hit });
    }

    // An open popup follows the data, such as a status added in another tab.
    for (const { hit } of roads.values()) {
      if (hit.isPopupOpen()) hit.getPopup()?.update();
    }
  }, [records, data, colorOf, editingId]);

  // A road chosen elsewhere, such as from its own page: the map fits it and opens its popup. Each request
  // is acted on once, when the road is drawn, so later data changes don't move the map again.
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!focusRecord || handled.current === focusRecord.nonce) return;
    const road = shown.current.get(focusRecord.id);
    const record = data.interventions.find((candidate) => candidate.id === focusRecord.id);
    const parts = record ? linePartsOf(record) : null;
    if (!road || !parts) return;
    const show = () => {
      handled.current = focusRecord.nonce;
      map.fitBounds(road.hit.getBounds(), { maxZoom: 16, padding: [48, 48], animate: false });
      const middle = pointOnLine(parts);
      road.hit.openPopup(middle ? L.latLng(middle.lat, middle.lng) : undefined);
    };
    // A jump made while the map is still zooming, such as to fit the island as it first opens, is undone
    // when that zoom ends, so it waits for the map to settle. Leaflet starts an animated zoom on the next
    // frame, so the first look is after it, and Leaflet has no public way to ask.
    let timer: ReturnType<typeof setTimeout>;
    const attempt = (triesLeft: number) => {
      const busy = (map as unknown as { _animatingZoom?: boolean })._animatingZoom;
      if (busy && triesLeft > 0) timer = setTimeout(() => attempt(triesLeft - 1), SETTLE_POLL_MS);
      else show();
    };
    const frame = requestAnimationFrame(() => attempt(SETTLE_MAX_TRIES));
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [focusRecord, map, records, data]);

  return null;
}
