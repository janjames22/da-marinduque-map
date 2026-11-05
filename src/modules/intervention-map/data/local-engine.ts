// What the database's triggers do, for local mode: flags, the status cache, links, versions and
// the audit log. Every function changes the given rows in place and throws if the write isn't
// allowed, so the caller can abandon the whole change. tests/qa-parity.test.ts checks this against
// the real triggers.
import { valuesFromRecord } from '../lib/form-values';
import { pointOf, computeFlags, locatePoint, samePoint, type PlaceIndex } from '../lib/qa';
import type { LatLng } from '../lib/coordinates';
import { validateAttributes, validateIntervention, validateStatus } from '../lib/validation';
import { ConflictError, ValidationError, type ChangeNote, type InterventionPatch, type InterventionValues, type PhotoMeta } from './store';
import type {
  AuditAction,
  AuditEntry,
  Barangay,
  Category,
  FieldSchema,
  Intervention,
  InterventionBarangay,
  InterventionPhoto,
  InterventionType,
  Municipality,
  StatusEntry,
  TypeStatus,
} from './types';

export interface LocalRows {
  interventions: Intervention[];
  links: InterventionBarangay[];
  statusHistory: StatusEntry[];
  barangays: Barangay[];
  photos: InterventionPhoto[];
  auditLog: AuditEntry[];
  changeCount: number;
}

export interface EngineContext {
  types: InterventionType[];
  categories: Category[];
  typeStatuses: TypeStatus[];
  municipalities: Municipality[];
  barangayFields: FieldSchema;
  places: PlaceIndex;
  now(): string;
  newId(): string;
}

export const MANUAL_DATA_SOURCE = 'Encoded on the map';

const typeOf = (context: EngineContext, id: number): InterventionType => {
  const type = context.types.find((t) => t.id === id);
  if (!type) throw new ValidationError({ intervention_type_id: 'Choose an intervention type.' });
  return type;
};

// The source uses 0,0 for "no coordinates". A single zero stays visible as out of province.
function normalizePoint(point: LatLng | null): LatLng | null {
  return point && point.lat === 0 && point.lng === 0 ? null : point;
}

const geojsonOf = (point: LatLng | null): GeoJSON.Point | null =>
  point ? { type: 'Point', coordinates: [point.lng, point.lat] } : null;

// The view's plotted columns aren't part of the table, so they stay out of the log.
function rowImage(record: Intervention): Record<string, unknown> {
  const { plotted_barangay_id: _id, plotted_barangay: _name, plotted_municipality: _municipality, ...row } = record;
  return row;
}

function audit(
  rows: LocalRows,
  context: EngineContext,
  table: string,
  recordId: string,
  action: AuditAction,
  oldRow: Record<string, unknown> | null,
  newRow: Record<string, unknown> | null,
  note?: ChangeNote,
) {
  rows.auditLog.push({
    id: (rows.auditLog.at(-1)?.id ?? 0) + 1,
    table_name: table,
    record_id: recordId,
    action,
    old_row: oldRow,
    new_row: newRow,
    actor_id: null, // the single implicit user in local mode
    context: note ? { ...note } : null,
    at: context.now(),
  });
}

function setPlotted(record: Intervention, context: EngineContext, barangays: Barangay[]) {
  const point = pointOf(record);
  const id = point ? locatePoint(point, context.places) : null;
  const barangay = barangays.find((b) => b.id === id);
  record.plotted_barangay_id = barangay?.id ?? null;
  record.plotted_barangay = barangay?.name ?? null;
  record.plotted_municipality = context.municipalities.find((m) => m.id === barangay?.municipality_id)?.name ?? null;
}

function recomputeFlags(record: Intervention, rows: LocalRows, context: EngineContext) {
  record.qa_flags = computeFlags(
    {
      id: record.id,
      point: pointOf(record),
      municipality_id: record.municipality_id,
      barangay_id: record.barangay_id,
      barangay_raw: record.barangay_raw,
      qa_flags: record.qa_flags,
      deleted_at: record.deleted_at,
    },
    rows.interventions,
    context.places,
  );
}

// When a record arrives at, leaves or is deleted from a point, the others there need rechecking.
function refreshNeighbours(rows: LocalRows, context: EngineContext, record: Intervention, points: (LatLng | null)[]) {
  for (const other of rows.interventions) {
    if (other.id === record.id || other.deleted_at !== null) continue;
    if (points.some((point) => samePoint(pointOf(other), point))) recomputeFlags(other, rows, context);
  }
}

// Points link to their encoded barangay. Lines and polygons will also link to those they cross.
function syncLinks(rows: LocalRows, record: Intervention) {
  rows.links = rows.links.filter((link) => link.intervention_id !== record.id);
  if (record.barangay_id !== null) {
    rows.links.push({ intervention_id: record.id, barangay_id: record.barangay_id, link_source: 'encoded' });
  }
}

export function createIntervention(rows: LocalRows, context: EngineContext, input: InterventionValues, note?: ChangeNote): Intervention {
  const values = { ...input, point: normalizePoint(input.point) };
  const type = typeOf(context, values.intervention_type_id);
  const errors = validateIntervention(values, null, { type, categories: context.categories, barangays: rows.barangays });
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const now = context.now();
  const { point, ...columns } = values;
  const record: Intervention = {
    ...columns,
    id: context.newId(),
    barangay_raw: null,
    status_id: null,
    data_source: MANUAL_DATA_SOURCE,
    qa_flags: [],
    geojson: geojsonOf(point),
    plotted_barangay_id: null,
    plotted_barangay: null,
    plotted_municipality: null,
    version: 1,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  recomputeFlags(record, rows, context);
  setPlotted(record, context, rows.barangays);
  rows.interventions.push(record);
  refreshNeighbours(rows, context, record, [point]);
  syncLinks(rows, record);
  audit(rows, context, 'interventions', record.id, 'insert', null, rowImage(record), note);
  return record;
}

function findCurrent(rows: LocalRows, id: string, expectedVersion: number): Intervention {
  const record = rows.interventions.find((r) => r.id === id);
  if (!record) throw new ConflictError(null);
  if (record.version !== expectedVersion) throw new ConflictError(record);
  return record;
}

export function updateIntervention(
  rows: LocalRows,
  context: EngineContext,
  id: string,
  expectedVersion: number,
  patch: InterventionPatch,
  note?: ChangeNote,
): Intervention {
  const record = findCurrent(rows, id, expectedVersion);
  if (record.deleted_at !== null) throw new ConflictError(record);

  const { clear_name_check: clearNameCheck, point: patchedPoint, ...columns } = patch;
  const previous = valuesFromRecord(record);
  const values: InterventionValues = {
    ...previous,
    ...columns,
    point: patchedPoint === undefined ? previous.point : normalizePoint(patchedPoint),
  };

  const type = typeOf(context, record.intervention_type_id);
  const errors = validateIntervention(values, previous, { type, categories: context.categories, barangays: rows.barangays });
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const before = rowImage(record);
  const { point, ...newColumns } = values;
  Object.assign(record, newColumns, {
    geojson: geojsonOf(point),
    version: record.version + 1,
    updated_at: context.now(),
    qa_flags: clearNameCheck ? record.qa_flags.filter((flag) => flag !== 'beneficiary_name_check') : record.qa_flags,
  });

  recomputeFlags(record, rows, context);
  setPlotted(record, context, rows.barangays);
  if (!samePoint(previous.point, point)) refreshNeighbours(rows, context, record, [previous.point, point]);
  syncLinks(rows, record);
  audit(rows, context, 'interventions', record.id, 'update', before, rowImage(record), note);
  return record;
}

function setDeleted(
  rows: LocalRows,
  context: EngineContext,
  id: string,
  expectedVersion: number,
  deletedAt: string | null,
  action: 'soft_delete' | 'restore',
  note?: ChangeNote,
): Intervention {
  const record = findCurrent(rows, id, expectedVersion);
  if ((record.deleted_at !== null) === (deletedAt !== null)) throw new ConflictError(record);

  const before = rowImage(record);
  record.deleted_at = deletedAt;
  record.version += 1;
  record.updated_at = context.now();
  recomputeFlags(record, rows, context);
  refreshNeighbours(rows, context, record, [pointOf(record)]);
  audit(rows, context, 'interventions', record.id, action, before, rowImage(record), note);
  return record;
}

export function softDeleteIntervention(rows: LocalRows, context: EngineContext, id: string, expectedVersion: number, note?: ChangeNote) {
  return setDeleted(rows, context, id, expectedVersion, context.now(), 'soft_delete', note);
}

export function restoreIntervention(rows: LocalRows, context: EngineContext, id: string, expectedVersion: number, note?: ChangeNote) {
  return setDeleted(rows, context, id, expectedVersion, null, 'restore', note);
}

export function addPhoto(rows: LocalRows, context: EngineContext, interventionId: string, meta: PhotoMeta, note?: ChangeNote): InterventionPhoto {
  const id = context.newId();
  const photo: InterventionPhoto = {
    id,
    intervention_id: interventionId,
    storage_path: `local/${id}`,
    caption: null,
    taken_at: meta.taken_at,
    exif_location: geojsonOf(meta.exif_location),
    created_at: context.now(),
  };
  rows.photos.push(photo);
  audit(rows, context, 'intervention_photos', id, 'insert', null, { ...photo }, note);
  return photo;
}

// The current status is the entry with the latest date. A backdated entry doesn't replace it.
function refreshCurrentStatus(rows: LocalRows, context: EngineContext, record: Intervention) {
  let current: StatusEntry | null = null;
  for (const entry of rows.statusHistory) {
    if (entry.intervention_id !== record.id) continue;
    if (
      !current ||
      entry.status_date > current.status_date ||
      (entry.status_date === current.status_date && entry.created_at >= current.created_at)
    ) {
      current = entry;
    }
  }
  record.status_id = current?.status_id ?? null;
  record.updated_at = context.now();
}

export function addStatus(
  rows: LocalRows,
  context: EngineContext,
  interventionId: string,
  status: { status_id: number; status_date: string; remarks: string | null; photo_id?: string | null },
  note?: ChangeNote,
): StatusEntry {
  const record = rows.interventions.find((r) => r.id === interventionId);
  if (!record) throw new ConflictError(null);

  const errors = validateStatus(status, record.intervention_type_id, context.typeStatuses);
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const entry: StatusEntry = {
    id: context.newId(),
    intervention_id: interventionId,
    status_id: status.status_id,
    status_date: status.status_date,
    date_basis: 'changed',
    source_note: null,
    remarks: status.remarks,
    photo_id: status.photo_id ?? null,
    created_at: context.now(),
  };
  rows.statusHistory.push(entry);
  refreshCurrentStatus(rows, context, record);
  audit(rows, context, 'status_history', entry.id, 'insert', null, { ...entry }, note);
  return entry;
}

export function updateBarangayBaseline(
  rows: LocalRows,
  context: EngineContext,
  id: number,
  expectedVersion: number,
  attributes: Record<string, unknown>,
  note?: ChangeNote,
): Barangay {
  const barangay = rows.barangays.find((b) => b.id === id);
  if (!barangay) throw new ConflictError(null);
  if (barangay.version !== expectedVersion) throw new ConflictError(barangay);

  const errors = validateAttributes(context.barangayFields, attributes);
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  const before = { ...barangay };
  barangay.attributes = attributes;
  barangay.version += 1;
  audit(rows, context, 'barangays', String(id), 'update', before, { ...barangay }, note);
  return barangay;
}

// Everything logged about one record: its own row, plus its status entries and photos.
export function auditForRecord(auditLog: AuditEntry[], interventionId: string): AuditEntry[] {
  return auditLog.filter(
    (entry) =>
      (entry.table_name === 'interventions' && entry.record_id === interventionId) ||
      ((entry.table_name === 'status_history' || entry.table_name === 'intervention_photos') &&
        (entry.new_row ?? entry.old_row)?.intervention_id === interventionId),
  );
}
