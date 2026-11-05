// The browser's copy of the database's location rules, used for live warnings and by local mode.
// supabase/migrations/0001_baseline.sql stays the authority once the app is on Supabase.
// tests/qa-parity.test.ts runs both on the same cases, so change them together.
import type { Barangay, Intervention, MapData, Municipality } from '../data/types';
import type { LatLng } from './coordinates';

export const PROVINCE_BOX = { minLng: 121.78, maxLng: 122.2, minLat: 13.15, maxLat: 13.6 };
const TOLERANCE_METRES = 250;
// The view's search box, in degrees. 250 m is about 0.0023 degrees here.
const SEARCH_DEGREES = 0.003;

type Ring = [number, number][];
interface Bounds {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}
interface Shape {
  polygons: Ring[][]; // each polygon: outer ring, then holes
  bounds: Bounds;
}

export interface PlaceIndex {
  barangays: Map<number, Shape>;
  municipalities: Map<number, Shape>;
}

function toShape(geometry: GeoJSON.Geometry): Shape {
  let polygons: Ring[][];
  if (geometry.type === 'Polygon') polygons = [geometry.coordinates as Ring[]];
  else if (geometry.type === 'MultiPolygon') polygons = geometry.coordinates as Ring[][];
  else throw new Error(`Expected a polygon boundary, not ${geometry.type}`);

  const bounds = { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity };
  for (const polygon of polygons) {
    for (const [lng, lat] of polygon[0]) {
      bounds.minLng = Math.min(bounds.minLng, lng);
      bounds.maxLng = Math.max(bounds.maxLng, lng);
      bounds.minLat = Math.min(bounds.minLat, lat);
      bounds.maxLat = Math.max(bounds.maxLat, lat);
    }
  }
  return { polygons, bounds };
}

export function buildPlaceIndex(
  boundaries: { barangays: GeoJSON.FeatureCollection; municipalities: GeoJSON.FeatureCollection },
  places: { barangays: Pick<Barangay, 'id' | 'psgc_code'>[]; municipalities: Pick<Municipality, 'id' | 'psgc_code'>[] },
): PlaceIndex {
  const barangayId = new Map(places.barangays.map((b) => [b.psgc_code, b.id]));
  const municipalityId = new Map(places.municipalities.map((m) => [m.psgc_code, m.id]));
  const index: PlaceIndex = { barangays: new Map(), municipalities: new Map() };

  for (const feature of boundaries.barangays.features) {
    const id = barangayId.get(feature.properties?.adm4_pcode);
    if (id !== undefined) index.barangays.set(id, toShape(feature.geometry));
  }
  for (const feature of boundaries.municipalities.features) {
    const id = municipalityId.get(feature.properties?.adm3_pcode);
    if (id !== undefined) index.municipalities.set(id, toShape(feature.geometry));
  }
  return index;
}

function insideRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inside(point: LatLng, shape: Shape): boolean {
  return shape.polygons.some(
    ([outer, ...holes]) => insideRing(point.lng, point.lat, outer) && !holes.some((hole) => insideRing(point.lng, point.lat, hole)),
  );
}

// Shortest distance from the point to the shape's edges, with the longitude and latitude scaled
// by the given factors. Scaling by 1 gives degrees, as the view orders by; metres need the factors below.
function edgeDistance(point: LatLng, shape: Shape, scaleLng: number, scaleLat: number): number {
  let shortest = Infinity;
  for (const polygon of shape.polygons) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const ax = (ring[i - 1][0] - point.lng) * scaleLng;
        const ay = (ring[i - 1][1] - point.lat) * scaleLat;
        const bx = (ring[i][0] - point.lng) * scaleLng;
        const by = (ring[i][1] - point.lat) * scaleLat;
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
        shortest = Math.min(shortest, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
  }
  return shortest;
}

// WGS84 radii of curvature at this latitude. Over a few hundred metres this matches PostGIS's
// spheroid distance to well under a metre.
function metresPerDegree(lat: number): { lng: number; lat: number } {
  const a = 6378137;
  const e2 = 0.00669437999014;
  const phi = (lat * Math.PI) / 180;
  const w = 1 - e2 * Math.sin(phi) ** 2;
  const degree = Math.PI / 180;
  return { lat: degree * ((a * (1 - e2)) / w ** 1.5), lng: degree * (a / Math.sqrt(w)) * Math.cos(phi) };
}

function nearBounds(point: LatLng, bounds: Bounds): boolean {
  return (
    point.lng >= bounds.minLng - SEARCH_DEGREES &&
    point.lng <= bounds.maxLng + SEARCH_DEGREES &&
    point.lat >= bounds.minLat - SEARCH_DEGREES &&
    point.lat <= bounds.maxLat + SEARCH_DEGREES
  );
}

function withinTolerance(point: LatLng, shape: Shape): boolean {
  if (!nearBounds(point, shape.bounds)) return false;
  if (inside(point, shape)) return true;
  const scale = metresPerDegree(point.lat);
  return edgeDistance(point, shape, scale.lng, scale.lat) <= TOLERANCE_METRES;
}

// The barangay a point is plotted in: the closest one within the tolerance, as interventions_v does.
export function locatePoint(point: LatLng, index: PlaceIndex): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  const ids = [...index.barangays.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const shape = index.barangays.get(id)!;
    if (!withinTolerance(point, shape)) continue;
    const distance = inside(point, shape) ? 0 : edgeDistance(point, shape, 1, 1);
    if (distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

export function pointOf(record: Pick<Intervention, 'geojson'>): LatLng | null {
  if (record.geojson?.type !== 'Point') return null;
  const [lng, lat] = record.geojson.coordinates;
  return { lat, lng };
}

export function samePoint(a: LatLng | null, b: LatLng | null): boolean {
  return a !== null && b !== null && a.lat === b.lat && a.lng === b.lng;
}

export interface FlagInput {
  id: string | null;
  point: LatLng | null;
  municipality_id: number;
  barangay_id: number | null;
  barangay_raw: string | null;
  qa_flags: string[];
  deleted_at: string | null;
}

export function computeFlags(input: FlagInput, others: Intervention[], index: PlaceIndex): string[] {
  const flags: string[] = [];
  const { point } = input;

  if (!point) {
    flags.push('no_coords');
  } else {
    const { minLng, maxLng, minLat, maxLat } = PROVINCE_BOX;
    if (point.lng < minLng || point.lng > maxLng || point.lat < minLat || point.lat > maxLat) flags.push('out_of_province');

    const municipality = index.municipalities.get(input.municipality_id);
    if (municipality && !withinTolerance(point, municipality)) flags.push('muni_mismatch');

    if (input.barangay_id !== null) {
      const barangay = index.barangays.get(input.barangay_id);
      if (barangay && !withinTolerance(point, barangay)) flags.push('barangay_mismatch');
    }

    const shared =
      input.deleted_at === null &&
      others.some((other) => other.id !== input.id && other.deleted_at === null && samePoint(pointOf(other), point));
    if (shared) flags.push('duplicate_point');
  }

  if (input.barangay_id === null) {
    flags.push((input.barangay_raw ?? '').trim() === '' ? 'no_barangay' : 'barangay_unmatched');
  }

  // Manual review flags are kept until a person clears them. All others are recalculated.
  return [...flags, ...input.qa_flags.filter((flag) => flag === 'beneficiary_name_check')];
}

function normalizeName(name: string | null): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface DuplicateInput {
  id: string | null;
  category_id: number | null;
  beneficiary: string | null;
  year_funded: number | null;
  barangay_id: number | null;
}

// A warning only: an FCA can receive two identical units.
export function possibleDuplicates(input: DuplicateInput, records: Intervention[]): Intervention[] {
  const beneficiary = normalizeName(input.beneficiary);
  if (input.category_id === null || beneficiary === '' || input.year_funded === null || input.barangay_id === null) return [];
  return records.filter(
    (record) =>
      record.id !== input.id &&
      record.deleted_at === null &&
      record.category_id === input.category_id &&
      record.year_funded === input.year_funded &&
      record.barangay_id === input.barangay_id &&
      normalizeName(record.beneficiary) === beneficiary,
  );
}

export type WarningCode =
  | 'no_coords'
  | 'out_of_province'
  | 'not_in_a_barangay'
  | 'muni_mismatch'
  | 'barangay_mismatch'
  | 'duplicate_point'
  | 'no_barangay'
  | 'barangay_unmatched'
  | 'possible_duplicate';

export interface EditWarning {
  code: WarningCode;
  message: string;
}

export interface WarningResult {
  warnings: EditWarning[];
  // Where the point actually is, so a form can offer to set the barangay to match.
  plotted: { barangayId: number; municipalityId: number; label: string } | null;
}

type PlaceNames = Pick<MapData, 'barangays' | 'municipalities'>;

export function editWarnings(
  input: FlagInput & DuplicateInput,
  records: Intervention[],
  index: PlaceIndex,
  places: PlaceNames,
): WarningResult {
  const flags = computeFlags(input, records, index);
  const warnings: EditWarning[] = [];
  const barangayName = (id: number | null) => places.barangays.find((b) => b.id === id)?.name;
  const municipalityName = (id: number) => places.municipalities.find((m) => m.id === id)?.name;

  const plottedId = input.point ? locatePoint(input.point, index) : null;
  const plottedBarangay = places.barangays.find((b) => b.id === plottedId);
  const plotted = plottedBarangay
    ? {
        barangayId: plottedBarangay.id,
        municipalityId: plottedBarangay.municipality_id,
        label: `${plottedBarangay.name}, ${municipalityName(plottedBarangay.municipality_id)}`,
      }
    : null;

  if (flags.includes('no_coords')) {
    warnings.push({ code: 'no_coords', message: 'No coordinates yet. This record won\'t appear on the map until it has some.' });
  }
  if (flags.includes('out_of_province')) {
    warnings.push({ code: 'out_of_province', message: 'This point is outside Marinduque, so the record won\'t appear on the map.' });
  } else if (input.point && !plotted) {
    warnings.push({ code: 'not_in_a_barangay', message: 'This point isn\'t in any Marinduque barangay. It may be at sea.' });
  }
  // With no barangay under the point, the warnings above already say so.
  if (plotted && flags.includes('muni_mismatch')) {
    warnings.push({
      code: 'muni_mismatch',
      message: `This point is in ${plotted.label}, but the municipality is set to ${municipalityName(input.municipality_id)}.`,
    });
  }
  if (plotted && flags.includes('barangay_mismatch')) {
    warnings.push({
      code: 'barangay_mismatch',
      message: `This point is in ${plotted.label}, but the barangay is set to ${barangayName(input.barangay_id)}.`,
    });
  }
  if (flags.includes('duplicate_point')) {
    warnings.push({ code: 'duplicate_point', message: 'Another record has exactly these coordinates.' });
  }
  if (flags.includes('no_barangay')) {
    warnings.push({ code: 'no_barangay', message: 'No barangay set. This record will count as Unassigned.' });
  }
  if (flags.includes('barangay_unmatched')) {
    warnings.push({
      code: 'barangay_unmatched',
      message: `The source says "${input.barangay_raw}", which isn't on the official list. Choose the barangay it means.`,
    });
  }

  const duplicates = possibleDuplicates(input, records);
  if (duplicates.length > 0) {
    warnings.push({
      code: 'possible_duplicate',
      message:
        duplicates.length === 1
          ? 'Possible duplicate: a record with the same category, beneficiary, year and barangay already exists.'
          : `Possible duplicate: ${duplicates.length} records with the same category, beneficiary, year and barangay already exist.`,
    });
  }

  return { warnings, plotted };
}
