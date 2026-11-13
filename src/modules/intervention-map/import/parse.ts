// Reads an uploaded file into rows of text by column, whatever it came as. Nothing is dropped: an empty
// cell is an empty string, and a column whose name repeats is numbered. A map file's lines come beside
// its rows (Phase 16c).
import JSZip from 'jszip';
import Papa from 'papaparse';

export type FileKind = 'csv' | 'xlsx' | 'kml' | 'kmz' | 'geojson';

// A line's parts, each a list of [longitude, latitude]: one part, or several for a line in pieces.
export type ImportedLine = [number, number][][];

export interface ParsedFile {
  fileName: string;
  kind: FileKind;
  columns: string[];
  rows: Record<string, string>[];
  // Each row's number as a person would see it in the file: in a sheet, counting the header and any
  // blank rows, and in a map file, the placemarks from 1.
  rowNumbers: number[];
  // In a map file, each row's line, beside its row: null for a point or anything else. A line has no
  // column of its own, as it's too long for a cell.
  lines?: (ImportedLine | null)[];
  // Which sheet of a workbook was read.
  sheet?: string;
  notes: string[];
}

// Added to a map file's rows from each placemark's point, as these files keep coordinates apart from
// the data.
export const MAP_FILE_LATITUDE = 'Latitude (from the map file)';
export const MAP_FILE_LONGITUDE = 'Longitude (from the map file)';

export const isMapFile = (kind: FileKind) => kind === 'kml' || kind === 'kmz' || kind === 'geojson';

export function fileKind(name: string): FileKind | null {
  const extension = name.toLowerCase().split('.').pop();
  if (extension === 'csv' || extension === 'txt') return 'csv';
  if (extension === 'xlsx' || extension === 'xls') return 'xlsx';
  if (extension === 'kml') return 'kml';
  if (extension === 'kmz') return 'kmz';
  if (extension === 'geojson' || extension === 'json') return 'geojson';
  return null;
}

// "Name", "Name" and "Name" become "Name", "Name (2)" and "Name (3)". A blank one is "Column 4".
export function uniqueColumns(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header.replace(/\s+/g, ' ').trim() || `Column ${index + 1}`;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

const cellText = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());

function fromTable(fileName: string, kind: FileKind, table: unknown[][], extra: Partial<ParsedFile> = {}): ParsedFile {
  // The header is the first row with at least two cells filled. Spreadsheets often start with a title,
  // in one cell, or a gap.
  const filled = (cells: unknown[]) => cells.filter((cell) => cellText(cell) !== '').length;
  const headerIndex = table.some((cells) => filled(cells) >= 2) ? table.findIndex((cells) => filled(cells) >= 2) : table.findIndex((cells) => filled(cells) > 0);
  if (headerIndex < 0) return { fileName, kind, columns: [], rows: [], rowNumbers: [], notes: [], ...extra };
  const width = Math.max(...table.map((cells) => cells.length));
  const columns = uniqueColumns(Array.from({ length: width }, (_, index) => cellText(table[headerIndex][index])));
  const notes: string[] = headerIndex > 0 ? [`The column names were taken from row ${headerIndex + 1}.`] : [];
  const rows: Record<string, string>[] = [];
  const rowNumbers: number[] = [];
  table.slice(headerIndex + 1).forEach((cells, index) => {
    const values = columns.map((_, column) => cellText(cells[column]));
    // Blank rows at the end, or between groups, aren't records.
    if (values.every((value) => value === '')) return;
    rows.push(Object.fromEntries(columns.map((column, position) => [column, values[position]])));
    rowNumbers.push(headerIndex + index + 2);
  });
  return { fileName, kind, columns, rows, rowNumbers, notes: [...notes, ...(extra.notes ?? [])], ...(extra.sheet ? { sheet: extra.sheet } : {}) };
}

export function parseCsv(fileName: string, text: string): ParsedFile {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: false });
  return fromTable(fileName, 'csv', parsed.data);
}

export async function parseWorkbook(fileName: string, bytes: ArrayBuffer): Promise<ParsedFile> {
  const XLSX = await import('xlsx');
  // Number formats are kept, as they're what says a cell is a date.
  const workbook = XLSX.read(bytes, { type: 'array', cellNF: true });
  // The first sheet with anything on it.
  const name = workbook.SheetNames.find((sheet) => {
    const ref = workbook.Sheets[sheet]?.['!ref'];
    return ref !== undefined && ref !== 'A1';
  }) ?? workbook.SheetNames[0];
  // Cell by cell: a date as YYYY-MM-DD whatever its display format, a number in full, without the
  // separators or rounding its format shows, and anything else as it reads.
  const sheet = workbook.Sheets[name];
  const table: string[][] = [];
  if (sheet['!ref']) {
    const range = XLSX.utils.decode_range(sheet['!ref']);
    for (let row = range.s.r; row <= range.e.r; row++) {
      const cells: string[] = [];
      for (let column = range.s.c; column <= range.e.c; column++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as { t: string; v: unknown; w?: string; z?: string } | undefined;
        if (!cell || cell.v === undefined || cell.v === null) cells.push('');
        else if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) cells.push(XLSX.SSF.format('yyyy-mm-dd', cell.v as number));
        else if (cell.t === 'n') cells.push(String(cell.v));
        else cells.push(cell.w ?? String(cell.v));
      }
      table.push(cells);
    }
  }
  const others = workbook.SheetNames.length - 1;
  return fromTable(fileName, 'xlsx', table, {
    sheet: name,
    notes: others > 0 ? [`Read the sheet "${name}". The workbook has ${others} other sheet${others === 1 ? '' : 's'}, which were left out.`] : [],
  });
}

interface MapGeometry {
  type: string;
  coordinates?: unknown;
  geometries?: MapGeometry[];
}

interface MapFeature {
  geometry: MapGeometry | null;
  properties: Record<string, unknown> | null;
}

// A placemark's own fields, then its point. Styles and the like aren't data.
const HIDDEN_PROPERTIES = new Set(['styleUrl', 'styleHash', 'styleMapHash', 'stroke', 'stroke-opacity', 'stroke-width', 'fill', 'fill-opacity', 'icon', 'visibility', 'timespan', 'timestamp']);

const NOT_DEGREES =
  "This file's coordinates aren't longitude and latitude, so it may be saved in another coordinate system. Save it again as WGS 84 (EPSG:4326), such as with QGIS's Export, and choose it again.";

// [longitude, latitude], without any height. Refused when it can't be a place on the earth, which is
// what a file in metres, such as UTM, looks like.
function position(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [lng, lat] = value as unknown[];
  if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) throw new Error(NOT_DEGREES);
  return [lng, lat];
}

// A line part with fewer than two places isn't a line.
function part(value: unknown): [number, number][] | null {
  if (!Array.isArray(value)) return null;
  const places = value.map(position).filter((place): place is [number, number] => place !== null);
  return places.length >= 2 ? places : null;
}

// What a feature is, for the import: a point, a line in one or more parts, or something it can't use,
// such as an area. A collection of lines, as KML's MultiGeometry gives, is one line in parts.
type Shape = { kind: 'point'; point: [number, number] } | { kind: 'line'; parts: ImportedLine } | { kind: 'other' } | null;

function shapeOf(geometry: MapGeometry | null): Shape {
  if (!geometry) return null;
  switch (geometry.type) {
    case 'Point': {
      const point = position(geometry.coordinates);
      return point ? { kind: 'point', point } : { kind: 'other' };
    }
    case 'LineString': {
      const line = part(geometry.coordinates);
      return line ? { kind: 'line', parts: [line] } : { kind: 'other' };
    }
    case 'MultiLineString': {
      const parts = Array.isArray(geometry.coordinates) ? geometry.coordinates.map(part).filter((line): line is [number, number][] => line !== null) : [];
      return parts.length > 0 ? { kind: 'line', parts } : { kind: 'other' };
    }
    case 'GeometryCollection': {
      const shapes = (geometry.geometries ?? []).map(shapeOf);
      if (shapes.length > 0 && shapes.every((shape) => shape?.kind === 'line')) {
        return { kind: 'line', parts: shapes.flatMap((shape) => (shape?.kind === 'line' ? shape.parts : [])) };
      }
      return shapes.length === 1 ? shapes[0] : { kind: 'other' };
    }
    default:
      return { kind: 'other' };
  }
}

const propertyText = (value: unknown) => (value !== null && typeof value === 'object' ? JSON.stringify(value) : cellText(value));
const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// Placemarks or features as rows: their own fields as columns, a point as the two coordinate columns,
// and a line beside the row. Rows are counted from 1, as the features are.
function fromFeatures(fileName: string, kind: FileKind, features: MapFeature[], noun: [string, string]): ParsedFile {
  const names: string[] = [];
  for (const feature of features) {
    for (const key of Object.keys(feature.properties ?? {})) if (!HIDDEN_PROPERTIES.has(key) && !names.includes(key)) names.push(key);
  }
  const shapes = features.map((feature) => shapeOf(feature.geometry));
  const points = shapes.filter((shape) => shape?.kind === 'point').length;
  const lines = shapes.filter((shape) => shape?.kind === 'line').length;
  const others = shapes.filter((shape) => shape?.kind === 'other').length;

  // The coordinate columns only when there's a point to fill them.
  const columns = uniqueColumns(points > 0 ? [...names, MAP_FILE_LATITUDE, MAP_FILE_LONGITUDE] : names);
  const parsed: ParsedFile = { fileName, kind, columns, rows: [], rowNumbers: [], lines: [], notes: [] };
  features.forEach((feature, index) => {
    const shape = shapes[index];
    const point = shape?.kind === 'point' ? shape.point : null;
    const cells = names.map((key) => propertyText(feature.properties?.[key]));
    if (points > 0) cells.push(point ? String(point[1]) : '', point ? String(point[0]) : '');
    // A feature with blank fields still counts when it has a shape, as that may be all it brings.
    if (cells.every((cell) => cell === '') && !shape) return;
    parsed.rows.push(Object.fromEntries(columns.map((column, position) => [column, cells[position]])));
    parsed.rowNumbers.push(index + 1);
    parsed.lines!.push(shape?.kind === 'line' ? shape.parts : null);
  });

  if (lines > 0) parsed.notes.push(`${counted(lines, `${noun[0]} is a line`, `${noun[1]} are lines`)}. A line comes in as a road's traced line, for a line type such as Farm-to-Market Road.`);
  if (points > 0 && lines > 0) parsed.notes.push(`${counted(points, `${noun[0]} is a point`, `${noun[1]} are points`)}, which come in with their coordinates for a point type.`);
  if (others > 0) parsed.notes.push(`${counted(others, `${noun[0]} is an area or another shape`, `${noun[1]} are areas or other shapes`)}, not a point or a line, so ${others === 1 ? 'it comes' : 'they come'} in without a location.`);
  return parsed;
}

export async function parseMapFile(fileName: string, kind: 'kml' | 'kmz', bytes: ArrayBuffer): Promise<ParsedFile> {
  let text: string;
  if (kind === 'kmz') {
    const zip = await JSZip.loadAsync(bytes);
    const entry = Object.values(zip.files).find((file) => !file.dir && file.name.toLowerCase().endsWith('.kml'));
    if (!entry) throw new Error('This KMZ file has no KML inside it.');
    text = await entry.async('string');
  } else {
    text = new TextDecoder().decode(bytes);
  }
  const { kml } = await import('@tmcw/togeojson');
  const document = new DOMParser().parseFromString(text, 'text/xml');
  if (document.getElementsByTagName('parsererror').length > 0) throw new Error('This map file couldn\'t be read. It may be damaged.');
  const features = (kml(document) as { features: MapFeature[] }).features;
  return fromFeatures(fileName, kind, features, ['placemark', 'placemarks']);
}

// GeoJSON is longitude and latitude unless it names another system, as files from before its current
// version could.
const DEGREES = /crs84|4326|wgs\s*84/i;

export function parseGeoJson(fileName: string, text: string): ParsedFile {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('This GeoJSON file couldn\'t be read. It may be damaged.');
  }
  const object = (json ?? {}) as { type?: string; features?: unknown; geometry?: unknown; properties?: unknown; crs?: { properties?: { name?: unknown } } };
  const named = object.crs?.properties?.name;
  if (typeof named === 'string' && !DEGREES.test(named)) throw new Error(NOT_DEGREES);

  let features: MapFeature[];
  if (object.type === 'FeatureCollection' && Array.isArray(object.features)) features = object.features as MapFeature[];
  else if (object.type === 'Feature') features = [object as MapFeature];
  else if (typeof object.type === 'string' && ('coordinates' in object || 'geometries' in object)) features = [{ geometry: object as MapGeometry, properties: {} }];
  else throw new Error('This file isn\'t GeoJSON: it has no features in it.');
  return fromFeatures(fileName, 'geojson', features.map((feature) => ({ geometry: feature?.geometry ?? null, properties: feature?.properties ?? null })), ['feature', 'features']);
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const kind = fileKind(file.name);
  if (!kind) throw new Error('Choose a CSV, Excel (XLSX), KML, KMZ or GeoJSON file.');
  if (kind === 'csv') return parseCsv(file.name, await file.text());
  if (kind === 'geojson') return parseGeoJson(file.name, await file.text());
  const bytes = await file.arrayBuffer();
  if (kind === 'xlsx') return parseWorkbook(file.name, bytes);
  return parseMapFile(file.name, kind, bytes);
}
