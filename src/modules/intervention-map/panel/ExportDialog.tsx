import { useEffect, useMemo, useRef, useState } from 'react';
import type { Intervention, MapData } from '../data/types';
import { barangaysInScope, type ViewFilters } from '../lib/choropleth';
import { manilaToday } from '../lib/dates';
import {
  describeFilters,
  exportFileStem,
  filterLines,
  isLocated,
  NEEDS_LOCATION_CHECK,
  needsLocationCheck,
  selectExportRecords,
  selectionView,
  type ExportFormat,
} from '../export/records';
import { useExportUi } from '../state/export-ui';
import { useMapUi } from '../state/map-ui';
import { useStore } from '../state/store-context';
import type { Boundaries } from '../state/use-map-data';

const FORMATS: { id: ExportFormat; label: string; note: string }[] = [
  { id: 'kmz', label: 'KMZ', note: 'Google Earth, with the map\'s icons' },
  { id: 'kml', label: 'KML', note: 'Google Earth and QGIS, with colored dots' },
  { id: 'csv', label: 'CSV', note: 'Excel, including records without coordinates' },
  { id: 'geojson', label: 'GeoJSON', note: 'QGIS and web maps' },
  { id: 'shp', label: 'Shapefile', note: 'QGIS and ArcGIS, as a .zip' },
];

const leavesOutUnlocated = (format: ExportFormat) => format === 'kmz' || format === 'kml' || format === 'shp';
const isGoogleEarth = (format: ExportFormat) => format === 'kmz' || format === 'kml';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function viewFilters(ui: ViewFilters): ViewFilters {
  const { mode, pickedProgramId, pickedTypeId, hiddenTypeIds, programId, yearFrom, yearTo, municipalityId, barangayId } = ui;
  return { mode, pickedProgramId, pickedTypeId, hiddenTypeIds, programId, yearFrom, yearTo, municipalityId, barangayId };
}

function download(bytes: Uint8Array, fileName: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

interface ExportDialogProps {
  data: MapData;
  boundaries: Boundaries;
  allRecords: Intervention[];
}

export function ExportDialog({ data, boundaries, allRecords }: ExportDialogProps) {
  const open = useExportUi((state) => state.open);
  const closeExport = useExportUi((state) => state.closeExport);
  const mapBounds = useExportUi((state) => state.mapBounds);
  const ui = useMapUi();
  const { store } = useStore();

  const [format, setFormat] = useState<ExportFormat>('kmz');
  const [onlyMapView, setOnlyMapView] = useState(false);
  const [layers, setLayers] = useState({ municipalBoundaries: false, barangayBoundaries: false, gapMap: false });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setFailure(null);
    closeButton.current?.focus();
  }, [open]);

  const view = viewFilters(ui);
  const selection = useMemo(
    () => ({ view, barangayId: open?.barangayId ?? null, mapBounds: onlyMapView ? mapBounds : null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(view), open?.barangayId, onlyMapView, mapBounds],
  );
  const records = useMemo(() => selectExportRecords(allRecords, data.links, selection, data), [allRecords, data, selection]);

  if (!open) return null;

  const filters = describeFilters(selection, data);
  const lines = filterLines(filters);
  const located = records.filter(isLocated).length;
  const unlocated = records.length - located;
  const nothingToPlot = leavesOutUnlocated(format) && located === 0;
  const toCheck = records.filter((record) => isLocated(record) && needsLocationCheck(record)).length;
  const fileExtension = format === 'shp' ? 'zip' : format;
  const stem = exportFileStem(filters, manilaToday());
  const barangayName = data.barangays.find((b) => b.id === open.barangayId)?.name;

  const runExport = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const [{ buildExportFile }, { renderMarkerInBrowser }] = await Promise.all([import('../export/build'), import('../export/marker-image')]);
      const barangays = barangaysInScope(data.barangays, selectionView(selection, data));
      const municipalityIds = new Set(barangays.map((b) => b.municipality_id));
      const file = await buildExportFile({
        format,
        records,
        data,
        boundaries,
        layers: isGoogleEarth(format) ? layers : { municipalBoundaries: false, barangayBoundaries: false, gapMap: false },
        stem,
        filterLines: lines,
        exportedOn: manilaToday(),
        exportedBy: store.user.full_name,
        barangays,
        municipalities: data.municipalities.filter((m) => municipalityIds.has(m.id)),
        renderMarker: renderMarkerInBrowser,
      });
      // The file only leaves once the log has it, so an export can't go unrecorded.
      await store.logExport({
        format,
        file_name: file.fileName,
        filters: { ...filters, layers: isGoogleEarth(format) ? layers : undefined },
        record_count: records.length,
      });
      download(file.bytes, file.fileName, file.mimeType);
      closeExport();
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="export-dialog-backdrop">
      <div className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <header className="panel-header">
          <h2 id="export-title">{barangayName ? `Export ${barangayName}` : 'Export'}</h2>
          <button type="button" ref={closeButton} className="close-button" onClick={closeExport} aria-label="Close export">
            ×
          </button>
        </header>

        <fieldset>
          <legend className="section-title">Format</legend>
          {FORMATS.map((option) => (
            <label className="choice export-format" key={option.id}>
              <input type="radio" name="export-format" checked={format === option.id} onChange={() => setFormat(option.id)} />
              <span>
                {option.label} <span className="field-hint">{option.note}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend className="section-title">What to include</legend>
          {lines.filter((line) => line !== 'Only the current map view').length > 0 ? (
            <ul className="export-filters" aria-label="Filters in force">
              {lines
                .filter((line) => line !== 'Only the current map view')
                .map((line) => (
                  <li key={line}>{line}</li>
                ))}
            </ul>
          ) : (
            <p className="field-hint">The whole province. No filters are on.</p>
          )}
          <label className="choice">
            <input type="checkbox" checked={onlyMapView} onChange={(event) => setOnlyMapView(event.target.checked)} />
            Only what's in the current map view
          </label>
        </fieldset>

        {isGoogleEarth(format) && (
          <fieldset>
            <legend className="section-title">Extra layers</legend>
            <label className="choice">
              <input type="checkbox" checked={layers.municipalBoundaries} onChange={(event) => setLayers({ ...layers, municipalBoundaries: event.target.checked })} />
              Municipal boundaries
            </label>
            <label className="choice">
              <input type="checkbox" checked={layers.barangayBoundaries} onChange={(event) => setLayers({ ...layers, barangayBoundaries: event.target.checked })} />
              Barangay boundaries
            </label>
            <label className="choice">
              <input type="checkbox" checked={layers.gapMap} onChange={(event) => setLayers({ ...layers, gapMap: event.target.checked })} />
              <span>
                Barangay gap map <span className="field-hint">Off when the file opens. Switch it on in Google Earth to show it.</span>
              </span>
            </label>
          </fieldset>
        )}

        <div className="export-summary" role="status">
          <p>
            <strong className="export-count">{plural(records.length, 'record')}</strong> will be exported.
          </p>
          {leavesOutUnlocated(format) && unlocated > 0 && (
            <p className="field-hint">
              {located} on the map. {plural(unlocated, 'record')} without coordinates can't be plotted, so {unlocated === 1 ? 'it is' : 'they are'} listed by name
              {format === 'shp' ? ' in a text file in the .zip' : ' in the file\'s "Read me" folder'}.
            </p>
          )}
          {toCheck > 0 && (
            <p className="field-hint">
              {plural(toCheck, 'record')} with coordinates outside Marinduque {isGoogleEarth(format) ? `${toCheck === 1 ? 'goes' : 'go'} in the folder "${NEEDS_LOCATION_CHECK}"` : `${toCheck === 1 ? 'is' : 'are'} marked in the first column, "${NEEDS_LOCATION_CHECK}"`}.
            </p>
          )}
          {nothingToPlot && records.length > 0 && <p className="field-hint">None of these have coordinates, so choose CSV or GeoJSON for them.</p>}
          <p className="field-hint export-file-name">
            {stem}.{fileExtension}
          </p>
        </div>

        {failure && (
          <p className="record-warning" role="alert">
            Nothing was exported. {failure}
          </p>
        )}

        <button type="button" className="primary-button" disabled={busy || records.length === 0 || nothingToPlot} onClick={() => void runExport()}>
          {busy ? 'Preparing…' : 'Download'}
        </button>
      </div>
    </div>
  );
}
