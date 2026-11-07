// Who changed what and when, for accountability. One page at a time, as the log only ever grows.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuditPage } from '../data/store';
import type { AuditAction, AuditEntry, MapData } from '../data/types';
import { ACTION_LABELS, auditDetails, auditTarget } from '../lib/audit-display';
import { recordName } from '../lib/display';
import { foldText } from '../lib/view-fields';
import { useStore } from '../state/store-context';

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;
const NO_LOGIN = '__none__';

const ACTIONS: AuditAction[] = ['insert', 'update', 'soft_delete', 'restore', 'delete', 'export'];

interface Filters {
  person: string;
  record: string;
  action: string;
  from: string;
  to: string;
}

const NO_FILTERS: Filters = { person: '', record: '', action: '', from: '', to: '' };

function matchingRecords(text: string, data: MapData): string[] | null {
  const wanted = foldText(text);
  if (wanted === '') return null;
  return data.interventions
    .filter((record) => foldText([recordName(record, data), record.beneficiary, record.source_id, record.id].filter(Boolean).join(' ')).includes(wanted))
    .map((record) => record.id);
}

export function AuditSection({ data }: { data: MapData }) {
  const { store } = useStore();
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<AuditPage | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const change = (changes: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...changes }));
    setPage(0);
  };

  const recordIds = useMemo(() => matchingRecords(filters.record, data), [filters.record, data]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(() => {
      // Nothing can match, so there's no need to ask.
      const asking =
        recordIds?.length === 0
          ? Promise.resolve({ total: 0, entries: [] })
          : store.auditLog({
              actorId: filters.person && filters.person !== NO_LOGIN ? filters.person : null,
              noActor: filters.person === NO_LOGIN,
              recordIds,
              action: (filters.action || null) as AuditAction | null,
              from: filters.from || null,
              to: filters.to || null,
              page,
              pageSize: PAGE_SIZE,
            });
      asking
        .then((answer) => {
          if (cancelled) return;
          setResult(answer);
          setFailure(null);
        })
        .catch((error: Error) => {
          if (!cancelled) setFailure(error.message);
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // data: a change made elsewhere belongs in the list straight away.
  }, [store, filters.person, filters.action, filters.from, filters.to, recordIds, page, data]);

  const noLoginLabel = store.local ? 'This browser' : 'No login (a script or Supabase\'s dashboard)';
  const who = (entry: AuditEntry) => entry.actor_name ?? (entry.actor_id ? 'An account since removed' : noLoginLabel);
  const people = [...data.members].sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''));

  const total = result?.total ?? 0;
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min((page + 1) * PAGE_SIZE, total);
  const hasFilters = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  return (
    <section className="admin-section audit-section" aria-label="Audit log">
      <header className="admin-section-header">
        <div>
          <h2>Audit log</h2>
          <p className="field-hint">Who changed what and when. Nothing here can be edited. Times are Philippine time.</p>
        </div>
      </header>

      <form className="audit-filters" aria-label="Filter the audit log" onSubmit={(event) => event.preventDefault()}>
        <label className="field">
          <span>Person</span>
          <select value={filters.person} onChange={(event) => change({ person: event.target.value })}>
            <option value="">Everyone</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name ?? 'Unnamed'}
              </option>
            ))}
            <option value={NO_LOGIN}>{noLoginLabel}</option>
          </select>
        </label>
        <label className="field">
          <span>Record</span>
          <input type="search" placeholder="Name, beneficiary or ID" value={filters.record} onChange={(event) => change({ record: event.target.value })} />
        </label>
        <label className="field">
          <span>Action</span>
          <select value={filters.action} onChange={(event) => change({ action: event.target.value })}>
            <option value="">Any</option>
            {ACTIONS.map((action) => (
              <option key={action} value={action}>
                {ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>From</span>
          <input type="date" value={filters.from} onChange={(event) => change({ from: event.target.value })} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={filters.to} onChange={(event) => change({ to: event.target.value })} />
        </label>
        {hasFilters && (
          <button type="button" className="link-button" onClick={() => change(NO_FILTERS)}>
            Clear filters
          </button>
        )}
      </form>

      {failure && (
        <p className="field-error" role="alert">
          The log could not be read. {failure}
        </p>
      )}

      {result && result.entries.length === 0 && !failure && <p className="empty-note">{hasFilters ? 'Nothing in the log matches these filters.' : 'Nothing has been logged yet.'}</p>}

      {result && result.entries.length > 0 && (
        <div className="audit-scroll" aria-busy={busy}>
          <table className="audit-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">What</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {result.entries.map((entry) => {
                const target = auditTarget(entry, data);
                const details = auditDetails(entry, data);
                const reason = typeof entry.context?.reason === 'string' ? entry.context.reason : null;
                return (
                  <tr key={entry.id} data-audit-entry={entry.id}>
                    <td className="audit-when">{new Date(entry.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</td>
                    <td>{who(entry)}</td>
                    <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
                    <td>{target.link ? <Link to={target.link}>{target.label}</Link> : target.label}</td>
                    <td>
                      {reason && <div>Reason: {reason}</div>}
                      {details.length > 0 && (
                        <ul>
                          {details.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="records-pages">
        <span className="records-count" role="status">
          {first}–{last} of {total.toLocaleString('en-US')}
        </span>
        <button type="button" className="secondary-button" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Newer
        </button>
        <button type="button" className="secondary-button" disabled={last >= total} onClick={() => setPage(page + 1)}>
          Older
        </button>
      </div>
    </section>
  );
}
