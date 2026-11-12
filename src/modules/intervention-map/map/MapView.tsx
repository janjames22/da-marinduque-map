import { useEffect } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { useExportUi } from '../state/export-ui';
import type { Boundaries } from '../state/use-map-data';
import type { BasemapId } from '../state/map-ui';
import { useMapUi } from '../state/map-ui';
import type { Shading } from '../lib/choropleth';
import type { Intervention, MapData } from '../data/types';
import { BarangayLayer } from './BarangayLayer';
import { BoundaryLines } from './BoundaryLines';
import { DraftLayer } from './DraftLayer';
import { InterventionLayer } from './InterventionLayer';
import { RoadLayer } from './RoadLayer';

const DEFAULT_CENTER: [number, number] = [13.4, 121.97];
const DEFAULT_ZOOM = 11;
const MAX_ZOOM = 19;

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const ESRI_ATTRIBUTION = 'Tiles &copy; Esri';

// Light is the default: a quiet grey base, so the barangays and markers are what stands out. Esri
// serves it only to zoom 16, and Leaflet enlarges those tiles beyond that.
const BASEMAPS: Record<BasemapId, { url: string; attribution: string; labelsUrl?: string; maxNativeZoom?: number }> = {
  light: {
    url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labelsUrl: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    maxNativeZoom: 16,
  },
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
      <TileLayer key={id} url={basemap.url} attribution={basemap.attribution} maxZoom={MAX_ZOOM} maxNativeZoom={basemap.maxNativeZoom} crossOrigin="anonymous" />
      {basemap.labelsUrl && (
        <TileLayer key={`${id}-labels`} url={basemap.labelsUrl} maxZoom={MAX_ZOOM} maxNativeZoom={basemap.maxNativeZoom} pane="overlayPane" crossOrigin="anonymous" />
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

// An export or the dashboard can be limited to what's on screen, and a saved view keeps where it is.
function ReportPosition() {
  const map = useMap();
  useEffect(() => {
    const report = () => {
      const bounds = map.getBounds();
      const center = map.getCenter();
      useExportUi
        .getState()
        .setMapPosition(
          { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() },
          { center: [center.lat, center.lng], zoom: map.getZoom() },
        );
    };
    report();
    map.on('moveend', report);
    return () => {
      map.off('moveend', report);
    };
  }, [map]);
  return null;
}

// Comes after the barangays, as they fit the map to the island when they first draw.
function GoToSavedExtent() {
  const map = useMap();
  const focusExtent = useMapUi((state) => state.focusExtent);
  useEffect(() => {
    if (focusExtent) map.setView(focusExtent.center, focusExtent.zoom, { animate: false });
  }, [focusExtent, map]);
  return null;
}

interface MapViewProps {
  data: MapData;
  boundaries: Boundaries;
  shading: Shading;
  counts: Map<number, number>;
  markers: Intervention[];
  colorOf(record: Intervention): string;
  selectedBarangayId: number | null;
  onSelectBarangay(id: number): void;
}

export function MapView({ data, boundaries, shading, counts, markers, colorOf, selectedBarangayId, onSelectBarangay }: MapViewProps) {
  return (
    <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} maxZoom={MAX_ZOOM} className="map" zoomSnap={0.5}>
      <Basemap />
      <KeepSizeInSync />
      <ReportPosition />
      <BarangayLayer
        data={data}
        geojson={boundaries.barangays}
        shading={shading}
        counts={counts}
        selectedId={selectedBarangayId}
        onSelect={onSelectBarangay}
      />
      <GoToSavedExtent />
      <BoundaryLines province={boundaries.province} municipalities={boundaries.municipalities} />
      <RoadLayer data={data} records={markers} colorOf={colorOf} />
      <InterventionLayer data={data} records={markers} colorOf={colorOf} />
      <DraftLayer />
    </MapContainer>
  );
}
