// Every flagged record, by what was found and where, with the fix each flag calls for. Fixing the data
// clears a flag by itself. Dismiss is for a flag that's right as it is, and needs a reason.
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { AppUser, Intervention, MapData, QaDismissal } from '../data/types';
import { useSaving, Feedback } from '../admin/parts';
import { SelectField, TextField } from '../edit/FormParts';
import { formatPoint } from '../lib/coordinates';
import { manilaToday } from '../lib/dates';
import { statusChoices } from '../lib/form-values';
import { FLAG_LABELS, recordName } from '../lib/display';
import { closestBarangays } from '../lib/matching';
import { recordOnMap } from '../lib/map-paths';
import { buildQueue, FLAG_ADVICE, FLAG_ORDER, flagCounts, type QueueFilters } from '../lib/qa-queue';
import { pointOf } from '../lib/qa';
import { useStore } from '../state/store-context';
import { personName } from './people';

type Action = 'barangay' | 'basis' | 'status' | 'dismiss';

// What can be done here for each flag. A location is fixed on the map, where a point can be picked.
const ACTIONS: Record<string, Action[]> = {
  out_of_province: ['status', 'dismiss'],
  no_coords: ['status', 'dismiss'],
  barangay_unmatched: ['barangay', 'status', 'dismiss'],
  no_barangay: ['barangay', 'status', 'dismiss'],
  muni_mismatch: ['barangay', 'status', 'dismiss'],
  barangay_mismatch: ['barangay', 'basis', 'status', 'dismiss'],
  beneficiary_name_check: ['status', 'dismiss'],
  duplicate_point: ['status', 'dismiss'],
};
const FIX_ON_MAP = new Set(['out_of_province', 'no_coords', 'muni_mismatch', 'barangay_mismatch', 'beneficiary_name_check', 'duplicate_point']);
const ACTION_LABELS: Record<Action, string> = { barangay: 'Set barangay', basis: 'Set location basis', status: 'Update status', dismiss: 'Dismiss' };

const dateOnly = (timestamp: string) => timestamp.slice(0, 10);

function detail(record: Intervention, flag: string, data: MapData): string | null {
  const encodedBarangay = data.barangays.find((barangay) => barangay.id === record.barangay_id)?.name;
  const encodedMunicipality = data.municipalities.find((municipality) => municipality.id === record.municipality_id)?.name;
  const point = pointOf(record);
  switch (flag) {
    case 'barangay_mismatch':
    case 'muni_mismatch':
      return record.plotted_barangay
        ? `Plotted in ${record.plotted_barangay}, ${record.plotted_municipality}; encoded as ${[encodedBarangay, encodedMunicipality].filter(Boolean).join(', ')}.`
        : `Plotted outside every barangay; encoded as ${[encodedBarangay, encodedMunicipality].filter(Boolean).join(', ')}.`;
    case 'barangay_unmatched':
      return `The source names "${record.barangay_raw}".`;
    case 'out_of_province':
    case 'duplicate_point':
      return point ? `At ${formatPoint(point)}.` : null;
    default:
      return null;
  }
}

function ActionForm({ record, flag, action, data, onDone, onSaved }: { record: Intervention; flag: string; action: Action; data: MapData; onDone(): void; onSaved(message: string): void }) {
  const { store } = useStore();
  const { busy, failure, errors, run, setErrors } = useSaving();
  const plottedBarangay = data.barangays.find((barangay) => barangay.id === record.plotted_barangay_id);
  const [municipalityId, setMunicipalityId] = useState(String(record.municipality_id));
  const [barangayId, setBarangayId] = useState(record.barangay_id === null ? '' : String(record.barangay_id));
  const [basisId, setBasisId] = useState(record.location_basis_id === null ? '' : String(record.location_basis_id));
  const statuses = statusChoices(data, record.intervention_type_id);
  const [statusId, setStatusId] = useState(String(record.status_id ?? statuses[0]?.value ?? ''));
  const [statusDate, setStatusDate] = useState(manilaToday());
  const [remarks, setRemarks] = useState('');
  const [reason, setReason] = useState('');

  const municipalityName = data.municipalities.find((municipality) => String(municipality.id) === municipalityId)?.name ?? '';
  const inMunicipality = data.barangays.filter((barangay) => String(barangay.municipality_id) === municipalityId);
  const nearest =
    flag === 'barangay_unmatched' && record.barangay_raw
      ? closestBarangays(record.barangay_raw, municipalityName, inMunicipality.map((barangay) => ({ id: barangay.id, name: barangay.name, municipality: municipalityName }))).sameMunicipality
      : [];

  const needReason = () => {
    if (reason.trim() === '') {
      setErrors({ reason: 'Give a reason. It goes in the audit log.' });
      return false;
    }
    return true;
  };

  // Said on the queue, as the record may leave it once saved.
  const named = `${recordName(record, data)}${record.beneficiary ? ` (${record.beneficiary})` : ''}`;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    let saved = false;
    let message = '';
    if (action === 'barangay') {
      if (barangayId === '') return setErrors({ barangay_id: 'Choose a barangay.' });
      if (!needReason()) return;
      saved = await run(() => store.updateIntervention(record.id, record.version, { municipality_id: Number(municipalityId), barangay_id: Number(barangayId) }, { kind: 'resolve', reason: reason.trim() }));
      message = `Barangay set for ${named}.`;
    } else if (action === 'basis') {
      if (basisId === '') return setErrors({ location_basis_id: 'Choose a location basis.' });
      if (!needReason()) return;
      // The basis says the point is somewhere else on purpose, so the flag is accepted with the same reason.
      saved = await run(async () => {
        await store.updateIntervention(record.id, record.version, { location_basis_id: Number(basisId) }, { kind: 'resolve', reason: reason.trim() });
        await store.dismissFlag(record.id, flag, reason.trim());
      });
      message = `Location basis set for ${named}, and the flag dismissed.`;
    } else if (action === 'status') {
      saved = await run(() => store.addStatus(record.id, { status_id: Number(statusId), status_date: statusDate, remarks: remarks.trim() || null }, { kind: 'status' }));
      message = `Status updated for ${named}.`;
    } else {
      if (!needReason()) return;
      saved = await run(() => store.dismissFlag(record.id, flag, reason.trim()));
      message = flag === 'beneficiary_name_check' ? `Name check cleared for ${named}.` : `Flag dismissed for ${named}. It's under Show dismissed.`;
    }
    if (saved) onSaved(message);
  };

  return (
    <form className="queue-action" aria-label={`${ACTION_LABELS[action]}: ${recordName(record, data)}`} onSubmit={(event) => void submit(event)} noValidate>
      {action === 'barangay' && (
        <>
          {plottedBarangay && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setMunicipalityId(String(plottedBarangay.municipality_id));
                setBarangayId(String(plottedBarangay.id));
              }}
            >
              Use where it's plotted: {plottedBarangay.name}
            </button>
          )}
          {nearest.length > 0 && (
            <p className="field-hint">
              Nearest names:{' '}
              {nearest.map((candidate, index) => (
                <span key={candidate.name}>
                  {index > 0 && ', '}
                  <button type="button" className="link-button" onClick={() => setBarangayId(String(inMunicipality.find((barangay) => barangay.name === candidate.name)!.id))}>
                    {candidate.name}
                  </button>
                </span>
              ))}
            </p>
          )}
          <SelectField label="Municipality" value={municipalityId} onChange={(value) => { setMunicipalityId(value); setBarangayId(''); }} options={data.municipalities.map((municipality) => ({ value: municipality.id, label: municipality.name }))} />
          <SelectField label="Barangay" required value={barangayId} placeholder="Choose a barangay" onChange={setBarangayId} options={inMunicipality.map((barangay) => ({ value: barangay.id, label: barangay.name }))} error={errors.barangay_id} />
        </>
      )}
      {action === 'basis' && (
        <SelectField
          label="Location basis"
          required
          value={basisId}
          placeholder="Choose one"
          onChange={setBasisId}
          options={data.locationBases.filter((basis) => basis.is_active || String(basis.id) === basisId).map((basis) => ({ value: basis.id, label: basis.name }))}
          error={errors.location_basis_id}
        />
      )}
      {action === 'status' && (
        <>
          <SelectField
            label="Status"
            required
            value={statusId}
            onChange={setStatusId}
            options={statuses}
            error={errors.status_id}
          />
          <TextField label="Status date" type="date" required value={statusDate} onChange={setStatusDate} error={errors.status_date} />
          <TextField label="Remarks (optional)" value={remarks} onChange={setRemarks} />
        </>
      )}
      {action !== 'status' && (
        <TextField
          label="Reason"
          required
          multiline
          value={reason}
          onChange={setReason}
          error={errors.reason}
          hint={
            action === 'basis'
              ? 'Such as "The point is the FCA\'s office in the next barangay." The flag is dismissed with this reason.'
              : action === 'dismiss' && flag === 'beneficiary_name_check'
                ? 'Dismissing a name check clears it.'
                : undefined
          }
        />
      )}
      <Feedback failure={failure} />
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={busy}>
          {ACTION_LABELS[action]}
        </button>
        <button type="button" className="secondary-button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DismissedNote({ dismissal, data, user, onPutBack }: { dismissal: QaDismissal; data: MapData; user: AppUser; onPutBack(): void }) {
  const who = personName(data, user, dismissal.dismissed_by);
  return (
    <p className="field-hint">
      Dismissed by {who} on {dateOnly(dismissal.dismissed_at)}: {dismissal.reason}{' '}
      <button type="button" className="link-button" onClick={onPutBack}>
        Put back in the queue
      </button>
    </p>
  );
}

export function QaQueue({ data, user }: { data: MapData; user: AppUser }) {
  const { store } = useStore();
  const [filters, setFilters] = useState<QueueFilters>({ municipalityId: null, flag: null, showDismissed: false, search: '' });
  const [open, setOpen] = useState<{ key: string; action: Action } | null>(null);
  const { failure, notice, run, clear } = useSaving();
  const [saved, setSaved] = useState<string | null>(null);

  const groups = useMemo(() => buildQueue(data, filters), [data, filters]);
  const counts = useMemo(() => flagCounts(data, filters.municipalityId), [data, filters.municipalityId]);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const change = (changes: Partial<QueueFilters>) => setFilters((current) => ({ ...current, ...changes }));

  return (
    <section className="admin-section qa-queue" aria-label="QA queue">
      <header className="admin-section-header">
        <div>
          <h2>QA queue</h2>
          <p className="field-hint">What the checks flagged, worst first. Fixing the data clears a flag by itself. Dismiss is for a flag that's right as it is, such as a point at the FCA's office, and needs a reason.</p>
        </div>
      </header>

      <form className="audit-filters" aria-label="Filter the queue" onSubmit={(event) => event.preventDefault()}>
        <label className="field">
          <span>Municipality</span>
          <select value={filters.municipalityId ?? ''} onChange={(event) => change({ municipalityId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">All</option>
            {data.municipalities.map((municipality) => (
              <option key={municipality.id} value={municipality.id}>
                {municipality.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Flag</span>
          <select value={filters.flag ?? ''} onChange={(event) => change({ flag: event.target.value || null })}>
            <option value="">All flags ({total})</option>
            {FLAG_ORDER.filter((flag) => counts[flag]).map((flag) => (
              <option key={flag} value={flag}>
                {FLAG_LABELS[flag]} ({counts[flag]})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Record</span>
          <input type="search" placeholder="Name, beneficiary or ID" value={filters.search} onChange={(event) => change({ search: event.target.value })} />
        </label>
        <label className="choice">
          <input type="checkbox" checked={filters.showDismissed} onChange={(event) => change({ showDismissed: event.target.checked })} />
          Show dismissed
        </label>
      </form>
      <Feedback failure={failure} notice={notice ?? saved} />

      {groups.length === 0 && <p className="empty-note">{total === 0 && !filters.search ? 'Nothing is flagged here.' : 'Nothing matches these filters.'}</p>}

      {groups.map((group) => (
        <section key={group.flag} className="queue-group" aria-label={group.label} data-flag={group.flag}>
          <h3>
            {group.label} <span className="count">{group.total}</span>
          </h3>
          <p className="field-hint">{FLAG_ADVICE[group.flag]}</p>
          {group.municipalities.map((place) => (
            <div key={place.id} className="queue-place">
              <h4>
                {place.name} <span className="count">{place.items.length}</span>
              </h4>
              <ul className="queue-list">
                {place.items.map(({ record, flag, dismissal }) => {
                  const key = `${record.id}|${flag}`;
                  const shown = detail(record, flag, data);
                  const barangay = data.barangays.find((candidate) => candidate.id === record.barangay_id)?.name ?? record.barangay_raw ?? 'No barangay';
                  return (
                    <li key={key} className="queue-item" data-record={record.id} data-flag={flag}>
                      <div className="queue-item-main">
                        <Link to={recordOnMap(record.id)}>{recordName(record, data)}</Link>
                        <span>{record.beneficiary ?? 'No beneficiary'}</span>
                        <span className="field-hint">
                          {barangay}
                          {record.year_funded ? ` · ${record.year_funded}` : ''}
                          {record.source_id ? ` · ${record.source_id}` : ''}
                        </span>
                        {shown && <span className="field-hint">{shown}</span>}
                        {dismissal && <DismissedNote dismissal={dismissal} data={data} user={user} onPutBack={() => { setSaved(null); void run(() => store.undismissFlag(record.id, flag), 'Back in the queue.'); }} />}
                      </div>
                      {!dismissal && (
                        <div className="queue-actions">
                          {FIX_ON_MAP.has(flag) && (
                            <Link className="secondary-button" to={`${recordOnMap(record.id)}?fix=resolve`}>
                              {flag === 'beneficiary_name_check' ? 'Fix the name' : 'Fix on the map'}
                            </Link>
                          )}
                          {(ACTIONS[flag] ?? ['status', 'dismiss']).map((action) => (
                            <button
                              key={action}
                              type="button"
                              className="secondary-button"
                              aria-expanded={open?.key === key && open.action === action}
                              onClick={() => {
                                clear();
                                setSaved(null);
                                setOpen(open?.key === key && open.action === action ? null : { key, action });
                              }}
                            >
                              {ACTION_LABELS[action]}
                            </button>
                          ))}
                        </div>
                      )}
                      {open?.key === key && <ActionForm
                          record={record}
                          flag={flag}
                          action={open.action}
                          data={data}
                          onDone={() => setOpen(null)}
                          onSaved={(message) => {
                            setOpen(null);
                            setSaved(message);
                          }}
                        />}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </section>
  );
}
