// Every export format, read back with a parser that isn't ours, on the real RAED data from the real
// migrations plus records made to be awkward.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { read as readShapefile } from 'shapefile';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLocalSeed } from '../scripts/build-local-seed';
import { loadSeedFiles, seedInterventions } from '../scripts/seed-interventions';
import * as engine from '../src/modules/intervention-map/data/local-engine';
import { stateFromSeed, toMapData, type LocalSeed } from '../src/modules/intervention-map/data/local-store';
import { createSupabaseStore } from '../src/modules/intervention-map/data/supabase-store';
import type { Barangay, Intervention, MapData, Municipality } from '../src/modules/intervention-map/data/types';
import { buildExportFile, buildCsv, buildGeoJson } from '../src/modules/intervention-map/export/build';
import { buildFields, placemarkName } from '../src/modules/intervention-map/export/fields';
import { buildKml, geometryXml, kmlColor, type KmlInput } from '../src/modules/intervention-map/export/kml';
import { drawMarker, iconDataUrl, MARKER_SIZE, type RenderMarker } from '../src/modules/intervention-map/export/marker-image';
import { describeFilters, exportFileStem, filterLines, geometryBounds, isLocated, selectExportRecords } from '../src/modules/intervention-map/export/records';
import { buildShapefile, shortFieldNames } from '../src/modules/intervention-map/export/shapefile';
import {
  barangaysInScope,
  buildShading,
  COUNT_BINS,
  countByBarangay,
  GAP_NONE_COLOR,
  liveRecords,
  visibleRecords,
  type ViewFilters,
} from '../src/modules/intervention-map/lib/choropleth';
import { recordColor, recordIcon } from '../src/modules/intervention-map/lib/display';
import { createTestDb } from './helpers/db';
import { createPgliteBackend } from './helpers/pglite-backend';

const ADMIN = 'f0000000-0000-4000-8000-000000000001';
const ENCODER = 'f0000000-0000-4000-8000-000000000002';
const VIEWER = 'f0000000-0000-4000-8000-000000000003';
const STRANGER = 'f0000000-0000-4000-8000-000000000004';

const boundary = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'boundaries', `${name}.geojson`), 'utf8')) as GeoJSON.FeatureCollection;
const boundaries = { barangays: boundary('barangays'), municipalities: boundary('municipalities') };

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
const NO_LAYERS = { municipalBoundaries: false, barangayBoundaries: false, gapMap: false };
const TODAY = '2026-11-07';

const renderMarker: RenderMarker = async (svg, color) => {
  const canvas = createCanvas(MARKER_SIZE, MARKER_SIZE);
  drawMarker(canvas.getContext('2d'), color, svg ? await loadImage(iconDataUrl(svg)) : null);
  return new Uint8Array(canvas.toBuffer('image/png'));
};

let db: PGlite;
let data: MapData;
let raed: Intervention[];
let awkward: Intervention;
let unlocatedAwkward: Intervention;
let road: Intervention;
let area: Intervention;
let all: Intervention[];
let gasan: Municipality;

const LONG_REMARK = `${'Pañe '.repeat(70)}end`;
const AWKWARD_NAME = 'Niño & "Peñafrancia" <Growers> ]]> Association';

const kmlInput = (records: Intervention[], changes: Partial<KmlInput> = {}): KmlInput => ({
  records,
  data,
  boundaries,
  layers: NO_LAYERS,
  title: 'Test',
  filterLines: [],
  exportedOn: TODAY,
  exportedBy: 'Vera Viewer',
  barangays: data.barangays,
  municipalities: data.municipalities,
  ...changes,
});

const parseXml = (text: string) => new DOMParser().parseFromString(text, 'text/xml');
const childrenNamed = (node: Element, name: string) => Array.from(node.childNodes as unknown as Node[]).filter((child) => child.nodeName === name) as Element[];
const folderName = (folder: Element) => childrenNamed(folder, 'name')[0].textContent;
const documentOf = (text: string) => parseXml(text).getElementsByTagName('Document')[0] as unknown as Element;
const featuresOf = (text: string) => kmlToGeoJson(parseXml(text) as unknown as Document).features;

beforeAll(async () => {
  db = await createTestDb();
  const { rows } = loadSeedFiles();
  await seedInterventions(db, rows, []);
  const seed = JSON.parse(JSON.stringify(await buildLocalSeed(db))) as LocalSeed;
  data = toMapData(seed);
  raed = liveRecords(data.interventions, data.types);
  gasan = data.municipalities.find((m) => m.name === 'Gasan')!;

  const template = raed.find((r) => r.geojson?.type === 'Point' && r.barangay_id !== null)!;
  const machinery = data.types.find((t) => t.code === 'farm-machinery')!;
  const inactiveRoad = data.types.find((t) => t.code === 'fmr')!;
  const inactiveArea = data.types.find((t) => t.code === 'service-area')!;

  awkward = {
    ...template,
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    beneficiary: AWKWARD_NAME,
    remarks: LONG_REMARK,
    attributes: { serial_no: 'SN-Ñ-1', engine_no: '=1+1', leftover_field: 'kept' },
    intervention_type_id: machinery.id,
    geojson: { type: 'Point', coordinates: [121.87836, 13.340199] },
  };
  unlocatedAwkward = {
    ...template,
    id: 'aaaaaaaa-0000-4000-8000-000000000002',
    beneficiary: 'Doña Unlocated Farmers',
    geojson: null,
    qa_flags: ['no_coords'],
    attributes: {},
  };
  road = {
    ...template,
    id: 'aaaaaaaa-0000-4000-8000-000000000003',
    beneficiary: 'Line Record',
    intervention_type_id: inactiveRoad.id,
    attributes: { length_km: 1.25 },
    geojson: { type: 'LineString', coordinates: [[121.9, 13.4], [121.95, 13.45], [122, 13.5]] },
  };
  area = {
    ...template,
    id: 'aaaaaaaa-0000-4000-8000-000000000004',
    beneficiary: 'Polygon Record',
    intervention_type_id: inactiveArea.id,
    attributes: { area_ha: 3 },
    // Counterclockwise outer ring with a hole, as GeoJSON has them.
    geojson: {
      type: 'Polygon',
      coordinates: [
        [[121.9, 13.3], [122, 13.3], [122, 13.4], [121.9, 13.4], [121.9, 13.3]],
        [[121.93, 13.33], [121.93, 13.37], [121.97, 13.37], [121.97, 13.33], [121.93, 13.33]],
      ],
    },
  };
  all = [...raed, awkward, unlocatedAwkward];

  for (const id of [ADMIN, ENCODER, VIEWER, STRANGER]) await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(
    `insert into profiles (id, full_name, role) values ($1, 'Ana Admin', 'admin'), ($2, 'Enzo Encoder', 'encoder'), ($3, 'Vera Viewer', 'viewer')`,
    [ADMIN, ENCODER, VIEWER],
  );
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe('the real data', () => {
  it('has the known counts the rest of these tests rely on', () => {
    expect(raed).toHaveLength(199);
    expect(raed.filter(isLocated)).toHaveLength(173);
    expect(raed.filter((r) => !isLocated(r))).toHaveLength(26);
  });

  it('gives every category an icon of its own group, on a fresh database', () => {
    expect(data.categories.filter((c) => !c.icon_id)).toEqual([]);
    const iconOf = (name: string) => data.icons.find((i) => i.id === data.categories.find((c) => c.name === name)?.icon_id)?.name;
    expect(iconOf('Hand Tractor (Walking-type)')).toBe('Tractor');
    expect(iconOf('Rice Thresher')).toBe('Crate');
    expect(iconOf('Solar-Powered Irrigation System (SPIS)')).toBe('Sun');
    expect(iconOf('Small Farm Reservoir (SFR)')).toBe('Canal');
  });

  it('gives a category added later its group\'s icon too', async () => {
    await db.exec('begin');
    const { rows } = await db.query<{ icon: string }>(
      `insert into categories (code, name, category_group_id)
       select 'x-new', 'New planter', id from category_groups where code = 'planting'
       returning (select name from icons where id = icon_id) as icon`,
    );
    await db.exec('rollback');
    expect(rows[0].icon).toBe('Seedling');
  });

  it('draws a record with the category\'s icon and the program\'s color, or falls back to the type\'s', () => {
    const record = raed.find((r) => r.category_id === data.categories.find((c) => c.name === 'Rice Thresher')!.id)!;
    expect(recordIcon(record, data)?.name).toBe('Crate');
    expect(recordColor(record, data)).toBe(data.programs.find((p) => p.id === record.banner_program_id)!.color);

    const noCategory = { ...record, category_id: null, banner_program_id: null };
    const type = data.types.find((t) => t.id === record.intervention_type_id)!;
    expect(recordIcon(noCategory, data)?.id).toBe(type.icon_id);
    expect(recordColor(noCategory, data)).toBe(type.color);
  });
});

describe('KML', () => {
  it('converts colors to aabbggrr', () => {
    expect(kmlColor('#2e7d32')).toBe('ff327d2e');
    expect(kmlColor('#F59E0B', 0x66)).toBe('660b9ef5');
  });

  it('writes coordinates longitude first, for every shape', () => {
    expect(geometryXml({ type: 'Point', coordinates: [121.9, 13.4] })).toContain('<coordinates>121.9,13.4,0</coordinates>');
    expect(geometryXml({ type: 'LineString', coordinates: [[121.9, 13.4], [122, 13.5]] })).toContain('121.9,13.4,0 122,13.5,0');
    const polygon = geometryXml(area.geojson!);
    expect(polygon).toContain('<outerBoundaryIs>');
    expect(polygon).toContain('<innerBoundaryIs>');
    expect(polygon).toContain('121.9,13.3,0');
  });

  it('every RAED point reads back at its own place, inside Marinduque unless flagged', () => {
    const { kml, placemarks } = buildKml(kmlInput(raed), true);
    expect(placemarks).toBe(173);
    const coordinates = Array.from(parseXml(kml).getElementsByTagName('coordinates')).map((node) => node.textContent!.split(','));
    expect(coordinates).toHaveLength(173);

    const features = featuresOf(kml);
    expect(features).toHaveLength(173);
    for (const record of raed.filter(isLocated)) {
      const feature = features.find((f) => f.properties?.RecordId === record.id)!;
      expect(feature.geometry).toEqual({ type: 'Point', coordinates: [...(record.geojson as GeoJSON.Point).coordinates, 0] });
    }

    // A swapped pair would put longitude near 13 and latitude near 122.
    const inBox = raed.filter((r) => isLocated(r) && !r.qa_flags.includes('out_of_province'));
    for (const record of inBox) {
      const [longitude, latitude] = (features.find((f) => f.properties?.RecordId === record.id)!.geometry as GeoJSON.Point).coordinates;
      expect(longitude).toBeGreaterThan(121.7);
      expect(longitude).toBeLessThan(122.3);
      expect(latitude).toBeGreaterThan(13.1);
      expect(latitude).toBeLessThan(13.7);
    }
  });

  it('folders run Municipality, Barangay, Type, with no barangay last', () => {
    const { kml } = buildKml(kmlInput(raed), true);
    const municipalities = childrenNamed(documentOf(kml), 'Folder');
    expect(municipalities.map(folderName)).toEqual(['QA – needs location check', 'Boac', 'Buenavista', 'Gasan', 'Mogpog', 'Santa Cruz', 'Torrijos']);

    let placemarks = 0;
    const typeNames = new Set<string>();
    for (const municipality of municipalities.slice(1)) {
      const barangays = childrenNamed(municipality, 'Folder');
      const names = barangays.map(folderName);
      if (names.includes('No barangay')) expect(names.at(-1)).toBe('No barangay');
      for (const barangay of barangays) {
        for (const type of childrenNamed(barangay, 'Folder')) {
          typeNames.add(folderName(type)!);
          placemarks += childrenNamed(type, 'Placemark').length;
        }
      }
    }
    expect(placemarks).toBe(172);
    expect([...typeNames].sort()).toEqual(['Farm Machinery', 'SSIP']);
  });

  it('files a record under its encoded place, once', () => {
    const record = raed.find((r) => isLocated(r) && r.barangay_id !== null)!;
    const { kml } = buildKml(kmlInput([record]), true);
    const municipality = childrenNamed(documentOf(kml), 'Folder')[0];
    const barangay = childrenNamed(municipality, 'Folder')[0];
    expect(folderName(municipality)).toBe(data.municipalities.find((m) => m.id === record.municipality_id)!.name);
    expect(folderName(barangay)).toBe(data.barangays.find((b) => b.id === record.barangay_id)!.name);
    expect(parseXml(kml).getElementsByTagName('Placemark')).toHaveLength(1);
  });

  it('names a placemark Category – Beneficiary (Year), leaving out blanks', () => {
    const category = data.categories.find((c) => c.id === awkward.category_id)!.name;
    expect(placemarkName(awkward, data)).toBe(`${category} – ${AWKWARD_NAME} (${awkward.year_funded})`);
    expect(placemarkName({ ...awkward, beneficiary: null }, data)).toBe(`${category} (${awkward.year_funded})`);
    expect(placemarkName({ ...awkward, year_funded: null }, data)).toBe(`${category} – ${AWKWARD_NAME}`);
  });

  it('carries every field through ExtendedData, including ñ and custom attributes', () => {
    const { kml } = buildKml(kmlInput(all), true);
    const feature = featuresOf(kml).find((f) => f.properties?.RecordId === awkward.id)!;
    expect(feature.properties).toMatchObject({
      Beneficiary: AWKWARD_NAME,
      SerialNo: 'SN-Ñ-1',
      LeftoverField: 'kept',
      Municipality: data.municipalities.find((m) => m.id === awkward.municipality_id)!.name,
      Status: data.statuses.find((s) => s.id === awkward.status_id)!.name,
      LocationBasis: data.locationBases.find((b) => b.id === awkward.location_basis_id)?.name ?? '',
    });
    for (const field of buildFields(all, data)) expect(feature.properties).toHaveProperty(field.key);
  });

  it('shows status with its as-of date, location basis and flags in the balloon', () => {
    const flagged = raed.find((r) => isLocated(r) && r.qa_flags.includes('beneficiary_name_check'))!;
    const { kml } = buildKml(kmlInput([flagged]), true);
    const description = featuresOf(kml)[0].properties?.description as string | { value: string };
    const html = typeof description === 'string' ? description : description.value;
    expect(html).toContain('Status as of');
    expect(html).toContain('as of 2026-10-21 (RAED report)');
    expect(html).toContain('Location basis');
    expect(html).toContain('QA flags');
    expect(html).toContain('Beneficiary name needs checking');
  });

  it('escapes values, so a balloon can\'t carry markup or break the file', () => {
    const hostile = { ...awkward, remarks: '<script>alert(1)</script> ]]> <b>' };
    const { kml } = buildKml(kmlInput([hostile]), true);
    expect(parseXml(kml).getElementsByTagName('Placemark')).toHaveLength(1);
    expect(kml).not.toContain('<script>');
    expect(kml).toContain('&lt;script&gt;');
  });

  it('survives characters XML can\'t hold', () => {
    const { kml } = buildKml(kmlInput([{ ...awkward, remarks: 'bell\u0007here' }]), true);
    expect(featuresOf(kml)[0].properties?.Remarks).toBe('bellhere');
  });

  it('leaves out records without coordinates, and lists each by name in the document description', () => {
    const { kml } = buildKml(kmlInput(all), true);
    const description = childrenNamed(documentOf(kml), 'description')[0].textContent!;
    expect(description).toContain('Left out, as they have no coordinates (27)');
    expect(description).toContain('Doña Unlocated Farmers');
    for (const record of raed.filter((r) => !isLocated(r))) {
      expect(description).toContain(placemarkName(record, data).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;'));
    }
    expect(featuresOf(kml).some((f) => f.properties?.RecordId === unlocatedAwkward.id)).toBe(false);
  });

  it('uses Google\'s colored dot on its own, as plain KML can\'t carry icons', () => {
    const { kml } = buildKml(kmlInput([awkward]), false);
    const color = recordColor(awkward, data);
    expect(kml).toContain(`<IconStyle><color>${kmlColor(color)}</color><scale>0.8</scale><Icon><href>https://maps.google.com/`);
    expect(kml).not.toContain('icons/');
  });

  it('writes elements in the order KML\'s schema requires', () => {
    const { kml } = buildKml(kmlInput([awkward, road, area], { layers: { municipalBoundaries: true, barangayBoundaries: true, gapMap: true } }), false);
    const order = (parent: string, expected: string[]) => {
      for (const element of Array.from(parseXml(kml).getElementsByTagName(parent))) {
        // Style and StyleMap count as one kind of element, and may mix.
        const names = Array.from(element.childNodes as unknown as Node[]).map((child) => (child.nodeName === 'StyleMap' ? 'Style' : child.nodeName)).filter((name) => expected.includes(name));
        const sorted = [...names].sort((a, b) => expected.indexOf(a) - expected.indexOf(b));
        expect(names, parent).toEqual(sorted);
      }
    };
    order('Placemark', ['name', 'Snippet', 'description', 'styleUrl', 'ExtendedData', 'Point', 'LineString', 'Polygon', 'MultiGeometry']);
    order('Document', ['name', 'open', 'Snippet', 'description', 'Style', 'Folder']);
    order('Folder', ['name', 'description', 'Folder', 'Placemark']);
    order('Style', ['IconStyle', 'LabelStyle', 'LineStyle', 'PolyStyle']);
    order('IconStyle', ['color', 'scale', 'Icon', 'hotSpot']);
    order('LineStyle', ['color', 'width']);
    order('Polygon', ['tessellate', 'outerBoundaryIs', 'innerBoundaryIs']);
  });

  describe('records with coordinates outside Marinduque', () => {
    const outside = () => raed.find((r) => r.qa_flags.includes('out_of_province'))!;
    const topFolders = (kml: string) => childrenNamed(documentOf(kml), 'Folder');
    const placemarkIds = (node: Element) =>
      Array.from(node.getElementsByTagName('Data'))
        .filter((data) => data.getAttribute('name') === 'RecordId')
        .map((data) => data.getElementsByTagName('value')[0].textContent);

    it('go in their own top-level folder, and no municipality folder', () => {
      const { kml, placemarks } = buildKml(kmlInput(raed), true);
      expect(placemarks).toBe(173);
      const [check, ...municipalities] = topFolders(kml);
      expect(folderName(check)).toBe('QA – needs location check');
      expect(placemarkIds(check)).toEqual(raed.filter((r) => r.qa_flags.includes('out_of_province')).map((r) => r.id));
      expect(childrenNamed(check, 'description')[0].textContent).toContain('outside Marinduque');
      for (const municipality of municipalities) expect(placemarkIds(municipality)).not.toContain(outside().id);
    });

    it('still have their coordinates, balloon and flag', () => {
      const { kml } = buildKml(kmlInput([outside()]), true);
      const feature = featuresOf(kml)[0];
      expect(feature.geometry).toEqual({ type: 'Point', coordinates: [...(outside().geojson as GeoJSON.Point).coordinates, 0] });
      expect(feature.properties?.QaFlags).toContain('Outside Marinduque');
      expect(feature.properties?.QaLocationCheck).toBe('Outside Marinduque');
    });

    it('are pointed out in the document description', () => {
      const { kml } = buildKml(kmlInput(raed), true);
      expect(childrenNamed(documentOf(kml), 'description')[0].textContent).toContain('1 record has coordinates outside Marinduque');
    });

    it('leave no empty folder, and no note, when there are none', () => {
      const { kml } = buildKml(kmlInput(raed.filter((r) => !r.qa_flags.includes('out_of_province'))), true);
      expect(topFolders(kml).map(folderName)).not.toContain('QA – needs location check');
      expect(kml).not.toContain('coordinates outside Marinduque');
    });

    it('are in the CSV, marked in its first column, with the QA flags next', () => {
      const parsed = Papa.parse<Record<string, string>>(buildCsv(raed, data).replace(/^\ufeff/, ''), { header: true, skipEmptyLines: true });
      expect(parsed.meta.fields?.slice(0, 2)).toEqual(['QA – needs location check', 'QA flags']);
      expect(parsed.data).toHaveLength(199);
      const marked = parsed.data.filter((row) => row['QA – needs location check'] !== '');
      expect(marked.map((row) => row['Record ID'])).toEqual([outside().id]);
      expect(marked[0]['QA – needs location check']).toBe('Outside Marinduque');
      expect(marked[0]['QA flags']).toContain('Outside Marinduque');
      expect(Number(marked[0].Longitude)).toBe((outside().geojson as GeoJSON.Point).coordinates[0]);
    });

    it('are in the Shapefile, marked in its first field, and explained in fields.txt', async () => {
      const built = await buildShapefile(raed, data, 'Marinduque_Test', new Date('2026-11-07T00:00:00Z'));
      const zip = await JSZip.loadAsync(built.zip);
      const collection = await readShapefile(await zip.files['Marinduque_Test.shp'].async('uint8array'), await zip.files['Marinduque_Test.dbf'].async('uint8array'), { encoding: 'utf-8' });
      expect(collection.features).toHaveLength(173);

      const names = Object.keys(collection.features[0].properties!);
      expect(names.slice(0, 2)).toEqual(['QALOCATION', 'QAFLAGS']);
      const marked = collection.features.filter((f) => f.properties?.QALOCATION);
      expect(marked).toHaveLength(1);
      expect(marked[0].properties?.QALOCATION).toBe('Outside Marinduque');
      expect(marked[0].geometry).toEqual(outside().geojson);
      const fieldsText = await zip.files['fields.txt'].async('string');
      expect(fieldsText).toContain('QALOCATION  QA – needs location check');
      expect(fieldsText).toContain('QAFLAGS     QA flags');
    });

    it('are in GeoJSON, marked the same way', () => {
      const parsed = JSON.parse(buildGeoJson(raed, data)) as GeoJSON.FeatureCollection;
      expect(parsed.features.filter((f) => f.properties?.QaLocationCheck).map((f) => f.id)).toEqual([outside().id]);
    });

    it('aren\'t confused with records that merely have no coordinates', () => {
      const { data: rows } = Papa.parse<Record<string, string>>(buildCsv(raed, data).replace(/^\ufeff/, ''), { header: true, skipEmptyLines: true });
      const unlocated = rows.filter((row) => row.Latitude === '');
      expect(unlocated).toHaveLength(26);
      expect(unlocated.every((row) => row['QA – needs location check'] === '')).toBe(true);
      expect(unlocated.every((row) => row['QA flags'].includes('No coordinates'))).toBe(true);
    });
  });

  it('keeps lines and polygons', () => {
    const { kml } = buildKml(kmlInput([road, area]), true);
    const features = featuresOf(kml);
    expect(features.map((f) => f.geometry?.type).sort()).toEqual(['LineString', 'Polygon']);
    expect(kml).toContain('<LineStyle>');
    expect(kml).toContain('<PolyStyle>');
  });
});

describe('optional KML layers', () => {
  const inFolder = (kml: string, ...path: string[]) => {
    let nodes = [documentOf(kml)];
    for (const name of path) nodes = nodes.flatMap((node) => childrenNamed(node, 'Folder')).filter((folder) => folderName(folder) === name);
    return nodes[0];
  };

  it('are absent unless asked for', () => {
    const { kml } = buildKml(kmlInput(raed), true);
    expect(childrenNamed(documentOf(kml), 'Folder').map(folderName)).not.toContain('Boundaries');
    expect(childrenNamed(documentOf(kml), 'Folder').map(folderName)).not.toContain('Barangay gap map');
    expect(kml).not.toContain('NAMRIA');
  });

  it('draw municipal and barangay boundaries as outlines, longitude first', () => {
    const { kml } = buildKml(kmlInput(raed, { layers: { municipalBoundaries: true, barangayBoundaries: true, gapMap: false } }), true);
    expect(childrenNamed(inFolder(kml, 'Boundaries', 'Municipal boundaries'), 'Placemark')).toHaveLength(6);
    const barangays = childrenNamed(inFolder(kml, 'Boundaries', 'Barangay boundaries'), 'Placemark');
    expect(barangays).toHaveLength(218);
    expect(kml).toContain('<Style id="outline-barangay"><LineStyle>');
    expect(kml).toContain('<PolyStyle><fill>0</fill></PolyStyle>');
    const [longitude, latitude] = barangays[0].getElementsByTagName('coordinates')[0].textContent!.trim().split(/\s+/)[0].split(',').map(Number);
    expect(longitude).toBeGreaterThan(121);
    expect(latitude).toBeLessThan(14);
    expect(kml).toContain('NAMRIA');
  });

  it('shade the gap map by count, with the count in each balloon', () => {
    const { kml } = buildKml(kmlInput(raed, { layers: { ...NO_LAYERS, gapMap: true } }), true);
    const gap = inFolder(kml, 'Barangay gap map');
    const placemarks = childrenNamed(gap, 'Folder').flatMap((folder) => childrenNamed(folder, 'Placemark'));
    expect(placemarks).toHaveLength(218);

    const counts = countByBarangay(raed, data.links);
    for (const barangay of data.barangays) {
      const municipality = childrenNamed(gap, 'Folder').find((f) => folderName(f) === data.municipalities.find((m) => m.id === barangay.municipality_id)!.name)!;
      const count = counts.get(barangay.id) ?? 0;
      const placemark = childrenNamed(municipality, 'Placemark').find((p) => folderName(p) === `${barangay.name}: ${count === 0 ? 'none encoded yet' : count}`);
      expect(placemark, barangay.name).toBeTruthy();
      expect(childrenNamed(placemark!, 'description')[0].textContent).toContain(`<th align="left">Interventions</th><td>${count}</td>`);
      expect(childrenNamed(placemark!, 'styleUrl')[0].textContent).toBe(count === 0 ? '#gap-none' : `#gap-${COUNT_BINS.findIndex((bin) => count >= bin.min && count <= bin.max) + 1}`);
    }
    expect(kml).toContain(`<Style id="gap-none"><LineStyle><color>${kmlColor('#6b6a66')}</color><width>1</width></LineStyle><PolyStyle><color>${kmlColor(GAP_NONE_COLOR, 0xb3)}</color>`);
    expect(kml).toContain('Shows what has been encoded, not what exists on the ground.');
  });

  it('cover only the export\'s own place', () => {
    const barangays = barangaysInScope(data.barangays, { municipalityId: gasan.id });
    const records = raed.filter((r) => r.municipality_id === gasan.id);
    const { kml } = buildKml(kmlInput(records, { layers: { municipalBoundaries: true, barangayBoundaries: true, gapMap: true }, barangays, municipalities: [gasan] }), true);
    expect(barangays.length).toBeGreaterThan(0);
    expect(childrenNamed(inFolder(kml, 'Boundaries', 'Municipal boundaries'), 'Placemark')).toHaveLength(1);
    expect(childrenNamed(inFolder(kml, 'Boundaries', 'Barangay boundaries'), 'Placemark')).toHaveLength(barangays.length);
    expect(childrenNamed(inFolder(kml, 'Barangay gap map'), 'Folder').map(folderName)).toEqual(['Gasan']);
  });
});

describe('KMZ', () => {
  const buildZip = async (records: Intervention[], layers = NO_LAYERS) => {
    const file = await buildExportFile({
      format: 'kmz',
      records,
      data,
      boundaries,
      layers,
      stem: 'Marinduque_Test',
      filterLines: [],
      exportedOn: TODAY,
      exportedBy: null,
      barangays: data.barangays,
      municipalities: data.municipalities,
      renderMarker,
    });
    return { file, zip: await JSZip.loadAsync(file.bytes) };
  };

  it('holds doc.kml first, at the top level, and an icons folder of real PNGs', async () => {
    const { zip, file } = await buildZip(raed);
    expect(file.fileName).toBe('Marinduque_Test.kmz');
    const names = Object.keys(zip.files);
    expect(names[0]).toBe('doc.kml');
    const icons = names.filter((name) => name.endsWith('.png'));
    expect(icons.length).toBeGreaterThan(1);
    for (const name of icons) {
      expect(name.startsWith('icons/')).toBe(true);
      const bytes = await zip.files[name].async('uint8array');
      expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
      const image = await loadImage(Buffer.from(bytes));
      expect(image.width).toBe(MARKER_SIZE);
    }
    expect(names.some((name) => /\.(jpe?g|heic|webp)$/i.test(name))).toBe(false);
  });

  it('points every placemark at an icon that is in the file, by relative path', async () => {
    const { zip } = await buildZip(raed);
    const kml = await zip.files['doc.kml'].async('string');
    const hrefs = [...kml.matchAll(/<href>([^<]+)<\/href>/g)].map((match) => match[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^icons\//);
      expect(zip.files[href], href).toBeTruthy();
    }
    const styles = new Set([...kml.matchAll(/<StyleMap id="([^"]+)"/g)].map((match) => match[1]));
    for (const [, used] of kml.matchAll(/<Placemark><name>.*?<styleUrl>#([^<]+)<\/styleUrl>/g)) expect(styles.has(used)).toBe(true);
  });

  it('round-trips the count, coordinates, fields and ñ', async () => {
    const { zip } = await buildZip(all);
    const features = featuresOf(await zip.files['doc.kml'].async('string'));
    expect(features).toHaveLength(174);
    const back = features.find((f) => f.properties?.RecordId === awkward.id)!;
    expect(back.properties?.Beneficiary).toBe(AWKWARD_NAME);
    expect(back.properties?.Remarks).toBe(LONG_REMARK);
    expect(back.geometry).toEqual({ type: 'Point', coordinates: [121.87836, 13.340199, 0] });
  });

  it('uses the same icon and color as the map marker', async () => {
    const { zip } = await buildZip([awkward]);
    const icon = recordIcon(awkward, data)!.name.toLowerCase();
    const color = recordColor(awkward, data).slice(1);
    expect(zip.files[`icons/${icon}-${color}.png`]).toBeTruthy();
  });
});

describe('CSV', () => {
  const parse = (text: string) => Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: true });

  it('starts with the UTF-8 mark Excel needs, as real bytes', async () => {
    const file = await buildExportFile({
      format: 'csv',
      records: all,
      data,
      boundaries,
      layers: NO_LAYERS,
      stem: 'Marinduque_Test',
      filterLines: [],
      exportedOn: TODAY,
      exportedBy: null,
      barangays: [],
      municipalities: [],
      renderMarker,
    });
    expect(Array.from(file.bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(file.bytes)).toContain('Doña Unlocated Farmers');
    expect(file.fileName).toBe('Marinduque_Test.csv');
  });

  it('includes unlocated records, with separate latitude and longitude columns', () => {
    const { data: rows, errors } = parse(buildCsv(all, data));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(201);
    expect(rows.filter((row) => row.Latitude === '' && row.Longitude === '')).toHaveLength(27);

    const back = rows.find((row) => row['Record ID'] === awkward.id)!;
    expect(Number(back.Latitude)).toBe(13.340199);
    expect(Number(back.Longitude)).toBe(121.87836);
    expect(rows.find((row) => row['Record ID'] === unlocatedAwkward.id)!.Beneficiary).toBe('Doña Unlocated Farmers');
  });

  it('round-trips awkward values, and stops a value running as a formula', () => {
    const { data: rows } = parse(buildCsv(all, data));
    const back = rows.find((row) => row['Record ID'] === awkward.id)!;
    expect(back.Beneficiary).toBe(AWKWARD_NAME);
    expect(back.Remarks).toBe(LONG_REMARK);
    expect(back['Serial No.']).toBe('SN-Ñ-1');
    expect(back['Engine No.']).toBe("'=1+1");
    expect(back.leftover_field).toBe('kept');
  });

  it('keeps every real record\'s values', () => {
    const { data: rows } = parse(buildCsv(raed, data));
    for (const record of raed) {
      const back = rows.find((row) => row['Record ID'] === record.id)!;
      expect(back.Beneficiary).toBe(record.beneficiary);
      expect(back['Year funded']).toBe(String(record.year_funded));
      expect(back['Source ID']).toBe(record.source_id);
    }
  });
});

describe('GeoJSON', () => {
  it('round-trips every record, with no geometry where there are no coordinates', () => {
    const parsed = JSON.parse(buildGeoJson(all, data)) as GeoJSON.FeatureCollection;
    expect(parsed.type).toBe('FeatureCollection');
    expect(parsed.features).toHaveLength(201);
    expect(parsed.features.filter((f) => f.geometry === null)).toHaveLength(27);

    const back = parsed.features.find((f) => f.id === awkward.id)!;
    expect(back.geometry).toEqual({ type: 'Point', coordinates: [121.87836, 13.340199] });
    expect(back.properties).toMatchObject({ Beneficiary: AWKWARD_NAME, SerialNo: 'SN-Ñ-1', Latitude: 13.340199, Longitude: 121.87836 });
    expect(parsed.features.find((f) => f.id === unlocatedAwkward.id)!.properties?.Beneficiary).toBe('Doña Unlocated Farmers');
  });

  it('keeps numbers as numbers', () => {
    const parsed = JSON.parse(buildGeoJson([awkward, road], data)) as GeoJSON.FeatureCollection;
    expect(parsed.features[0].properties?.YearFunded).toBe(awkward.year_funded);
    expect(parsed.features[1].properties?.LengthKm).toBe(1.25);
  });
});

describe('Shapefile', () => {
  const openZip = async (records: Intervention[]) => {
    const built = await buildShapefile(records, data, 'Marinduque_Test', new Date('2026-11-07T00:00:00Z'));
    return { built, zip: await JSZip.loadAsync(built.zip) };
  };
  const readBack = async (zip: JSZip, base = 'Marinduque_Test') =>
    readShapefile(await zip.files[`${base}.shp`].async('uint8array'), await zip.files[`${base}.dbf`].async('uint8array'), { encoding: 'utf-8' });

  it('holds all five parts and the field list', async () => {
    const { zip } = await openZip(raed);
    expect(Object.keys(zip.files).sort()).toEqual(
      ['Marinduque_Test.cpg', 'Marinduque_Test.dbf', 'Marinduque_Test.prj', 'Marinduque_Test.shp', 'Marinduque_Test.shx', 'fields.txt', 'records-left-out.txt'].sort(),
    );
    expect(await zip.files['Marinduque_Test.cpg'].async('string')).toBe('UTF-8');
    expect(await zip.files['Marinduque_Test.prj'].async('string')).toContain('GCS_WGS_1984');
  });

  it('round-trips the count, coordinates and fields of every located record', async () => {
    const { built, zip } = await openZip(raed);
    expect(built.written).toBe(173);
    const collection = await readBack(zip);
    expect(collection.features).toHaveLength(173);

    const names = shortFieldNames(buildFields(raed, data).map((field) => field.key));
    for (const record of raed.filter(isLocated)) {
      const feature = collection.features.find((f) => f.properties?.[names.get('RecordId')!] === record.id)!;
      expect(feature.geometry).toEqual(record.geojson);
      expect(feature.properties?.[names.get('Beneficiary')!]).toBe(record.beneficiary);
      expect(feature.properties?.[names.get('YearFunded')!]).toBe(record.year_funded);
      expect(feature.properties?.[names.get('Latitude')!]).toBeCloseTo((record.geojson as GeoJSON.Point).coordinates[1], 7);
    }
  });

  it('keeps ñ, and cuts an overlong value on a whole letter, saying so', async () => {
    const { zip } = await openZip([awkward]);
    const names = shortFieldNames(buildFields([awkward], data).map((field) => field.key));
    const { features } = await readBack(zip);
    expect(features[0].properties?.[names.get('Beneficiary')!]).toBe(AWKWARD_NAME);
    expect(features[0].properties?.[names.get('SerialNo')!]).toBe('SN-Ñ-1');

    const remarks = features[0].properties?.[names.get('Remarks')!] as string;
    expect(LONG_REMARK.startsWith(remarks.trimEnd())).toBe(true);
    expect(new TextEncoder().encode(remarks).length).toBeLessThanOrEqual(254);
    expect(remarks).not.toContain('�');
    expect(await zip.files['fields.txt'].async('string')).toMatch(/cut short in: Remarks/);
  });

  it('maps every 10-character name to its full name in fields.txt', async () => {
    const { zip } = await openZip(all);
    const text = await zip.files['fields.txt'].async('string');
    const fields = buildFields(all, data);
    const names = shortFieldNames(fields.map((field) => field.key));
    expect(new Set(names.values()).size).toBe(fields.length);
    for (const field of fields) {
      const short = names.get(field.key)!;
      expect(short.length).toBeLessThanOrEqual(10);
      expect(short).toMatch(/^[A-Z0-9_]+$/);
      expect(text).toContain(`${short.padEnd(10)}  ${field.label}`);
    }
    expect(names.get('Beneficiary')).not.toBe(names.get('BeneficiaryType'));
  });

  it('leaves out records without coordinates, and lists them by name', async () => {
    const { built, zip } = await openZip(all);
    expect(built.leftOut).toHaveLength(27);
    const text = await zip.files['records-left-out.txt'].async('string');
    expect(text).toContain('Doña Unlocated Farmers');
    expect(text).toContain('27 records');
    expect(await zip.files['fields.txt'].async('string')).toContain('27 records aren\'t in the shapefile');
    expect((await readBack(zip)).features).toHaveLength(174);
  });

  it('has no list of left-out records when none are', async () => {
    const { zip } = await openZip([awkward]);
    expect(zip.files['records-left-out.txt']).toBeUndefined();
  });

  it('writes one set per geometry kind, and reads back lines and holes', async () => {
    const { zip } = await openZip([awkward, road, area]);
    const points = await readBack(zip, 'Marinduque_Test_points');
    const lines = await readBack(zip, 'Marinduque_Test_lines');
    const polygons = await readBack(zip, 'Marinduque_Test_polygons');
    expect(points.features).toHaveLength(1);
    expect(lines.features[0].geometry).toEqual(road.geojson);

    const polygon = polygons.features[0].geometry as GeoJSON.Polygon;
    expect(polygon.type).toBe('Polygon');
    expect(polygon.coordinates).toHaveLength(2);
    const area_ = (ring: number[][]) => Math.abs(ring.reduce((sum, [x, y], i) => sum + x * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * y, 0) / 2);
    expect(area_(polygon.coordinates[0])).toBeCloseTo(0.01, 6);
    expect(area_(polygon.coordinates[1])).toBeCloseTo(0.0016, 6);
  });

  it('lists a shape it can\'t hold, rather than dropping it', async () => {
    const odd: Intervention = { ...road, id: 'aaaaaaaa-0000-4000-8000-000000000005', geojson: { type: 'MultiPoint', coordinates: [[121.9, 13.4]] } };
    const { built, zip } = await openZip([awkward, odd]);
    expect(built.leftOut.map((r) => r.id)).toEqual([odd.id]);
    expect(await zip.files['records-left-out.txt'].async('string')).toContain('a shape a shapefile can\'t hold');
  });

  it('writes a valid index for each shape', async () => {
    const { zip } = await openZip(raed);
    const shx = new DataView((await zip.files['Marinduque_Test.shx'].async('uint8array')).buffer);
    const shp = new DataView((await zip.files['Marinduque_Test.shp'].async('uint8array')).buffer);
    expect(shx.getInt32(0, false)).toBe(9994);
    expect(shx.byteLength).toBe(100 + 173 * 8);
    expect(shp.getInt32(24, false) * 2).toBe(shp.byteLength);
    expect(shp.getInt32(32, true)).toBe(1);
    for (let i = 0; i < 173; i++) {
      const offset = shx.getInt32(100 + i * 8, false) * 2;
      expect(shp.getInt32(offset, false)).toBe(i + 1);
      expect(shp.getInt32(offset + 8, true)).toBe(1);
    }
  });
});

describe('what an export takes', () => {
  const select = (view: Partial<ViewFilters>, extra: { barangayId?: number; mapBounds?: { west: number; south: number; east: number; north: number } } = {}) =>
    selectExportRecords(raed, data.links, { view: { ...NO_FILTERS, ...view }, ...extra }, data);
  const shown = (view: Partial<ViewFilters>) => visibleRecords(raed, { ...NO_FILTERS, ...view }, data.links);

  it('matches the map\'s own filters exactly, for each kind of filter', () => {
    const machinery = data.types.find((t) => t.code === 'farm-machinery')!.id;
    const ssip = data.types.find((t) => t.code === 'ssip')!.id;
    const rice = data.programs.find((p) => p.code === 'rice')!.id;
    const views: [Partial<ViewFilters>, (r: Intervention) => boolean][] = [
      [{}, () => true],
      [{ hiddenTypeIds: [ssip] }, (r) => r.intervention_type_id === machinery],
      [{ mode: 'type', pickedTypeId: ssip }, (r) => r.intervention_type_id === ssip],
      [{ programId: rice }, (r) => r.banner_program_id === rice],
      [{ mode: 'program', pickedProgramId: rice }, (r) => r.banner_program_id === rice],
      [{ yearFrom: 2020 }, (r) => r.year_funded !== null && r.year_funded >= 2020],
      [{ yearTo: 2019 }, (r) => r.year_funded !== null && r.year_funded <= 2019],
      [{ yearFrom: 2018, yearTo: 2020 }, (r) => r.year_funded! >= 2018 && r.year_funded! <= 2020],
      [{ municipalityId: gasan.id }, (r) => r.municipality_id === gasan.id],
      [{ municipalityId: gasan.id, programId: rice, hiddenTypeIds: [ssip] }, (r) => r.municipality_id === gasan.id && r.banner_program_id === rice && r.intervention_type_id === machinery],
    ];
    for (const [view, expected] of views) {
      const records = select(view);
      expect(records.map((r) => r.id).sort()).toEqual(raed.filter(expected).map((r) => r.id).sort());
      expect(records).toEqual(shown(view));
      expect(records.length, JSON.stringify(view)).toBeGreaterThan(0);
    }
  });

  it('writes exactly those records to the file', () => {
    const records = select({ municipalityId: gasan.id });
    expect(records).toHaveLength(33);
    expect(Papa.parse(buildCsv(records, data).replace(/^﻿/, ''), { header: true, skipEmptyLines: true }).data).toHaveLength(33);
    expect((JSON.parse(buildGeoJson(records, data)) as GeoJSON.FeatureCollection).features).toHaveLength(33);
    const located = records.filter(isLocated).length;
    expect(featuresOf(buildKml(kmlInput(records), true).kml)).toHaveLength(located);
  });

  it('takes a barangay the way its profile does, by link', () => {
    const link = data.links.find((l) => l.link_source === 'spatial' && !data.links.some((o) => o.intervention_id === l.intervention_id && o.link_source === 'encoded' && o.barangay_id === l.barangay_id)) ?? data.links[0];
    const linked = new Set(data.links.filter((l) => l.barangay_id === link.barangay_id).map((l) => l.intervention_id));
    expect(select({}, { barangayId: link.barangay_id }).map((r) => r.id).sort()).toEqual(raed.filter((r) => linked.has(r.id)).map((r) => r.id).sort());
    // The same through the map's filter.
    const municipality = data.barangays.find((b) => b.id === link.barangay_id)!.municipality_id;
    expect(shown({ municipalityId: null, barangayId: link.barangay_id }).length).toBe(linked.size);
    expect(municipality).toBeGreaterThan(0);
  });

  it('still applies the other filters to a barangay\'s export', () => {
    const barangayId = data.links[0].barangay_id;
    const year = raed.find((r) => r.id === data.links[0].intervention_id)!.year_funded!;
    const records = select({ yearFrom: year + 100 }, { barangayId });
    expect(records).toEqual([]);
  });

  it('limits to the map view, which no record without coordinates can be in', () => {
    const mapBounds = { west: 121.8, south: 13.3, east: 121.95, north: 13.45 };
    const records = select({}, { mapBounds });
    expect(records.length).toBeGreaterThan(0);
    expect(records.length).toBeLessThan(173);
    for (const record of records) {
      const [longitude, latitude] = (record.geojson as GeoJSON.Point).coordinates;
      expect(longitude).toBeGreaterThanOrEqual(mapBounds.west);
      expect(longitude).toBeLessThanOrEqual(mapBounds.east);
      expect(latitude).toBeGreaterThanOrEqual(mapBounds.south);
      expect(latitude).toBeLessThanOrEqual(mapBounds.north);
    }
    const outside = raed.filter((r) => isLocated(r) && !records.includes(r));
    for (const record of outside) {
      const { west, east, south, north } = geometryBounds(record.geojson!);
      expect(west > mapBounds.east || east < mapBounds.west || south > mapBounds.north || north < mapBounds.south).toBe(true);
    }
  });

  it('counts a line or polygon as in view if any of it is', () => {
    const mapBounds = { west: 121.94, south: 13.44, east: 121.96, north: 13.46 };
    const inside = selectExportRecords([road], data.links, { view: { ...NO_FILTERS }, mapBounds }, data);
    expect(inside).toEqual([road]);
    const away = { west: 121, south: 12, east: 121.1, north: 12.1 };
    expect(selectExportRecords([road], data.links, { view: { ...NO_FILTERS }, mapBounds: away }, data)).toEqual([]);
  });

  it('never takes deleted records or inactive types', () => {
    const deleted = { ...awkward, id: 'aaaaaaaa-0000-4000-8000-00000000000a', deleted_at: '2026-01-01T00:00:00Z' };
    const live = liveRecords([...data.interventions, deleted, road], data.types);
    expect(live).toHaveLength(199);
    expect(live.some((r) => r.id === deleted.id || r.id === road.id)).toBe(false);
  });

  it('keeps an out-of-province record, which has coordinates, with its flag showing', () => {
    const outside = raed.find((r) => r.qa_flags.includes('out_of_province'))!;
    expect(select({}).includes(outside)).toBe(true);
    const feature = featuresOf(buildKml(kmlInput([outside]), true).kml)[0];
    expect(feature.properties?.QaFlags).toContain('Outside Marinduque');
  });
});

describe('file names', () => {
  const stem = (view: Partial<ViewFilters>, extra: { barangayId?: number; mapBounds?: { west: number; south: number; east: number; north: number } } = {}) =>
    exportFileStem(describeFilters({ view: { ...NO_FILTERS, ...view }, ...extra }, data), TODAY);

  it('follows Marinduque_<scope>_<date>', () => {
    const ssip = data.types.find((t) => t.code === 'ssip')!.id;
    const machinery = data.types.find((t) => t.code === 'farm-machinery')!.id;
    const rice = data.programs.find((p) => p.code === 'rice')!.id;
    const santaCruz = data.municipalities.find((m) => m.name === 'Santa Cruz')!.id;
    expect(stem({})).toBe('Marinduque_Province_2026-11-07');
    expect(stem({ municipalityId: gasan.id, hiddenTypeIds: [ssip] })).toBe('Marinduque_Gasan_FarmMachinery_2026-11-07');
    expect(stem({ hiddenTypeIds: [machinery], programId: rice })).toBe('Marinduque_SSIP_RiceProgram_2026-11-07');
    expect(stem({ municipalityId: santaCruz })).toBe('Marinduque_SantaCruz_2026-11-07');
    expect(stem({ yearFrom: 2020, yearTo: 2024 })).toBe('Marinduque_2020-2024_2026-11-07');
    expect(stem({ yearFrom: 2020, yearTo: 2020 })).toBe('Marinduque_2020_2026-11-07');
    expect(stem({ yearFrom: 2020 })).toBe('Marinduque_From2020_2026-11-07');
    expect(stem({}, { mapBounds: { west: 0, south: 0, east: 1, north: 1 } })).toBe('Marinduque_MapView_2026-11-07');
  });

  it('names a barangay with its municipality', () => {
    const barangay = data.barangays.find((b) => b.municipality_id === gasan.id)!;
    expect(stem({}, { barangayId: barangay.id })).toBe(`Marinduque_Gasan_${barangay.name.replace(/[^A-Za-z0-9]+/g, '')}_2026-11-07`);
  });

  it('turns ñ and punctuation into plain letters', () => {
    const filters = describeFilters({ view: { ...NO_FILTERS } }, data);
    expect(exportFileStem({ ...filters, municipality: 'Peñón de Sta. Cruz' }, TODAY)).toBe('Marinduque_PenonDeStaCruz_2026-11-07');
  });

  it('describes the filters in words', () => {
    const rice = data.programs.find((p) => p.code === 'rice')!.id;
    expect(filterLines(describeFilters({ view: { ...NO_FILTERS } }, data))).toEqual([]);
    expect(filterLines(describeFilters({ view: { ...NO_FILTERS, programId: rice, municipalityId: gasan.id, yearFrom: 2020 } }, data))).toEqual([
      'Municipality: Gasan',
      'Program: Rice Program',
      'Year funded: From 2020',
    ]);
  });
});

describe('the map\'s place filters', () => {
  it('shade and count only that place, so the rest aren\'t shown as gaps', () => {
    const scoped = barangaysInScope(data.barangays, { municipalityId: gasan.id });
    const inside = scoped[0];
    const outside = data.barangays.find((b: Barangay) => b.municipality_id !== gasan.id)!;

    for (const mode of ['gap', 'count'] as const) {
      const shading = buildShading(mode, 'Test', new Map(), scoped);
      expect(shading.fillFor(inside.id).opacity).toBeGreaterThan(0);
      expect(shading.fillFor(outside.id).opacity).toBe(0);
      expect(shading.barangaysWithout).toBe(scoped.length);
    }
    expect(barangaysInScope(data.barangays, { municipalityId: gasan.id, barangayId: inside.id })).toEqual([inside]);
    expect(barangaysInScope(data.barangays, {})).toHaveLength(218);
  });
});

describe('the export log', () => {
  const ENTRY = { format: 'kmz', file_name: 'Marinduque_Gasan_2026-11-07.kmz', filters: { municipality: 'Gasan', program: null }, record_count: 33 };
  const storeAs = (id: string, role: 'admin' | 'encoder' | 'viewer') => createSupabaseStore(createPgliteBackend(db, id), { id, full_name: role, role });
  const lastLogged = async () =>
    (await db.query<{ table_name: string; action: string; actor_id: string; context: Record<string, unknown> }>(`select table_name, action, actor_id, context from audit_log where action = 'export' order by id desc limit 1`)).rows[0];

  it.each([
    ['Viewer', VIEWER, 'viewer'],
    ['Encoder', ENCODER, 'encoder'],
    ['Admin', ADMIN, 'admin'],
  ] as const)('records who, the format, the filters and the count, for a %s', async (_label, id, role) => {
    await storeAs(id, role).logExport(ENTRY);
    expect(await lastLogged()).toEqual({ table_name: 'exports', action: 'export', actor_id: id, context: ENTRY });
  });

  it('refuses an account with no role, and a deactivated one, and visitors', async () => {
    await expect(storeAs(STRANGER, 'viewer').logExport(ENTRY)).rejects.toThrow(/permission/);

    await db.query(`insert into auth.users (id) values ('f0000000-0000-4000-8000-000000000005')`);
    await db.query(`insert into profiles (id, full_name, role, deactivated_at) values ('f0000000-0000-4000-8000-000000000005', 'Gone', 'viewer', now())`);
    await expect(storeAs('f0000000-0000-4000-8000-000000000005', 'viewer').logExport(ENTRY)).rejects.toThrow(/permission/);

    await db.exec('begin');
    await db.exec('set local role anon');
    await expect(db.query(`select public.log_export('kmz', 'x', '{}', 1)`)).rejects.toThrow(/permission denied/);
    await db.exec('rollback');
  });

  it('won\'t let a person name someone else, as the login decides who', async () => {
    const before = await db.query<{ n: number }>(`select count(*)::int as n from audit_log where action = 'export' and actor_id = $1`, [ADMIN]);
    await storeAs(VIEWER, 'viewer').logExport({ ...ENTRY, filters: { actor_id: ADMIN } });
    const after = await db.query<{ n: number }>(`select count(*)::int as n from audit_log where action = 'export' and actor_id = $1`, [ADMIN]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect((await lastLogged()).actor_id).toBe(VIEWER);
  });

  it('refuses nonsense', async () => {
    const store = storeAs(VIEWER, 'viewer');
    await expect(store.logExport({ ...ENTRY, format: 'exe' })).rejects.toThrow(/format/);
    await expect(store.logExport({ ...ENTRY, record_count: -1 })).rejects.toThrow(/count/);
    await expect(store.logExport({ ...ENTRY, file_name: 'x'.repeat(300) })).rejects.toThrow(/too long/);
    await expect(store.logExport({ ...ENTRY, filters: { padding: 'x'.repeat(5000) } })).rejects.toThrow(/too long/);
  });

  it('keeps the log itself away from Viewers and Encoders, and the only way in is the function', async () => {
    await storeAs(VIEWER, 'viewer').logExport(ENTRY);
    const attempt = async (id: string, sql: string) => {
      await db.exec('begin');
      try {
        await db.exec('set local role authenticated');
        await db.query(`select set_config('request.jwt.sub', $1, true)`, [id]);
        return (await db.query<{ n: number }>(sql)).rows;
      } finally {
        await db.exec('rollback');
      }
    };
    expect((await attempt(VIEWER, 'select count(*)::int as n from audit_log'))[0].n).toBe(0);
    expect((await attempt(ENCODER, 'select count(*)::int as n from audit_log'))[0].n).toBe(0);
    expect((await attempt(ADMIN, `select count(*)::int as n from audit_log where action = 'export'`))[0].n).toBeGreaterThan(0);
    await expect(attempt(VIEWER, `insert into audit_log (table_name, action) values ('exports', 'export') returning 1 as n`)).rejects.toThrow(/permission denied/);
  });

  it('doesn\'t change the data or send a live signal', async () => {
    const { rows: before } = await db.query<{ n: number }>(`select count(*)::int as n from realtime.messages`);
    const { rows: versions } = await db.query<{ total: number }>('select sum(version)::int as total from interventions');
    await storeAs(VIEWER, 'viewer').logExport(ENTRY);
    expect((await db.query<{ n: number }>('select count(*)::int as n from realtime.messages')).rows[0].n).toBe(before[0].n);
    expect((await db.query<{ total: number }>('select sum(version)::int as total from interventions')).rows[0].total).toBe(versions[0].total);
  });

  it('works the same way in local mode, without counting as a change', () => {
    const state = stateFromSeed(JSON.parse(JSON.stringify({ lookups: { icons: [], programs: [], categories: [], statuses: [], location_bases: [], beneficiary_types: [], intervention_types: [], intervention_type_statuses: [], barangay_field_schema: [] }, municipalities: [], barangays: [], interventions: [], intervention_barangays: [], status_history: [], import_batches: [] })) as LocalSeed, 'test');
    engine.logExport(state.rows, { now: () => '2026-11-07T00:00:00Z' } as Parameters<typeof engine.logExport>[1], ENTRY);
    expect(state.rows.auditLog.at(-1)).toMatchObject({ table_name: 'exports', action: 'export', context: ENTRY });
    expect(state.rows.changeCount).toBe(0);
  });
});

