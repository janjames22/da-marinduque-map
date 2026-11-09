// One beneficiary's interventions: what they received, where each is, and each one's status history.
import type { MapData, ReportSignatory } from '../data/types';
import type { Boundaries } from '../state/use-map-data';
import { beneficiaryMap } from './map-layers';
import { legendRow, MARGIN, manilaDateTime, manilaLongDate, newDocument, pageFooters, pageHeight, pageWidth, paragraph, pdfBytes, signatureBlocks, table, text, titleBlock, vectorMap } from './pdf-common';
import { BOUNDARY_SOURCE, beneficiaryGroups, beneficiaryRecords, dataSourceLine } from './report-data';

export interface BeneficiaryPdfInput {
  data: MapData;
  boundaries: Boundaries;
  beneficiaryKey: string;
  signatories: ReportSignatory[];
  now: Date;
}

export function beneficiaryPdf({ data, boundaries, beneficiaryKey, signatories, now }: BeneficiaryPdfInput): { bytes: Uint8Array; records: number; name: string } | null {
  const group = beneficiaryGroups(data).find((candidate) => candidate.key === beneficiaryKey);
  if (!group) return null;
  const rows = beneficiaryRecords(group, data);
  const doc = newDocument('a4', 'portrait');
  const width = pageWidth(doc) - 2 * MARGIN;
  const summary = `${group.records.length} ${group.records.length === 1 ? 'intervention' : 'interventions'}, ${group.units} ${group.units === 1 ? 'unit' : 'units'}, in ${group.municipalities.join(', ')}`;
  const lines = [summary, ...(group.spellings.length > 1 ? [`Also written as: ${group.spellings.slice(1).join('; ')}`] : []), `As of ${manilaLongDate(now)}`];
  let y = titleBlock(doc, 'BENEFICIARY PROFILE', group.name, lines);

  // Where they are, among the municipalities they're in.
  const map = beneficiaryMap(rows, group.municipalities, data, boundaries);
  const mapBox = { x: MARGIN, y, width, height: 190 };
  vectorMap(doc, mapBox, { ...map, pointRadius: 3.4 });
  y = mapBox.y + mapBox.height + 6;
  y = legendRow(doc, map.legend, MARGIN, y, width);
  const unlocated = rows.filter((row) => !row.point).length;
  if (unlocated > 0) y += paragraph(doc, `${unlocated} of them ${unlocated === 1 ? 'has' : 'have'} no coordinates yet, so ${unlocated === 1 ? 'isn\'t' : 'aren\'t'} on the map.`, MARGIN, y, width, { size: 7.5, color: '#52514e' });

  y = table(
    doc,
    ['#', 'Intervention', 'Program', 'Year', 'Units', 'Location', 'Coordinates', 'Status'],
    rows.map((row, index) => [
      String(index + 1),
      `${row.name}${row.type ? `\n${row.type}` : ''}`,
      row.program,
      row.year,
      String(row.record.quantity),
      row.place,
      row.point ? `${row.point.lat.toFixed(6)}, ${row.point.lng.toFixed(6)}` : 'None yet',
      row.status,
    ]),
    y + 8,
    { columnStyles: { 0: { cellWidth: 18 }, 3: { cellWidth: 32 }, 4: { cellWidth: 30, halign: 'right' }, 6: { cellWidth: 74 } } },
  );

  // Each intervention's statuses, oldest first.
  if (y > pageHeight(doc) - MARGIN - 80) {
    doc.addPage();
    y = MARGIN;
  } else y += 14;
  text(doc, 'Status history', MARGIN, y, { size: 10, bold: true });
  y = table(
    doc,
    ['#', 'Intervention', 'Status', 'Date', 'Remarks'],
    rows.flatMap((row, index) => row.history.map((entry) => [String(index + 1), row.name, entry.status, entry.when, entry.remarks ?? ''])),
    y + 14,
    { columnStyles: { 0: { cellWidth: 18 }, 3: { cellWidth: 150 } } },
  );

  y += paragraph(doc, `Data source: ${dataSourceLine(group.records)}. ${BOUNDARY_SOURCE}.`, MARGIN, y + 6, width, { size: 7.5, color: '#52514e' });
  signatureBlocks(doc, signatories, y + 6);
  pageFooters(doc, manilaDateTime(now));
  return { bytes: pdfBytes(doc), records: rows.length, name: group.name };
}
