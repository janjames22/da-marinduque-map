// A municipality on one page: its map with the interventions, the figures that matter, tables by program,
// status and category, and the barangays with no intervention yet. Signature blocks at the foot.
import type { MapData, ReportSignatory } from '../data/types';
import type { Boundaries } from '../state/use-map-data';
import { municipalMap } from './map-layers';
import { legendRow, MARGIN, manilaDateTime, manilaLongDate, newDocument, pageFooters, pageWidth, paragraph, pdfBytes, signatureBlocks, table, text, titleBlock, vectorMap } from './pdf-common';
import { BOUNDARY_SOURCE, dataSourceLine, municipalProfile, type TallyRow } from './report-data';

export interface MunicipalPdfInput {
  data: MapData;
  boundaries: Boundaries;
  municipalityId: number;
  signatories: ReportSignatory[];
  now: Date;
}

// A long list of categories keeps to the page, with the rest added up.
const MOST_ROWS = 12;

function shortened(rows: TallyRow[]): string[][] {
  const shown = rows.slice(0, MOST_ROWS).map((row) => [row.label, String(row.records), String(row.units)]);
  const rest = rows.slice(MOST_ROWS);
  if (rest.length > 0) {
    shown.push([`${rest.length} others`, String(rest.reduce((sum, row) => sum + row.records, 0)), String(rest.reduce((sum, row) => sum + row.units, 0))]);
  }
  return shown;
}

export function municipalPdf({ data, boundaries, municipalityId, signatories, now }: MunicipalPdfInput): { bytes: Uint8Array; records: number } | null {
  const profile = municipalProfile(data, municipalityId);
  if (!profile) return null;
  const { municipality, numbers } = profile;
  const doc = newDocument('a4', 'portrait');
  const width = pageWidth(doc) - 2 * MARGIN;
  let y = titleBlock(doc, `MUNICIPAL PROFILE: ${municipality.name.toUpperCase()}`, `Interventions in ${municipality.name}, Marinduque`, [`As of ${manilaLongDate(now)}`]);

  // The map, with every barangay of the municipality shaded by whether it has an intervention.
  const map = municipalMap(profile, data, boundaries);
  const mapBox = { x: MARGIN, y, width: width * 0.6, height: 270 };
  vectorMap(doc, mapBox, map);

  // The figures, beside the map.
  const figuresX = mapBox.x + mapBox.width + 14;
  const figuresWidth = width - mapBox.width - 14;
  let figureY = y;
  const figure = (value: string, label: string, note?: string) => {
    text(doc, value, figuresX, figureY, { size: 16, bold: true });
    figureY += 19;
    figureY += paragraph(doc, label, figuresX, figureY, figuresWidth, { size: 8.5 });
    if (note) figureY += paragraph(doc, note, figuresX, figureY, figuresWidth, { size: 7.5, color: '#52514e' });
    figureY += 8;
  };
  figure(String(numbers.records), numbers.records === 1 ? 'intervention' : 'interventions');
  for (const tile of numbers.types.filter((type) => type.units > 0)) figure(String(tile.units), tile.label);
  figure(String(numbers.beneficiaries), 'beneficiaries (approx.)', 'Names compared ignoring case, spacing and punctuation.');
  const share = numbers.operational;
  figure(
    share.percent === null ? '—' : `${share.percent}%`,
    'operational',
    share.assessed === 0 ? 'No unit has had its condition checked yet.' : `${share.units} of ${share.assessed} assessed units. ${share.notAssessed.reduce((sum, entry) => sum + entry.units, 0)} not yet assessed.`,
  );
  figure(`${numbers.barangaysWithout} of ${numbers.barangaysTotal}`, 'barangays with no intervention yet');

  y = mapBox.y + mapBox.height + 6;
  y = legendRow(doc, map.legend, MARGIN, y, width) + 4;

  // Three tables side by side.
  const gap = 10;
  const columnWidth = (width - 2 * gap) / 3;
  const tables: [string, TallyRow[]][] = [
    ['Program', profile.byProgram],
    ['Status', profile.byStatus],
    ['Category', profile.byCategory],
  ];
  let lowest = y;
  tables.forEach(([title, rows], index) => {
    const left = MARGIN + index * (columnWidth + gap);
    const end = table(doc, [title, 'Records', 'Units'], rows.length > 0 ? shortened(rows) : [['None', '0', '0']], y, {
      margin: { left, right: pageWidth(doc) - left - columnWidth, top: MARGIN, bottom: MARGIN },
      tableWidth: columnWidth,
      styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2, lineColor: [158, 157, 152], lineWidth: 0.5, textColor: [31, 30, 28] },
      columnStyles: { 1: { cellWidth: 38, halign: 'right' }, 2: { cellWidth: 30, halign: 'right' } },
      pageBreak: 'avoid',
    });
    lowest = Math.max(lowest, end);
  });
  y = lowest + 10;

  text(doc, `Barangays with no intervention yet (${profile.gaps.length} of ${profile.barangays.length})`, MARGIN, y, { size: 9, bold: true });
  y += 12;
  y += paragraph(doc, profile.gaps.length > 0 ? profile.gaps.map((barangay) => barangay.name).join(', ') : 'Every barangay has at least one intervention.', MARGIN, y, width, { size: 8.5 });
  y += paragraph(doc, 'This shows what has been encoded, not what exists on the ground.', MARGIN, y + 2, width, { size: 7.5, color: '#52514e' });
  y += paragraph(doc, `Data source: ${dataSourceLine(profile.records)}. ${BOUNDARY_SOURCE}.`, MARGIN, y + 4, width, { size: 7.5, color: '#52514e' });

  signatureBlocks(doc, signatories, y + 4);
  pageFooters(doc, manilaDateTime(now));
  return { bytes: pdfBytes(doc), records: profile.records.length };
}
