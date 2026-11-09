// The inventory report as an Excel workbook: the same title, particulars, sections and columns as the
// PDF, then the signature blocks. It prints on legal paper, landscape, with grid lines, as the RAED
// report does. Years, units and coordinates are numbers, so they sort and filter as numbers.
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import type { MapData, ReportSignatory } from '../data/types';
import { activeSignatories, dataSourceLine, inventorySections, inventoryTitle, manilaLongDate, OFFICE, type InventoryFilters } from './report-data';

export interface InventoryXlsxInput {
  data: MapData;
  filters: InventoryFilters;
  signatories: ReportSignatory[];
  now: Date;
}

const NUMERIC = new Set(['Qty', 'Year Funded', 'Latitude', 'Longitude']);
const WIDTHS: Record<string, number> = {
  'Machine Name': 28,
  'Project Type': 26,
  'Project Title': 34,
  Qty: 6,
  'Year Funded': 8,
  'Banner Program': 24,
  Beneficiary: 36,
  Status: 14,
  Stage: 14,
  Region: 22,
  Province: 12,
  Municipality: 14,
  Barangay: 18,
  Latitude: 11,
  Longitude: 11,
};

type Cell = string | number | null;

// Excel's own print settings, which this edition of SheetJS doesn't write: legal paper (size 5),
// landscape, and the grid printed. They go in their place in the sheet, around its margins.
async function withPrintSettings(bytes: ArrayBuffer): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const path = 'xl/worksheets/sheet1.xml';
  const sheet = await zip.file(path)!.async('string');
  const patched = sheet.replace(/<pageMargins[^>]*\/>/, (margins) => `<printOptions gridLines="1"/>${margins}<pageSetup paperSize="5" orientation="landscape"/>`);
  zip.file(path, patched);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function inventoryXlsx({ data, filters, signatories, now }: InventoryXlsxInput): Promise<{ bytes: Uint8Array; records: number }> {
  const sections = inventorySections(data, filters);
  const heading = inventoryTitle(sections, filters, data);
  const records = sections.reduce((sum, section) => sum + section.records.length, 0);
  const units = sections.reduce((sum, section) => sum + section.units, 0);
  const widest = Math.max(12, ...sections.map((section) => section.columns.length));

  const rows: Cell[][] = [];
  const merges: XLSX.Range[] = [];
  const fullWidth = (value: string) => {
    merges.push({ s: { r: rows.length, c: 0 }, e: { r: rows.length, c: widest - 1 } });
    rows.push([value]);
  };
  fullWidth(heading.title);
  fullWidth(heading.subtitle);
  fullWidth(heading.place);
  rows.push([]);
  const particular = (label: string, value: string) => {
    merges.push({ s: { r: rows.length, c: 1 }, e: { r: rows.length, c: widest - 1 } });
    rows.push([label, value]);
  };
  particular('Prepared by:', OFFICE);
  particular('Date:', manilaLongDate(now));
  if (heading.filters.length > 0) particular('Showing:', heading.filters.join('; '));
  particular('Records:', `${records} ${records === 1 ? 'record' : 'records'}, ${units} ${units === 1 ? 'unit' : 'units'}`);
  particular('Data Source:', `${dataSourceLine(sections.flatMap((section) => section.records))}. Generated from the DA Marinduque Intervention Map.`);

  for (const section of sections) {
    rows.push([]);
    rows.push([`${section.type.name}: ${section.records.length} ${section.records.length === 1 ? 'record' : 'records'}, ${section.units} ${section.units === 1 ? 'unit' : 'units'}`]);
    rows.push(section.columns);
    for (const row of section.rows) {
      rows.push(row.map((value, index) => (NUMERIC.has(section.columns[index]) && value !== '' && Number.isFinite(Number(value)) ? Number(value) : value)));
    }
  }
  if (sections.length === 0) rows.push([], ['No records match these choices.']);

  // Signature blocks, side by side: the label, room to sign, the name, then the position.
  const list = activeSignatories(signatories);
  if (list.length > 0) {
    const step = Math.max(3, Math.floor(widest / list.length));
    const line = (read: (signatory: ReportSignatory) => string) => {
      const row: Cell[] = [];
      list.forEach((signatory, index) => (row[index * step] = read(signatory)));
      return row;
    };
    rows.push([], [], line((signatory) => `${signatory.label}:`), [], [], line((signatory) => signatory.name), line((signatory) => signatory.position));
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!merges'] = merges;
  const columns = sections[0]?.columns ?? [];
  sheet['!cols'] = Array.from({ length: widest }, (_, index) => ({ wch: WIDTHS[columns[index]] ?? 14 }));
  sheet['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Inventory');
  const written = XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
  return { bytes: await withPrintSettings(written), records };
}
