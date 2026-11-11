import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from './leaflet-setup';
import { useMapUi } from '../state/map-ui';

const PANE = 'boundaries';
// Under the barangays, over the basemap.
const MASK_PANE = 'province-mask';

const WORLD: L.LatLngExpression[] = [
  [-89, -179],
  [-89, 179],
  [89, 179],
  [89, -179],
];

// Each island's outline, to cut out of the dimmed world. The province file is a GeometryCollection,
// so this reads any GeoJSON shape rather than assume one.
function outlines(geojson: GeoJSON.GeoJSON): L.LatLngExpression[][] {
  switch (geojson.type) {
    case 'FeatureCollection':
      return geojson.features.flatMap((feature) => outlines(feature));
    case 'Feature':
      return geojson.geometry ? outlines(geojson.geometry) : [];
    case 'GeometryCollection':
      return geojson.geometries.flatMap((geometry) => outlines(geometry));
    case 'Polygon':
      return [geojson.coordinates[0].map(([lng, lat]) => [lat, lng] as L.LatLngTuple)];
    case 'MultiPolygon':
      return geojson.coordinates.map((polygon) => polygon[0].map(([lng, lat]) => [lat, lng] as L.LatLngTuple));
    default:
      return [];
  }
}

interface BoundaryLinesProps {
  province: GeoJSON.FeatureCollection;
  municipalities: GeoJSON.FeatureCollection;
}

// Lines only, so clicks pass through to the barangays beneath. And a dimmed world around the province.
export function BoundaryLines({ province, municipalities }: BoundaryLinesProps) {
  const map = useMap();
  const showMunicipal = useMapUi((state) => state.showMunicipal);
  const showProvince = useMapUi((state) => state.showProvince);

  useEffect(() => {
    if (!map.getPane(PANE)) {
      const pane = map.createPane(PANE);
      pane.style.zIndex = '420';
      pane.style.pointerEvents = 'none';
    }
    if (!map.getPane(MASK_PANE)) {
      const pane = map.createPane(MASK_PANE);
      pane.style.zIndex = '350';
      pane.style.pointerEvents = 'none';
    }
  }, [map]);

  // Everything outside Marinduque is dimmed, so the eye stays on the province.
  useEffect(() => {
    const mask = L.polygon([WORLD, ...outlines(province)], {
      pane: MASK_PANE,
      interactive: false,
      stroke: false,
      fillColor: '#f7f6f3',
      fillOpacity: 0.7,
      className: 'province-mask',
    }).addTo(map);
    return () => {
      mask.remove();
    };
  }, [map, province]);

  useEffect(() => {
    if (!showMunicipal) return;
    const layer = L.geoJSON(municipalities, {
      pane: PANE,
      interactive: false,
      style: { color: '#6f6d66', weight: 1.6, opacity: 0.9, fill: false },
      onEachFeature(feature, featureLayer) {
        featureLayer.bindTooltip(feature.properties.adm3_name, {
          permanent: true,
          direction: 'center',
          className: 'municipality-label',
          pane: PANE,
        });
      },
    }).addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, municipalities, showMunicipal]);

  useEffect(() => {
    if (!showProvince) return;
    const layer = L.geoJSON(province, {
      pane: PANE,
      interactive: false,
      style: { color: '#14532d', weight: 2.5, fill: false },
    }).addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, province, showProvince]);

  return null;
}
