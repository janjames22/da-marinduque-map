// Units delivered but not yet looked at, such as Turned-over, for a MAO to go through and set what they
// found. Each status button saves a new status for the record, dated today unless changed.
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Intervention, MapData } from '../data/types';
import { plural, useSaving, Feedback } from '../admin/parts';
import { TextField } from '../edit/FormParts';
import { manilaToday } from '../lib/dates';
import { recordName } from '../lib/display';
import { looseKey } from '../lib/matching';
import { recordOnMap } from '../lib/map-paths';
import { awaitingCheck } from '../lib/qa-queue';
import { foldText } from '../lib/view-fields';
import { useStore } from '../state/store-context';

const PAGE = 50;

function SetStatus({ record, statusId, data, onDone, onSaved }: { record: Intervention; statusId: number; data: MapData; onDone(): void; onSaved(message: string): void }) {
  const { store } = useStore();
  const { busy, failure, errors, run } = useSaving();
  const [statusDate, setStatusDate] = useState(manilaToday());
  const [remarks, setRemarks] = useState('');
  const name = data.statuses.find((status) => status.id === statusId)?.name ?? '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(() => store.addStatus(record.id, { status_id: statusId, status_date: statusDate, remarks: remarks.trim() || null }, { kind: 'status' }));
    if (saved) onSaved(`${recordName(record, data)} (${record.beneficiary ?? "no beneficiary"}) set to ${name}.`);
  };

  return (
    <form className="queue-action" aria-label={`Set ${name}: ${recordName(record, data)}`} onSubmit={(event) => void submit(event)} noValidate>
      <TextField label="Checked on" type="date" required value={statusDate} onChange={setStatusDate} error={errors.status_date} />
      <TextField label="What was found (optional)" value={remarks} onChange={setRemarks} />
      <Feedback failure={failure ?? errors.status_id ?? null} />
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={busy}>
          Save as {name}
        </button>
        <button type="button" className="secondary-button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ConditionCheck({ data }: { data: MapData }) {
  // The statuses that don't say a unit's condition, with how many records are at each, here.
  const [municipalityId, setMunicipalityId] = useState<number | null>(null);
  const waiting = useMemo(
    () =>
      data.statuses
        .filter((status) => status.counts_as_assessed === false && status.is_active)
        .map((status) => ({ status, records: awaitingCheck(data, { municipalityId, statusId: status.id }).length }))
        .filter((entry) => entry.records > 0),
    [data, municipalityId],
  );
  // Delivered and not yet looked at, which is what a visit is for. The others are a choice away.
  const [statusId, setStatusId] = useState<number | null>(() => waiting.find((entry) => looseKey(entry.status.name) === 'turnedover')?.status.id ?? null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<{ id: string; statusId: number } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const since = useMemo(() => {
    const latest = new Map<string, string>();
    for (const entry of data.statusHistory) {
      const current = latest.get(entry.intervention_id);
      if (!current || entry.status_date > current) latest.set(entry.intervention_id, entry.status_date);
    }
    return latest;
  }, [data.statusHistory]);

  const records = useMemo(() => {
    const wanted = foldText(search);
    const placeName = (record: Intervention) => data.municipalities.find((municipality) => municipality.id === record.municipality_id)?.name ?? '';
    const barangayName = (record: Intervention) => data.barangays.find((barangay) => barangay.id === record.barangay_id)?.name ?? record.barangay_raw ?? '';
    return awaitingCheck(data, { municipalityId, statusId })
      .filter((record) => !wanted || foldText([recordName(record, data), record.beneficiary, record.source_id, barangayName(record)].filter(Boolean).join(' ')).includes(wanted))
      .sort((a, b) => placeName(a).localeCompare(placeName(b)) || barangayName(a).localeCompare(barangayName(b)) || recordName(a, data).localeCompare(recordName(b, data)));
  }, [data, municipalityId, statusId, search]);

  const units = records.reduce((sum, record) => sum + record.quantity, 0);
  const lastPage = Math.max(0, Math.ceil(records.length / PAGE) - 1);
  const shownPage = Math.min(page, lastPage);
  const shown = records.slice(shownPage * PAGE, (shownPage + 1) * PAGE);
  const filter = (apply: () => void) => {
    apply();
    setPage(0);
    setOpen(null);
  };

  return (
    <section className="admin-section condition-check" aria-label="Condition check">
      <header className="admin-section-header">
        <div>
          <h2>Condition check</h2>
          <p className="field-hint">
            Units at a status that doesn't say what condition they're in, such as Turned-over. They're left out of % operational until checked. Set what you found on a visit, dated the day you saw it.
          </p>
        </div>
      </header>

      <form className="audit-filters" aria-label="Filter the units" onSubmit={(event) => event.preventDefault()}>
        <label className="field">
          <span>Municipality</span>
          <select value={municipalityId ?? ''} onChange={(event) => filter(() => setMunicipalityId(event.target.value ? Number(event.target.value) : null))}>
            <option value="">All</option>
            {data.municipalities.map((municipality) => (
              <option key={municipality.id} value={municipality.id}>
                {municipality.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select value={statusId ?? ''} onChange={(event) => filter(() => setStatusId(event.target.value ? Number(event.target.value) : null))}>
            <option value="">All not yet assessed ({waiting.reduce((sum, entry) => sum + entry.records, 0)})</option>
            {waiting.map(({ status, records: count }) => (
              <option key={status.id} value={status.id}>
                {status.name} ({count})
              </option>
            ))}
            {statusId !== null && !waiting.some((entry) => entry.status.id === statusId) && (
              <option value={statusId}>{data.statuses.find((status) => status.id === statusId)?.name} (0)</option>
            )}
          </select>
        </label>
        <label className="field">
          <span>Record</span>
          <input type="search" placeholder="Name, beneficiary, barangay or ID" value={search} onChange={(event) => filter(() => setSearch(event.target.value))} />
        </label>
      </form>

      <p className="records-count" role="status">
        {records.length === 0 ? 'Nothing waiting here.' : `${plural(records.length, 'record')} waiting, ${plural(units, 'unit')}.`}
        {saved && ` ${saved}`}
      </p>

      {shown.length > 0 && (
        <ul className="queue-list condition-list">
          {shown.map((record) => {
            const current = data.statuses.find((status) => status.id === record.status_id);
            const barangay = data.barangays.find((candidate) => candidate.id === record.barangay_id)?.name ?? record.barangay_raw ?? 'No barangay';
            const municipality = data.municipalities.find((candidate) => candidate.id === record.municipality_id)?.name ?? '';
            const choices = data.typeStatuses
              .filter((entry) => entry.intervention_type_id === record.intervention_type_id)
              .map((entry) => data.statuses.find((status) => status.id === entry.status_id))
              .filter((status) => status !== undefined && status.is_active && status.counts_as_assessed);
            const type = data.types.find((candidate) => candidate.id === record.intervention_type_id);
            return (
              <li key={record.id} className="queue-item" data-record={record.id}>
                <div className="queue-item-main">
                  <Link to={recordOnMap(record.id)}>{recordName(record, data)}</Link>
                  <span>{record.beneficiary ?? 'No beneficiary'}</span>
                  <span className="field-hint">
                    {barangay}, {municipality}
                    {record.year_funded ? ` · ${record.year_funded}` : ''}
                    {record.quantity > 1 ? ` · ${record.quantity} units` : ''}
                  </span>
                  <span className="field-hint">
                    {current?.name ?? 'No status'}
                    {since.get(record.id) ? ` since ${since.get(record.id)}` : ''}
                  </span>
                </div>
                {type?.is_active !== false && (
                  <div className="queue-actions" role="group" aria-label={`Set the status of ${recordName(record, data)}`}>
                    {choices.map((status) => (
                      <button
                        key={status!.id}
                        type="button"
                        className="secondary-button"
                        aria-expanded={open?.id === record.id && open.statusId === status!.id}
                        onClick={() => {
                          setSaved(null);
                          setOpen(open?.id === record.id && open.statusId === status!.id ? null : { id: record.id, statusId: status!.id });
                        }}
                      >
                        {status!.name}
                      </button>
                    ))}
                  </div>
                )}
                {open?.id === record.id && (
                  <SetStatus
                    record={record}
                    statusId={open.statusId}
                    data={data}
                    onDone={() => setOpen(null)}
                    onSaved={(message) => {
                      setOpen(null);
                      setSaved(message);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {records.length > PAGE && (
        <div className="records-pages">
          <span className="records-count">
            {shownPage * PAGE + 1}–{Math.min((shownPage + 1) * PAGE, records.length)} of {records.length}
          </span>
          <button type="button" className="secondary-button" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>
            Previous
          </button>
          <button type="button" className="secondary-button" disabled={shownPage >= lastPage} onClick={() => setPage(shownPage + 1)}>
            Next
          </button>
        </div>
      )}
    </section>
  );
}
