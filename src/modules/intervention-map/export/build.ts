// Turns chosen records into a file. Loaded only when someone exports, as the zip code is large.
import Papa from 'papaparse';
import type { Barangay, Intervention, MapData, Municipality } from '../data/types';
import { buildFields } from './fields';
import { buildKml, buildKmz, type KmlBoundaries, type KmlLayers } from './kml';
import type { RenderMarker } from './marker-image';
import type { ExportFormat } from './records';
import { buildShapefile } from './shapefile';

const encoder = new TextEncoder();

export function buildCsv(records: Intervention[], data: MapData): string {
  const fields = buildFields(records, data);
  // The mark tells Excel it's UTF-8, for names with ñ. A value starting with = could run as a
  // formula when someone opens the file, so those are escaped.
  const text = Papa.unparse(
    { fields: fields.map((field) => field.label), data: records.map((record) => fields.map((field) => field.read(record))) },
    { escapeFormulae: true },
  );
  return `﻿${text}`;
}

// A record with no coordinates stays in, with no geometry, which GeoJSON allows.
export function buildGeoJson(records: Intervention[], data: MapData): string {
  const fields = buildFields(records, data);
  return JSON.stringify({
    type: 'FeatureCollection',
    features: records.map((record) => ({
      type: 'Feature',
      id: record.id,
      geometry: record.geojson,
      properties: Object.fromEntries(fields.map((field) => [field.key, field.read(record)])),
    })),
  });
}

export interface ExportFileRequest {
  format: ExportFormat;
  records: Intervention[];
  data: MapData;
  boundaries: KmlBoundaries;
  layers: KmlLayers;
  stem: string;
  filterLines: string[];
  exportedOn: string;
  exportedBy: string | null;
  barangays: Barangay[];
  municipalities: Municipality[];
  renderMarker: RenderMarker;
  now?: Date;
}

export interface ExportFile {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

const TYPES: Record<ExportFormat, string> = {
  kmz: 'application/vnd.google-earth.kmz',
  kml: 'application/vnd.google-earth.kml+xml',
  csv: 'text/csv;charset=utf-8',
  geojson: 'application/geo+json',
  shp: 'application/zip',
};
const EXTENSIONS: Record<ExportFormat, string> = { kmz: 'kmz', kml: 'kml', csv: 'csv', geojson: 'geojson', shp: 'zip' };

export async function buildExportFile(request: ExportFileRequest): Promise<ExportFile> {
  const { format, records, data, stem } = request;
  const kmlInput = () => {
    const place = request.filterLines.find((line) => /^(Barangay|Municipality): /.test(line))?.replace(/^\w+: /, '');
    return {
      ...request,
      title: `DA Interventions – ${place ? `${place}, ` : ''}Marinduque (exported ${request.exportedOn})`,
    };
  };

  const bytes = await (async () => {
    switch (format) {
      case 'kmz':
        return buildKmz(kmlInput(), request.renderMarker);
      case 'kml':
        return encoder.encode(buildKml(kmlInput(), false).kml);
      case 'csv':
        return encoder.encode(buildCsv(records, data));
      case 'geojson':
        return encoder.encode(buildGeoJson(records, data));
      case 'shp':
        return (await buildShapefile(records, data, stem, request.now ?? new Date())).zip;
    }
  })();

  return { fileName: `${stem}.${EXTENSIONS[format]}`, mimeType: TYPES[format], bytes };
}
