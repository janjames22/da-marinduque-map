import type { Intervention, MapData } from '../data/types';
import { openRecordPanel } from '../edit/open-panel';
import { encodedPlace, isOnMap, locationWarning, needsReview, recordName, statusDateLabel, statusTimeline } from '../lib/display';
import { useMapUi } from '../state/map-ui';

interface RecordListProps {
  records: Intervention[];
  data: MapData;
  showEncodedPlace?: boolean;
}

function compareRecords(a: Intervention, b: Intervention) {
  return (b.year_funded ?? 0) - (a.year_funded ?? 0) || (a.beneficiary ?? '').localeCompare(b.beneficiary ?? '');
}

export function RecordList({ records, data, showEncodedPlace = false }: RecordListProps) {
  const zoomToRecord = useMapUi((state) => state.zoomToRecord);

  return (
    <ul className="record-list">
      {[...records].sort(compareRecords).map((record) => {
        const type = data.types.find((t) => t.id === record.intervention_type_id);
        const program = data.programs.find((p) => p.id === record.banner_program_id);
        const status = data.statuses.find((s) => s.id === record.status_id);
        const latest = statusTimeline(record.id, data.statusHistory).at(-1);
        const warning = locationWarning(record, data);
        const name = recordName(record, data);

        return (
          <li key={record.id} className="record-row">
            {isOnMap(record) ? (
              <button type="button" className="link-button record-name" onClick={() => zoomToRecord(record.id)}>
                {name}
              </button>
            ) : (
              <span className="record-name">{name}</span>
            )}
            <div className="record-meta">
              {[type?.name, record.year_funded, record.beneficiary].filter(Boolean).join(' · ')}
            </div>
            {showEncodedPlace && <div className="record-meta">Encoded in {encodedPlace(record, data)}</div>}
            {program && (
              <div className="record-meta">
                <span className="swatch" style={{ background: program.color }} aria-hidden="true" />
                {program.name}
              </div>
            )}
            {status && (
              <div className="record-meta">
                {status.name}
                {latest && `, ${statusDateLabel(latest)}`}
              </div>
            )}
            {warning && <div className="record-warning">{warning}</div>}
            <div className="record-actions">
              <button type="button" className="link-button" onClick={() => openRecordPanel('edit', record)}>
                Edit
              </button>
              <button type="button" className="link-button" onClick={() => openRecordPanel('status', record)}>
                Update status
              </button>
              {needsReview(record) && (
                <button type="button" className="link-button" onClick={() => openRecordPanel('resolve', record)}>
                  Resolve flag
                </button>
              )}
              <button type="button" className="link-button" onClick={() => openRecordPanel('history', record)}>
                History
              </button>
              <button type="button" className="link-button" onClick={() => openRecordPanel('delete', record)}>
                Delete
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
