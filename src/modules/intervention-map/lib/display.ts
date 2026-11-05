import type { FieldDefinition, Intervention, MapData, StatusEntry } from '../data/types';

const byId = <T extends { id: number }>(items: T[], id: number | null): T | undefined =>
  id === null ? undefined : items.find((item) => item.id === id);

export function recordName(record: Intervention, data: Pick<MapData, 'categories'>): string {
  const variant = typeof record.attributes.variant === 'string' ? record.attributes.variant : null;
  const name = record.title ?? byId(data.categories, record.category_id)?.name ?? 'Unnamed record';
  return variant ? `${name} (${variant})` : name;
}

// A status with an as-of date was reported that way on that date. It may have changed earlier,
// so it must never read as the date the status changed.
export function statusDateLabel(entry: Pick<StatusEntry, 'status_date' | 'date_basis' | 'source_note'>): string {
  const date = entry.status_date.slice(0, 10);
  if (entry.date_basis !== 'as_of') return date;
  return entry.source_note ? `as of ${date} (${entry.source_note})` : `as of ${date}`;
}

// Out-of-province and unlocated records stay off the map. Mismatched points stay on, with a warning.
export function isOnMap(record: Intervention): boolean {
  return record.geojson !== null && !record.qa_flags.includes('out_of_province');
}

export function encodedPlace(record: Intervention, data: Pick<MapData, 'barangays' | 'municipalities'>): string {
  const barangay = byId(data.barangays, record.barangay_id)?.name ?? record.barangay_raw;
  const municipality = byId(data.municipalities, record.municipality_id)?.name;
  return [barangay, municipality].filter(Boolean).join(', ');
}

export function locationWarning(record: Intervention, data: Pick<MapData, 'barangays' | 'municipalities'>): string | null {
  const flags = record.qa_flags;
  if (flags.includes('no_coords')) return 'No coordinates yet, so this record is not on the map';
  if (flags.includes('out_of_province')) return 'Coordinates are outside Marinduque, so this record is not on the map';
  if ((flags.includes('barangay_mismatch') || flags.includes('muni_mismatch')) && record.plotted_barangay) {
    return `Plotted in ${record.plotted_barangay}, ${record.plotted_municipality}; encoded as ${encodedPlace(record, data)}`;
  }
  return null;
}

export function fieldValue(field: FieldDefinition, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (field.input === 'yes_no') return value ? 'Yes' : 'No';
  if (field.input === 'dropdown') {
    return field.options?.find((option) => option.value === value)?.label ?? String(value);
  }
  return field.unit ? `${String(value)} ${field.unit}` : String(value);
}

export function statusTimeline(recordId: string, history: StatusEntry[]): StatusEntry[] {
  return history
    .filter((entry) => entry.intervention_id === recordId)
    .sort((a, b) => a.status_date.localeCompare(b.status_date) || a.created_at.localeCompare(b.created_at));
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

// The popup is plain HTML handed to Leaflet, so every value from the data must be escaped.
export function popupHtml(record: Intervention, data: MapData): string {
  const type = byId(data.types, record.intervention_type_id);
  const program = byId(data.programs, record.banner_program_id);
  const locationBasis = byId(data.locationBases, record.location_basis_id);
  const warning = locationWarning(record, data);

  const row = (label: string, value: string | number | null | undefined) =>
    value === null || value === undefined || value === ''
      ? ''
      : `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(String(value))}</td></tr>`;

  const customFields = (type?.field_schema.fields ?? [])
    .filter((field) => !field.archived)
    .map((field) => row(field.label, fieldValue(field, record.attributes[field.key])))
    .join('');

  const timeline = statusTimeline(record.id, data.statusHistory)
    .map((entry) => {
      const status = byId(data.statuses, entry.status_id)?.name ?? 'Unknown';
      return `<li><strong>${escapeHtml(status)}</strong> ${escapeHtml(statusDateLabel(entry))}</li>`;
    })
    .join('');

  let coordinates = '';
  let mapLink = '';
  if (record.geojson?.type === 'Point') {
    const [longitude, latitude] = record.geojson.coordinates;
    coordinates = row('Coordinates', `${latitude}, ${longitude}`);
    const url = `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`;
    mapLink = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>`;
  }

  return [
    `<div class="record-popup">`,
    `<h3>${escapeHtml(recordName(record, data))}</h3>`,
    warning ? `<p class="record-warning">${escapeHtml(warning)}</p>` : '',
    `<table>`,
    row('Type', type?.name),
    row('Program', program?.name),
    row('Year funded', record.year_funded),
    row('Beneficiary', record.beneficiary),
    row('Encoded in', encodedPlace(record, data)),
    row('Location basis', locationBasis?.name),
    coordinates,
    customFields,
    row('Remarks', record.remarks),
    `</table>`,
    timeline ? `<h4>Status</h4><ol class="status-timeline">${timeline}</ol>` : '',
    mapLink,
    `</div>`,
  ].join('');
}
