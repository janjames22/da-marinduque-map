import { useEffect } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { Boundaries } from '../state/use-map-data';
import type { BasemapId } from '../state/map-ui';
import { useMapUi } from '../state/map-ui';
import type { Shading } from '../lib/choropleth';
import type { Intervention, MapData } from '../data/types';
import { BarangayLayer } from './BarangayLayer';
import { BoundaryLines } from './BoundaryLines';
import { InterventionLayer } from './InterventionLayer';

const DEFAULT_CENTER: [number, number] = [13.4, 121.97];
const DEFAULT_ZOOM = 11;
const MAX_ZOOM = 19;

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const ESRI_ATTRIBUTION = 'Tiles &copy; Esri';

const BASEMAPS: Record<BasemapId, { url: string; attribution: string; labelsUrl?: string }> = {
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  imagery: { url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, attribution: ESRI_ATTRIBUTION },
  topo: { url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`, attribution: ESRI_ATTRIBUTION },
  hybrid: {
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    labelsUrl: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_ATTRIBUTION,
  },
};

function Basemap() {
  const id = useMapUi((state) => state.basemap);
  const basemap = BASEMAPS[id];
  return (
    <>
      <TileLayer key={id} url={basemap.url} attribution={basemap.attribution} maxZoom={MAX_ZOOM} crossOrigin="anonymous" />
      {basemap.labelsUrl && (
        <TileLayer key={`${id}-labels`} url={basemap.labelsUrl} maxZoom={MAX_ZOOM} pane="overlayPane" crossOrigin="anonymous" />
      )}
    </>
  );
}

// Panels opening and closing change the map's size, and Leaflet doesn't notice on its own.
function KeepSizeInSync() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

interface MapViewProps {
  data: MapData;
  boundaries: Boundaries;
  shading: Shading;
  counts: Map<number, number>;
  markers: Intervention[];
  selectedBarangayId: number | null;
  onSelectBarangay(id: number): void;
}

export function MapView({ data, boundaries, shading, counts, markers, selectedBarangayId, onSelectBarangay }: MapViewProps) {
  return (
    <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} maxZoom={MAX_ZOOM} className="map" zoomSnap={0.5}>
      <Basemap />
      <KeepSizeInSync />
      <BarangayLayer
        data={data}
        geojson={boundaries.barangays}
        shading={shading}
        counts={counts}
        selectedId={selectedBarangayId}
        onSelect={onSelectBarangay}
      />
      <BoundaryLines province={boundaries.province} municipalities={boundaries.municipalities} />
      <InterventionLayer data={data} records={markers} />
    </MapContainer>
  );
}
