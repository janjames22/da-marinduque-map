// A record's audit trail: every change, newest first, with who made it, when, why, and what changed.
// The map's History panel and the record's own page both show it. The database lets Encoders and Admins
// read it, one record at a time.
import { useEffect, useState } from 'react';
import type { AuditEntry, Intervention, MapData } from '../data/types';
import { auditChanges, auditHeadline } from '../lib/audit-display';
import { useStore } from '../state/store-context';

const when = (at: string) => new Date(at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' });

export function ChangeHistory({ data, record }: { data: MapData; record: Intervention }) {
  const { store } = useStore();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const schema = data.types.find((t) => t.id === record.intervention_type_id)?.field_schema;

  // Depends on the record itself, so the list refreshes when the record changes.
  useEffect(() => {
    let cancelled = false;
    store
      .auditFor(record.id)
      .then((found) => {
        if (!cancelled) setEntries(found);
      })
      .catch((error: Error) => {
        if (!cancelled) setFailure(`Could not load the history: ${error.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [store, record]);

  if (failure) {
    return (
      <p className="field-error" role="alert">
        {failure}
      </p>
    );
  }
  if (entries === null) return <p className="muted">Loading…</p>;
  if (entries.length === 0) return <p className="muted">No changes recorded yet.</p>;

  return (
    <ol className="audit-list">
      {[...entries].reverse().map((entry) => {
        const changes = auditChanges(entry, data, schema);
        const reason = typeof entry.context?.reason === 'string' ? entry.context.reason : null;
        return (
          <li key={entry.id}>
            <strong>{auditHeadline(entry, data)}</strong>
            <span className="record-meta"> {when(entry.at)}</span>
            {entry.actor_name && <div className="record-meta">By {entry.actor_name}</div>}
            {reason && <div>Reason: {reason}</div>}
            {changes.length > 0 && (
              <ul>
                {changes.map((change) => (
                  <li key={change.field}>
                    {change.field}: {change.from} → {change.to}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
