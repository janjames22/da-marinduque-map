// /dashboard: the province's figures on a page of their own. The filters are the map's, so the map,
// this page, the records table and the exports always count the same records. Records without
// verified coordinates are in every total, and listed at the bottom for the region to check.
// Loaded only when opened, so the map and Home don't carry the chart library.
import { Download, MapPinOff } from 'lucide-react';
import Papa from 'papaparse';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChartCard, HorizontalBars, operationalNotes, plural, RowsTable, StatusStacks, StatusTable, YearColumns } from '../dashboard/Charts';
import type { AppUser, MapData } from '../data/types';
import { describeFilters, filterLines, selectExportRecords } from '../export/records';
import { barangaysInScope, liveRecords, pickViewFilters } from '../lib/choropleth';
import { buildDashboard, type BarRow, type StatusRow, type StatusSeries } from '../lib/dashboard';
import { manilaToday } from '../lib/dates';
import { recordName } from '../lib/display';
import { downloadFile } from '../lib/download';
import { recordOnMap } from '../lib/map-paths';
import { awaitingCount, awaitingLocation, hasRoads, unitsByCategoryGroup, VERIFICATION_COLUMNS, verificationRows } from '../lib/overview';
import { useMapUi } from '../state/map-ui';
import { StoreContext, useStore } from '../state/store-context';
import { useMapData } from '../state/use-map-data';
import { FilterBar } from './FilterBar';
import { SegmentedBar, Tile } from './HomePage';
import './overview.css';

const count = (value: number) => value.toLocaleString('en-US');

type CsvRow = Record<string, string | number>;

// A chart's table as a file. Like every export, it's in the audit log before it leaves.
function useCsvDownload(filters: Record<string, unknown>) {
  const { store } = useStore();
  const [failure, setFailure] = useState<string | null>(null);
  const download = async (name: string, columns: readonly string[], rows: CsvRow[], records: number, what: string) => {
    setFailure(null);
    try {
      const fileName = `${name}_${manilaToday()}.csv`;
      await store.logExport({ format: 'csv', file_name: fileName, filters: { report: 'dashboard', table: what, ...filters }, record_count: records });
      // The byte-order mark makes Excel read ñ correctly.
      const text = `﻿${Papa.unparse({ fields: [...columns], data: rows.map((row) => columns.map((column) => row[column] ?? '')) })}`;
      downloadFile(new TextEncoder().encode(text), fileName, 'text/csv;charset=utf-8');
    } catch (error) {
      setFailure(`The file wasn't downloaded: ${(error as Error).message}`);
    }
  };
  return { download, failure };
}

const barCsv = (rows: BarRow[], heading: string): CsvRow[] => rows.map((row) => ({ [heading]: row.label, Units: row.value }));
const statusCsv = (rows: StatusRow[], series: StatusSeries[]): CsvRow[] =>
  rows.map((row) => ({ Municipality: row.label, ...Object.fromEntries(series.map((entry) => [entry.label, row.values[entry.key] ?? 0])), Total: row.total }));

function Dashboard({ data }: { data: MapData }) {
  const ui = useMapUi();
  const location = useLocation();
  const view = pickViewFilters(ui);
  const viewKey = JSON.stringify(view);
  const selection = useMemo(() => ({ view, mapBounds: null }), [viewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const allRecords = useMemo(() => liveRecords(data.interventions, data.types), [data.interventions, data.types]);
  const records = useMemo(() => selectExportRecords(allRecords, data.links, selection, data), [allRecords, data, selection]);
  const barangays = useMemo(() => barangaysInScope(data.barangays, view), [data.barangays, viewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const numbers = useMemo(() => buildDashboard(records, data, barangays), [records, data, barangays]);
  const groups = useMemo(() => unitsByCategoryGroup(records, data), [records, data]);
  const awaiting = useMemo(() => awaitingLocation(records, data), [records, data]);
  const waiting = awaitingCount(awaiting);
  const units = records.reduce((sum, record) => sum + record.quantity, 0);

  const filters = useMemo(() => describeFilters(selection, data), [selection, data]);
  const lines = filterLines(filters);
  const { download, failure } = useCsvDownload(filters as unknown as Record<string, unknown>);
  const { operational } = numbers;

  // A link to the list, from Home, waits until the list is there.
  useEffect(() => {
    if (location.hash === '#awaiting') document.getElementById('awaiting')?.scrollIntoView();
  }, [location.hash]);

  const selectMunicipality = (key: string) => {
    if (/^\d+$/.test(key)) ui.setMunicipalityFilter(Number(key));
  };
  const municipalityName = data.municipalities.find((municipality) => municipality.id === ui.municipalityId)?.name;

  return (
    <main className="overview-page dashboard-page" aria-labelledby="dashboard-title">
      <header className="page-header">
        <h1 id="dashboard-title">Dashboard</h1>
        <p>
          {plural(numbers.records, 'record')}
          {waiting > 0 ? `, including ${count(waiting)} not on the map yet` : ''}. The filters here are the map's, so both count the same records.
        </p>
      </header>

      <FilterBar data={data} />
      <p className="dashboard-scope" aria-live="polite">
        {lines.length > 0 ? lines.join(' · ') : 'The whole province. No filters are on.'}
      </p>
      {failure && (
        <p className="ui-notice ui-notice-danger" role="alert">
          {failure}
        </p>
      )}

      <dl className="overview-tiles" aria-label="Totals">
        <Tile id="records" hero label="Total interventions" value={count(numbers.records)} note={plural(units, 'unit')} />
        {numbers.types.map((type) => (
          <Tile key={type.typeId} id={`type-${type.typeId}`} label={data.types.find((t) => t.id === type.typeId)?.name ?? type.label} value={count(type.units)} note="Units" />
        ))}
        {!hasRoads(data) && (
          <div className="overview-tile is-placeholder" data-tile="fmr">
            <dt>Farm-to-Market Roads</dt>
            <dd className="overview-tile-value">Data to follow</dd>
            <dd className="overview-tile-note">Roads and km, once the data is in</dd>
          </div>
        )}
      </dl>
      <dl className="overview-tiles" aria-label="Condition and reach">
        <Tile id="operational" label="% operational" value={operational.percent === null ? '–' : `${operational.percent}%`} note={operationalNotes(operational).join('. ')} />
        <Tile id="beneficiaries" label="Beneficiaries (approx.)" value={count(numbers.beneficiaries)} note="Different names, ignoring case, spacing and punctuation" />
        <Tile id="barangays-without" label="Barangays with no intervention yet" value={count(numbers.barangaysWithout)} note={`of ${plural(numbers.barangaysTotal, 'barangay')}`} />
        <Tile
          id="awaiting"
          label="Awaiting coordinate verification"
          value={count(waiting)}
          note={
            waiting > 0 ? (
              <>
                {numbers.records > 0 ? `${Math.round((waiting / numbers.records) * 100)}% of records. ` : ''}
                <a href="#awaiting">See the list</a>
              </>
            ) : (
              'Every record here is on the map'
            )
          }
        />
      </dl>

      {numbers.records === 0 ? (
        <p className="overview-card empty-note">No records match these filters, so there's nothing to chart.</p>
      ) : (
        <>
          <ChartCard
            title="Units by category group"
            note={`Share of all ${plural(units, 'unit')}`}
            table={<RowsTable rows={groups} heading="Category group" />}
            onCsv={() => void download('Dashboard_CategoryGroups', ['Category group', 'Units'], barCsv(groups, 'Category group'), records.length, 'Units by category group')}
          >
            <SegmentedBar rows={groups} label="Units by category group" limit={Infinity} />
          </ChartCard>

          <div className="dashboard-charts">
            <ChartCard
              title="Units by municipality"
              note={municipalityName ? `Only ${municipalityName}. Clear the filter to see them all.` : 'Select a bar to see only that municipality.'}
              table={<RowsTable rows={numbers.byMunicipality} heading="Municipality" />}
              onCsv={() => void download('Dashboard_Municipalities', ['Municipality', 'Units'], barCsv(numbers.byMunicipality, 'Municipality'), records.length, 'Units by municipality')}
            >
              <HorizontalBars rows={numbers.byMunicipality} labelWidth={96} onSelect={selectMunicipality} />
            </ChartCard>
            <ChartCard
              title="Status by municipality"
              note="Status colors are set by Admins"
              table={<StatusTable rows={numbers.byStatus} series={numbers.statusSeries} />}
              onCsv={() =>
                void download('Dashboard_Status', ['Municipality', ...numbers.statusSeries.map((entry) => entry.label), 'Total'], statusCsv(numbers.byStatus, numbers.statusSeries), records.length, 'Status by municipality')
              }
            >
              <StatusStacks rows={numbers.byStatus} series={numbers.statusSeries} />
            </ChartCard>
            <ChartCard
              title="Units by program"
              note="The banner programs"
              table={<RowsTable rows={numbers.byProgram} heading="Program" />}
              onCsv={() => void download('Dashboard_Programs', ['Program', 'Units'], barCsv(numbers.byProgram, 'Program'), records.length, 'Units by program')}
            >
              <HorizontalBars rows={numbers.byProgram} labelWidth={150} />
            </ChartCard>
            <ChartCard
              title="Units by year funded"
              note={numbers.noYearUnits > 0 ? `Not shown: ${plural(numbers.noYearUnits, 'unit')} with no year.` : 'Every unit has a year.'}
              table={<RowsTable rows={numbers.byYear} heading="Year" />}
              onCsv={() => void download('Dashboard_Years', ['Year', 'Units'], barCsv(numbers.byYear, 'Year'), records.length, 'Units by year funded')}
            >
              <YearColumns rows={numbers.byYear} />
            </ChartCard>
            <ChartCard
              title={numbers.categoriesLeftOut > 0 ? 'Units by category (top 15)' : 'Units by category'}
              note={numbers.categoriesLeftOut > 0 ? `Not shown: ${numbers.categoriesLeftOut} smaller ${numbers.categoriesLeftOut === 1 ? 'category' : 'categories'}, with ${plural(numbers.unitsLeftOut, 'unit')}.` : undefined}
              table={<RowsTable rows={numbers.byCategory} heading="Category" />}
              onCsv={() => void download('Dashboard_Categories', ['Category', 'Units'], barCsv(numbers.byCategory, 'Category'), records.length, 'Units by category')}
            >
              <HorizontalBars rows={numbers.byCategory} labelWidth={150} />
            </ChartCard>
          </div>
        </>
      )}

      <section id="awaiting" className="overview-card awaiting" aria-labelledby="awaiting-title">
        <header className="overview-card-header">
          <div>
            <h2 id="awaiting-title">Awaiting coordinate verification</h2>
            <p>
              {waiting > 0
                ? `${plural(waiting, 'record')}. Counted above, but not on the map until the region confirms where ${waiting === 1 ? 'it is' : 'they are'}.`
                : 'Every record in these filters is on the map.'}
            </p>
          </div>
          {waiting > 0 && (
            <button
              type="button"
              className="ui-button ui-button-secondary"
              onClick={() => void download('For_field_verification', VERIFICATION_COLUMNS, verificationRows(awaiting, data), waiting, 'Awaiting coordinate verification')}
            >
              <Download aria-hidden="true" />
              Download verification sheet
            </button>
          )}
        </header>
        {awaiting.map((group) => (
          <div key={group.municipalityId} className="awaiting-group">
            <h3>
              {group.municipality} <span className="count">{group.records.length}</span>
            </h3>
            <div className="chart-table-scroll">
              <table className="awaiting-table">
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Item</th>
                    <th scope="col">Beneficiary</th>
                    <th scope="col">Encoded barangay</th>
                    <th scope="col">Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {group.records.map(({ record, issue }) => (
                    <tr key={record.id} data-record={record.id}>
                      <td className="awaiting-id">{record.source_id ?? '–'}</td>
                      <td>
                        <Link to={recordOnMap(record.id)}>{recordName(record, data)}</Link>
                      </td>
                      <td>{record.beneficiary ?? '–'}</td>
                      <td>{data.barangays.find((barangay) => barangay.id === record.barangay_id)?.name ?? record.barangay_raw ?? '–'}</td>
                      <td>
                        <span className={`issue-badge${record.qa_flags.includes('out_of_province') ? ' is-warning' : ''}`}>
                          <MapPinOff aria-hidden="true" />
                          {issue}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

export function DashboardPage({ user, onDataSources }: { user: AppUser; onDataSources(sources: string[]): void }) {
  const state = useMapData(user);
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
      <Dashboard data={state.data} />
    </StoreContext.Provider>
  );
}
