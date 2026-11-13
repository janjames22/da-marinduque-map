// The map's filters as a bar across the top of a page: the Dashboard and the Interventions list. They're
// the map's own, so every page counts the same records.
import { useState } from 'react';
import type { MapData } from '../data/types';
import { FieldFilters } from '../panel/FieldFilters';
import { hasFilters, useMapUi } from '../state/map-ui';

const numberOrNull = (text: string) => (text === '' || !Number.isFinite(Number(text)) ? null : Number(text));

export function FilterBar({ data }: { data: MapData }) {
  const ui = useMapUi();
  const [more, setMore] = useState(ui.fieldFilters.length > 0);
  const programs = data.programs.filter((program) => program.is_active).sort((a, b) => a.sort_order - b.sort_order);
  const years = [...new Set(data.interventions.map((record) => record.year_funded).filter((year): year is number => year !== null))].sort((a, b) => a - b);
  const municipalities = [...data.municipalities].sort((a, b) => a.name.localeCompare(b.name));
  const byProgramShading = ui.mode === 'program';
  const filtered = hasFilters(ui);

  return (
    <form className="overview-card filter-bar" aria-label="Filters" onSubmit={(event) => event.preventDefault()}>
      <div className="filter-bar-fields">
        <div className="filter-field is-wide">
          <label htmlFor="dash-program">Program</label>
          <select id="dash-program" value={ui.programId ?? ''} disabled={byProgramShading} onChange={(event) => ui.setProgramFilter(numberOrNull(event.target.value))}>
            <option value="">All programs</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.name}
              </option>
            ))}
          </select>
          {byProgramShading && <span className="field-hint">The map is shaded by program, so its program is the one counted.</span>}
        </div>
        <div className="filter-field">
          <label htmlFor="dash-year-from">Year funded from</label>
          <select id="dash-year-from" value={ui.yearFrom ?? ''} onChange={(event) => ui.setYearFrom(numberOrNull(event.target.value))}>
            <option value="">Any</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="dash-year-to">to</label>
          <select id="dash-year-to" value={ui.yearTo ?? ''} onChange={(event) => ui.setYearTo(numberOrNull(event.target.value))}>
            <option value="">Any</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field is-wide">
          <label htmlFor="dash-municipality">Municipality</label>
          <select id="dash-municipality" value={ui.municipalityId ?? ''} onChange={(event) => ui.setMunicipalityFilter(numberOrNull(event.target.value))}>
            <option value="">All municipalities</option>
            {municipalities.map((municipality) => (
              <option key={municipality.id} value={municipality.id}>
                {municipality.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-bar-actions">
          <button type="button" className="link-button" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? 'Fewer filters' : 'More filters'}
          </button>
          {filtered && (
            <button type="button" className="link-button" onClick={ui.clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>
      {more && (
        <div className="filter-bar-more">
          <FieldFilters data={data} />
        </div>
      )}
    </form>
  );
}
