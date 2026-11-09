// What a report's map shows, for both the screen and the PDF, so the two always agree.
import type { Intervention, MapData } from '../data/types';
import type { Boundaries } from '../state/use-map-data';
import { allPolygons, polygonsOf, type Polygon } from './geo';
import type { BeneficiaryRecord, MunicipalProfile } from './report-data';

export const WITH_RECORDS = '#d6e9d2';
const WITHOUT = '#ffffff';
const NEIGHBOUR = '#ecebe7';
const NO_PROGRAM = '#757575';

export interface ReportMapContent {
  focus: Polygon[];
  layers: { polygons: Polygon[]; fill?: string; stroke?: string; width?: number }[];
  points: { lat: number; lng: number; color: string }[];
  legend: { color: string; label: string }[];
}

function pointsOf(records: Intervention[], data: Pick<MapData, 'programs'>) {
  const color = new Map(data.programs.map((program) => [program.id, program.color]));
  return records
    .filter((record) => record.geojson?.type === 'Point')
    .map((record) => {
      const [lng, lat] = (record.geojson as GeoJSON.Point).coordinates;
      return { lng, lat, color: color.get(record.banner_program_id ?? -1) ?? NO_PROGRAM };
    });
}

const programLegend = (records: Intervention[], data: Pick<MapData, 'programs'>) =>
  data.programs.filter((program) => records.some((record) => record.banner_program_id === program.id)).map((program) => ({ color: program.color, label: program.name }));

// The municipality's barangays, shaded by whether each has an intervention, among its neighbours.
export function municipalMap(profile: MunicipalProfile, data: Pick<MapData, 'barangays' | 'programs'>, boundaries: Boundaries): ReportMapContent {
  const byCode = new Map(data.barangays.map((barangay) => [barangay.psgc_code, barangay]));
  const gaps = new Set(profile.gaps.map((barangay) => barangay.id));
  const own = boundaries.barangays.features.filter((feature) => byCode.get(feature.properties?.adm4_pcode)?.municipality_id === profile.municipality.id);
  const others = boundaries.barangays.features.filter((feature) => byCode.get(feature.properties?.adm4_pcode)?.municipality_id !== profile.municipality.id);
  const shapes = (withRecords: boolean) =>
    own.filter((feature) => gaps.has(byCode.get(feature.properties?.adm4_pcode)!.id) !== withRecords).flatMap((feature) => polygonsOf(feature.geometry));
  const outline = boundaries.municipalities.features.filter((feature) => feature.properties?.adm3_pcode === profile.municipality.psgc_code).flatMap((feature) => polygonsOf(feature.geometry));
  return {
    focus: outline.length > 0 ? outline : own.flatMap((feature) => polygonsOf(feature.geometry)),
    layers: [
      { polygons: others.flatMap((feature) => polygonsOf(feature.geometry)), fill: NEIGHBOUR, stroke: '#ffffff', width: 0.4 },
      { polygons: shapes(true), fill: WITH_RECORDS, stroke: '#9e9d98', width: 0.4 },
      { polygons: shapes(false), fill: WITHOUT, stroke: '#9e9d98', width: 0.4 },
      { polygons: allPolygons(boundaries.municipalities), stroke: '#52514e', width: 0.9 },
    ],
    points: pointsOf(profile.records, data),
    legend: [...programLegend(profile.records, data), { color: WITH_RECORDS, label: 'Barangay with an intervention' }],
  };
}

// Where one beneficiary's interventions are, among the municipalities they're in.
export function beneficiaryMap(rows: BeneficiaryRecord[], municipalities: string[], data: Pick<MapData, 'municipalities' | 'programs'>, boundaries: Boundaries): ReportMapContent {
  const records = rows.map((row) => row.record);
  const codes = new Set(data.municipalities.filter((municipality) => municipalities.includes(municipality.name)).map((municipality) => municipality.psgc_code));
  return {
    focus: boundaries.municipalities.features.filter((feature) => codes.has(feature.properties?.adm3_pcode)).flatMap((feature) => polygonsOf(feature.geometry)),
    layers: [
      { polygons: allPolygons(boundaries.barangays), fill: '#ffffff', stroke: '#c9c8c3', width: 0.4 },
      { polygons: allPolygons(boundaries.municipalities), stroke: '#52514e', width: 0.9 },
    ],
    points: pointsOf(records, data),
    legend: programLegend(records, data),
  };
}
