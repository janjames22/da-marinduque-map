import { formatKm, lineLengthKm } from '../lib/roads';
import { useEditUi } from '../state/edit-ui';

const HINTS = {
  add: 'Tap the map to add points along the road, in order. Tap Done when the line is finished.',
  shape: 'Drag a point to move it, or drag or tap a small dot between two points to add a bend. Tap a point to pick it.',
  none: "Until it's traced, the road is counted in every total and kept off the map.",
};

// A road's location is its line, drawn and reshaped on the map (Phase 16b), in the Edit form and the
// Resolve flag form alike. Nothing is saved until the form is. A line in several parts, as a file can
// bring in, can't be reshaped here and stays as it is.
export function LineLocation({ editable, error }: { editable: boolean; error?: string }) {
  const draftLine = useEditUi((state) => state.draftLine);
  const lineMode = useEditUi((state) => state.lineMode);
  const selectedPoint = useEditUi((state) => state.selectedPoint);
  const { setLineMode, setDraftLine, removeLinePoint } = useEditUi.getState();

  if (!editable) {
    return (
      <fieldset className="location-input">
        <legend>Location</legend>
        <p className="location-readout" data-testid="location-readout">
          A line in several parts
        </p>
        <p className="field-hint">It can&apos;t be reshaped here yet, so it stays as it is.</p>
      </fieldset>
    );
  }

  const count = draftLine?.length ?? 0;
  const km = draftLine && count >= 2 ? lineLengthKm([draftLine.map(({ lat, lng }) => [lng, lat])]) : null;
  const readout = km !== null ? `Traced line, ${formatKm(km)}, ${count} points` : count === 1 ? '1 point. Add another to make a line.' : 'No traced line yet';
  return (
    <fieldset className="location-input">
      <legend>Location</legend>
      <p className="location-readout" data-testid="location-readout" aria-live="polite">
        {readout}
      </p>
      <p className="field-hint">{HINTS[lineMode ?? 'none']}</p>
      <div className="location-buttons">
        {lineMode === null && count === 0 && (
          <button type="button" className="secondary-button" onClick={() => setLineMode('add')}>
            Draw the line
          </button>
        )}
        {lineMode === 'add' && (
          <>
            <button type="button" className="secondary-button" disabled={count === 0} onClick={() => removeLinePoint(count - 1)}>
              Undo last point
            </button>
            <button type="button" className="secondary-button" aria-pressed="true" onClick={() => setLineMode(count > 0 ? 'shape' : null)}>
              Done
            </button>
          </>
        )}
        {lineMode === 'shape' && (
          <>
            <button type="button" className="secondary-button" onClick={() => setLineMode('add')}>
              Add points at the end
            </button>
            {selectedPoint !== null && (
              <button type="button" className="secondary-button" onClick={() => removeLinePoint(selectedPoint)}>
                Remove point {selectedPoint + 1}
              </button>
            )}
            <button type="button" className="secondary-button" onClick={() => setDraftLine(null, null)}>
              Clear the line
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
