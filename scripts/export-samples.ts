// Writes sample exports to exports/samples/, using the same code as the map's Export button. They
// come from the local dataset, the RAED records as loaded by the real migrations, with every extra
// layer on. They hold beneficiary names, so exports/ is ignored by git and shouldn't be shared.
//
// Usage: npm run build:local-seed, then npm run export:samples
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import { toMapData, type LocalSeed } from '../src/modules/intervention-map/data/local-store';
import type { MapData } from '../src/modules/intervention-map/data/types';
import { barangaysInScope, liveRecords, type ViewFilters } from '../src/modules/intervention-map/lib/choropleth';
import { manilaToday } from '../src/modules/intervention-map/lib/dates';
import { buildExportFile } from '../src/modules/intervention-map/export/build';
import { drawMarker, iconDataUrl, MARKER_SIZE, type RenderMarker } from '../src/modules/intervention-map/export/marker-image';
import { describeFilters, exportFileStem, filterLines, isLocated, selectExportRecords, type ExportFormat } from '../src/modules/intervention-map/export/records';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = resolve(ROOT, 'exports', 'samples');
const readJson = (path: string) => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));

const renderMarker: RenderMarker = async (svg, color) => {
  const canvas = createCanvas(MARKER_SIZE, MARKER_SIZE);
  const image: Image | null = svg ? await loadImage(iconDataUrl(svg)) : null;
  drawMarker(canvas.getContext('2d'), color, image);
  return new Uint8Array(canvas.toBuffer('image/png'));
};

const NO_FILTERS: ViewFilters = {
  mode: 'count',
  pickedProgramId: null,
  pickedTypeId: null,
  hiddenTypeIds: [],
  programId: null,
  yearFrom: null,
  yearTo: null,
  municipalityId: null,
  barangayId: null,
};

const seed = readJson('data/local/local-seed.json') as LocalSeed;
const data: MapData = toMapData(seed);
const boundaries = {
  barangays: readJson('public/boundaries/barangays.geojson'),
  municipalities: readJson('public/boundaries/municipalities.geojson'),
};
const allRecords = liveRecords(data.interventions, data.types);
const date = manilaToday();
const gasan = data.municipalities.find((m) => m.name === 'Gasan')!;

const SAMPLES: { format: ExportFormat; view: ViewFilters }[] = [
  { format: 'kmz', view: NO_FILTERS },
  { format: 'kmz', view: { ...NO_FILTERS, municipalityId: gasan.id } },
  { format: 'shp', view: NO_FILTERS },
  { format: 'csv', view: NO_FILTERS },
];

mkdirSync(OUTPUT, { recursive: true });
for (const { format, view } of SAMPLES) {
  const selection = { view };
  const records = selectExportRecords(allRecords, data.links, selection, data);
  const filters = describeFilters(selection, data);
  const barangays = barangaysInScope(data.barangays, view);
  const municipalityIds = new Set(barangays.map((b) => b.municipality_id));
  const file = await buildExportFile({
    format,
    records,
    data,
    boundaries,
    layers: { municipalBoundaries: true, barangayBoundaries: true, gapMap: true },
    stem: exportFileStem(filters, date),
    filterLines: filterLines(filters),
    exportedOn: date,
    exportedBy: 'Sample export',
    barangays,
    municipalities: data.municipalities.filter((m) => municipalityIds.has(m.id)),
    renderMarker,
  });
  writeFileSync(resolve(OUTPUT, file.fileName), file.bytes);
  const located = records.filter(isLocated).length;
  console.log(`${file.fileName}: ${records.length} records (${located} located, ${records.length - located} without coordinates), ${Math.round(file.bytes.length / 1024)} KB`);
}
