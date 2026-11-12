import { useMemo, useState } from 'react';
import type { Intervention } from '../data/types';
import type { ChoroplethMode, Shading } from '../lib/choropleth';
import { DEFAULT_COLOR_BY, type ColorScale } from '../lib/view-fields';

interface LegendProps {
  mode: ChoroplethMode;
  shading: Shading;
  totalBarangays: number;
  unassigned: number;
  scale: ColorScale;
  markers: Intervention[];
  // Roads drawn on the map, by whether they're finished.
  roads: { finished: number; unfinished: number };
  onShowUnassigned(): void;
}

// A road's line takes its color from Color by, like a marker. What the legend adds is the dashes.
function RoadLegend({ roads }: { roads: LegendProps['roads'] }) {
  const rows = [
    { key: 'finished', label: 'Completed or in use', count: roads.finished },
    { key: 'unfinished', label: 'Proposed or on-going', count: roads.unfinished },
  ].filter((row) => row.count > 0);
  if (rows.length === 0) return null;
  return (
    <>
      <h2 className="legend-title legend-roads-title">Roads</h2>
      <ul aria-label="Road lines">
        {rows.map((row) => (
          <li key={row.key}>
            <span className={`line-swatch${row.key === 'unfinished' ? ' is-dashed' : ''}`} aria-hidden="true" />
            <span>{row.label}</span>
            <span className="count">{row.count}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

// Colors alone can't say what they mean, so each comes with its words and how many are showing.
function MarkerLegend({ scale, markers }: { scale: ColorScale; markers: Intervention[] }) {
  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of markers) {
      const key = scale.keyOf(record);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return scale.entries.map((entry) => ({ ...entry, count: counts.get(entry.key) ?? 0 })).filter((entry) => entry.count > 0);
  }, [scale, markers]);

  return (
    // Programs are the usual colors, so that list stays folded until it's wanted.
    <details className="legend-markers" open={scale.field !== DEFAULT_COLOR_BY}>
      <summary className="legend-title">Markers by {scale.title.toLowerCase()}</summary>
      <ul aria-label={`Marker colors by ${scale.title}`}>
        {rows.map((entry) => (
          <li key={entry.key}>
            <span className="swatch" style={{ background: entry.color }} aria-hidden="true" />
            <span>{entry.label}</span>
            <span className="count">{entry.count}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Legend({ mode, shading, totalBarangays, unassigned, scale, markers, roads, onShowUnassigned }: LegendProps) {
  // Phones only: the legend starts folded into a small button, so the map has the screen.
  const [open, setOpen] = useState(false);
  return (
    <div className={`legend${open ? ' is-open' : ''}`} aria-label="Map legend">
      <button type="button" className="legend-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="legend-toggle-swatches" aria-hidden="true">
          {(mode === 'off' ? [] : shading.legend.slice(-3)).map((entry) => (
            <span key={entry.label} style={{ background: entry.color }} />
          ))}
        </span>
        {open ? 'Hide legend' : 'Legend'}
      </button>
      <div className="legend-body">
      {mode !== 'off' && (
        <>
          <h2 className="legend-title">{shading.title}</h2>
          <ul>
            {shading.legend.map((entry) => (
              <li key={entry.label}>
                <span className="swatch" style={{ background: entry.color }} aria-hidden="true" />
                <span>{entry.label}</span>
                <span className="count">{entry.barangays}</span>
              </li>
            ))}
          </ul>
          <p className="legend-note">
            {mode === 'gap'
              ? 'Shows what has been encoded, not what exists on the ground.'
              : 'Number of barangays beside each class.'}
          </p>
        </>
      )}
      <p className="legend-summary">
        {shading.barangaysWithRecords} of {totalBarangays} barangays have records
      </p>
      {unassigned > 0 && (
        <button type="button" className="link-button" onClick={onShowUnassigned}>
          Unassigned: {unassigned} {unassigned === 1 ? 'record' : 'records'}
        </button>
      )}
      <RoadLegend roads={roads} />
      <MarkerLegend scale={scale} markers={markers} />
      </div>
    </div>
  );
}
