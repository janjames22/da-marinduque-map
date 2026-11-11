// /import: a file of records in, as one batch that can be taken back off the map together. The file is
// read in this browser and nothing is saved until the last step. The database checks every row again.
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MOST_IMPORT_ROWS } from '../data/store';
import type { AppUser, ImportBatch, MapData } from '../data/types';
import { plural, useSaving, Feedback } from '../admin/parts';
import { SelectField, TextField } from '../edit/FormParts';
import { buildPreview, listOptions, summarize, unmatchedValues, type ImportSettings, type PreviewRow, type ValueChoices } from '../import/build';
import { columnFor, guessMapping, targetsFor, type ColumnMapping } from '../import/fields';
import { parseFile, type ParsedFile } from '../import/parse';
import { manilaToday } from '../lib/dates';
import { FLAG_LABELS } from '../lib/display';
import { defaultStatusId, statusChoices } from '../lib/form-values';
import { looseKey } from '../lib/matching';
import { MAP_PATH } from '../lib/map-paths';
import { FLAG_ORDER } from '../lib/qa-queue';
import { useStore } from '../state/store-context';
import { personName } from './people';

type Step = 'file' | 'columns' | 'values' | 'check' | 'done';
const STEPS: { id: Step; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'columns', label: 'Columns' },
  { id: 'values', label: 'Values' },
  { id: 'check', label: 'Check' },
];
const PREVIEW_PAGE = 100;
const BLANK = '__blank__';

// How the last file from a source was read, kept with its batch.
interface Remembered {
  columns: ColumnMapping;
  values: ValueChoices;
  defaultStatusId: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function rememberedFor(batches: ImportBatch[], source: string, typeId: number): Remembered {
  const key = looseKey(source);
  const latest = batches
    .filter((batch) => batch.intervention_type_id === typeId && looseKey(batch.data_source) === key)
    .sort((a, b) => b.imported_at.localeCompare(a.imported_at))[0];
  const saved = latest?.column_mapping ?? {};
  const columns: ColumnMapping = {};
  if (isRecord(saved.columns)) for (const [column, target] of Object.entries(saved.columns)) if (typeof target === 'string') columns[column] = target;
  const values: ValueChoices = {};
  if (isRecord(saved.values)) {
    for (const [target, chosen] of Object.entries(saved.values)) {
      if (!isRecord(chosen)) continue;
      values[target] = {};
      for (const [raw, value] of Object.entries(chosen)) if (typeof value === 'string' || value === null) values[target][raw] = value;
    }
  }
  return { columns, values, defaultStatusId: typeof saved.defaultStatusId === 'number' ? saved.defaultStatusId : null };
}

const when = (timestamp: string) => new Date(timestamp).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });

function Steps({ step }: { step: Step }) {
  const at = STEPS.findIndex((entry) => entry.id === step);
  return (
    <ol className="import-steps" aria-label="Steps">
      {STEPS.map((entry, index) => (
        <li key={entry.id} className={index === at ? 'current' : index < at || step === 'done' ? 'done' : undefined} aria-current={index === at ? 'step' : undefined}>
          {index + 1}. {entry.label}
        </li>
      ))}
    </ol>
  );
}

function samples(file: ParsedFile, column: string): string {
  const seen: string[] = [];
  for (const row of file.rows) {
    const value = (row[column] ?? '').trim();
    if (value && !seen.includes(value)) seen.push(value.length > 40 ? `${value.slice(0, 39)}…` : value);
    if (seen.length === 3) break;
  }
  return seen.join(' · ');
}

function BatchList({ data, user }: { data: MapData; user: AppUser }) {
  const { store } = useStore();
  const { busy, failure, notice, errors, run, setErrors } = useSaving();
  const [undoing, setUndoing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const batches = [...data.importBatches].sort((a, b) => b.imported_at.localeCompare(a.imported_at));

  const undo = async (event: FormEvent, batch: ImportBatch) => {
    event.preventDefault();
    if (reason.trim() === '') return setErrors({ reason: 'Give a reason. It goes in the audit log.' });
    const done = await run(async () => {
      const result = await store.undoImport(batch.id, reason.trim());
      return result;
    }, `${batch.file_name} was undone. Its records are off the map. An Admin can still restore one from its history.`);
    if (done) {
      setUndoing(null);
      setReason('');
    }
  };

  if (batches.length === 0) return null;
  return (
    <section className="import-batches" aria-label="Earlier imports">
      <h3>Earlier imports</h3>
      <Feedback failure={failure} notice={notice} />
      <ul className="queue-list">
        {batches.map((batch) => {
          const type = data.types.find((candidate) => candidate.id === batch.intervention_type_id);
          const canUndo = batch.undone_at === null && batch.imported_by !== null && (user.role === 'admin' || batch.imported_by === user.id);
          return (
            <li key={batch.id} className="queue-item" data-batch={batch.id}>
              <div className="queue-item-main">
                <strong>{batch.file_name}</strong>
                <span>
                  {batch.data_source}
                  {type ? ` · ${type.name}` : ''} · {plural(Number(batch.counts.records ?? 0), 'record')}
                  {batch.counts.flagged ? `, ${batch.counts.flagged} flagged` : ''}
                </span>
                <span className="field-hint">
                  {batch.imported_by === null ? 'Loaded by script' : `By ${personName(data, user, batch.imported_by)}`} on {when(batch.imported_at)}
                </span>
                {batch.undone_at && (
                  <span className="field-hint">
                    Undone by {personName(data, user, batch.undone_by)} on {when(batch.undone_at)}: {batch.undo_reason}
                  </span>
                )}
              </div>
              {canUndo && undoing !== batch.id && (
                <div className="queue-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setUndoing(batch.id);
                      setReason('');
                      setErrors({});
                    }}
                  >
                    Undo this import
                  </button>
                </div>
              )}
              {undoing === batch.id && (
                <form className="queue-action" aria-label={`Undo ${batch.file_name}`} onSubmit={(event) => void undo(event, batch)} noValidate>
                  <p className="field-hint">This takes all {plural(Number(batch.counts.records ?? 0), 'record')} from this file off the map. It can't be done once any of them has been changed since.</p>
                  <TextField label="Reason" required multiline value={reason} onChange={setReason} error={errors.reason} />
                  <div className="form-actions">
                    <button type="submit" className="danger-button" disabled={busy}>
                      Undo the import
                    </button>
                    <button type="button" className="secondary-button" onClick={() => setUndoing(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  const [show, setShow] = useState<'all' | 'fix' | 'warnings' | 'flagged'>('all');
  const [page, setPage] = useState(0);
  const shown = rows.filter((row) => (show === 'fix' ? row.input === null : show === 'warnings' ? row.warnings.length > 0 : show === 'flagged' ? row.flags.length > 0 : true));
  const lastPage = Math.max(0, Math.ceil(shown.length / PREVIEW_PAGE) - 1);
  const at = Math.min(page, lastPage);

  return (
    <>
      <label className="field import-show">
        <span>Show</span>
        <select
          value={show}
          onChange={(event) => {
            setShow(event.target.value as typeof show);
            setPage(0);
          }}
        >
          <option value="all">Every row ({rows.length})</option>
          <option value="fix">Rows to fix ({rows.filter((row) => row.input === null).length})</option>
          <option value="warnings">Rows with warnings ({rows.filter((row) => row.warnings.length > 0).length})</option>
          <option value="flagged">Rows that will be flagged ({rows.filter((row) => row.flags.length > 0).length})</option>
        </select>
      </label>
      {shown.length === 0 ? (
        <p className="empty-note">No rows here.</p>
      ) : (
        <div className="records-scroll">
          <table className="records-table import-preview">
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Beneficiary</th>
                <th scope="col">Municipality</th>
                <th scope="col">Barangay</th>
                <th scope="col">Will be flagged</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(at * PREVIEW_PAGE, (at + 1) * PREVIEW_PAGE).map((row) => (
                <tr key={row.row} data-row={row.row} className={row.input === null ? 'to-fix' : undefined}>
                  <td>{row.row}</td>
                  <td>{row.beneficiary ?? '—'}</td>
                  <td>{row.municipality || '—'}</td>
                  <td>
                    {row.barangay || '—'}
                    {row.barangay && !row.barangayMatched && (
                      <span className="field-hint">
                        {' '}
                        (not on the list{row.candidates.length > 0 ? `; nearest: ${row.candidates.join(', ')}` : ''})
                      </span>
                    )}
                  </td>
                  <td>{row.flags.map((flag) => FLAG_LABELS[flag] ?? flag).join('; ') || '—'}</td>
                  <td>
                    {row.errors.map((message) => (
                      <span key={message} className="import-error">
                        {message}
                      </span>
                    ))}
                    {row.warnings.map((message) => (
                      <span key={message} className="import-warning">
                        {message}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > PREVIEW_PAGE && (
        <div className="records-pages">
          <span className="records-count">
            {at * PREVIEW_PAGE + 1}–{Math.min((at + 1) * PREVIEW_PAGE, shown.length)} of {shown.length}
          </span>
          <button type="button" className="secondary-button" disabled={at === 0} onClick={() => setPage(at - 1)}>
            Previous
          </button>
          <button type="button" className="secondary-button" disabled={at >= lastPage} onClick={() => setPage(at + 1)}>
            Next
          </button>
        </div>
      )}
    </>
  );
}

export function ImportPage({ data, user }: { data: MapData; user: AppUser }) {
  const { store, places } = useStore();
  const saving = useSaving();
  const types = data.types.filter((type) => type.is_active && type.geometry_kind === 'point').sort((a, b) => a.sort_order - b.sort_order);

  const [step, setStep] = useState<Step>('file');
  const [typeId, setTypeId] = useState(types.length === 1 ? String(types[0].id) : '');
  const [dataSource, setDataSource] = useState('');
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [mappedFor, setMappedFor] = useState('');
  const [choices, setChoices] = useState<ValueChoices>({});
  const [statusId, setStatusId] = useState('');
  const [statusDate, setStatusDate] = useState(manilaToday());
  const [leaveOutToFix, setLeaveOutToFix] = useState(false);
  const [leaveOutAlready, setLeaveOutAlready] = useState(true);
  const [result, setResult] = useState<{ records: number; flagged: number; leftOut: number[] } | null>(null);

  const type = types.find((candidate) => String(candidate.id) === typeId);
  const targets = useMemo(() => (type ? targetsFor(type) : []), [type]);
  const settings: ImportSettings | null = type && file ? { type, dataSource: dataSource.trim(), mapping, choices, defaultStatusId: statusId ? Number(statusId) : null, statusDate } : null;

  // Every value in a list column that the list doesn't know, chosen for or not, so a choice can be changed.
  const pending = useMemo(() => (settings && file ? unmatchedValues(file, { ...settings, choices: {} }, data) : []), [file, settings?.type, mapping, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = useMemo(() => (step === 'check' && settings && file ? buildPreview(file, settings, data, places) : []), [step, file, mapping, choices, statusId, statusDate, type, dataSource, data, places]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = summarize(preview);
  const already = preview.filter((row) => row.alreadyImported).length;
  const toImport = preview.filter((row) => row.input !== null && !(leaveOutAlready && row.alreadyImported));

  const restart = () => {
    setStep('file');
    setFile(null);
    setFileError(null);
    setResult(null);
    setMappedFor('');
    saving.clear();
  };

  const chooseFile = async (chosen: File | undefined) => {
    setFile(null);
    setFileError(null);
    if (!chosen) return;
    setReading(true);
    try {
      const parsed = await parseFile(chosen);
      if (parsed.rows.length === 0) setFileError('No rows of data were found in this file.');
      else if (parsed.rows.length > MOST_IMPORT_ROWS) setFileError(`This file has ${parsed.rows.length.toLocaleString('en-US')} rows. One import takes ${MOST_IMPORT_ROWS.toLocaleString('en-US')} at most, so split it into smaller files.`);
      else setFile(parsed);
    } catch (error) {
      setFileError((error as Error).message);
    } finally {
      setReading(false);
    }
  };

  const toColumns = (event: FormEvent) => {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (!type) problems.type = 'Choose what kind of records these are.';
    if (dataSource.trim() === '') problems.source = 'Say where the file came from, such as "ABEMIS export". The next file from there starts with the same columns.';
    if (!file) problems.file = fileError ?? 'Choose a file.';
    setStepErrors(problems);
    if (Object.keys(problems).length > 0 || !type || !file) return;
    const key = `${file.fileName}|${type.id}|${looseKey(dataSource)}`;
    if (key !== mappedFor) {
      const remembered = rememberedFor(data.importBatches, dataSource, type.id);
      setMapping(guessMapping(file.columns, targetsFor(type), remembered.columns));
      // Only choices that are still on the lists.
      const kept: ValueChoices = {};
      for (const target of targetsFor(type).filter((candidate) => candidate.list)) {
        const offered = new Set(listOptions(target, type, data).map((option) => option.value));
        for (const [raw, value] of Object.entries(remembered.values[target.id] ?? {})) {
          if (value === null || offered.has(value)) kept[target.id] = { ...kept[target.id], [raw]: value };
        }
      }
      setChoices(kept);
      const offeredStatuses = statusChoices(data, type.id).map((choice) => choice.value);
      setStatusId(remembered.defaultStatusId !== null && offeredStatuses.includes(remembered.defaultStatusId) ? String(remembered.defaultStatusId) : defaultStatusId(data, type.id));
      setLeaveOutAlready(true);
      setLeaveOutToFix(false);
      setMappedFor(key);
    }
    setStep('columns');
  };

  const assign = (column: string, target: string) => {
    setMapping((current) => {
      const next: ColumnMapping = {};
      for (const [other, chosen] of Object.entries(current)) next[other] = target && chosen === target ? '' : chosen;
      next[column] = target;
      return next;
    });
  };

  const missing = targets.filter((target) => target.required && !columnFor(mapping, target.id));
  const halfCoordinates = Boolean(columnFor(mapping, 'latitude')) !== Boolean(columnFor(mapping, 'longitude'));

  const toValues = (event: FormEvent) => {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (missing.length > 0) problems.columns = `Choose a column for ${missing.map((target) => target.label).join(', ')}. Every record needs ${missing.length === 1 ? 'it' : 'them'}.`;
    if (halfCoordinates) problems.columns = [problems.columns, 'Choose a column for both latitude and longitude, or neither.'].filter(Boolean).join(' ');
    if (!statusId) problems.status = 'Choose the status for rows without one.';
    if (!statusDate) problems.statusDate = 'Give the date these statuses were true.';
    setStepErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setStep(pending.length > 0 ? 'values' : 'check');
  };

  const choose = (target: string, key: string, value: string) => {
    setChoices((current) => {
      const forTarget = { ...current[target] };
      if (value === '') delete forTarget[key];
      else forTarget[key] = value === BLANK ? null : value;
      return { ...current, [target]: forTarget };
    });
  };
  const unchosen = pending.filter((value) => !(value.key in (choices[value.target] ?? {})));

  const toCheck = (event: FormEvent) => {
    event.preventDefault();
    if (unchosen.length > 0) {
      setStepErrors({ values: `Choose for ${plural(unchosen.length, 'value')} still.` });
      return;
    }
    setStepErrors({});
    setStep('check');
  };

  const commit = async () => {
    if (!type || !file) return;
    const rows = toImport.map((row) => row.input!);
    const leftOut = preview.filter((row) => !toImport.includes(row)).map((row) => row.row);
    const saved = await saving.run(async () => {
      const done = await store.importRecords(
        {
          file_name: file.fileName,
          data_source: dataSource.trim(),
          intervention_type_id: type.id,
          column_mapping: { columns: mapping, values: choices, defaultStatusId: Number(statusId), ...(file.sheet ? { sheet: file.sheet } : {}) },
        },
        rows,
      );
      setResult({ records: done.records, flagged: toImport.filter((row) => row.flags.some((flag) => flag !== 'duplicate_point')).length, leftOut });
    });
    if (saved) setStep('done');
  };

  const statuses = type ? statusChoices(data, type.id) : [];

  return (
    <section className="admin-section import-page" aria-label="Import">
      <header className="admin-section-header">
        <div>
          <h2>Import records</h2>
          <p className="field-hint">A CSV, Excel (.xlsx) or Google Earth (.kml, .kmz) file of records, brought in as one batch. Nothing is saved until the last step, and the whole batch can be undone while its records are untouched.</p>
        </div>
      </header>
      {step !== 'done' && <Steps step={step} />}

      {step === 'file' && (
        <>
          <form className="import-form" aria-label="Choose a file" onSubmit={toColumns} noValidate>
            <SelectField
              label="What the file lists"
              required
              value={typeId}
              placeholder="Choose a type"
              onChange={(value) => setTypeId(value)}
              options={types.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
              error={stepErrors.type}
            />
            <div className="form-field">
              <label htmlFor="import-source">
                Where it came from
                <span className="required-mark"> *</span>
              </label>
              <input id="import-source" list="import-sources" value={dataSource} onChange={(event) => setDataSource(event.target.value)} aria-invalid={stepErrors.source ? true : undefined} aria-required aria-describedby="import-source-hint" />
              <datalist id="import-sources">
                {data.dataSources.map((source) => (
                  <option key={source} value={source} />
                ))}
              </datalist>
              <span id="import-source-hint" className="field-hint">
                {stepErrors.source ? <span className="field-error">{stepErrors.source}</span> : 'Such as "ABEMIS export". Columns are remembered for the next file from the same source.'}
              </span>
            </div>
            <div className="form-field">
              <label htmlFor="import-file">
                File
                <span className="required-mark"> *</span>
              </label>
              <input id="import-file" type="file" accept=".csv,.txt,.xlsx,.xls,.kml,.kmz" onChange={(event) => void chooseFile(event.target.files?.[0])} />
              {reading && <span className="field-hint">Reading the file…</span>}
              {(fileError ?? stepErrors.file) && (
                <span className="field-error" role="alert">
                  {fileError ?? stepErrors.file}
                </span>
              )}
              {file && (
                <span className="field-hint" role="status">
                  {plural(file.rows.length, 'row')} and {plural(file.columns.length, 'column')} read{file.sheet ? ` from the sheet "${file.sheet}"` : ''}.
                </span>
              )}
              {file?.notes.map((note) => (
                <span key={note} className="field-hint">
                  {note}
                </span>
              ))}
            </div>
            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={reading}>
                Next: columns
              </button>
            </div>
          </form>
          <BatchList data={data} user={user} />
        </>
      )}

      {step === 'columns' && file && type && (
        <form className="import-form" aria-label="Match the columns" onSubmit={toValues} noValidate>
          <p className="field-hint">Which field each of the file's columns fills. Starred fields need a column. Columns left out aren't imported, but each row is kept whole with its record.</p>
          <div className="records-scroll">
            <table className="records-table import-columns">
              <thead>
                <tr>
                  <th scope="col">Column in the file</th>
                  <th scope="col">Its first values</th>
                  <th scope="col">Goes into</th>
                </tr>
              </thead>
              <tbody>
                {file.columns.map((column) => (
                  <tr key={column}>
                    <th scope="row">{column}</th>
                    <td className="field-hint">{samples(file, column) || '(empty)'}</td>
                    <td>
                      <select aria-label={`Field for ${column}`} value={mapping[column] ?? ''} onChange={(event) => assign(column, event.target.value)}>
                        <option value="">Don't import</option>
                        {targets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.label}
                            {target.required ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stepErrors.columns && (
            <p className="field-error" role="alert">
              {stepErrors.columns}
            </p>
          )}
          <SelectField label="Status for rows without one" required value={statusId} placeholder="Choose a status" onChange={setStatusId} options={statuses} error={stepErrors.status} />
          <TextField
            label="Statuses are as of"
            type="date"
            required
            value={statusDate}
            onChange={setStatusDate}
            error={stepErrors.statusDate}
            hint="The date the file's statuses were true, such as the day it was exported. Rows with a status date of their own keep it."
          />
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setStep('file')}>
              Back
            </button>
            <button type="submit" className="primary-button">
              {pending.length > 0 ? 'Next: values' : 'Next: check'}
            </button>
          </div>
        </form>
      )}

      {step === 'values' && file && type && (
        <form className="import-form" aria-label="Match the values" onSubmit={toCheck} noValidate>
          <p className="field-hint">These values aren't on the app's lists. Choose what each one is. Your choices are remembered for the next file from {dataSource.trim()}.</p>
          <ul className="import-values">
            {pending.map((value) => {
              const target = targets.find((candidate) => candidate.id === value.target)!;
              const chosen = choices[value.target]?.[value.key];
              const blank = value.target === 'status' ? 'Use the status for rows without one' : target.required ? null : 'Leave it blank';
              return (
                <li key={`${value.target}|${value.key}`}>
                  <label className="field">
                    <span>
                      {value.label}: "{value.raw}" <span className="field-hint">({plural(value.rows, 'row')})</span>
                    </span>
                    <select value={chosen === undefined ? '' : chosen === null ? BLANK : chosen} onChange={(event) => choose(value.target, value.key, event.target.value)}>
                      <option value="">Choose…</option>
                      {listOptions(target, type, data).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                      {blank && <option value={BLANK}>{blank}</option>}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
          {stepErrors.values && (
            <p className="field-error" role="alert">
              {stepErrors.values}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setStep('columns')}>
              Back
            </button>
            <button type="submit" className="primary-button">
              Next: check
            </button>
          </div>
        </form>
      )}

      {step === 'check' && file && type && (
        <div className="import-check">
          <p className="import-summary" role="status">
            {plural(summary.rows, 'row')}: {summary.ready} ready, {summary.toFix} to fix, {summary.withWarnings} with warnings.
          </p>
          {Object.keys(summary.flags).length > 0 && (
            <ul className="import-flags" aria-label="What will be flagged">
              {[...FLAG_ORDER, ...Object.keys(summary.flags).filter((flag) => !FLAG_ORDER.includes(flag))]
                .filter((flag) => summary.flags[flag])
                .map((flag) => (
                  <li key={flag}>
                    {FLAG_LABELS[flag] ?? flag}: {summary.flags[flag]}
                  </li>
                ))}
            </ul>
          )}
          {summary.flags.barangay_unmatched || summary.flags.barangay_mismatch ? <p className="field-hint">Flagged records come in and wait in the QA queue, where they can be fixed.</p> : null}
          <PreviewTable rows={preview} />

          {already > 0 && (
            <label className="choice">
              <input type="checkbox" checked={leaveOutAlready} onChange={(event) => setLeaveOutAlready(event.target.checked)} />
              Leave out the {plural(already, 'row')} already imported from {dataSource.trim()}
            </label>
          )}
          {summary.toFix > 0 && (
            <label className="choice">
              <input type="checkbox" checked={leaveOutToFix} onChange={(event) => setLeaveOutToFix(event.target.checked)} />
              Leave out the {plural(summary.toFix, 'row')} to fix, and import the rest
            </label>
          )}
          {summary.toFix > 0 && !leaveOutToFix && <p className="field-hint">Fix those rows in the file and read it again, change the columns or values, or leave them out.</p>}
          <Feedback failure={saving.failure} />
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setStep(pending.length > 0 ? 'values' : 'columns')} disabled={saving.busy}>
              Back
            </button>
            <button type="button" className="primary-button" disabled={saving.busy || toImport.length === 0 || (summary.toFix > 0 && !leaveOutToFix)} onClick={() => void commit()}>
              {saving.busy ? 'Importing…' : `Import ${plural(toImport.length, 'record')}`}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && result && file && (
        <>
        <div className="import-done" role="status">
          <h3>Imported {plural(result.records, 'record')}</h3>
          <p>
            From {file.fileName}, as one batch. {result.flagged > 0 ? `${result.flagged} of them need a look in the QA queue.` : 'None of them were flagged.'}
          </p>
          {result.leftOut.length > 0 && <p className="field-hint">Left out: {result.leftOut.length > 30 ? `${plural(result.leftOut.length, 'row')}` : `row${result.leftOut.length === 1 ? '' : 's'} ${result.leftOut.join(', ')}`}.</p>}
          <div className="form-actions">
            {result.flagged > 0 && (
              <Link className="primary-button" to="/qa">
                Open the QA queue
              </Link>
            )}
            <Link className="secondary-button" to={MAP_PATH}>
              See them on the map
            </Link>
            <button type="button" className="secondary-button" onClick={restart}>
              Import another file
            </button>
          </div>
        </div>
        {/* So a wrong file can be undone straight away. */}
        <BatchList data={data} user={user} />
        </>
      )}
    </section>
  );
}
