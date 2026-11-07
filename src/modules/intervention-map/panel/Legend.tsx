import { useMemo } from 'react';
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
  onShowUnassigned(): void;
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

export function Legend({ mode, shading, totalBarangays, unassigned, scale, markers, onShowUnassigned }: LegendProps) {
  return (
    <div className="legend" aria-label="Map legend">
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
      <MarkerLegend scale={scale} markers={markers} />
    </div>
  );
}
