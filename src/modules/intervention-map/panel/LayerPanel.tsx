import { useMemo } from 'react';
import type { Intervention, MapData } from '../data/types';
import type { ChoroplethMode } from '../lib/choropleth';
import { useMapUi, type BasemapId } from '../state/map-ui';

const BASEMAP_OPTIONS: { id: BasemapId; label: string }[] = [
  { id: 'osm', label: 'OpenStreetMap' },
  { id: 'imagery', label: 'Satellite' },
  { id: 'topo', label: 'Topographic' },
  { id: 'hybrid', label: 'Satellite with labels' },
];

const MODE_OPTIONS: { id: ChoroplethMode; label: string }[] = [
  { id: 'count', label: 'Number of interventions' },
  { id: 'program', label: 'By program' },
  { id: 'type', label: 'By type' },
  { id: 'gap', label: 'No intervention yet' },
  { id: 'off', label: 'Off (outlines only)' },
];

interface LayerPanelProps {
  data: MapData;
  records: Intervention[];
  onGoToBarangay(id: number): void;
}

export function LayerPanel({ data, records, onGoToBarangay }: LayerPanelProps) {
  const ui = useMapUi();

  const activeTypes = useMemo(
    () => data.types.filter((t) => t.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [data.types],
  );
  const programs = useMemo(
    () => data.programs.filter((p) => p.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [data.programs],
  );
  const years = useMemo(() => {
    const all = records.map((r) => r.year_funded).filter((y): y is number => y !== null);
    return [...new Set(all)].sort((a, b) => a - b);
  }, [records]);

  const barangaysByMunicipality = useMemo(
    () =>
      [...data.municipalities]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((municipality) => ({
          municipality,
          barangays: data.barangays
            .filter((b) => b.municipality_id === municipality.id)
            .sort((a, b) => a.name.localeCompare(b.name)),
        })),
    [data.municipalities, data.barangays],
  );

  const recordsOfType = (id: number) => records.filter((r) => r.intervention_type_id === id).length;
  const numberOrNull = (value: string) => (value === '' ? null : Number(value));

  return (
    <aside className={`panel panel-left${ui.panelOpen ? ' is-open' : ''}`} aria-label="Layers and filters">
      <section>
        <label className="field">
          <span className="section-title">Go to barangay</span>
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) onGoToBarangay(Number(event.target.value));
            }}
          >
            <option value="">Choose a barangay</option>
            {barangaysByMunicipality.map(({ municipality, barangays }) => (
              <optgroup key={municipality.id} label={municipality.name}>
                {barangays.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </section>

      <section>
        <h2 className="section-title">Shade barangays by</h2>
        {MODE_OPTIONS.map((option) => (
          <label className="choice" key={option.id}>
            <input
              type="radio"
              name="choropleth-mode"
              checked={ui.mode === option.id}
              onChange={() => ui.setMode(option.id)}
            />
            {option.label}
          </label>
        ))}
        {ui.mode === 'program' && (
          <label className="field">
            <span>Program</span>
            <select
              value={ui.pickedProgramId ?? ''}
              onChange={(event) => ui.setPickedProgram(Number(event.target.value))}
            >
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {ui.mode === 'type' && (
          <label className="field">
            <span>Type</span>
            <select value={ui.pickedTypeId ?? ''} onChange={(event) => ui.setPickedType(Number(event.target.value))}>
              {activeTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section>
        <h2 className="section-title">Intervention layers</h2>
        {activeTypes.map((type) => (
          <label className="choice" key={type.id}>
            <input
              type="checkbox"
              checked={!ui.hiddenTypeIds.includes(type.id)}
              onChange={() => ui.toggleType(type.id)}
            />
            <span className="swatch" style={{ background: type.color }} aria-hidden="true" />
            {type.name}
            <span className="count">{recordsOfType(type.id)}</span>
          </label>
        ))}
      </section>

      <section>
        <h2 className="section-title">Filters</h2>
        {ui.mode !== 'program' && (
          <label className="field">
            <span>Program</span>
            <select
              value={ui.programId ?? ''}
              onChange={(event) => ui.setProgramFilter(numberOrNull(event.target.value))}
            >
              <option value="">All programs</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="field-row">
          <label className="field">
            <span>Year from</span>
            <select value={ui.yearFrom ?? ''} onChange={(event) => ui.setYearFrom(numberOrNull(event.target.value))}>
              <option value="">Any</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Year to</span>
            <select value={ui.yearTo ?? ''} onChange={(event) => ui.setYearTo(numberOrNull(event.target.value))}>
              <option value="">Any</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
        {(ui.programId !== null || ui.yearFrom !== null || ui.yearTo !== null) && (
          <button type="button" className="link-button" onClick={ui.clearFilters}>
            Clear filters
          </button>
        )}
      </section>

      <section>
        <h2 className="section-title">Boundaries</h2>
        <label className="choice">
          <input type="checkbox" checked disabled />
          Barangays (always on)
        </label>
        <label className="choice">
          <input type="checkbox" checked={ui.showMunicipal} onChange={(e) => ui.setShowMunicipal(e.target.checked)} />
          Municipalities
        </label>
        <label className="choice">
          <input type="checkbox" checked={ui.showProvince} onChange={(e) => ui.setShowProvince(e.target.checked)} />
          Province
        </label>
      </section>

      <section>
        <h2 className="section-title">Basemap</h2>
        {BASEMAP_OPTIONS.map((option) => (
          <label className="choice" key={option.id}>
            <input
              type="radio"
              name="basemap"
              checked={ui.basemap === option.id}
              onChange={() => ui.setBasemap(option.id)}
            />
            {option.label}
          </label>
        ))}
      </section>
    </aside>
  );
}
