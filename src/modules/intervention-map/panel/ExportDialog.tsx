import { CircleAlert, Download, FileDown, Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Intervention, MapData } from '../data/types';
import { Dialog } from '../overview/Dialog';
import { barangaysInScope, pickViewFilters } from '../lib/choropleth';
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
import { downloadFile } from '../lib/download';
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

const MAP_VIEW_LINE = 'Only the current map view';

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

  useEffect(() => {
    if (open) setFailure(null);
  }, [open]);

  const view = pickViewFilters(ui);
  // The records table has already decided, so its rows are what goes.
  const table = open?.table ?? null;
  const limitToMap = table ? table.onlyMapView : onlyMapView;
  const selection = useMemo(
    () => ({ view, barangayId: open?.barangayId ?? null, mapBounds: limitToMap ? mapBounds : null, recordIds: table?.recordIds ?? null, search: table?.search ?? null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(view), open?.barangayId, limitToMap, mapBounds, table],
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
  const shownLines = table ? lines : lines.filter((line) => line !== MAP_VIEW_LINE);

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
      downloadFile(file.bytes, file.fileName, file.mimeType);
      closeExport();
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = barangayName ? `Export ${barangayName}` : table ? 'Export the records table' : 'Export';
  const hasNotes = (leavesOutUnlocated(format) && unlocated > 0) || toCheck > 0 || (nothingToPlot && records.length > 0);

  return (
    <Dialog
      title={title}
      closeLabel="Close export"
      onClose={closeExport}
      subtitle="Download the records for Google Earth, QGIS or Excel."
      footer={
        <>
          {/* Beside the button, so what will go is in view however far the choices scroll. */}
          <div className="export-summary" role="status">
            <p className="export-summary-count">
              <strong className="export-count">{plural(records.length, 'record')}</strong> will be exported.
            </p>
            <p className="export-file">
              <FileDown aria-hidden="true" />
              <span className="export-file-name">
                {stem}.{fileExtension}
              </span>
            </p>
          </div>
          <div className="ui-dialog-actions">
            <button type="button" className="ui-button ui-button-secondary" onClick={closeExport}>
              Cancel
            </button>
            <button type="button" className="ui-button ui-button-primary" disabled={busy || records.length === 0 || nothingToPlot} onClick={() => void runExport()}>
              <Download aria-hidden="true" />
              {busy ? 'Preparing…' : 'Download'}
            </button>
          </div>
        </>
      }
    >
      <fieldset className="dialog-section">
        <legend>Format</legend>
        <div className="option-cards">
          {FORMATS.map((option) => (
            <label className="option-card" key={option.id}>
              <input type="radio" name="export-format" checked={format === option.id} onChange={() => setFormat(option.id)} />
              <span className="option-card-text">
                <strong>{option.label}</strong> <span>{option.note}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="dialog-section">
        <legend>What to include</legend>
        {table && <p className="dialog-hint">The table's rows, in its order.</p>}
        {shownLines.length > 0 ? (
          <ul className="filter-chips" aria-label="Filters in force">
            {shownLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="dialog-hint">The whole province. No filters are on.</p>
        )}
        {!table && (
          <label className="dialog-check">
            <input type="checkbox" checked={onlyMapView} onChange={(event) => setOnlyMapView(event.target.checked)} />
            <span>Only what's in the current map view</span>
          </label>
        )}
      </fieldset>

      {isGoogleEarth(format) && (
        <fieldset className="dialog-section">
          <legend>Extra layers</legend>
          <label className="dialog-check">
            <input type="checkbox" checked={layers.municipalBoundaries} onChange={(event) => setLayers({ ...layers, municipalBoundaries: event.target.checked })} />
            <span>Municipal boundaries</span>
          </label>
          <label className="dialog-check">
            <input type="checkbox" checked={layers.barangayBoundaries} onChange={(event) => setLayers({ ...layers, barangayBoundaries: event.target.checked })} />
            <span>Barangay boundaries</span>
          </label>
          <label className="dialog-check">
            <input type="checkbox" checked={layers.gapMap} onChange={(event) => setLayers({ ...layers, gapMap: event.target.checked })} />
            <span>
              Barangay gap map <span className="dialog-hint">Off when the file opens. Switch it on in Google Earth to show it.</span>
            </span>
          </label>
        </fieldset>
      )}

      {hasNotes && (
        <div className="ui-notice ui-notice-info export-notes" role="status">
          <Info aria-hidden="true" />
          <div>
            {leavesOutUnlocated(format) && unlocated > 0 && (
              <p>
                {located} on the map. {plural(unlocated, 'record')} without coordinates can't be plotted, so {unlocated === 1 ? 'it is' : 'they are'} listed by name
                {format === 'shp' ? ' in a text file in the .zip' : ' in the file\'s "Read me" folder'}.
              </p>
            )}
            {toCheck > 0 && (
              <p>
                {plural(toCheck, 'record')} with coordinates outside Marinduque {isGoogleEarth(format) ? `${toCheck === 1 ? 'goes' : 'go'} in the folder "${NEEDS_LOCATION_CHECK}"` : `${toCheck === 1 ? 'is' : 'are'} marked in the first column, "${NEEDS_LOCATION_CHECK}"`}.
              </p>
            )}
            {nothingToPlot && records.length > 0 && <p>None of these have coordinates, so choose CSV or GeoJSON for them.</p>}
          </div>
        </div>
      )}

      {failure && (
        <p className="ui-notice ui-notice-danger" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>Nothing was exported. {failure}</span>
        </p>
      )}
    </Dialog>
  );
}
