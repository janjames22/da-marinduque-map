// Imports and dismissed flags in local mode, mirroring import_records, undo_import, dismiss_flag and
// undismiss_flag. tests/import.test.ts runs both against the same cases.
import { addStatus, audit, createIntervention, softDeleteIntervention, updateIntervention, type EngineContext, type LocalRows } from './local-engine';
import { ConflictError, MOST_IMPORT_ROWS, ValidationError, type ImportBatchInput, type ImportRowInput } from './store';
import type { ImportBatch, QaDismissal, UserRole } from './types';

const reasonOf = (text: string | null | undefined) => (text ?? '').trim();

// Every row or none: the caller's transaction is abandoned if this throws.
export function importRecords(rows: LocalRows, context: EngineContext, userId: string, input: ImportBatchInput, items: ImportRowInput[]) {
  const source = input.data_source.trim();
  const file = input.file_name.trim();
  if (source === '') throw new Error('An import needs a data source, such as "ABEMIS export".');
  if (file === '') throw new Error('An import needs the name of its file.');
  if (items.length === 0) throw new Error('An import needs at least one row.');
  if (items.length > MOST_IMPORT_ROWS) throw new Error('An import takes up to 2,000 rows at a time. Split the file and import each part.');
  if (!context.types.some((type) => type.id === input.intervention_type_id && type.is_active)) throw new Error('An import needs an active intervention type.');

  const now = context.now();
  const batch: ImportBatch = {
    id: context.newId(),
    file_name: file,
    data_source: source,
    intervention_type_id: input.intervention_type_id,
    column_mapping: input.column_mapping,
    counts: {},
    imported_by: userId,
    imported_at: now,
    undone_at: null,
    undone_by: null,
    undo_reason: null,
  };
  rows.importBatches = [...(rows.importBatches ?? []), batch];
  const note = { kind: 'import' as const };
  audit(rows, context, 'import_batches', batch.id, 'insert', null, { ...batch }, note);

  const created = [];
  for (const item of items) {
    try {
      const record = createIntervention(rows, context, { ...item.values, intervention_type_id: input.intervention_type_id }, note, {
        data_source: source,
        import_batch_id: batch.id,
        source_id: item.source_id?.trim() || null,
        barangay_raw: item.values.barangay_raw?.trim() || null,
      });
      addStatus(rows, context, record.id, { ...item.status, source_note: source }, note);
      created.push(record);
    } catch (error) {
      const message = error instanceof ValidationError ? Object.values(error.fields).join(' ') : (error as Error).message;
      throw new Error(`Row ${item.row}: ${message}`);
    }
  }

  batch.counts = { records: created.length, flagged: created.filter((record) => record.qa_flags.some((flag) => flag !== 'duplicate_point')).length };
  return { id: batch.id, records: created.length };
}

// Its records are deleted, so an Admin can still restore one. Refused once anyone has worked on them.
export function undoImport(rows: LocalRows, context: EngineContext, user: { id: string; role: UserRole }, id: string, reason: string) {
  const batch = rows.importBatches?.find((candidate) => candidate.id === id);
  if (!batch) throw new ConflictError(null);
  if (batch.undone_at !== null) throw new Error('This import has already been undone.');
  if (batch.imported_by === null) throw new Error('This import was loaded by a script, so it can\'t be undone here.');
  if (user.role !== 'admin' && batch.imported_by !== user.id) throw new Error('Only the person who imported it, or an Admin, can undo an import.');
  if (reasonOf(reason) === '') throw new ValidationError({ reason: 'Give a reason for undoing the import. It goes in the audit log.' });

  const records = rows.interventions.filter((record) => record.import_batch_id === id);
  const changed = records.filter(
    (record) =>
      record.version > 1 ||
      rows.statusHistory.filter((entry) => entry.intervention_id === record.id).length > 1 ||
      rows.photos.some((photo) => photo.intervention_id === record.id) ||
      (rows.qaDismissals ?? []).some((dismissal) => dismissal.intervention_id === record.id),
  ).length;
  if (changed > 0) {
    throw new Error(`${changed} of its records ${changed === 1 ? 'has' : 'have'} been worked on since, so undoing the import would lose that. Change or delete them one at a time instead.`);
  }

  const note = { kind: 'import' as const, reason: reasonOf(reason) };
  let removed = 0;
  for (const record of records) {
    if (record.deleted_at !== null) continue;
    softDeleteIntervention(rows, context, record.id, record.version, note);
    removed += 1;
  }
  const before = { ...batch };
  batch.undone_at = context.now();
  batch.undone_by = user.id;
  batch.undo_reason = reasonOf(reason);
  audit(rows, context, 'import_batches', batch.id, 'update', before, { ...batch }, note);
  return { records: removed };
}

// The name check is a person's own flag, so dismissing it clears it. Any other flag stays, and is
// marked as looked at.
export function dismissFlag(rows: LocalRows, context: EngineContext, userId: string, recordId: string, flag: string, reason: string) {
  if (reasonOf(reason) === '') throw new ValidationError({ reason: 'Give a reason. It goes in the audit log.' });
  const record = rows.interventions.find((candidate) => candidate.id === recordId && candidate.deleted_at === null);
  if (!record) throw new ConflictError(null);
  if (!record.qa_flags.includes(flag)) throw new ConflictError(record);

  const note = { kind: 'dismiss' as const, reason: reasonOf(reason) };
  if (flag === 'beneficiary_name_check') {
    updateIntervention(rows, context, record.id, record.version, { clear_name_check: true }, note);
    return;
  }
  const dismissals = (rows.qaDismissals ??= []);
  const existing = dismissals.find((dismissal) => dismissal.intervention_id === recordId && dismissal.flag === flag);
  const dismissal: QaDismissal = { intervention_id: recordId, flag, reason: reasonOf(reason), dismissed_by: userId, dismissed_at: context.now() };
  if (existing) {
    const before = { ...existing };
    Object.assign(existing, dismissal);
    audit(rows, context, 'qa_dismissals', recordId, 'update', before, { ...existing }, note);
  } else {
    dismissals.push(dismissal);
    audit(rows, context, 'qa_dismissals', recordId, 'insert', null, { ...dismissal }, note);
  }
}

export function undismissFlag(rows: LocalRows, context: EngineContext, recordId: string, flag: string) {
  const dismissals = rows.qaDismissals ?? [];
  const existing = dismissals.find((dismissal) => dismissal.intervention_id === recordId && dismissal.flag === flag);
  if (!existing) throw new Error('That flag isn\'t dismissed any more.');
  rows.qaDismissals = dismissals.filter((dismissal) => dismissal !== existing);
  audit(rows, context, 'qa_dismissals', recordId, 'delete', { ...existing }, null, { kind: 'dismiss' });
}
