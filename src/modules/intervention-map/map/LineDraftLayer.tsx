// A road's line while a form draws or reshapes it (Phase 16b): the line in the draft's orange, a handle
// on each point, and a smaller one between each two. In "add points" mode a click on the map adds a
// point at the end. Any point can be dragged, a handle between two dragged or tapped adds a bend there,
// and a tapped point is picked for the form's Remove this point. Nothing is saved until the form is.
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from './leaflet-setup';
import { roundPoint, type LatLng } from '../lib/coordinates';
import { useEditUi } from '../state/edit-ui';

// Above the markers, so a point placed over one can still be reached.
const PANE = 'line-draft';
const PANE_Z = '610';
const COLOR = '#eb6834';
const DRAWING_CLASS = 'is-drawing';
const DRAFT_CLASS = 'has-line-draft';
// A little longer than the phone sheet's rise (map-phone.css, sheet-up).
const SHEET_RISE_MS = 350;

// Bigger to touch than they look, so a finger can find them on a phone.
const handleIcon = (selected: boolean) =>
  L.divIcon({ className: `line-handle${selected ? ' is-selected' : ''}`, html: '<span></span>', iconSize: [32, 32] });
const MIDPOINT_ICON = L.divIcon({ className: 'line-midpoint', html: '<span></span>', iconSize: [28, 28] });

const toLatLngs = (line: LatLng[]) => line.map((point) => L.latLng(point.lat, point.lng));
const middle = (a: LatLng, b: LatLng): LatLng => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });

export function LineDraftLayer() {
  const map = useMap();
  const draftLine = useEditUi((state) => state.draftLine);
  const lineMode = useEditUi((state) => state.lineMode);
  const selectedPoint = useEditUi((state) => state.selectedPoint);
  const groupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = PANE_Z;
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    // The form decides what a click means while it's open, so only "add points" mode takes one here.
    const onClick = (event: L.LeafletMouseEvent) => {
      const { lineMode: mode, addLinePoint } = useEditUi.getState();
      if (mode === 'add') addLinePoint(roundPoint(event.latlng));
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
      map.getContainer().classList.remove(DRAWING_CLASS, DRAFT_CLASS);
      group.remove();
      groupRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const container = map.getContainer();
    container.classList.toggle(DRAWING_CLASS, lineMode === 'add');
    container.classList.toggle(DRAFT_CLASS, lineMode !== null);
  }, [map, lineMode]);

  // As drawing starts, nothing may cover the line: a popup closes, and a line partly out of view is
  // brought into it. On a phone the form's sheet shrinks the map as it rises, so the fit is done again
  // once the sheet is up.
  const wasDrawing = useRef(false);
  useEffect(() => {
    const starting = lineMode !== null && !wasDrawing.current;
    wasDrawing.current = lineMode !== null;
    if (!starting) return;
    map.closePopup();
    const line = useEditUi.getState().draftLine;
    if (!line || line.length === 0) return;
    const fit = () => {
      const bounds = L.latLngBounds(toLatLngs(line));
      if (!map.getBounds().pad(-0.1).contains(bounds)) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17, animate: false });
    };
    const frame = requestAnimationFrame(fit);
    const later = setTimeout(fit, SHEET_RISE_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(later);
    };
  }, [map, lineMode]);

  // Drawn afresh after each change. A drag only moves the line on screen, and the store hears of it
  // when the drag ends, so nothing is rebuilt under the finger.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    if (!draftLine || draftLine.length === 0 || !lineMode) return;

    const casing = L.polyline(toLatLngs(draftLine), { pane: PANE, color: '#ffffff', weight: 8, opacity: 0.95, interactive: false });
    const line = L.polyline(toLatLngs(draftLine), { pane: PANE, color: COLOR, weight: 4, opacity: 1, interactive: false, className: 'line-draft' });
    group.addLayer(casing).addLayer(line);
    const showWith = (points: LatLng[]) => {
      casing.setLatLngs(toLatLngs(points));
      line.setLatLngs(toLatLngs(points));
    };
    const { moveLinePoint, insertLinePoint, selectLinePoint } = useEditUi.getState();

    draftLine.forEach((point, index) => {
      const handle = L.marker(point, {
        icon: handleIcon(index === selectedPoint),
        draggable: true,
        autoPan: true,
        zIndexOffset: 2000,
        title: `Point ${index + 1} of ${draftLine.length}`,
        alt: `Point ${index + 1} of ${draftLine.length}`,
      });
      handle.on('drag', () => showWith(draftLine.map((at, i) => (i === index ? handle.getLatLng() : at))));
      handle.on('dragend', () => moveLinePoint(index, roundPoint(handle.getLatLng())));
      handle.on('click', () => selectLinePoint(index === useEditUi.getState().selectedPoint ? null : index));
      group.addLayer(handle);
    });

    // A bend between two points, by dragging or tapping the small handle there.
    if (lineMode === 'shape') {
      for (let index = 1; index < draftLine.length; index++) {
        const at = middle(draftLine[index - 1], draftLine[index]);
        const bend = L.marker(at, { icon: MIDPOINT_ICON, draggable: true, autoPan: true, zIndexOffset: 1900, title: 'Add a point here', alt: 'Add a point here' });
        const withBend = (point: LatLng) => [...draftLine.slice(0, index), point, ...draftLine.slice(index)];
        bend.on('drag', () => showWith(withBend(bend.getLatLng())));
        bend.on('dragend', () => insertLinePoint(index, roundPoint(bend.getLatLng())));
        bend.on('click', () => insertLinePoint(index, roundPoint(at)));
        group.addLayer(bend);
      }
    }
  }, [draftLine, lineMode, selectedPoint]);

  return null;
}
