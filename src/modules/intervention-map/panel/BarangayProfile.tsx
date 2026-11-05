import { useMemo } from 'react';
import type { Barangay, Intervention, MapData } from '../data/types';
import { useEditUi } from '../state/edit-ui';
import { useMapUi } from '../state/map-ui';
import { BaselineSection } from './BaselineSection';
import { RecordList } from './RecordList';

interface BarangayProfileProps {
  barangay: Barangay;
  data: MapData;
  allRecords: Intervention[];
  onClose(): void;
}

interface CountRow {
  key: number | string;
  label: string;
  color: string | null;
  count: number;
}

function tally(records: Intervention[], rowFor: (record: Intervention) => Omit<CountRow, 'count'>): CountRow[] {
  const rows = new Map<CountRow['key'], CountRow>();
  for (const record of records) {
    const row = rowFor(record);
    const existing = rows.get(row.key);
    if (existing) existing.count += 1;
    else rows.set(row.key, { ...row, count: 1 });
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function CountTable({ caption, rows }: { caption: string; rows: CountRow[] }) {
  return (
    <table className="count-table">
      <caption>{caption}</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">
              {row.color && <span className="swatch" style={{ background: row.color }} aria-hidden="true" />}
              {row.label}
            </th>
            <td>{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// A profile always shows everything in the barangay, whatever filters the map has on.
export function BarangayProfile({ barangay, data, allRecords, onClose }: BarangayProfileProps) {
  const records = useMemo(() => {
    const linked = new Set(data.links.filter((l) => l.barangay_id === barangay.id).map((l) => l.intervention_id));
    return allRecords.filter((r) => linked.has(r.id));
  }, [allRecords, data.links, barangay.id]);

  const municipality = data.municipalities.find((m) => m.id === barangay.municipality_id);

  const byType = tally(records, (record) => {
    const type = data.types.find((t) => t.id === record.intervention_type_id);
    return { key: record.intervention_type_id, label: type?.name ?? 'Unknown', color: type?.color ?? null };
  });
  const byProgram = tally(records, (record) => {
    const program = data.programs.find((p) => p.id === record.banner_program_id);
    return { key: record.banner_program_id ?? 'none', label: program?.name ?? 'No program', color: program?.color ?? null };
  });

  const addHere = () => {
    useMapUi.getState().zoomToBarangay(barangay.id);
    useEditUi
      .getState()
      .openPanel({ kind: 'add', prefill: { municipality_id: barangay.municipality_id, barangay_id: barangay.id } }, { picking: true });
  };

  return (
    <aside className="panel panel-right" aria-label={`Profile of barangay ${barangay.name}`}>
      <header className="panel-header">
        <div>
          <h2>{barangay.name}</h2>
          <p>
            {municipality?.name}, Marinduque · PSGC {barangay.psgc_code}
          </p>
        </div>
        <button type="button" className="close-button" onClick={onClose} aria-label="Close profile">
          ×
        </button>
      </header>

      <button type="button" className="primary-button" onClick={addHere}>
        Add intervention here
      </button>

      <section>
        <h3 className="section-title">
          Interventions <span className="count">{records.length}</span>
        </h3>
        {records.length === 0 ? (
          <p className="empty-note">No intervention encoded yet in this barangay.</p>
        ) : (
          <>
            <CountTable caption="By type" rows={byType} />
            <CountTable caption="By program" rows={byProgram} />
            <RecordList records={records} data={data} />
          </>
        )}
      </section>

      <BaselineSection key={barangay.id} barangay={barangay} data={data} />
    </aside>
  );
}
