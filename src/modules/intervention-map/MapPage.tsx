import { useEffect, useMemo } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { LocalSeedMissingError } from './data/local-store';
import type { MapData } from './data/types';
import {
  buildShading,
  countByBarangay,
  liveRecords,
  recordsInView,
  unassignedRecords,
  type ChoroplethMode,
} from './lib/choropleth';
import { MapView } from './map/MapView';
import { BarangayProfile } from './panel/BarangayProfile';
import { LayerPanel } from './panel/LayerPanel';
import { Legend } from './panel/Legend';
import { UnassignedPanel } from './panel/UnassignedPanel';
import { useMapUi } from './state/map-ui';
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

  const { mode, pickedProgramId, pickedTypeId, hiddenTypeIds, programId, yearFrom, yearTo } = ui;
  const inView = useMemo(
    () => recordsInView(allRecords, { mode, pickedProgramId, pickedTypeId, hiddenTypeIds, programId, yearFrom, yearTo }),
    [allRecords, mode, pickedProgramId, pickedTypeId, hiddenTypeIds, programId, yearFrom, yearTo],
  );

  const counts = useMemo(() => countByBarangay(inView, data.links), [inView, data.links]);
  const unassigned = useMemo(() => unassignedRecords(inView, data.links), [inView, data.links]);
  const shading = useMemo(
    () => buildShading(mode, shadingTitle(mode, data, pickedProgramId, pickedTypeId), counts, data.barangays),
    [mode, data, pickedProgramId, pickedTypeId, counts],
  );

  // By-type shading follows the picked type, but markers always respect the layer switches.
  const markers = useMemo(
    () => inView.filter((r) => !hiddenTypeIds.includes(r.intervention_type_id)),
    [inView, hiddenTypeIds],
  );

  const openBarangay = (id: number) => {
    ui.setShowUnassigned(false);
    navigate(`/barangays/${id}`);
  };
  const closeProfile = () => navigate('/');

  return (
    <main className={`workspace${selected || ui.showUnassigned ? ' has-right-panel' : ''}`}>
      <LayerPanel
        data={data}
        records={allRecords}
        onGoToBarangay={(id) => {
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
          onSelectBarangay={openBarangay}
        />
        <button
          type="button"
          className="panel-toggle"
          aria-expanded={ui.panelOpen}
          onClick={() => ui.setPanelOpen(!ui.panelOpen)}
        >
          {ui.panelOpen ? 'Close layers' : 'Layers and filters'}
        </button>
        <Legend
          mode={mode}
          shading={shading}
          totalBarangays={data.barangays.length}
          unassigned={unassigned.length}
          onShowUnassigned={() => {
            closeProfile();
            ui.setShowUnassigned(true);
          }}
        />
      </div>

      {selected && !ui.showUnassigned && (
        <BarangayProfile barangay={selected} data={data} allRecords={allRecords} onClose={closeProfile} />
      )}
      {ui.showUnassigned && (
        <UnassignedPanel records={unassigned} data={data} onClose={() => ui.setShowUnassigned(false)} />
      )}
    </main>
  );
}

export function MapPage({ onDataSources }: { onDataSources(sources: string[]): void }) {
  const state = useMapData();

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

  return <MapWorkspace data={state.data} boundaries={state.boundaries} />;
}
