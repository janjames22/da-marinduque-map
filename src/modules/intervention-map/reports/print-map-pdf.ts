// The map on screen as a printable sheet: a title, the map with a north arrow and scale bar, its legend,
// the date and data sources, and the signature blocks.
import type { ReportSignatory } from '../data/types';
import type { CapturedMap } from './map-capture';
import { activeSignatories } from './report-data';
import {
  MARGIN,
  manilaDateTime,
  manilaLongDate,
  newDocument,
  northArrow,
  pageFooters,
  pageHeight,
  pageWidth,
  paragraph,
  pdfBytes,
  pdfSafe,
  scaleBar,
  signatureBlocks,
  text,
  titleBlock,
  type Orientation,
  type Paper,
} from './pdf-common';

export interface LegendSection {
  title: string;
  // Squares for shaded barangays, dots for markers, short lines for roads.
  shape: 'square' | 'dot' | 'line';
  entries: { color: string; label: string; count?: number; dashed?: boolean }[];
}

export interface PrintMapInput {
  capture: CapturedMap;
  // On screen, at the map's center.
  metersPerPixel: number;
  title: string;
  lines: string[];
  paper: Paper;
  orientation: Orientation;
  legend: LegendSection[];
  sources: string;
  basemap: string;
  signatories: ReportSignatory[];
  now: Date;
}

const LEGEND_WIDTH = 160;
const ROW = 11;

// A label as the lines it wraps to in the room it has.
function labelLines(doc: ReturnType<typeof newDocument>, label: string, width: number): string[] {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  return doc.splitTextToSize(pdfSafe(label), width) as string[];
}

function legendHeight(sections: LegendSection[]): number {
  return sections.reduce((sum, section) => sum + 14 + section.entries.length * ROW * 1.4 + 6, 0);
}

function drawLegend(doc: ReturnType<typeof newDocument>, sections: LegendSection[], x: number, y: number, width: number, columns: number): number {
  const columnWidth = width / columns;
  let lowest = y;
  let column = 0;
  let top = y;
  for (const section of sections) {
    const left = x + column * columnWidth;
    let at = top;
    text(doc, section.title, left, at, { size: 8.5, bold: true, maxWidth: columnWidth - 6 });
    at += 13;
    for (const entry of section.entries) {
      doc.setFillColor(entry.color);
      doc.setDrawColor('#9e9d98');
      doc.setLineWidth(0.4);
      if (section.shape === 'dot') doc.circle(left + 4, at + 4, 3.6, 'FD');
      else if (section.shape === 'line') {
        doc.setDrawColor(entry.color);
        doc.setLineWidth(1.6);
        if (entry.dashed) doc.setLineDashPattern([2.5, 1.5], 0);
        doc.line(left, at + 4, left + 9, at + 4);
        doc.setLineDashPattern([], 0);
      } else doc.rect(left, at, 8, 8, 'FD');
      const lines = labelLines(doc, entry.label, columnWidth - 40);
      lines.forEach((line, index) => text(doc, line, left + 12, at + index * 9, { size: 7.5 }));
      if (entry.count !== undefined) text(doc, String(entry.count), left + columnWidth - 8, at, { size: 7.5, align: 'right', color: '#52514e' });
      at += Math.max(ROW, lines.length * 9 + 2);
    }
    lowest = Math.max(lowest, at);
    if (columns > 1) {
      column = (column + 1) % columns;
      if (column === 0) top = lowest + 6;
    } else top = at + 6;
  }
  return Math.max(lowest, top);
}

export function printMapPdf(input: PrintMapInput): Uint8Array {
  const { capture, legend, signatories, now } = input;
  const doc = newDocument(input.paper, input.orientation);
  const width = pageWidth(doc) - 2 * MARGIN;
  const top = titleBlock(doc, input.title, null, input.lines);
  const landscape = input.orientation === 'landscape';

  const signing = activeSignatories(signatories).length > 0;
  const below = 34 + (signing ? 88 : 0) + 18;
  const legendBelow = landscape ? 0 : Math.min(legendHeight(legend) / 2 + 20, 180);
  const frame = {
    x: MARGIN,
    y: top,
    width: landscape ? width - LEGEND_WIDTH - 14 : width,
    height: pageHeight(doc) - MARGIN - top - below - legendBelow,
  };

  // The map keeps its shape: as wide as it can be, or as tall.
  const ratio = capture.width / capture.height;
  const fitted = frame.width / frame.height > ratio ? { width: frame.height * ratio, height: frame.height } : { width: frame.width, height: frame.width / ratio };
  const image = { x: frame.x + (frame.width - fitted.width) / 2, y: frame.y, ...fitted };
  doc.addImage(capture.image, 'PNG', image.x, image.y, image.width, image.height, undefined, 'FAST');
  doc.setDrawColor('#52514e');
  doc.setLineWidth(0.75);
  doc.rect(image.x, image.y, image.width, image.height, 'S');
  doc.setFillColor('#ffffff');
  doc.roundedRect(image.x + image.width - 30, image.y + 6, 24, 30, 3, 3, 'F');
  northArrow(doc, image.x + image.width - 25, image.y + 9);
  scaleBar(doc, (input.metersPerPixel * capture.width) / image.width, image.x + 10, image.y + image.height - 20, Math.min(140, image.width / 3));

  let y = image.y + image.height + 8;
  if (landscape) drawLegend(doc, legend, frame.x + frame.width + 14, top, LEGEND_WIDTH, 1);
  else y = drawLegend(doc, legend, MARGIN, y, width, 2) + 4;

  const credits = [
    `Date: ${manilaLongDate(now)}.`,
    `Data: ${input.sources}.`,
    'Boundaries: NAMRIA, PSA via HDX (CC BY-IGO).',
    capture.basemapLeftOut ? 'Basemap left out: its tiles could not be copied.' : `Basemap: ${input.basemap}.`,
  ].join(' ');
  y += paragraph(doc, credits, MARGIN, y, width, { size: 7.5, color: '#52514e' });
  signatureBlocks(doc, signatories, y);
  pageFooters(doc, manilaDateTime(now));
  return pdfBytes(doc);
}
