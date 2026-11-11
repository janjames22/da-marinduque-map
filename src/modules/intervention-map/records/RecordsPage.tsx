// /records: every intervention as a list, and /records/:id, one record on a page of its own. The list
// uses the map's filters and the same table as the panel beside the map, so it counts the same
// records. Editing happens on the map, where the location is. Loaded only when opened.
import { ArrowLeft, Info, Map as MapIcon, MapPinOff, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router-dom';
import { RecordsTable, type TableState } from '../dashboard/RecordsTable';
import type { AppUser, MapData } from '../data/types';
import { selectExportRecords } from '../export/records';
import { liveRecords, pickViewFilters } from '../lib/choropleth';
import { formatPoint, googleMapsUrl } from '../lib/coordinates';
import { manilaDate } from '../lib/dates';
import { dismissedKeys, encodedPlace, fieldValue, FLAG_LABELS, isOnMap, locationWarning, recordName, statusDateLabel } from '../lib/display';
import { ADD_ON_MAP, AWAITING_LIST, recordOnMap } from '../lib/map-paths';
import { permissionsFor } from '../lib/permissions';
import { pointOf } from '../lib/qa';
import { FilterBar } from '../overview/FilterBar';
import { ExportDialog } from '../panel/ExportDialog';
import { useMapUi } from '../state/map-ui';
import { StoreContext } from '../state/store-context';
import { useMapData, type Boundaries } from '../state/use-map-data';
import '../overview/overview.css';
import './records.css';

const count = (value: number) => value.toLocaleString('en-US');
const byId = <T extends { id: number }>(rows: T[], id: number | null) => (id === null ? undefined : rows.find((row) => row.id === id));

function RecordsList({ data, boundaries, user }: { data: MapData; boundaries: Boundaries; user: AppUser }) {
  const navigate = useNavigate();
  const ui = useMapUi();
  const view = pickViewFilters(ui);
  const viewKey = JSON.stringify(view);
  const allRecords = useMemo(() => liveRecords(data.interventions, data.types), [data.interventions, data.types]);
  const records = useMemo(() => selectExportRecords(allRecords, data.links, { view, mapBounds: null }, data), [allRecords, data, viewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tableState, setTableState] = useState<TableState>({ search: '', sorting: [], pagination: { pageIndex: 0, pageSize: 25 } });
  const changeTable = useCallback((changes: Partial<TableState>) => setTableState((current) => ({ ...current, ...changes })), []);
  const { canEdit } = permissionsFor(user.role);

  const perType = data.types
    .filter((type) => type.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((type) => ({ type, count: records.filter((record) => record.intervention_type_id === type.id).length }))
    .filter(({ count: n }) => n > 0);

  return (
    <main className="overview-page records-page" aria-labelledby="records-title">
      <header className="page-header page-header-actions">
        <div>
          <h1 id="records-title">Interventions</h1>
          <p>
            {count(records.length)} {records.length === 1 ? 'record' : 'records'}
            {perType.length > 0 ? ` · ${perType.map(({ type, count: n }) => `${count(n)} ${type.name}`).join(', ')}` : ''}
          </p>
        </div>
        {canEdit && (
          <Link to={ADD_ON_MAP} className="ui-button ui-button-primary">
            <Plus aria-hidden="true" />
            Add intervention
          </Link>
        )}
      </header>
      <FilterBar data={data} />
      <div className="overview-card records-card">
        <RecordsTable records={records} data={data} state={tableState} onChange={changeTable} onOpen={(record) => navigate(`/records/${record.id}`)} markUnplotted />
      </div>
      <ExportDialog data={data} boundaries={boundaries} allRecords={allRecords} />
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function RecordDetail({ data, user, id }: { data: MapData; user: AppUser; id: string }) {
  const { canEdit } = permissionsFor(user.role);
  const record = data.interventions.find((candidate) => candidate.id === id);

  if (!record) {
    return (
      <main className="overview-page records-page" aria-labelledby="record-title">
        <Link to="/records" className="back-link">
          <ArrowLeft aria-hidden="true" />
          Interventions
        </Link>
        <div className="overview-card" role="alert">
          <h1 id="record-title" className="record-missing">
            That record wasn't found
          </h1>
          <p>It may have been removed, or the link may be incomplete.</p>
        </div>
      </main>
    );
  }

  const type = byId(data.types, record.intervention_type_id);
  const category = byId(data.categories, record.category_id);
  const group = byId(data.categoryGroups, category?.category_group_id ?? null);
  const status = byId(data.statuses, record.status_id);
  const point = pointOf(record);
  const onMap = isOnMap(record);
  const warning = locationWarning(record, data);
  const dismissed = dismissedKeys(data.qaDismissals);
  const flags = record.qa_flags.filter((flag) => flag !== 'duplicate_point' && !dismissed.has(`${record.id}|${flag}`));
  const history = data.statusHistory.filter((entry) => entry.intervention_id === record.id).sort((a, b) => b.status_date.localeCompare(a.status_date) || b.created_at.localeCompare(a.created_at));
  const photos = data.photos.filter((photo) => photo.intervention_id === record.id);
  const custom = (type?.field_schema.fields ?? []).filter((field) => !field.archived && field.input !== 'photo');

  return (
    <main className="overview-page records-page" aria-labelledby="record-title">
      <Link to="/records" className="back-link">
        <ArrowLeft aria-hidden="true" />
        Interventions
      </Link>

      <header className="page-header page-header-actions">
        <div>
          <div className="record-title-row">
            <h1 id="record-title">{recordName(record, data)}</h1>
            {type && (
              <span className="pill">
                <span className="pill-dot" style={{ background: type.color }} aria-hidden="true" />
                {type.name}
              </span>
            )}
            {status && (
              <span className="pill">
                <span className="pill-dot" style={{ background: status.color }} aria-hidden="true" />
                {status.name}
              </span>
            )}
            {!onMap && <span className="unplotted-badge">No coordinates yet</span>}
          </div>
          <p>{[record.source_id, encodedPlace(record, data)].filter(Boolean).join(' · ')}</p>
        </div>
        {onMap && (
          <Link to={recordOnMap(record.id)} className="ui-button ui-button-primary">
            <MapIcon aria-hidden="true" />
            {canEdit ? 'Open on the map to edit' : 'Open on the map'}
          </Link>
        )}
      </header>

      {record.deleted_at && (
        <p className="ui-notice ui-notice-danger" role="status">
          This record was deleted on {manilaDate(record.deleted_at)}. It isn't counted anywhere. An Admin can restore it from the map's Deleted records.
        </p>
      )}

      <div className="record-columns">
        <div className="record-main">
          <section className="overview-card" aria-labelledby="details-title">
            <h2 id="details-title" className="card-title">
              Details
            </h2>
            <dl className="facts">
              <Fact label="Type" value={type?.name} />
              <Fact label="Category" value={category?.name} />
              <Fact label="Category group" value={group?.name} />
              <Fact label="Program" value={byId(data.programs, record.banner_program_id)?.name} />
              <Fact label="Year funded" value={record.year_funded === null ? null : String(record.year_funded)} />
              <Fact label="Quantity" value={String(record.quantity)} />
              <Fact label="Beneficiary" value={record.beneficiary} />
              <Fact label="Beneficiary type" value={byId(data.beneficiaryTypes, record.beneficiary_type_id)?.name} />
              <Fact label="Fund source" value={record.fund_source} />
              <Fact label="Unit cost" value={record.unit_cost === null ? null : `₱${record.unit_cost.toLocaleString('en-US')}`} />
              {custom.map((field) => (
                <Fact key={field.key} label={field.label} value={(() => {
                  const value = fieldValue(field, record.attributes[field.key]);
                  return value && field.unit ? `${value} ${field.unit}` : value;
                })()} />
              ))}
            </dl>
            {record.remarks && <p className="record-remarks">{record.remarks}</p>}
            {record.data_source && <p className="record-source">Source: {record.data_source}</p>}
          </section>

          <section className="overview-card" aria-labelledby="location-title">
            <h2 id="location-title" className="card-title">
              Location
            </h2>
            {onMap && point ? (
              <>
                <dl className="facts">
                  <Fact label="Coordinates" value={formatPoint(point)} />
                  <Fact label="Barangay" value={encodedPlace(record, data)} />
                  <Fact label="Location basis" value={byId(data.locationBases, record.location_basis_id)?.name} />
                </dl>
                {warning && <p className="ui-notice ui-notice-info">{warning}</p>}
                <p className="record-links">
                  <Link to={recordOnMap(record.id)}>Open on the map</Link>
                  <a href={googleMapsUrl(point)} target="_blank" rel="noopener noreferrer">
                    Open in Google Maps
                  </a>
                </p>
              </>
            ) : (
              <>
                <p className="ui-notice ui-notice-info">
                  <MapPinOff aria-hidden="true" />
                  <span>
                    {(warning ?? 'No coordinates yet, so this record is not on the map').replace(/\.?$/, '.')} It's still counted on the dashboard, and it's on the{' '}
                    <Link to={AWAITING_LIST}>list for the region to verify</Link>.
                  </span>
                </p>
                {canEdit && record.deleted_at === null && (
                  <Link to={`${recordOnMap(record.id)}?fix=resolve`} className="ui-button ui-button-secondary">
                    Enter verified coordinates
                  </Link>
                )}
              </>
            )}
          </section>

          <section className="overview-card" aria-labelledby="history-title">
            <h2 id="history-title" className="card-title">
              Status history
            </h2>
            {history.length === 0 ? (
              <p className="muted">No status recorded yet.</p>
            ) : (
              <ol className="timeline">
                {history.map((entry) => {
                  const entryStatus = byId(data.statuses, entry.status_id);
                  return (
                    <li key={entry.id}>
                      <span className="timeline-dot" style={{ background: entryStatus?.color }} aria-hidden="true" />
                      <span>
                        <strong>{entryStatus?.name ?? 'Unknown status'}</strong>
                        <span className="muted">{statusDateLabel(entry)}</span>
                        {entry.remarks && <span className="muted">{entry.remarks}</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <div className="record-side">
          <section className="overview-card" aria-labelledby="qa-title">
            <h2 id="qa-title" className="card-title">
              QA
            </h2>
            {flags.length === 0 ? (
              <p className="pill is-success">Nothing to check</p>
            ) : (
              <>
                <ul className="flag-list">
                  {flags.map((flag) => (
                    <li key={flag}>{FLAG_LABELS[flag] ?? flag}</li>
                  ))}
                </ul>
                {canEdit && <Link to="/qa">Open the QA queue</Link>}
              </>
            )}
          </section>
          <section className="overview-card" aria-labelledby="photos-title">
            <h2 id="photos-title" className="card-title">
              Photos
            </h2>
            {photos.length === 0 ? (
              <p className="muted">No photos yet.{canEdit && onMap ? ' Add one from the record on the map.' : ''}</p>
            ) : (
              <p>
                {count(photos.length)} {photos.length === 1 ? 'photo' : 'photos'}. {onMap && <Link to={recordOnMap(record.id)}>See them on the map</Link>}
              </p>
            )}
          </section>
          {record.updated_at && (
            <p className="record-updated">
              <Info aria-hidden="true" />
              Last changed {manilaDate(record.updated_at)}
              {canEdit ? '. The full history is on the map, under History.' : '.'}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

export function RecordsPage({ user, onDataSources }: { user: AppUser; onDataSources(sources: string[]): void }) {
  const state = useMapData(user);
  const detail = useMatch('/records/:id');
  const sources = state.status === 'ready' ? state.data.dataSources : null;
  useEffect(() => {
    if (sources) onDataSources(sources);
  }, [sources, onDataSources]);

  if (state.status === 'loading') return <p className="page-message is-loading">Loading…</p>;
  if (state.status === 'error') {
    return (
      <div className="page-message" role="alert">
        <h2>This page could not load</h2>
        <p>{state.error.message}</p>
      </div>
    );
  }
  return (
    <StoreContext.Provider value={{ store: state.store, places: state.places }}>
      {detail ? <RecordDetail data={state.data} user={user} id={detail.params.id!} /> : <RecordsList data={state.data} boundaries={state.boundaries} user={user} />}
    </StoreContext.Provider>
  );
}
