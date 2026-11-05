import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from './leaflet-setup';
import { roundPoint } from '../lib/coordinates';
import { PROVINCE_BOX } from '../lib/qa';
import { useEditUi } from '../state/edit-ui';

const GO_TO_ZOOM = 16;

const DRAFT_ICON = L.divIcon({
  className: 'draft-marker',
  html: '<span></span>',
  iconSize: [30, 30],
});

// The location being set in a form: a draggable marker, and the map click that places it.
export function DraftLayer() {
  const map = useMap();
  const draft = useEditUi((state) => state.draft);
  const draftNonce = useEditUi((state) => state.draftNonce);
  const picking = useEditUi((state) => state.picking);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    const onClick = (event: L.LeafletMouseEvent) => {
      const { picking: isPicking, setDraft } = useEditUi.getState();
      if (isPicking) setDraft(roundPoint(event.latlng));
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [map]);

  useEffect(() => {
    map.getContainer().classList.toggle('is-picking', picking);
  }, [map, picking]);

  useEffect(() => {
    if (!draft) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (markerRef.current) {
      markerRef.current.setLatLng(draft);
      return;
    }
    const marker = L.marker(draft, {
      icon: DRAFT_ICON,
      draggable: true,
      autoPan: true,
      zIndexOffset: 2000,
      title: 'Location being set',
      alt: 'Location being set',
    }).addTo(map);
    marker.on('dragend', () => useEditUi.getState().setDraft(roundPoint(marker.getLatLng())));
    markerRef.current = marker;
  }, [map, draft]);

  useEffect(
    () => () => {
      markerRef.current?.remove();
      markerRef.current = null;
    },
    [],
  );

  // A location typed in or read from GPS or a photo may be off screen.
  useEffect(() => {
    if (draftNonce === 0) return;
    const point = useEditUi.getState().draft;
    if (!point) return;
    const { minLng, maxLng, minLat, maxLat } = PROVINCE_BOX;
    if (point.lng < minLng || point.lng > maxLng || point.lat < minLat || point.lat > maxLat) return;
    map.setView(point, Math.max(map.getZoom(), GO_TO_ZOOM));
  }, [map, draftNonce]);

  return null;
}
