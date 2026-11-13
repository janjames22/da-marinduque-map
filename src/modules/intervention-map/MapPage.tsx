import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Download, Info, Layers, Maximize2, Minimize2, PanelLeftOpen, PanelRightClose, PanelRightOpen, Printer } from 'lucide-react';
import { Link, useLocation, useMatch, useNavigate } from 'react-router-dom';
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
import { linePartsOf } from './lib/qa';
import { isUnfinished } from './lib/roads';
import { AWAITING_LIST, BARANGAY_ROUTE, barangayOnMap, MAP_PATH, RECORD_ROUTE } from './lib/map-paths';
import { readViewConfig } from './lib/saved-views';
import { buildColorScale, viewFields } from './lib/view-fields';
import { EditPanelHost } from './edit/EditPanelHost';
import { MoveConfirm } from './edit/MoveConfirm';
import { openRecordPanel } from './edit/open-panel';
import { ConnectionNotice, Notice, PhotoDialog } from './edit/RecordPanels';
import { ControlSlot } from './map/ControlSlot';
import { useFullscreen } from './map/fullscreen';
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

  // The map first, each time the Map is opened: the layers card and the dashboard start put away.
  // Moving between the map, a barangay and a record keeps this page, and what's been brought out.
  useLayoutEffect(() => {
    useMapUi.getState().enterMap();
  }, []);

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
    const fix = new URLSearchParams(location.search).get('fix');
    const fixing = fix === 'resolve' && canEdit && record.deleted_at === null && isActive;
    // From a road's own page: its Edit form, ready to draw its line, near its barangay (Phase 16b).
    const isLine = data.types.find((type) => type.id === record.intervention_type_id)?.geometry_kind === 'line';
    if (fix === 'draw' && isLine && canEdit && record.deleted_at === null && isActive) {
      state.showEverything();
      if (record.barangay_id !== null) state.zoomToBarangay(record.barangay_id);
      openRecordPanel('edit', record);
      if (!record.geojson) edit.setLineMode('add');
    } else if (record.deleted_at === null && isActive && isOnMap(record)) {
      state.showEverything();
      if (globalThis.matchMedia?.('(max-width: 800px)').matches) state.setInsights(null);
      state.zoomToRecord(id);
      if (fixing) openRecordPanel('resolve', record);
    } else if (fixing) {
      state.showEverything();
      if (record.barangay_id !== null) state.zoomToBarangay(record.barangay_id);
      openRecordPanel('resolve', record);
      // A road waiting for its line starts drawing it, as from its own page.
      if (isLine && !record.geojson) edit.setLineMode('add');
    } else if (canSeeHistory) {
      openRecordPanel('history', record);
      edit.setNotice(record.deleted_at ? 'This record was deleted, so it isn\'t on the map. Here\'s its history.' : 'This record isn\'t on the map. Here\'s its history.');
    } else {
      edit.setNotice('This record isn\'t on the map.');
    }
  }, [recordLink?.params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Home's "Add intervention" opens the map ready to place a new point, as the map's own button does.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('add') !== '1') return;
    navigate(MAP_PATH, { replace: true });
    if (!canEdit) return;
    useMapUi.getState().setPanelOpen(false);
    openPanel({ kind: 'add' }, { picking: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // On a computer the layers card and the panel on the right can each be put away for the map's sake.
  // The panel comes back when another one takes its place. The buttons' names are kept apart from the
  // panels' own names, such as "Layers and filters", so a screen reader doesn't hear one as the other.
  const rightPanel = otherPanel || ui.insights !== null;
  const sideHidden = ui.sideHidden && rightPanel;
  const rightKey = panel ? `${panel.kind}:${'id' in panel ? panel.id : ''}` : ui.showUnassigned ? 'unassigned' : selected ? `barangay:${selected.id}` : (ui.insights ?? '');
  const rightName = panel
    ? panel.kind === 'history'
      ? 'history'
      : panel.kind === 'deleted'
        ? 'deleted records'
        : 'form'
    : ui.showUnassigned
      ? 'unassigned records'
      : selected
        ? 'barangay profile'
        : ui.insights === 'records'
          ? 'records list'
          : 'dashboard';
  useEffect(() => {
    useMapUi.getState().showSide();
  }, [rightKey]);

  // Full screen is the map alone, so it gives way to anything that opens beside it or over it.
  const area = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(area);
  const leaveFullscreen = fullscreen.exit;
  const exporting = useExportUi((state) => state.open !== null);
  const photoId = useEditUi((state) => state.photoId);
  useEffect(() => {
    if (rightKey || exporting || printing || photoId) leaveFullscreen();
  }, [rightKey, exporting, printing, photoId, leaveFullscreen]);
  // Counted, but not drawn: no coordinates yet, or coordinates outside Marinduque.
  const onMap = markers.filter(isOnMap).length;
  const offMap = markers.length - onMap;
  // Roads drawn on the map, solid once finished and dashed before, for the legend.
  const roads = useMemo(() => {
    const drawn = markers.filter((record) => isOnMap(record) && linePartsOf(record) !== null);
    const unfinished = drawn.filter((record) => isUnfinished(record, data)).length;
    return { finished: drawn.length - unfinished, unfinished };
  }, [markers, data]);

  return (
    <main className="map-page" aria-labelledby="map-title">
      <header className="map-header">
        <h1 id="map-title">Map</h1>
        <p className="map-header-note">Click a barangay for its profile, or a marker for the record.</p>
        {offMap > 0 && (
          <p className="map-coverage">
            <Info aria-hidden="true" />
            <span>
              <strong>
                {onMap.toLocaleString('en-US')} of {markers.length.toLocaleString('en-US')} records are on the map.
              </strong>{' '}
              <span className="map-coverage-detail">
                {offMap.toLocaleString('en-US')} {offMap === 1 ? 'is' : 'are'} waiting for verified coordinates, so {offMap === 1 ? "it's" : "they're"} counted but not drawn.
              </span>
            </span>
            <Link to={AWAITING_LIST}>See the list</Link>
          </p>
        )}
      </header>
      <div
        className={`workspace${layout}${ui.layersHidden ? ' layers-hidden' : ui.layersLeaving ? ' layers-leaving' : ''}${sideHidden ? ' side-hidden' : ui.sideLeaving && rightPanel ? ' side-leaving' : ''}`}
      >
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

        {/* Phones: dims the map behind the layers sheet, and a tap on it closes the sheet. */}
        <div className={`sheet-backdrop${ui.panelOpen ? ' is-open' : ''}`} aria-hidden="true" onClick={() => ui.setPanelOpen(false)} />
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

        <div className={`map-area${fullscreen.mode === 'window' ? ' is-window-fullscreen' : ''}`} ref={area}>
          <MapView
            data={data}
            boundaries={boundaries}
            shading={shading}
            counts={counts}
            markers={markers}
            colorOf={scale.colorOf}
            selectedBarangayId={selectedId}
            onSelectBarangay={onMapSelectBarangay}
          >
            {/* Under the zoom buttons, as on most web maps, rather than in the toolbar: one more button
                there made it wrap onto a second row over a popup when the map is narrow. */}
            <ControlSlot position="topleft" className="fullscreen-control">
              <button type="button" className="edge-toggle" aria-label={fullscreen.mode ? 'Exit full screen' : 'Full screen'} title={fullscreen.mode ? 'Exit full screen (Esc)' : 'Full screen'} onClick={fullscreen.toggle}>
                {fullscreen.mode ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
              </button>
            </ControlSlot>
            {/* Computers only, among the map's own controls so they stay clear of the legend and the
                toolbar. The layers card comes out from here, named as a phone's Layers button is, and
                goes away by its own close button. The panel on the right goes away and back here. */}
            {ui.layersHidden && (
              <ControlSlot position="topleft" className="edge-control">
                <button type="button" className="edge-toggle is-collapsed" aria-controls="map-layers" aria-expanded={false} onClick={ui.showLayers}>
                  <PanelLeftOpen aria-hidden="true" />
                  <span>
                    Layers<span className="visually-hidden"> and filters</span>
                  </span>
                </button>
              </ControlSlot>
            )}
            {rightPanel && (
              <ControlSlot position="bottomright" className="edge-control">
                <button
                  type="button"
                  className={`edge-toggle${sideHidden ? ' is-collapsed' : ''}`}
                  aria-expanded={!sideHidden}
                  aria-label={sideHidden ? 'Show the side panel' : 'Hide the side panel'}
                  title={`${sideHidden ? 'Show' : 'Hide'} the ${rightName}`}
                  onClick={sideHidden ? ui.showSide : ui.hideSide}
                >
                  {sideHidden && <span aria-hidden="true">{rightName.charAt(0).toUpperCase() + rightName.slice(1)}</span>}
                  {sideHidden ? <PanelRightOpen aria-hidden="true" /> : <PanelRightClose aria-hidden="true" />}
                </button>
              </ControlSlot>
            )}
          </MapView>
          {/* Phones only. The sheet it opens has its own close button. */}
          <button type="button" className="panel-toggle" aria-expanded={ui.panelOpen} onClick={() => ui.setPanelOpen(!ui.panelOpen)}>
            <Layers aria-hidden="true" />
            Layers<span className="toolbar-label-long"> and filters</span>
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
                  + Add<span className="toolbar-label-long"> intervention</span>
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
                <Download aria-hidden="true" />
                <span className="toolbar-label">Export</span>
              </button>
              <button
                type="button"
                className="export-button"
                onClick={() => {
                  ui.setPanelOpen(false);
                  setPrinting(true);
                }}
              >
                <Printer aria-hidden="true" />
                <span className="toolbar-label">Print map</span>
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
            roads={roads}
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
      </div>
    </main>
  );
}

export function MapPage({ user, onDataSources }: { user: AppUser; onDataSources(sources: string[]): void }) {
  const state = useMapData(user);

  useEffect(() => {
    if (state.status === 'ready') onDataSources(state.data.dataSources);
  }, [state, onDataSources]);

  if (state.status === 'loading') {
    return <p className="page-message is-loading">Loading the map…</p>;
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
