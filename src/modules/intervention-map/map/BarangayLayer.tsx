import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from './leaflet-setup';
import type { MapData } from '../data/types';
import type { Shading } from '../lib/choropleth';
import { escapeHtml } from '../lib/display';
import { useMapUi } from '../state/map-ui';

const PANE = 'barangays';

interface BarangayLayerProps {
  data: MapData;
  geojson: GeoJSON.FeatureCollection;
  shading: Shading;
  counts: Map<number, number>;
  selectedId: number | null;
  onSelect(id: number): void;
}

// All 218 barangays are always drawn and clickable, whatever the view or filters.
export function BarangayLayer({ data, geojson, shading, counts, selectedId, onSelect }: BarangayLayerProps) {
  const map = useMap();
  const layerByBarangay = useRef(new Map<number, L.Path>());
  const focusBarangay = useMapUi((state) => state.focusBarangay);

  const barangayByPsgc = useMemo(() => new Map(data.barangays.map((b) => [b.psgc_code, b])), [data.barangays]);
  const municipalityName = useMemo(() => new Map(data.municipalities.map((m) => [m.id, m.name])), [data.municipalities]);

  // The tooltip and click handler are created once, so they read the latest values from here.
  const latest = useRef({ counts, onSelect });
  latest.current = { counts, onSelect };

  useEffect(() => {
    if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = '410';
    const layers = layerByBarangay.current;

    const group = L.geoJSON(geojson, {
      pane: PANE,
      onEachFeature(feature, layer) {
        const barangay = barangayByPsgc.get(feature.properties.adm4_pcode);
        if (!barangay) throw new Error(`No barangay for PSGC code ${feature.properties.adm4_pcode}`);

        const path = layer as L.Path;
        layers.set(barangay.id, path);

        path.bindTooltip(
          () => {
            const count = latest.current.counts.get(barangay.id) ?? 0;
            const place = escapeHtml(`${barangay.name}, ${municipalityName.get(barangay.municipality_id)}`);
            return `${place}: ${count === 0 ? 'none encoded yet' : count}`;
          },
          { sticky: true },
        );
        path.on('click', () => latest.current.onSelect(barangay.id));
        path.on('add', () => {
          path.getElement()?.setAttribute('data-barangay-id', String(barangay.id));
          path.getElement()?.classList.add('barangay-shape');
        });
      },
    }).addTo(map);

    map.fitBounds(group.getBounds(), { padding: [12, 12] });

    return () => {
      group.remove();
      layers.clear();
    };
  }, [map, geojson, barangayByPsgc, municipalityName]);

  useEffect(() => {
    for (const [id, path] of layerByBarangay.current) {
      const { color, opacity } = shading.fillFor(id);
      const selected = id === selectedId;
      path.setStyle({
        fillColor: color,
        fillOpacity: opacity,
        color: selected ? '#111111' : '#6b6a66',
        weight: selected ? 3 : 0.8,
        opacity: selected ? 1 : 0.8,
      });
      if (selected) path.bringToFront();
    }
  }, [shading, selectedId]);

  useEffect(() => {
    if (!focusBarangay) return;
    const path = layerByBarangay.current.get(focusBarangay.id);
    if (path instanceof L.Polygon) map.fitBounds(path.getBounds(), { maxZoom: 14, padding: [40, 40] });
  }, [focusBarangay, map]);

  return null;
}
