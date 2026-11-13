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

// A one-part line's positions, as the forms draw and save it. A line in several parts, as a file can bring
// in, gives null here: the editor reshapes one line at a time.
export function linePositionsOf(record: Pick<Intervention, 'geojson'>): [number, number][] | null {
  return record.geojson?.type === 'LineString' ? (record.geojson.coordinates as [number, number][]) : null;
}

export function sameLine(a: [number, number][] | null, b: [number, number][] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every(([lng, lat], i) => lng === b[i][0] && lat === b[i][1]);
}

// A line's parts, each a list of [longitude, latitude]: one part for a LineString, several for a
// MultiLineString.
export type LineParts = [number, number][][];

export function linePartsOf(record: Pick<Intervention, 'geojson'>): LineParts | null {
  const geometry = record.geojson;
  if (geometry?.type === 'LineString') return [geometry.coordinates as [number, number][]];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates as [number, number][][];
  return null;
}

function lineBounds(parts: LineParts): Bounds {
  const bounds = { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity };
  for (const part of parts) {
    for (const [lng, lat] of part) {
      bounds.minLng = Math.min(bounds.minLng, lng);
      bounds.maxLng = Math.max(bounds.maxLng, lng);
      bounds.minLat = Math.min(bounds.minLat, lat);
      bounds.maxLat = Math.max(bounds.maxLat, lat);
    }
  }
  return bounds;
}

function boundsNear(a: Bounds, b: Bounds, margin: number): boolean {
  return a.minLng <= b.maxLng + margin && a.maxLng >= b.minLng - margin && a.minLat <= b.maxLat + margin && a.maxLat >= b.minLat - margin;
}

const segmentsOf = (parts: LineParts) => parts.flatMap((part) => part.slice(1).map((end, i) => [part[i], end] as const));
const ringSegments = (shape: Shape) =>
  shape.polygons.flatMap((polygon) => polygon.flatMap((ring) => ring.slice(1).map((end, i) => [ring[i], end] as const)));

// Whether two segments meet, touching counted, as PostGIS counts it.
function segmentsMeet(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], d: readonly [number, number]): boolean {
  const turn = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const onSegment = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]) =>
    Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) && Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1]);
  const [t1, t2, t3, t4] = [turn(a, b, c), turn(a, b, d), turn(c, d, a), turn(c, d, b)];
  if (t1 !== t2 && t3 !== t4) return true;
  return (t1 === 0 && onSegment(a, c, b)) || (t2 === 0 && onSegment(a, d, b)) || (t3 === 0 && onSegment(c, a, d)) || (t4 === 0 && onSegment(c, b, d));
}

// ST_Intersects(boundary, line): part of the line is inside the shape, or crosses or touches its edge.
function lineMeets(parts: LineParts, shape: Shape): boolean {
  if (!boundsNear(lineBounds(parts), shape.bounds, 0)) return false;
  if (parts.some((part) => part.some(([lng, lat]) => inside({ lng, lat }, shape)))) return true;
  const edges = ringSegments(shape);
  return segmentsOf(parts).some(([a, b]) => edges.some(([c, d]) => segmentsMeet(a, b, c, d)));
}

// Shortest distance from a point to the line, in metres, as edgeDistance measures it to a shape.
function lineDistance(point: LatLng, parts: LineParts): number {
  const ring: Shape = { polygons: parts.map((part) => [part]), bounds: lineBounds(parts) };
  const scale = metresPerDegree(point.lat);
  return edgeDistance(point, ring, scale.lng, scale.lat);
}

// ST_DWithin(boundary, line, 250 m): the line comes within the tolerance of the shape anywhere.
function lineWithinTolerance(parts: LineParts, shape: Shape): boolean {
  if (!boundsNear(lineBounds(parts), shape.bounds, SEARCH_DEGREES)) return false;
  if (lineMeets(parts, shape)) return true;
  // Apart, the two are closest at a corner of one of them.
  const nearShape = parts.some((part) =>
    part.some(([lng, lat]) => {
      const scale = metresPerDegree(lat);
      return edgeDistance({ lng, lat }, shape, scale.lng, scale.lat) <= TOLERANCE_METRES;
    }),
  );
  return nearShape || shape.polygons.some((polygon) => polygon.some((ring) => ring.some(([lng, lat]) => lineDistance({ lng, lat }, parts) <= TOLERANCE_METRES)));
}

// GEOS's Coordinate::distance. Math.hypot can differ from it in the last digit, and on a two-point line
// that decides which end is nearer the middle.
const planarDistance = (a: readonly [number, number], b: readonly [number, number]) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
};

// ST_PointOnSurface for a line, as GEOS finds it: the vertex closest to the line's centroid, leaving out
// the ends unless no part has a vertex between them. The plotted barangay is found from this point. The
// sums run in GEOS's order, as a tie between two ends comes down to the last digit.
export function pointOnLine(parts: LineParts): LatLng | null {
  let sumLng = 0;
  let sumLat = 0;
  let total = 0;
  for (const part of parts) {
    let partLength = 0;
    for (let i = 0; i < part.length - 1; i++) {
      const length = planarDistance(part[i], part[i + 1]);
      if (length === 0) continue;
      partLength += length;
      sumLng += length * ((part[i][0] + part[i + 1][0]) / 2);
      sumLat += length * ((part[i][1] + part[i + 1][1]) / 2);
    }
    total += partLength;
  }
  const first = parts.find((part) => part.length > 0)?.[0];
  if (!first) return null;
  const centre: [number, number] = total > 0 ? [sumLng / total, sumLat / total] : first;

  let best: [number, number] | null = null;
  let bestDistance = Infinity;
  const consider = (vertex: [number, number]) => {
    const distance = planarDistance(vertex, centre);
    if (distance < bestDistance) {
      best = vertex;
      bestDistance = distance;
    }
  };
  for (const part of parts) part.slice(1, -1).forEach(consider);
  if (!best) for (const part of parts) [part[0], part[part.length - 1]].forEach(consider);
  const [lng, lat] = best ?? first;
  return { lng, lat };
}

// The barangay a record is plotted in: under its point, or under the point on its line.
export function locateShape(input: { point: LatLng | null; line?: LineParts | null }, index: PlaceIndex): number | null {
  const at = input.point ?? (input.line ? pointOnLine(input.line) : null);
  return at ? locatePoint(at, index) : null;
}

// Every barangay a line crosses or touches, as interventions_sync_barangays links them.
export function barangaysCrossed(parts: LineParts, index: PlaceIndex): number[] {
  return [...index.barangays.keys()].sort((a, b) => a - b).filter((id) => lineMeets(parts, index.barangays.get(id)!));
}

export interface FlagInput {
  id: string | null;
  point: LatLng | null;
  // A line record's line, null while it waits for one. Left out for a point record.
  line?: LineParts | null;
  municipality_id: number;
  barangay_id: number | null;
  barangay_raw: string | null;
  qa_flags: string[];
  deleted_at: string | null;
}

export function computeFlags(input: FlagInput, others: Intervention[], index: PlaceIndex): string[] {
  const flags: string[] = [];
  const { point } = input;
  const line = input.line && input.line.some((part) => part.length > 0) ? input.line : null;

  if (!point && !line) {
    flags.push('no_coords');
  } else {
    // Any vertex outside the box, as the database compares the shape's extent with it.
    const { minLng, maxLng, minLat, maxLat } = PROVINCE_BOX;
    const vertices = line ? line.flat() : [[point!.lng, point!.lat]];
    if (vertices.some(([lng, lat]) => lng < minLng || lng > maxLng || lat < minLat || lat > maxLat)) flags.push('out_of_province');

    const near = (shape: Shape) => (line ? lineWithinTolerance(line, shape) : withinTolerance(point!, shape));
    const municipality = index.municipalities.get(input.municipality_id);
    if (municipality && !near(municipality)) flags.push('muni_mismatch');

    if (input.barangay_id !== null) {
      const barangay = index.barangays.get(input.barangay_id);
      if (barangay && !near(barangay)) flags.push('barangay_mismatch');
    }

    // Only points share a spot. Two roads can cross or meet.
    const shared =
      point !== null &&
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

  const plottedId = locateShape(input, index);
  // A road's warnings speak of its line, and a road with none waits for it to be traced.
  const isLine = input.line !== undefined;
  const shape = isLine ? 'line' : 'point';
  const plottedBarangay = places.barangays.find((b) => b.id === plottedId);
  const plotted = plottedBarangay
    ? {
        barangayId: plottedBarangay.id,
        municipalityId: plottedBarangay.municipality_id,
        label: `${plottedBarangay.name}, ${municipalityName(plottedBarangay.municipality_id)}`,
      }
    : null;

  if (flags.includes('no_coords')) {
    warnings.push({
      code: 'no_coords',
      message: isLine ? "No traced line yet. This road won't appear on the map until its line is traced." : "No coordinates yet. This record won't appear on the map until it has some.",
    });
  }
  if (flags.includes('out_of_province')) {
    warnings.push({ code: 'out_of_province', message: `This ${shape} is outside Marinduque, so the record won't appear on the map.` });
  } else if ((input.point || input.line) && !plotted) {
    warnings.push({ code: 'not_in_a_barangay', message: `This ${shape} isn't in any Marinduque barangay. It may be at sea.` });
  }
  // With no barangay under the point, the warnings above already say so.
  if (plotted && flags.includes('muni_mismatch')) {
    warnings.push({
      code: 'muni_mismatch',
      message: `This ${shape} is in ${plotted.label}, but the municipality is set to ${municipalityName(input.municipality_id)}.`,
    });
  }
  if (plotted && flags.includes('barangay_mismatch')) {
    warnings.push({
      code: 'barangay_mismatch',
      message: `This ${shape} is in ${plotted.label}, but the barangay is set to ${barangayName(input.barangay_id)}.`,
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
