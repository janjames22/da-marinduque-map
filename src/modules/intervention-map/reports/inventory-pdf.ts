// The inventory report as a PDF, in the layout of the RAED Consolidated Inventory Report: legal paper,
// landscape, a cover with the title, who prepared it, the date and the data source, then a ruled table
// for each type in the RAED columns. Signature blocks follow the last table.
import type { MapData, ReportSignatory } from '../data/types';
import { MARGIN, manilaDateTime, manilaLongDate, newDocument, pageFooters, pageHeight, pageWidth, paragraph, pdfBytes, signatureBlocks, table, text } from './pdf-common';
import { dataSourceLine, inventorySections, inventoryTitle, OFFICE, type InventoryFilters } from './report-data';

export interface InventoryPdfInput {
  data: MapData;
  filters: InventoryFilters;
  signatories: ReportSignatory[];
  now: Date;
}

// Narrow columns kept narrow, so names and places get the room.
const NARROW: Record<string, number> = { Qty: 28, 'Year Funded': 40, Status: 66, Stage: 60, Region: 70, Province: 58, Latitude: 54, Longitude: 58 };

export function inventoryPdf({ data, filters, signatories, now }: InventoryPdfInput): { bytes: Uint8Array; records: number } {
  const sections = inventorySections(data, filters);
  const heading = inventoryTitle(sections, filters, data);
  const doc = newDocument('legal', 'landscape');
  const width = pageWidth(doc) - 2 * MARGIN;
  const records = sections.reduce((sum, section) => sum + section.records.length, 0);
  const units = sections.reduce((sum, section) => sum + section.units, 0);

  // The cover, as the RAED report's: the title in the upper middle, then the particulars.
  let y = pageHeight(doc) * 0.28;
  for (const line of [heading.title, heading.subtitle, heading.place]) {
    y += paragraph(doc, line, MARGIN, y, width, { size: 18, bold: line === heading.title, align: 'center' }) + 8;
  }
  y = pageHeight(doc) * 0.56;
  const particular = (label: string, value: string) => {
    text(doc, label, MARGIN, y, { size: 9, bold: true });
    y += paragraph(doc, value, MARGIN + 70, y, width - 70, { size: 9 }) + 4;
  };
  particular('Prepared by:', OFFICE);
  particular('Date:', manilaLongDate(now));
  if (heading.filters.length > 0) particular('Showing:', heading.filters.join('; '));
  particular('Records:', `${records} ${records === 1 ? 'record' : 'records'}, ${units} ${units === 1 ? 'unit' : 'units'}`);
  particular(
    'Data Source:',
    `${dataSourceLine(sections.flatMap((section) => section.records))}. The inventory list was generated from the DA Marinduque Intervention Map, which keeps each record's current status, location and history.`,
  );

  if (sections.length === 0) {
    y += 16;
    paragraph(doc, 'No records match these choices.', MARGIN, y, width, { size: 11, align: 'center' });
  }

  let end = y;
  for (const section of sections) {
    doc.addPage();
    text(doc, `${section.type.name}: ${section.records.length} ${section.records.length === 1 ? 'record' : 'records'}, ${section.units} ${section.units === 1 ? 'unit' : 'units'}`, MARGIN, MARGIN, { size: 10, bold: true });
    const columnStyles = Object.fromEntries(section.columns.map((column, index) => [index, NARROW[column] ? { cellWidth: NARROW[column] } : {}]));
    end = table(doc, section.columns, section.rows, MARGIN + 18, { columnStyles, styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, lineColor: [158, 157, 152], lineWidth: 0.5, textColor: [31, 30, 28], overflow: 'linebreak', valign: 'middle' } });
  }

  signatureBlocks(doc, signatories, end);
  pageFooters(doc, manilaDateTime(now));
  return { bytes: pdfBytes(doc), records };
}
