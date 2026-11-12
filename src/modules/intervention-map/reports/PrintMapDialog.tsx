// Print map: the map as it is on screen, as a PDF with a title, legend, north arrow, scale bar, date, data
// sources and the signature blocks. The PDF code loads only when it's used.
import { CircleAlert, Info, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Intervention, MapData } from '../data/types';
import { SelectField, TextField } from '../edit/FormParts';
import { Dialog } from '../overview/Dialog';
import { describeFilters, exportFileStem, filterLines } from '../export/records';
import type { ChoroplethMode, Shading } from '../lib/choropleth';
import { pickViewFilters } from '../lib/choropleth';
import { manilaToday } from '../lib/dates';
import { isOnMap } from '../lib/display';
import { linePartsOf } from '../lib/qa';
import { isUnfinished } from '../lib/roads';
import { downloadFile } from '../lib/download';
import type { ColorScale } from '../lib/view-fields';
import { useExportUi } from '../state/export-ui';
import { useMapUi, type BasemapId } from '../state/map-ui';
import { useStore } from '../state/store-context';
import type { LegendSection } from './print-map-pdf';

// A road's legend sample is grey, as the line itself takes its Color by color.
const ROAD_SAMPLE_COLOR = '#52514e';
import { dataSourceLine } from './report-data';

const BASEMAP_CREDITS: Record<BasemapId, string> = {
  light: 'Esri World Light Gray Canvas, © OpenStreetMap contributors',
  osm: '© OpenStreetMap contributors',
  imagery: 'Esri World Imagery',
  topo: 'Esri World Topographic Map',
  hybrid: 'Esri World Imagery and Reference',
};

const METERS_PER_DEGREE = 111_320;

interface PrintMapDialogProps {
  open: boolean;
  onClose(): void;
  data: MapData;
  mode: ChoroplethMode;
  shading: Shading;
  scale: ColorScale;
  markers: Intervention[];
}

export function PrintMapDialog({ open, onClose, data, mode, shading, scale, markers }: PrintMapDialogProps) {
  const { store } = useStore();
  const ui = useMapUi();
  const mapBounds = useExportUi((state) => state.mapBounds);
  const view = pickViewFilters(ui);
  const filters = useMemo(() => describeFilters({ view, barangayId: null, mapBounds: null }, data), [JSON.stringify(view), data]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = filterLines(filters);
  const [title, setTitle] = useState('');
  const [paper, setPaper] = useState<'a4' | 'letter' | 'legal'>('a4');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFailure(null);
    setTitle(`DA Interventions in ${filters.municipality ? `${filters.municipality}, ` : ''}Marinduque`);
    // Only when it opens, so a title being typed isn't replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const legend = (): LegendSection[] => {
    const sections: LegendSection[] = [];
    if (mode !== 'off') sections.push({ title: shading.title, shape: 'square', entries: shading.legend.map((entry) => ({ color: entry.color, label: entry.label, count: entry.barangays })) });
    const counts = new Map<string, number>();
    for (const record of markers) counts.set(scale.keyOf(record), (counts.get(scale.keyOf(record)) ?? 0) + 1);
    const entries = scale.entries.filter((entry) => counts.has(entry.key)).map((entry) => ({ color: entry.color, label: entry.label, count: counts.get(entry.key) }));
    if (entries.length > 0) sections.push({ title: `Markers by ${scale.title.toLowerCase()}`, shape: 'dot', entries });
    // The roads drawn, as the map's legend counts them: solid once finished, dashed before.
    const drawn = markers.filter((record) => isOnMap(record) && linePartsOf(record) !== null);
    const unfinished = drawn.filter((record) => isUnfinished(record, data)).length;
    const roads = [
      { color: ROAD_SAMPLE_COLOR, label: 'Completed or in use', count: drawn.length - unfinished },
      { color: ROAD_SAMPLE_COLOR, label: 'Proposed or on-going', count: unfinished, dashed: true },
    ].filter((entry) => entry.count > 0);
    if (roads.length > 0) sections.push({ title: 'Roads', shape: 'line', entries: roads });
    return sections;
  };

  const print = async () => {
    const container = document.querySelector<HTMLElement>('.map.leaflet-container');
    if (!container || !mapBounds) {
      setFailure('The map isn\'t ready yet. Try again in a moment.');
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const [{ captureMap }, { printMapPdf }] = await Promise.all([import('./map-capture'), import('./print-map-pdf')]);
      const capture = await captureMap(container);
      const middle = ((mapBounds.north + mapBounds.south) / 2) * (Math.PI / 180);
      const metersPerPixel = ((mapBounds.east - mapBounds.west) * Math.cos(middle) * METERS_PER_DEGREE) / capture.width;
      const now = new Date();
      const bytes = printMapPdf({
        capture,
        metersPerPixel,
        title: title.trim() || 'DA Interventions in Marinduque',
        lines,
        paper,
        orientation,
        legend: legend(),
        sources: dataSourceLine(markers),
        basemap: BASEMAP_CREDITS[ui.basemap],
        signatories: data.signatories,
        now,
      });
      const fileName = `Map_${exportFileStem(filters, manilaToday(now))}.pdf`;
      // As with any export, the file leaves only once the log has it.
      await store.logExport({ format: 'pdf', file_name: fileName, filters: { report: 'map', ...filters }, record_count: markers.length });
      downloadFile(bytes, fileName, 'application/pdf');
      onClose();
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Print map"
      closeLabel="Close print map"
      onClose={onClose}
      subtitle="The map as it is now, as a PDF with its legend, a north arrow, a scale bar, the date, the data sources and the signature blocks."
      onSubmit={() => void print()}
      formLabel="Print map"
      footer={
        <>
          <button type="button" className="ui-button ui-button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="ui-button ui-button-primary" disabled={busy}>
            <Printer aria-hidden="true" />
            {busy ? 'Preparing the map…' : 'Download PDF'}
          </button>
        </>
      }
    >
      <p className="ui-notice ui-notice-info">
        <Info aria-hidden="true" />
        <span>Move or zoom the map first to choose what shows, and close the side panels for a wider map.</span>
      </p>
      <div className="dialog-fields">
        <TextField label="Title" value={title} onChange={setTitle} />
        {lines.length > 0 && (
          <p className="dialog-hint" aria-label="Under the title">
            Under the title: {lines.join('; ')}
          </p>
        )}
        <div className="dialog-field-row">
          <SelectField
            label="Paper"
            value={paper}
            onChange={(value) => setPaper(value as typeof paper)}
            options={[
              { value: 'a4', label: 'A4' },
              { value: 'letter', label: 'Letter (8.5 × 11 in)' },
              { value: 'legal', label: 'Legal (8.5 × 14 in)' },
            ]}
          />
          <SelectField
            label="Orientation"
            value={orientation}
            onChange={(value) => setOrientation(value as typeof orientation)}
            options={[
              { value: 'landscape', label: 'Landscape' },
              { value: 'portrait', label: 'Portrait' },
            ]}
          />
        </div>
      </div>
      {failure && (
        <p className="ui-notice ui-notice-danger" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{failure}</span>
        </p>
      )}
    </Dialog>
  );
}
