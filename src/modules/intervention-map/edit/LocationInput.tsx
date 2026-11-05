import { useState, type KeyboardEvent } from 'react';
import { formatPoint, parseCoordinates } from '../lib/coordinates';
import { getDevicePosition } from '../lib/geolocate';
import { PHOTO_ACCEPT, photoProblem, readPhotoMeta } from '../lib/photo-meta';
import { useEditUi } from '../state/edit-ui';

// Every way of setting a location ends in the same place: the draft point, which also shows on the
// map as a marker that can be dragged to fine-tune it.
export function LocationInput() {
  const draft = useEditUi((state) => state.draft);
  const picking = useEditUi((state) => state.picking);
  const setDraft = useEditUi((state) => state.setDraft);
  const setPicking = useEditUi((state) => state.setPicking);

  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = typed.trim() === '' ? null : parseCoordinates(typed);

  const useTyped = () => {
    const result = parseCoordinates(typed);
    if (!result.ok) {
      setTypedError(result.error);
      return;
    }
    setTypedError(null);
    setProblem(null);
    setMessage(result.note ?? null);
    setDraft(result.point, { goTo: true });
    setTyped('');
  };

  const onTypedKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault(); // Enter here means "use these", not "save the form"
      useTyped();
    }
  };

  const useDevice = async () => {
    setBusy(true);
    setProblem(null);
    setMessage(null);
    try {
      const { point, accuracyMetres } = await getDevicePosition();
      setDraft(point, { goTo: true });
      setMessage(`From this device. Accuracy about ${accuracyMetres} m.`);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const usePhoto = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setMessage(null);
    const wrong = photoProblem(file);
    if (wrong) {
      setProblem(wrong);
      return;
    }
    setBusy(true);
    const { exif_location: point } = await readPhotoMeta(file);
    setBusy(false);
    if (!point) {
      setProblem('This photo has no location in it. Some phones remove it when a photo is picked. Try the original file from the camera.');
      return;
    }
    setDraft(point, { goTo: true });
    setMessage('Location read from the photo. The photo itself is not saved here.');
  };

  return (
    <fieldset className="location-input">
      <legend>Location</legend>
      <p className="location-readout" data-testid="location-readout">
        {draft ? formatPoint(draft) : 'Not set'}
        {draft && (
          <button type="button" className="link-button" onClick={() => setDraft(null)}>
            Clear
          </button>
        )}
      </p>
      {picking && <p className="field-hint">Click the map to set the location.</p>}
      {draft && !picking && <p className="field-hint">Drag the orange marker on the map to fine-tune it.</p>}

      <div className="location-buttons">
        <button type="button" className="secondary-button" aria-pressed={picking} onClick={() => setPicking(!picking)}>
          {picking ? 'Cancel map click' : 'Pick on map'}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={useDevice}>
          Use my location (GPS)
        </button>
        <label className="secondary-button">
          From a photo
          <input
            type="file"
            accept={PHOTO_ACCEPT}
            className="visually-hidden"
            aria-label="Read the location from a photo"
            onChange={(event) => {
              void usePhoto(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      <div className="form-field">
        <label htmlFor="typed-coordinates">Type or paste coordinates</label>
        <div className="typed-coordinates">
          <input
            id="typed-coordinates"
            value={typed}
            placeholder={`13.4671, 122.0686`}
            aria-invalid={typedError ? true : undefined}
            onChange={(event) => {
              setTyped(event.target.value);
              setTypedError(null);
            }}
            onKeyDown={onTypedKey}
          />
          <button type="button" className="secondary-button" disabled={typed.trim() === ''} onClick={useTyped}>
            Use
          </button>
        </div>
        <span className="field-hint">Decimal, degrees-minutes-seconds, or a Google Maps link.</span>
        {preview?.ok && <span className="field-hint">Reads as {formatPoint(preview.point)}</span>}
        {typedError && <span className="field-error">{typedError}</span>}
      </div>

      {message && <p className="field-hint" role="status">{message}</p>}
      {problem && <p className="field-error" role="alert">{problem}</p>}
    </fieldset>
  );
}
