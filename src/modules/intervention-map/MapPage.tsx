import { useEffect, useMemo } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { LocalSeedMissingError } from './data/store';
import type { AppUser, MapData } from './data/types';
import {
  barangaysInScope,
  buildShading,
  countByBarangay,
  liveRecords,
  recordsInView,
  unassignedRecords,
  visibleRecords,
  type ChoroplethMode,
} from './lib/choropleth';
import { EditPanelHost } from './edit/EditPanelHost';
import { MoveConfirm } from './edit/MoveConfirm';
import { ConnectionNotice, Notice, PhotoDialog } from './edit/RecordPanels';
import { MapView } from './map/MapView';
import { BarangayProfile } from './panel/BarangayProfile';
import { ExportDialog } from './panel/ExportDialog';
import { LayerPanel } from './panel/LayerPanel';
import { Legend } from './panel/Legend';
import { UnassignedPanel } from './panel/UnassignedPanel';
import { isFormOpen, useEditUi } from './state/edit-ui';
import { useExportUi } from './state/export-ui';
import { useMapUi } from './state/map-ui';
import { StoreContext, usePermissions } from './state/store-context';
import { useMapData, type Boundaries } from './state/use-map-data';

function shadingTitle(mode: ChoroplethMode, data: MapData, programId: number | null, typeId: number | null) {
  if (mode === 'gap') return 'No intervention yet';
  if (mode === 'program') return data.programs.find((p) => p.id === programId)?.name ?? 'By program';
  if (mode === 'type') return data.types.find((t) => t.id === typeId)?.name ?? 'By type';
  return 'Number of interventions';
}

function MapWorkspace({ data, boundaries }: { data: MapData; boundaries: Boundaries }) {
  const navigate = useNavigate();
  const match = useMatch('/barangays/:id');
  const selectedId = match ? Number(match.params.id) : null;
  const selected = data.barangays.find((b) => b.id === selectedId) ?? null;

  const ui = useMapUi();
  const panel = useEditUi((state) => state.panel);
  const picking = useEditUi((state) => state.picking);
  const setPicking = useEditUi((state) => state.setPicking);
  const openPanel = useEditUi((state) => state.openPanel);
  const closePanel = useEditUi((state) => state.closePanel);
  const { canEdit } = usePermissions();

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

  const { mode, pickedProgramId, pickedTypeId, hiddenTypeIds, programId, yearFrom, yearTo, municipalityId, barangayId } = ui;
  const view = useMemo(
    () => ({ mode, pickedProgramId, pickedTypeId, hiddenTypeIds, programId, yearFrom, yearTo, municipalityId, barangayId }),
    [mode, pickedProgramId, pickedTypeId, hiddenTypeIds, programId, yearFrom, yearTo, municipalityId, barangayId],
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

  const openBarangay = (id: number) => {
    ui.setShowUnassigned(false);
    navigate(`/barangays/${id}`);
  };
  const closeProfile = () => navigate('/');

  // A click on the map belongs to the form while one is open, so it can't navigate away from it.
  const onMapSelectBarangay = (id: number) => {
    const edit = useEditUi.getState();
    if (edit.picking || isFormOpen(edit.panel)) return;
    if (edit.panel) edit.closePanel();
    openBarangay(id);
  };

  return (
    <main className={`workspace${selected || ui.showUnassigned || panel ? ' has-right-panel' : ''}`}>
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
      <PhotoDialog />
      <ExportDialog data={data} boundaries={boundaries} allRecords={allRecords} />
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
