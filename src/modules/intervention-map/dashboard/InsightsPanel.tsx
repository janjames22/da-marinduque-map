// The dashboard and the records table, beside the map. Loaded only when opened, so the map doesn't
// carry the chart library.
import { useCallback, useMemo, useState } from 'react';
import type { Intervention, MapData } from '../data/types';
import { describeFilters, filterLines, geometryBounds, overlaps, selectExportRecords } from '../export/records';
import { barangaysInScope, pickViewFilters } from '../lib/choropleth';
import { buildDashboard } from '../lib/dashboard';
import { useExportUi } from '../state/export-ui';
import { useMapUi } from '../state/map-ui';
import type { Boundaries } from '../state/use-map-data';
import { DashboardView } from './Charts';
import { RecordsTable, type TableState } from './RecordsTable';

const MAP_VIEW_LINE = 'Only the current map view';

interface InsightsPanelProps {
  data: MapData;
  boundaries: Boundaries;
  allRecords: Intervention[];
  // Another panel is on top for now. This stays mounted, so it comes back as it was left.
  covered: boolean;
}

export default function InsightsPanel({ data, boundaries, allRecords, covered }: InsightsPanelProps) {
  const ui = useMapUi();
  const mapBounds = useExportUi((state) => state.mapBounds);
  const [tableState, setTableState] = useState<TableState>({ search: '', sorting: [], pagination: { pageIndex: 0, pageSize: 25 } });
  const changeTable = useCallback((changes: Partial<TableState>) => setTableState((current) => ({ ...current, ...changes })), []);

  const filters = pickViewFilters(ui);
  const view = useMemo(() => filters, [JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps
  const bounds = ui.limitToMapView ? mapBounds : null;
  const selection = useMemo(() => ({ view, mapBounds: bounds }), [view, bounds]);

  // Exactly what the map and an export would take, so the numbers can't disagree with them.
  const records = useMemo(() => selectExportRecords(allRecords, data.links, selection, data), [allRecords, data, selection]);

  const barangayBoxes = useMemo(() => {
    const idByCode = new Map(data.barangays.map((barangay) => [barangay.psgc_code, barangay.id]));
    return new Map(boundaries.barangays.features.map((feature) => [idByCode.get(feature.properties?.adm4_pcode), geometryBounds(feature.geometry)]));
  }, [boundaries.barangays, data.barangays]);

  const barangays = useMemo(() => {
    const inScope = barangaysInScope(data.barangays, view);
    if (!bounds) return inScope;
    return inScope.filter((barangay) => {
      const box = barangayBoxes.get(barangay.id);
      return box !== undefined && overlaps(box, bounds);
    });
  }, [data.barangays, view, bounds, barangayBoxes]);

  const numbers = useMemo(() => buildDashboard(records, data, barangays), [records, data, barangays]);

  if (covered || !ui.insights) return null;

  const lines = filterLines(describeFilters(selection, data)).filter((line) => line !== MAP_VIEW_LINE);
  const hasFilters = ui.programId !== null || ui.yearFrom !== null || ui.yearTo !== null || ui.municipalityId !== null || ui.fieldFilters.length > 0;

  return (
    <aside className={`panel panel-right insights-panel${ui.insightsWide ? ' is-wide' : ''}`} aria-label="Dashboard and records">
      <header className="insights-header">
        <div className="insights-tabs" role="group" aria-label="Show">
          <button type="button" aria-pressed={ui.insights === 'dashboard'} onClick={() => ui.setInsights('dashboard')}>
            Dashboard
          </button>
          <button type="button" aria-pressed={ui.insights === 'records'} onClick={() => ui.setInsights('records')}>
            Records
          </button>
        </div>
        <div className="insights-actions">
          <button type="button" className="link-button insights-wide-toggle" aria-pressed={ui.insightsWide} onClick={() => ui.setInsightsWide(!ui.insightsWide)}>
            {ui.insightsWide ? 'Narrower' : 'Wider'}
          </button>
          <button type="button" className="close-button insights-close" onClick={() => ui.setInsights(null)} aria-label="Close the dashboard">
            ×
          </button>
        </div>
      </header>

      <div className="insights-scope">
        {lines.length > 0 ? (
          <ul aria-label="Filters in force">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="field-hint">The whole province. No filters are on.</p>
        )}
        <div className="insights-scope-actions">
          <label className="choice">
            <input type="checkbox" checked={ui.limitToMapView} onChange={(event) => ui.setLimitToMapView(event.target.checked)} />
            Limit to map view
          </label>
          {hasFilters && (
            <button type="button" className="link-button" onClick={ui.clearFilters}>
              Clear filters
            </button>
          )}
          <button type="button" className="link-button insights-filters-button" onClick={() => ui.setPanelOpen(true)}>
            Change filters
          </button>
        </div>
        {ui.limitToMapView && <p className="field-hint">Records without coordinates aren't counted while this is on.</p>}
      </div>

      {ui.insights === 'dashboard' ? <DashboardView numbers={numbers} /> : <RecordsTable records={records} data={data} state={tableState} onChange={changeTable} />}
    </aside>
  );
}
