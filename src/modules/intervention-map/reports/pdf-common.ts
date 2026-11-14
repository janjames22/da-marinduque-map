// What every report's PDF shares: the page, the title block, signature blocks, page footers and the
// vector maps. Loaded only when a report is downloaded, as jsPDF is large.
import { jsPDF } from 'jspdf';
import { autoTable, type UserOptions } from 'jspdf-autotable';
import type { ReportSignatory } from '../data/types';
import { boundsOf, fitProjection, niceScale, type Box, type Polygon, type Projection } from './geo';
import { OFFICE_SEAL } from '../../../app/brand';
import { activeSignatories, OFFICE } from './report-data';

export { manilaDateTime, manilaLongDate } from './report-data';

export type Paper = 'a4' | 'letter' | 'legal';
export type Orientation = 'portrait' | 'landscape';

export const MARGIN = 36;
const INK = '#1f1e1c';
const MUTED = '#52514e';
const RULE = '#9e9d98';

// Helvetica, as jsPDF has it, writes the Windows character set: Filipino names, dashes and curly quotes
// are all fine. Anything else would garble its whole line, so it's spelled out or replaced.
const EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function pdfSafe(text: string): string {
  return text
    .normalize('NFC')
    .replace(/₱\s?/g, 'PHP ')
    .replace(/[‐‑‒]/g, '-')
    .replace(/[^\n\x20-\x7e\xa0-\xff]/gu, (character) => (EXTRA.has(character) ? character : '?'));
}

export function newDocument(paper: Paper, orientation: Orientation): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: paper, orientation, compress: true });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(INK);
  doc.setLineHeightFactor(1.2);
  return doc;
}

export const pageWidth = (doc: jsPDF) => doc.internal.pageSize.getWidth();
export const pageHeight = (doc: jsPDF) => doc.internal.pageSize.getHeight();

export function text(doc: jsPDF, value: string, x: number, y: number, options: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'center' | 'right'; maxWidth?: number } = {}) {
  doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
  doc.setFontSize(options.size ?? 10);
  doc.setTextColor(options.color ?? INK);
  doc.text(pdfSafe(value), x, y, { align: options.align ?? 'left', ...(options.maxWidth ? { maxWidth: options.maxWidth } : {}), baseline: 'top' });
}

// Lines of wrapped text, and the height they took.
export function paragraph(doc: jsPDF, value: string, x: number, y: number, width: number, options: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'center' } = {}): number {
  const size = options.size ?? 10;
  doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(pdfSafe(value), width) as string[];
  doc.setTextColor(options.color ?? INK);
  const at = options.align === 'center' ? x + width / 2 : x;
  doc.text(lines, at, y, { align: options.align ?? 'left', baseline: 'top' });
  return lines.length * size * 1.2;
}

// The office's seal as a data URL for jsPDF, or null if it can't be had, as a report never fails over it.
export async function loadSeal(): Promise<string | null> {
  try {
    const response = await fetch(OFFICE_SEAL);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const SEAL_SIZE = 50;

// The office line and a report's title, at the top of its first page, with the office's seal at the left
// as on a letterhead. The text keeps clear of the seal on both sides, so it stays centered on the page.
// Returns where the content starts.
export function titleBlock(doc: jsPDF, title: string, subtitle: string | null, lines: string[] = [], seal: string | null = null): number {
  const inset = seal ? SEAL_SIZE + 10 : 0;
  const left = MARGIN + inset;
  const width = pageWidth(doc) - 2 * MARGIN - 2 * inset;
  let y = MARGIN;
  if (seal) doc.addImage(seal, 'PNG', MARGIN, MARGIN, SEAL_SIZE, SEAL_SIZE, undefined, 'FAST');
  y += paragraph(doc, OFFICE, left, y, width, { size: 9, color: MUTED, align: 'center' }) + 6;
  y += paragraph(doc, title, left, y, width, { size: 15, bold: true, align: 'center' }) + 2;
  if (subtitle) y += paragraph(doc, subtitle, left, y, width, { size: 11, align: 'center' }) + 2;
  for (const line of lines) y += paragraph(doc, line, left, y, width, { size: 9, color: MUTED, align: 'center' });
  if (seal) y = Math.max(y, MARGIN + SEAL_SIZE);
  doc.setDrawColor(RULE);
  doc.setLineWidth(0.75);
  doc.line(MARGIN, y + 6, pageWidth(doc) - MARGIN, y + 6);
  return y + 14;
}

const SIGNATURE_HEIGHT = 74;

// "Prepared by", "Noted by" and the rest, side by side, each with room to sign above the name. On a new
// page if this one hasn't the room. Returns where it ends.
export function signatureBlocks(doc: jsPDF, signatories: ReportSignatory[], top: number, footerRoom = 24): number {
  const list = activeSignatories(signatories);
  if (list.length === 0) return top;
  const width = pageWidth(doc) - 2 * MARGIN;
  const perRow = Math.min(list.length, width > 600 ? 4 : 3);
  const rows = Math.ceil(list.length / perRow);
  let y = top + 14;
  if (y + rows * SIGNATURE_HEIGHT > pageHeight(doc) - MARGIN - footerRoom) {
    doc.addPage();
    y = MARGIN;
  }
  const column = width / perRow;
  list.forEach((signatory, index) => {
    const x = MARGIN + (index % perRow) * column + 8;
    const rowTop = y + Math.floor(index / perRow) * SIGNATURE_HEIGHT;
    const lineWidth = Math.min(column - 24, 200);
    text(doc, `${signatory.label}:`, x, rowTop, { size: 9 });
    const nameTop = rowTop + 32;
    text(doc, signatory.name, x + lineWidth / 2, nameTop, { size: 10, bold: true, align: 'center', maxWidth: column - 16 });
    doc.setDrawColor(INK);
    doc.setLineWidth(0.5);
    doc.line(x, nameTop + 12, x + lineWidth, nameTop + 12);
    if (signatory.position) text(doc, signatory.position, x + lineWidth / 2, nameTop + 15, { size: 8.5, color: MUTED, align: 'center', maxWidth: column - 16 });
  });
  return y + rows * SIGNATURE_HEIGHT;
}

// On every page: when it was made, and the page number.
export function pageFooters(doc: jsPDF, generated: string) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    const y = pageHeight(doc) - MARGIN + 10;
    text(doc, `Generated ${generated} from the DA Marinduque Intervention Map`, MARGIN, y, { size: 7.5, color: MUTED });
    text(doc, `Page ${page} of ${pages}`, pageWidth(doc) - MARGIN, y, { size: 7.5, color: MUTED, align: 'right' });
  }
}

// A table in the report's style, with its header on every page. Returns where it ends.
export function table(doc: jsPDF, head: string[], body: string[][], startY: number, options: Partial<UserOptions> = {}): number {
  autoTable(doc, {
    head: [head.map(pdfSafe)],
    body: body.map((row) => row.map(pdfSafe)),
    startY,
    theme: 'grid',
    margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN + 18 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, lineColor: [158, 157, 152], lineWidth: 0.5, textColor: [31, 30, 28], overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [232, 238, 233], textColor: [31, 30, 28], fontStyle: 'bold', valign: 'middle' },
    showHead: 'everyPage',
    ...options,
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

// ---------------------------------------------------------------------------
// Vector maps
// ---------------------------------------------------------------------------

function path(doc: jsPDF, polygon: Polygon, projection: Projection) {
  for (const ring of polygon) {
    ring.forEach(([lng, lat], index) => {
      const [x, y] = projection.project(lng, lat);
      if (index === 0) doc.moveTo(x, y);
      else doc.lineTo(x, y);
    });
    doc.close();
  }
}

export interface MapLayer {
  polygons: Polygon[];
  fill?: string;
  stroke?: string;
  width?: number;
}

export interface MapPoint {
  lat: number;
  lng: number;
  color: string;
}

export interface VectorMapOptions {
  layers: MapLayer[];
  points: MapPoint[];
  // What the map is fitted to. The layers outside it are clipped.
  focus: Polygon[];
  pointRadius?: number;
}

// A map drawn in lines and shapes, so it prints sharp at any size, with a frame, a north arrow and a
// scale bar. Returns the projection, for anything drawn on top.
export function vectorMap(doc: jsPDF, box: Box, options: VectorMapOptions): Projection | null {
  const bounds = boundsOf(options.focus, options.points);
  if (!bounds) return null;
  const projection = fitProjection(bounds, box);

  doc.saveGraphicsState();
  doc.rect(box.x, box.y, box.width, box.height, null);
  doc.clip();
  doc.discardPath();
  doc.setFillColor('#eef3f6');
  doc.rect(box.x, box.y, box.width, box.height, 'F');
  for (const layer of options.layers) {
    doc.setLineWidth(layer.width ?? 0.5);
    if (layer.stroke) doc.setDrawColor(layer.stroke);
    if (layer.fill) doc.setFillColor(layer.fill);
    for (const polygon of layer.polygons) {
      path(doc, polygon, projection);
      if (layer.fill && layer.stroke) doc.fillStrokeEvenOdd();
      else if (layer.fill) doc.fillEvenOdd();
      else doc.stroke();
    }
  }
  const radius = options.pointRadius ?? 2.6;
  doc.setLineWidth(0.6);
  doc.setDrawColor('#ffffff');
  for (const point of options.points) {
    const [x, y] = projection.project(point.lng, point.lat);
    doc.setFillColor(point.color);
    doc.circle(x, y, radius, 'FD');
  }
  doc.restoreGraphicsState();

  doc.setDrawColor(RULE);
  doc.setLineWidth(0.75);
  doc.rect(box.x, box.y, box.width, box.height, 'S');
  northArrow(doc, box.x + box.width - 22, box.y + 10);
  scaleBar(doc, projection.metersPerUnit, box.x + 10, box.y + box.height - 20, Math.min(120, box.width / 3));
  return projection;
}

export function northArrow(doc: jsPDF, x: number, y: number, size = 14) {
  doc.setFillColor(INK);
  doc.setDrawColor(INK);
  doc.setLineWidth(0.6);
  doc.triangle(x, y + size, x + size / 2, y, x + size / 2, y + size * 0.75, 'F');
  doc.setFillColor('#ffffff');
  doc.triangle(x + size, y + size, x + size / 2, y, x + size / 2, y + size * 0.75, 'FD');
  text(doc, 'N', x + size / 2, y + size + 1, { size: 8, bold: true, align: 'center' });
}

export function scaleBar(doc: jsPDF, metersPerUnit: number, x: number, y: number, maxWidth: number) {
  const { units, label } = niceScale(metersPerUnit, maxWidth);
  doc.setFillColor('#ffffff');
  doc.rect(x - 4, y - 4, units + 8 + 40, 16, 'F');
  doc.setDrawColor(INK);
  doc.setLineWidth(0.8);
  doc.line(x, y + 6, x + units, y + 6);
  doc.line(x, y + 2, x, y + 8);
  doc.line(x + units, y + 2, x + units, y + 8);
  text(doc, label, x + units + 4, y + 1.5, { size: 7.5 });
}

// A row of colored dots and their meaning, wrapping across the given width. Returns where it ends.
export function legendRow(doc: jsPDF, entries: { color: string; label: string }[], x: number, y: number, width: number): number {
  let cursorX = x;
  let cursorY = y;
  doc.setFontSize(8);
  for (const entry of entries) {
    const label = pdfSafe(entry.label);
    const itemWidth = 14 + doc.getTextWidth(label) + 12;
    if (cursorX + itemWidth > x + width && cursorX > x) {
      cursorX = x;
      cursorY += 12;
    }
    doc.setFillColor(entry.color);
    doc.setDrawColor('#ffffff');
    doc.circle(cursorX + 4, cursorY + 4.5, 3.5, 'F');
    text(doc, entry.label, cursorX + 11, cursorY, { size: 8 });
    cursorX += itemWidth;
  }
  return cursorY + 12;
}

export function pdfBytes(doc: jsPDF): Uint8Array {
  return new Uint8Array(doc.output('arraybuffer'));
}
