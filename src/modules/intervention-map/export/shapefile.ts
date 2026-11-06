// Shapefile, zipped: .shp, .shx, .dbf, .prj and .cpg, one set per geometry kind. Records without
// coordinates can't be stored in one, so they're listed in a text file beside it.
import JSZip from 'jszip';
import type { Intervention, MapData } from '../data/types';
import { buildFields, unlocatedLine, type ExportField } from './fields';

const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]';
const encoder = new TextEncoder();

const MAX_TEXT_BYTES = 254; // the longest text a DBF field can hold
const NUMBER_WIDTH = 19;
const MAX_DECIMALS = 8;

type Kind = 'points' | 'lines' | 'polygons';
const SHAPE_TYPES: Record<Kind, number> = { points: 1, lines: 3, polygons: 5 };

function kindOf(geometry: GeoJSON.Geometry): Kind | null {
  switch (geometry.type) {
    case 'Point':
      return 'points';
    case 'LineString':
    case 'MultiLineString':
      return 'lines';
    case 'Polygon':
    case 'MultiPolygon':
      return 'polygons';
    default:
      return null; // a shapefile can't hold these with the rest, so they're listed instead
  }
}

// DBF names are 10 letters at most, and must differ from each other.
export function shortFieldNames(keys: string[]): Map<string, string> {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const key of keys) {
    const base = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 10) || 'FIELD';
    let name = base;
    for (let suffix = 2; taken.has(name); suffix++) name = `${base.slice(0, 10 - String(suffix).length - 1)}_${suffix}`;
    taken.add(name);
    names.set(key, name);
  }
  return names;
}

// Cutting at a byte limit mustn't leave half a letter such as ñ behind.
function fitToBytes(text: string, limit: number): Uint8Array {
  const bytes = encoder.encode(text);
  if (bytes.length <= limit) return bytes;
  let end = limit;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.slice(0, end);
}

interface DbfColumn {
  field: ExportField;
  name: string;
  width: number;
  decimals: number;
}

function decimalsIn(value: number): number {
  const text = String(value);
  if (text.includes('e')) return MAX_DECIMALS;
  return Math.min(text.split('.')[1]?.length ?? 0, MAX_DECIMALS);
}

function buildDbf(records: Intervention[], fields: ExportField[], names: Map<string, string>, today: Date): { dbf: Uint8Array; truncated: string[] } {
  const columns: DbfColumn[] = fields.map((field) => {
    const values = records.map((record) => field.read(record));
    if (field.numeric) {
      const decimals = Math.max(0, ...values.map((value) => (typeof value === 'number' ? decimalsIn(value) : 0)));
      return { field, name: names.get(field.key)!, width: NUMBER_WIDTH, decimals };
    }
    const longest = Math.max(1, ...values.map((value) => (value === null ? 0 : encoder.encode(String(value)).length)));
    return { field, name: names.get(field.key)!, width: Math.min(longest, MAX_TEXT_BYTES), decimals: 0 };
  });

  const headerLength = 32 + 32 * columns.length + 1;
  const recordLength = 1 + columns.reduce((sum, column) => sum + column.width, 0);
  const bytes = new Uint8Array(headerLength + recordLength * records.length + 1);
  const view = new DataView(bytes.buffer);

  bytes[0] = 0x03;
  bytes[1] = today.getUTCFullYear() - 1900;
  bytes[2] = today.getUTCMonth() + 1;
  bytes[3] = today.getUTCDate();
  view.setUint32(4, records.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);

  columns.forEach((column, index) => {
    const start = 32 + index * 32;
    bytes.set(encoder.encode(column.name), start);
    bytes[start + 11] = (column.field.numeric ? 'N' : 'C').charCodeAt(0);
    bytes[start + 16] = column.width;
    bytes[start + 17] = column.decimals;
  });
  bytes[headerLength - 1] = 0x0d;

  const truncated = new Set<string>();
  bytes.fill(0x20, headerLength, bytes.length - 1); // both empty values and padding are spaces
  records.forEach((record, row) => {
    let at = headerLength + row * recordLength + 1;
    for (const column of columns) {
      const value = column.field.read(record);
      if (value !== null) {
        if (column.field.numeric) {
          const text = (value as number).toFixed(column.decimals);
          bytes.set(encoder.encode(text), at + column.width - text.length);
        } else {
          const whole = encoder.encode(String(value));
          const fitted = fitToBytes(String(value), column.width);
          if (fitted.length < whole.length) truncated.add(column.field.label);
          bytes.set(fitted, at);
        }
      }
      at += column.width;
    }
  });
  bytes[bytes.length - 1] = 0x1a;
  return { dbf: bytes, truncated: [...truncated] };
}

// The shape's parts. A shapefile wants outer rings clockwise and holes counterclockwise, the
// opposite of GeoJSON.
function partsOf(geometry: GeoJSON.Geometry): number[][][] {
  const signedArea = (ring: number[][]) => ring.reduce((sum, [x, y], i) => {
    const [nextX, nextY] = ring[(i + 1) % ring.length];
    return sum + (x * nextY - nextX * y);
  }, 0);
  const oriented = (ring: number[][], clockwise: boolean) => (signedArea(ring) < 0 === clockwise ? ring : [...ring].reverse());
  const polygon = (rings: number[][][]) => rings.map((ring, index) => oriented(ring, index === 0));

  switch (geometry.type) {
    case 'LineString':
      return [geometry.coordinates];
    case 'MultiLineString':
      return geometry.coordinates;
    case 'Polygon':
      return polygon(geometry.coordinates);
    case 'MultiPolygon':
      return geometry.coordinates.flatMap(polygon);
    default:
      return [];
  }
}

function buildShp(kind: Kind, geometries: GeoJSON.Geometry[]): { shp: Uint8Array; shx: Uint8Array } {
  const shapes = geometries.map((geometry) => {
    if (geometry.type === 'Point') return { point: geometry.coordinates, parts: [] as number[][][] };
    return { point: null, parts: partsOf(geometry) };
  });
  const contentBytes = (shape: (typeof shapes)[number]) => {
    if (shape.point) return 20;
    const points = shape.parts.reduce((sum, part) => sum + part.length, 0);
    return 4 + 32 + 4 + 4 + 4 * shape.parts.length + 16 * points;
  };

  const shpLength = 100 + shapes.reduce((sum, shape) => sum + 8 + contentBytes(shape), 0);
  const shxLength = 100 + shapes.length * 8;
  const shp = new DataView(new ArrayBuffer(shpLength));
  const shx = new DataView(new ArrayBuffer(shxLength));

  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  const positions = (shape: (typeof shapes)[number]) => (shape.point ? [shape.point] : shape.parts.flat());
  for (const shape of shapes) {
    for (const [x, y] of positions(shape)) {
      west = Math.min(west, x);
      east = Math.max(east, x);
      south = Math.min(south, y);
      north = Math.max(north, y);
    }
  }

  for (const [view, length] of [[shp, shpLength], [shx, shxLength]] as const) {
    view.setInt32(0, 9994, false);
    view.setInt32(24, length / 2, false);
    view.setInt32(28, 1000, true);
    view.setInt32(32, SHAPE_TYPES[kind], true);
    view.setFloat64(36, west, true);
    view.setFloat64(44, south, true);
    view.setFloat64(52, east, true);
    view.setFloat64(60, north, true);
  }

  let at = 100;
  shapes.forEach((shape, index) => {
    const content = contentBytes(shape);
    shx.setInt32(100 + index * 8, at / 2, false);
    shx.setInt32(100 + index * 8 + 4, content / 2, false);
    shp.setInt32(at, index + 1, false);
    shp.setInt32(at + 4, content / 2, false);
    at += 8;
    shp.setInt32(at, SHAPE_TYPES[kind], true);

    if (shape.point) {
      shp.setFloat64(at + 4, shape.point[0], true);
      shp.setFloat64(at + 12, shape.point[1], true);
      at += content;
      return;
    }

    const all = positions(shape);
    const xs = all.map(([x]) => x);
    const ys = all.map(([, y]) => y);
    shp.setFloat64(at + 4, Math.min(...xs), true);
    shp.setFloat64(at + 12, Math.min(...ys), true);
    shp.setFloat64(at + 20, Math.max(...xs), true);
    shp.setFloat64(at + 28, Math.max(...ys), true);
    shp.setInt32(at + 36, shape.parts.length, true);
    shp.setInt32(at + 40, all.length, true);

    let cursor = at + 44;
    let first = 0;
    for (const part of shape.parts) {
      shp.setInt32(cursor, first, true);
      cursor += 4;
      first += part.length;
    }
    for (const [x, y] of all) {
      shp.setFloat64(cursor, x, true);
      shp.setFloat64(cursor + 8, y, true);
      cursor += 16;
    }
    at += content;
  });

  return { shp: new Uint8Array(shp.buffer), shx: new Uint8Array(shx.buffer) };
}

function fieldsText(fields: ExportField[], names: Map<string, string>, truncated: Set<string>, leftOut: number): string {
  const lines = [
    'DBF field names can only be 10 characters long. This lists what each one means.',
    '',
    'Short name  Full name',
    '----------  ---------',
    ...fields.map((field) => `${names.get(field.key)!.padEnd(10)}  ${field.label}`),
  ];
  if (truncated.size > 0) {
    lines.push('', `A DBF text field holds ${MAX_TEXT_BYTES} bytes at most, so longer values were cut short in: ${[...truncated].join(', ')}.`, 'The CSV and GeoJSON exports have them in full.');
  }
  if (leftOut > 0) lines.push('', `${leftOut} records aren't in the shapefile. See records-left-out.txt.`);
  return `${lines.join('\r\n')}\r\n`;
}

export interface BuiltShapefile {
  zip: Uint8Array;
  written: number;
  leftOut: Intervention[];
}

export async function buildShapefile(records: Intervention[], data: MapData, stem: string, today: Date): Promise<BuiltShapefile> {
  const fields = buildFields(records, data);
  const names = shortFieldNames(fields.map((field) => field.key));

  const groups = new Map<Kind, Intervention[]>();
  const leftOut: Intervention[] = [];
  for (const record of records) {
    const kind = record.geojson ? kindOf(record.geojson) : null;
    if (kind) groups.set(kind, [...(groups.get(kind) ?? []), record]);
    else leftOut.push(record);
  }

  const zip = new JSZip();
  const truncated = new Set<string>();
  for (const [kind, group] of groups) {
    const base = groups.size > 1 ? `${stem}_${kind}` : stem;
    const { shp, shx } = buildShp(kind, group.map((record) => record.geojson!));
    const { dbf, truncated: cut } = buildDbf(group, fields, names, today);
    cut.forEach((label) => truncated.add(label));
    zip.file(`${base}.shp`, shp);
    zip.file(`${base}.shx`, shx);
    zip.file(`${base}.dbf`, dbf);
    zip.file(`${base}.prj`, WGS84_PRJ);
    zip.file(`${base}.cpg`, 'UTF-8');
  }
  zip.file('fields.txt', fieldsText(fields, names, truncated, leftOut.length));
  if (leftOut.length > 0) {
    const reason = (record: Intervention) => (record.geojson ? ' (a shape a shapefile can\'t hold)' : ' (no coordinates)');
    const lines = leftOut.map((record) => `${unlocatedLine(record, data)}${reason(record)}`);
    zip.file('records-left-out.txt', `${leftOut.length} records are left out of this shapefile:\r\n\r\n${lines.join('\r\n')}\r\n`);
  }

  return {
    zip: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
    written: records.length - leftOut.length,
    leftOut,
  };
}
