import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { LocalSeedMissingError } from './data/store';
import type { AppUser, MapData } from './data/types';
import {
  barangaysInScope,
  buildShading,
  countByBarangay,
  liveRecords,
  pickViewFilters,
  recordsInView,
  unassignedRecords,
  visibleRecords,
  type ChoroplethMode,
} from './lib/choropleth';
import { isOnMap } from './lib/display';
import { BARANGAY_ROUTE, barangayOnMap, MAP_PATH, RECORD_ROUTE } from './lib/map-paths';
import { readViewConfig } from './lib/saved-views';
import { buildColorScale, viewFields } from './lib/view-fields';
import { EditPanelHost } from './edit/EditPanelHost';
import { MoveConfirm } from './edit/MoveConfirm';
import { openRecordPanel } from './edit/open-panel';
import { ConnectionNotice, Notice, PhotoDialog } from './edit/RecordPanels';
import { MapView } from './map/MapView';
import { BarangayProfile } from './panel/BarangayProfile';
import { ExportDialog } from './panel/ExportDialog';
import { LayerPanel } from './panel/LayerPanel';
import { Legend } from './panel/Legend';
import { UnassignedPanel } from './panel/UnassignedPanel';
import { PrintMapDialog } from './reports/PrintMapDialog';
import { isFormOpen, useEditUi } from './state/edit-ui';
import { useExportUi } from './state/export-ui';
import { useMapUi } from './state/map-ui';
import { StoreContext, usePermissions } from './state/store-context';
import { useMapData, type Boundaries } from './state/use-map-data';

// Only loaded when opened, so the map doesn't carry the chart library.
const InsightsPanel = lazy(() => import('./dashboard/InsightsPanel'));

function shadingTitle(mode: ChoroplethMode, data: MapData, programId: number | null, typeId: number | null) {
  if (mode === 'gap') return 'No intervention yet';
  if (mode === 'program') return data.programs.find((p) => p.id === programId)?.name ?? 'By program';
  if (mode === 'type') return data.types.find((t) => t.id === typeId)?.name ?? 'By type';
  return 'Number of interventions';
}

function MapWorkspace({ data, boundaries }: { data: MapData; boundaries: Boundaries }) {
  const navigate = useNavigate();
  const location = useLocation();
  const recordLink = useMatch(RECORD_ROUTE);
  const match = useMatch(BARANGAY_ROUTE);
  const selectedId = match ? Number(match.params.id) : null;
  const selected = data.barangays.find((b) => b.id === selectedId) ?? null;

  const ui = useMapUi();
  const panel = useEditUi((state) => state.panel);
  const picking = useEditUi((state) => state.picking);
  const setPicking = useEditUi((state) => state.setPicking);
  const openPanel = useEditUi((state) => state.openPanel);
  const closePanel = useEditUi((state) => state.closePanel);
  const { canEdit, canSeeHistory } = usePermissions();

  // Before the first paint, so the map doesn't flash up as something else. A link to a particular
  // place or record is asking for that instead.
  useLayoutEffect(() => {
    const state = useMapUi.getState();
    if (state.defaultViewHandled) return;
    state.markDefaultViewHandled();
    const view = data.savedViews.find((candidate) => candidate.is_default);
    if (view && location.pathname.replace(/\/$/, '') === MAP_PATH) {
      state.applyView(readViewConfig(view.config, data));
      useEditUi.getState().setNotice(`Opened on the shared view "${view.name}".`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A link to one record, such as from the audit log, shows it whatever filters were on.
  useEffect(() => {
    const id = recordLink?.params.id;
    if (!id) return;
    navigate(MAP_PATH, { replace: true });
    const state = useMapUi.getState();
    const edit = useEditUi.getState();
    const record = data.interventions.find((candidate) => candidate.id === id);
    if (!record) {
      edit.setNotice('That record wasn\'t found. It may have been removed.');
      return;
    }
    const isActive = data.types.some((type) => type.id === record.intervention_type_id && type.is_active);
    // From the QA queue, to fix a location on the map. A record with no coordinates yet gets them here too.
    const fixing = new URLSearchParams(location.search).get('fix') === 'resolve' && canEdit && record.deleted_at === null && isActive;
    if (record.deleted_at === null && isActive && isOnMap(record)) {
      state.showEverything();
      if (globalThis.matchMedia?.('(max-width: 800px)').matches) state.setInsights(null);
      state.zoomToRecord(id);
      if (fixing) openRecordPanel('resolve', record);
    } else if (fixing) {
      state.showEverything();
      if (record.barangay_id !== null) state.zoomToBarangay(record.barangay_id);
      openRecordPanel('resolve', record);
    } else if (canSeeHistory) {
      openRecordPanel('history', record);
      edit.setNotice(record.deleted_at ? 'This record was deleted, so it isn\'t on the map. Here\'s its history.' : 'This record isn\'t on the map. Here\'s its history.');
    } else {
      edit.setNotice('This record isn\'t on the map.');
    }
  }, [recordLink?.params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const firstProgram = data.programs.filter((p) => p.is_active).sort((a, b) => a.sort_order - b.sort_order)[0];
    const firstType = data.types.filter((t) => t.is_active).sort((a, b) => a.sort_order - b.sort_order)[0];
    const { pickedProgramId, pickedTypeId, setPickedProgram, setPickedType } = useMapUi.getState();
    if (pickedProgramId === null && firstProgram) setPickedProgram(firstProgram.id);
    if (pickedTypeId === null && firstType) setPickedType(firstType.id);
  }, [data]);

  // A link straight to a barangay should open with that barangay in view.
  useEffect(() => {
    if (selectedId !== null) useMapUi.getState().zoomToBarangay(selectedId);
  }, []); // Only on first load: clicking a barangay shouldn't move the map.

  const allRecords = useMemo(() => liveRecords(data.interventions, data.types), [data.interventions, data.types]);

  const { mode, pickedProgramId, pickedTypeId, hiddenTypeIds, programId, yearFrom, yearTo, municipalityId, barangayId, fieldFilters, colorBy } = ui;
  const view = useMemo(
    () => pickViewFilters({ mode, pickedProgramId, pickedTypeId, hiddenTypeIds, programId, yearFrom, yearTo, municipalityId, barangayId, fieldFilters }),
    [mode, pickedProgramId, pickedTypeId, hiddenTypeIds, programId, yearFrom, yearTo, municipalityId, barangayId, fieldFilters],
  );
  const inView = useMemo(() => recordsInView(allRecords, view, data.links), [allRecords, view, data.links]);
  const scoped = useMemo(() => barangaysInScope(data.barangays, view), [data.barangays, view]);

  const counts = useMemo(() => countByBarangay(inView, data.links), [inView, data.links]);
  const unassigned = useMemo(() => unassignedRecords(inView, data.links), [inView, data.links]);
  const shading = useMemo(
    () => buildShading(mode, shadingTitle(mode, data, pickedProgramId, pickedTypeId), counts, scoped),
    [mode, data, pickedProgramId, pickedTypeId, counts, scoped],
  );

  const markers = useMemo(() => visibleRecords(allRecords, view, data.links), [allRecords, view, data.links]);
  const fields = useMemo(() => viewFields(data), [data]);
  // Over all records, not the filtered ones, so a filter can't change what a color means.
  const scale = useMemo(() => buildColorScale(colorBy, allRecords, data, fields), [colorBy, allRecords, data, fields]);
  const [printing, setPrinting] = useState(false);

  const openBarangay = (id: number) => {
    ui.setShowUnassigned(false);
    navigate(barangayOnMap(id));
  };
  const closeProfile = () => navigate(MAP_PATH);

  // A click on the map belongs to the form while one is open, so it can't navigate away from it.
  const onMapSelectBarangay = (id: number) => {
    const edit = useEditUi.getState();
    if (edit.picking || isFormOpen(edit.panel)) return;
    if (edit.panel) edit.closePanel();
    openBarangay(id);
  };

  const otherPanel = Boolean(selected || ui.showUnassigned || panel);
  // Once opened it stays mounted, so the table keeps its place while the map has a turn.
  const insightsOpened = useRef(false);
  if (ui.insights) insightsOpened.current = true;

  const layout = otherPanel ? ' has-right-panel' : ui.insights ? ` has-insights${ui.insightsWide ? ' insights-wide' : ''}` : '';

  return (
    <main className={`workspace${layout}`}>
      <nav className="phone-tabs" aria-label="Views">
        <button type="button" aria-pressed={!ui.insights} onClick={() => ui.setInsights(null)}>
          Map
        </button>
        <button type="button" aria-pressed={ui.insights === 'dashboard'} onClick={() => ui.setInsights('dashboard')}>
          Dashboard
        </button>
        <button type="button" aria-pressed={ui.insights === 'records'} onClick={() => ui.setInsights('records')}>
          List
        </button>
      </nav>

      <LayerPanel
        data={data}
        records={allRecords}
        onGoToBarangay={(id) => {
          if (isFormOpen(useEditUi.getState().panel)) {
            ui.zoomToBarangay(id); // the form stays open, and the map goes there
            return;
          }
          closePanel();
          openBarangay(id);
          ui.zoomToBarangay(id);
        }}
      />

      <div className="map-area">
        <MapView
          data={data}
          boundaries={boundaries}
          shading={shading}
          counts={counts}
          markers={markers}
          colorOf={scale.colorOf}
          selectedBarangayId={selectedId}
          onSelectBarangay={onMapSelectBarangay}
        />
        <button
          type="button"
          className="panel-toggle"
          aria-expanded={ui.panelOpen}
          onClick={() => ui.setPanelOpen(!ui.panelOpen)}
        >
          {ui.panelOpen ? 'Close layers' : 'Layers and filters'}
        </button>
        {!panel && (
          <div className="map-toolbar">
            {canEdit && (
              <button
                type="button"
                className="add-record-button"
                onClick={() => {
                  ui.setPanelOpen(false);
                  openPanel({ kind: 'add' }, { picking: true });
                }}
              >
                + Add intervention
              </button>
            )}
            <button
              type="button"
              className="export-button"
              onClick={() => {
                ui.setPanelOpen(false);
                useExportUi.getState().openExport();
              }}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />
              </svg>
              Export
            </button>
            <button
              type="button"
              className="export-button"
              onClick={() => {
                ui.setPanelOpen(false);
                setPrinting(true);
              }}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 9V3h10v6M7 18H4v-7h16v7h-3M7 14h10v7H7z" />
              </svg>
              Print map
            </button>
            {!ui.insights && !otherPanel && (
              <button type="button" className="export-button insights-open-button" onClick={() => ui.setInsights('dashboard')}>
                Dashboard
              </button>
            )}
          </div>
        )}
        {picking && (
          <div className="map-hint" role="status">
            Click the map to set the location.
            <button type="button" className="link-button" onClick={() => setPicking(false)}>
              Cancel
            </button>
          </div>
        )}
        <MoveConfirm data={data} />
        <Notice />
        <ConnectionNotice />
        <Legend
          mode={mode}
          shading={shading}
          totalBarangays={scoped.length}
          unassigned={unassigned.length}
          scale={scale}
          markers={markers}
          onShowUnassigned={() => {
            closeProfile();
            ui.setShowUnassigned(true);
          }}
        />
      </div>

      {panel ? (
        <EditPanelHost data={data} />
      ) : (
        <>
          {selected && !ui.showUnassigned && (
            <BarangayProfile barangay={selected} data={data} allRecords={allRecords} onClose={closeProfile} />
          )}
          {ui.showUnassigned && (
            <UnassignedPanel records={unassigned} data={data} onClose={() => ui.setShowUnassigned(false)} />
          )}
        </>
      )}
      {insightsOpened.current && (
        <Suspense fallback={ui.insights && !otherPanel ? <aside className="panel panel-right insights-panel">Loading the dashboard…</aside> : null}>
          <InsightsPanel data={data} boundaries={boundaries} allRecords={allRecords} covered={otherPanel} />
        </Suspense>
      )}
      <PhotoDialog />
      <ExportDialog data={data} boundaries={boundaries} allRecords={allRecords} />
      <PrintMapDialog open={printing} onClose={() => setPrinting(false)} data={data} mode={mode} shading={shading} scale={scale} markers={markers} />
    </main>
  );
}

export function MapPage({ user, onDataSources }: { user: AppUser; onDataSources(sources: string[]): void }) {
  const state = useMapData(user);

  useEffect(() => {
    if (state.status === 'ready') onDataSources(state.data.dataSources);
  }, [state, onDataSources]);

  if (state.status === 'loading') {
    return <p className="page-message">Loading the map…</p>;
  }

  if (state.status === 'error') {
    return (
      <div className="page-message" role="alert">
        {state.error instanceof LocalSeedMissingError ? (
          <>
            <h2>Local data not found</h2>
            <p>
              Run <code>npm run build:local-seed</code>, then reload this page.
            </p>
          </>
        ) : (
          <>
            <h2>The map could not load</h2>
            <p>{state.error.message}</p>
          </>
        )}
      </div>
    );
  }

  return (
    <StoreContext.Provider value={{ store: state.store, places: state.places }}>
      <MapWorkspace data={state.data} boundaries={state.boundaries} />
    </StoreContext.Provider>
  );
}
