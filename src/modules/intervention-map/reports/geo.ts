// Fitting boundaries and points into a box on a page, for the maps drawn in reports. Marinduque is small
// and near the equator, so a plain longitude-latitude grid, with longitude narrowed by the cosine of the
// latitude, keeps shapes and distances true to within a fraction of a percent.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

// A polygon's rings, outer first, as [longitude, latitude] pairs.
export type Polygon = [number, number][][];

const METERS_PER_DEGREE = 111_320;

export function polygonsOf(geometry: GeoJSON.Geometry | null | undefined): Polygon[] {
  if (!geometry) return [];
  switch (geometry.type) {
    case 'Polygon':
      return [geometry.coordinates as Polygon];
    case 'MultiPolygon':
      return geometry.coordinates as Polygon[];
    case 'GeometryCollection':
      return geometry.geometries.flatMap(polygonsOf);
    default:
      return [];
  }
}

// Every polygon in a GeoJSON object, whether a feature collection, a feature or a bare geometry.
export function allPolygons(geojson: GeoJSON.GeoJSON | null | undefined): Polygon[] {
  if (!geojson) return [];
  if (geojson.type === 'FeatureCollection') return geojson.features.flatMap((feature) => polygonsOf(feature.geometry));
  if (geojson.type === 'Feature') return polygonsOf(geojson.geometry);
  return polygonsOf(geojson);
}

export function boundsOf(polygons: Polygon[], points: { lat: number; lng: number }[] = []): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const take = (lng: number, lat: number) => {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  };
  for (const polygon of polygons) for (const ring of polygon) for (const [lng, lat] of ring) take(lng, lat);
  for (const point of points) take(point.lng, point.lat);
  return Number.isFinite(west) ? { west, south, east, north } : null;
}

export interface Projection {
  project(lng: number, lat: number): [number, number];
  // How many meters one unit of the page stands for, for a scale bar.
  metersPerUnit: number;
  // The area drawn, which may be wider or taller than the bounds asked for, to keep the shape true.
  drawn: Box;
}

// Fits the bounds inside the box, centered, with a margin, keeping north up and shapes true.
export function fitProjection(bounds: Bounds, box: Box, margin = 0.04): Projection {
  const midLat = ((bounds.north + bounds.south) / 2) * (Math.PI / 180);
  const xStretch = Math.cos(midLat);
  const spanX = Math.max((bounds.east - bounds.west) * xStretch, 1e-6);
  const spanY = Math.max(bounds.north - bounds.south, 1e-6);
  const usableWidth = box.width * (1 - 2 * margin);
  const usableHeight = box.height * (1 - 2 * margin);
  const scale = Math.min(usableWidth / spanX, usableHeight / spanY);
  const width = spanX * scale;
  const height = spanY * scale;
  const left = box.x + (box.width - width) / 2;
  const top = box.y + (box.height - height) / 2;
  return {
    project: (lng, lat) => [left + (lng - bounds.west) * xStretch * scale, top + (bounds.north - lat) * scale],
    metersPerUnit: METERS_PER_DEGREE / scale,
    drawn: { x: left, y: top, width, height },
  };
}

// A round length for a scale bar no longer than the room given: 1, 2 or 5 times a power of ten.
export function niceScale(metersPerUnit: number, maxUnits: number): { meters: number; units: number; label: string } {
  const most = metersPerUnit * maxUnits;
  const power = 10 ** Math.floor(Math.log10(most));
  const meters = [5, 2, 1].map((step) => step * power).find((candidate) => candidate <= most) ?? power;
  return { meters, units: meters / metersPerUnit, label: meters >= 1000 ? `${meters / 1000} km` : `${meters} m` };
}
