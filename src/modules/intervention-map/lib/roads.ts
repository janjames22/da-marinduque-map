// Lines on the map, starting with Farm-to-Market Roads (Phase 16): how long a road is, and whether it's
// built yet. The map, the record pages and the Home and Dashboard figures all ask here, so they agree.
import type { Intervention, InterventionType, MapData } from '../data/types';
import { linePartsOf, type LineParts } from './qa';

export const ROAD_TYPE_CODE = 'fmr';
// The Farm-to-Market Road type's own field for the length the source reports. A field's key never
// changes once made, so this holds even if an Admin renames the field.
export const LENGTH_FIELD = 'length_km';

// The statuses before a road is finished. Its line is dashed on the map while it's at one of these.
// Matched by name, ignoring case, spaces and hyphens, as the status list has no codes.
const UNFINISHED_STATUSES = ['proposed', 'ongoing'];

const EARTH_RADIUS_KM = 6371.0088;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

// Great-circle length along the line, in km. Within a fraction of a percent of PostGIS on the spheroid,
// which is far closer than a traced road follows the real one.
export function lineLengthKm(parts: LineParts): number {
  let total = 0;
  for (const part of parts) {
    for (let i = 1; i < part.length; i++) {
      const [lng1, lat1] = part[i - 1];
      const [lng2, lat2] = part[i];
      const a = Math.sin(radians(lat2 - lat1) / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lng2 - lng1) / 2) ** 2;
      total += 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
    }
  }
  return total;
}

export interface LineLength {
  // The length that counts: as reported if the form has it, otherwise as traced.
  km: number | null;
  basis: 'reported' | 'traced' | null;
  reportedKm: number | null;
  tracedKm: number | null;
}

function reportedKm(record: Pick<Intervention, 'attributes'>): number | null {
  const value = record.attributes[LENGTH_FIELD];
  const km = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(km) && km > 0 ? km : null;
}

// The source's own figure comes first, so the totals match what the region reports. A road without
// one counts the length of its traced line.
export function lineLength(record: Pick<Intervention, 'attributes' | 'geojson'>): LineLength {
  const reported = reportedKm(record);
  const parts = linePartsOf(record);
  const traced = parts ? lineLengthKm(parts) : null;
  const km = reported ?? traced;
  return { km, basis: reported !== null ? 'reported' : traced !== null ? 'traced' : null, reportedKm: reported, tracedKm: traced };
}

export function formatKm(km: number): string {
  const digits = km >= 10 ? 1 : 2;
  return `${km.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}

const statusKey = (name: string) => name.toLowerCase().replace(/[\s-]+/g, '');

export function isUnfinished(record: Pick<Intervention, 'status_id'>, data: Pick<MapData, 'statuses'>): boolean {
  const status = data.statuses.find((candidate) => candidate.id === record.status_id);
  return status !== undefined && UNFINISHED_STATUSES.includes(statusKey(status.name));
}

export const isLineType = (type: Pick<InterventionType, 'geometry_kind'> | undefined) => type?.geometry_kind === 'line';

export const roadType = (data: Pick<MapData, 'types'>) => data.types.find((type) => type.code === ROAD_TYPE_CODE);

export interface RoadTotals {
  roads: number;
  km: number;
  // Roads with a traced line, and those still waiting for one.
  traced: number;
  waiting: number;
  // Roads counted in the km by their traced line, as the form has no reported length.
  tracedOnly: number;
  // Roads with neither, so they add nothing to the km.
  noLength: number;
}

export function roadTotals(records: Intervention[], data: Pick<MapData, 'types'>): RoadTotals {
  const typeId = roadType(data)?.id;
  const totals: RoadTotals = { roads: 0, km: 0, traced: 0, waiting: 0, tracedOnly: 0, noLength: 0 };
  for (const record of records) {
    if (record.intervention_type_id !== typeId || record.deleted_at !== null) continue;
    const length = lineLength(record);
    totals.roads += 1;
    totals.km += length.km ?? 0;
    if (length.tracedKm !== null) totals.traced += 1;
    else totals.waiting += 1;
    if (length.basis === 'traced') totals.tracedOnly += 1;
    if (length.basis === null) totals.noLength += 1;
  }
  return totals;
}

const count = (value: number) => value.toLocaleString('en-US');

// The roads behind the km, and what the km leaves out or takes from the traced lines.
export function roadNote(roads: RoadTotals): string {
  const parts = [`${count(roads.roads)} ${roads.roads === 1 ? 'road' : 'roads'}`];
  if (roads.waiting > 0) parts.push(`${count(roads.waiting)} not yet traced`);
  if (roads.tracedOnly > 0) parts.push(`${count(roads.tracedOnly)} measured from the map`);
  if (roads.noLength > 0) parts.push(`${count(roads.noLength)} with no length yet`);
  return parts.join(' · ');
}
