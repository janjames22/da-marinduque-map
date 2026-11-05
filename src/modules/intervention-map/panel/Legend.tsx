import type { ChoroplethMode, Shading } from '../lib/choropleth';

interface LegendProps {
  mode: ChoroplethMode;
  shading: Shading;
  totalBarangays: number;
  unassigned: number;
  onShowUnassigned(): void;
}

export function Legend({ mode, shading, totalBarangays, unassigned, onShowUnassigned }: LegendProps) {
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
    </div>
  );
}
