// Reads an uploaded file into rows of text by column, whatever it came as. Nothing is dropped: an empty
// cell is an empty string, and a column whose name repeats is numbered.
import JSZip from 'jszip';
import Papa from 'papaparse';

export type FileKind = 'csv' | 'xlsx' | 'kml' | 'kmz';

export interface ParsedFile {
  fileName: string;
  kind: FileKind;
  columns: string[];
  rows: Record<string, string>[];
  // Each row's number as a person would see it in the file: in a sheet, counting the header and any
  // blank rows, and in a map file, the placemarks from 1.
  rowNumbers: number[];
  // Which sheet of a workbook was read.
  sheet?: string;
  notes: string[];
}

// Added to a map file's rows from each placemark's point, as these files keep coordinates apart from
// the data.
export const MAP_FILE_LATITUDE = 'Latitude (from the map file)';
export const MAP_FILE_LONGITUDE = 'Longitude (from the map file)';

export function fileKind(name: string): FileKind | null {
  const extension = name.toLowerCase().split('.').pop();
  if (extension === 'csv' || extension === 'txt') return 'csv';
  if (extension === 'xlsx' || extension === 'xls') return 'xlsx';
  if (extension === 'kml') return 'kml';
  if (extension === 'kmz') return 'kmz';
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

interface MapFeature {
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
}

// A placemark's own fields, then its point. Styles and the like aren't data.
const HIDDEN_PROPERTIES = new Set(['styleUrl', 'styleHash', 'styleMapHash', 'stroke', 'stroke-opacity', 'stroke-width', 'fill', 'fill-opacity', 'icon', 'visibility', 'timespan', 'timestamp']);

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

  const names: string[] = [];
  for (const feature of features) {
    for (const key of Object.keys(feature.properties ?? {})) if (!HIDDEN_PROPERTIES.has(key) && !names.includes(key)) names.push(key);
  }
  let notPoints = 0;
  const table: unknown[][] = [[...names, MAP_FILE_LATITUDE, MAP_FILE_LONGITUDE]];
  for (const feature of features) {
    const point = feature.geometry?.type === 'Point' ? (feature.geometry.coordinates as number[]) : null;
    if (feature.geometry && !point) notPoints += 1;
    table.push([...names.map((key) => cellText(feature.properties?.[key])), point ? String(point[1]) : '', point ? String(point[0]) : '']);
  }
  const parsed = fromTable(fileName, kind, table);
  // In a map file the rows are placemarks, counted from 1.
  parsed.rowNumbers = parsed.rowNumbers.map((number) => number - 1);
  if (notPoints > 0) parsed.notes.push(`${notPoints} placemark${notPoints === 1 ? ' is a line or shape' : 's are lines or shapes'}, not a point, so ${notPoints === 1 ? 'it comes' : 'they come'} in without coordinates.`);
  return parsed;
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const kind = fileKind(file.name);
  if (!kind) throw new Error('Choose a CSV, Excel (XLSX), KML or KMZ file.');
  if (kind === 'csv') return parseCsv(file.name, await file.text());
  const bytes = await file.arrayBuffer();
  if (kind === 'xlsx') return parseWorkbook(file.name, bytes);
  return parseMapFile(file.name, kind, bytes);
}
