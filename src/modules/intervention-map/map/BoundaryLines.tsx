import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from './leaflet-setup';
import { useMapUi } from '../state/map-ui';

const PANE = 'boundaries';

interface BoundaryLinesProps {
  province: GeoJSON.FeatureCollection;
  municipalities: GeoJSON.FeatureCollection;
}

// Lines only, so clicks pass through to the barangays beneath.
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
  }, [map]);

  useEffect(() => {
    if (!showMunicipal) return;
    const layer = L.geoJSON(municipalities, {
      pane: PANE,
      interactive: false,
      style: { color: '#2b2a28', weight: 1.8, fill: false },
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
      style: { color: '#14532d', weight: 3, fill: false },
    }).addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, province, showProvince]);

  return null;
}
