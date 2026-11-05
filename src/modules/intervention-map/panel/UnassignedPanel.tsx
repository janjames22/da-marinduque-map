import type { Intervention, MapData } from '../data/types';
import { RecordList } from './RecordList';

interface UnassignedPanelProps {
  records: Intervention[];
  data: MapData;
  onClose(): void;
}

export function UnassignedPanel({ records, data, onClose }: UnassignedPanelProps) {
  return (
    <aside className="panel panel-right" aria-label="Unassigned records">
      <header className="panel-header">
        <div>
          <h2>Unassigned records</h2>
          <p>
            {records.length} {records.length === 1 ? 'record has' : 'records have'} no linked barangay, so {records.length === 1 ? 'it isn\'t' : 'they aren\'t'} counted
            in any barangay.
          </p>
        </div>
        <button type="button" className="close-button" onClick={onClose} aria-label="Close list">
          ×
        </button>
      </header>
      <section>
        <RecordList records={records} data={data} showEncodedPlace />
      </section>
    </aside>
  );
}
