// Reading files, guessing columns and building records for the import wizard. The RAED source file
// goes through the same path as any import, and has to come out as the seed stored it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildLocalSeed } from '../scripts/build-local-seed';
import { loadSeedFiles, seedInterventions } from '../scripts/seed-interventions';
import { toMapData, type LocalSeed } from '../src/modules/intervention-map/data/local-store';
import type { MapData } from '../src/modules/intervention-map/data/types';
import { buildPreview, dateFrom, summarize, unmatchedValues, type ImportSettings } from '../src/modules/intervention-map/import/build';
import { guessMapping, targetsFor } from '../src/modules/intervention-map/import/fields';
import { fileKind, MAP_FILE_LATITUDE, MAP_FILE_LONGITUDE, parseCsv, parseGeoJson, parseMapFile, parseWorkbook, uniqueColumns, type ParsedFile } from '../src/modules/intervention-map/import/parse';
import { buildPlaceIndex, locateShape, type PlaceIndex } from '../src/modules/intervention-map/lib/qa';
import { lineLengthKm } from '../src/modules/intervention-map/lib/roads';
import { createTestDb } from './helpers/db';

let db: PGlite;
let data: MapData;
let places: PlaceIndex;

const boundary = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'boundaries', `${name}.geojson`), 'utf8')) as GeoJSON.FeatureCollection;

beforeAll(async () => {
  db = await createTestDb();
  await seedInterventions(db, loadSeedFiles().rows, []);
  data = toMapData(JSON.parse(JSON.stringify(await buildLocalSeed(db))) as LocalSeed);
  places = buildPlaceIndex({ barangays: boundary('barangays'), municipalities: boundary('municipalities') }, data);
}, 180_000);

afterAll(async () => {
  await db.close();
});

const machinery = () => data.types.find((type) => type.code === 'farm-machinery')!;
const turnedOver = () => data.statuses.find((status) => status.name === 'Turned-over')!.id;
const settings = (over: Partial<ImportSettings> = {}): ImportSettings => ({
  type: machinery(),
  dataSource: 'ABEMIS export',
  mapping: {},
  choices: {},
  defaultStatusId: turnedOver(),
  statusDate: '2026-10-01',
  ...over,
});
const emptyMap = () => ({ ...data, interventions: [] });

describe('reading a file', () => {
  it('finds the header under a title, numbers repeated columns, and keeps each row\'s own number', () => {
    const csv = '﻿Marinduque machinery,,\n,,\nBeneficiary,Barangay,Barangay\nBantad FCA,Bantad,x\n,,\nTumapon FA,Tumapon,y\n,,\n';
    const file = parseCsv('list.csv', csv);
    expect(file.columns).toEqual(['Beneficiary', 'Barangay', 'Barangay (2)']);
    expect(file.rows.map((row) => row.Beneficiary)).toEqual(['Bantad FCA', 'Tumapon FA']);
    expect(file.rowNumbers).toEqual([4, 6]);
    expect(file.notes[0]).toMatch(/row 3/);
    expect(uniqueColumns(['', 'A', 'a'])).toEqual(['Column 1', 'A', 'a (2)']);
  });

  it('reads the first sheet of a workbook with something on it, with dates as dates', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Empty');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Beneficiary', 'Date turned over', 'Cost'], ['Bantad FCA', new Date(Date.UTC(2024, 2, 5)), 1250000]]), 'Machinery');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const file = await parseWorkbook('abemis.xlsx', bytes);
    expect(file.sheet).toBe('Machinery');
    expect(file.rows).toEqual([{ Beneficiary: 'Bantad FCA', 'Date turned over': '2024-03-05', Cost: '1250000' }]);
    expect(file.notes[0]).toMatch(/1 other sheet/);
  });

  it('reads a map file\'s placemarks, with their points as columns, from KML or KMZ', async () => {
    (globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
    const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>Bantad FCA</name><ExtendedData><Data name="Category"><value>Hand Tractor</value></Data></ExtendedData><Point><coordinates>121.85,13.45,0</coordinates></Point></Placemark>
      <Placemark><name>Road</name><LineString><coordinates>121.8,13.4 121.9,13.5</coordinates></LineString></Placemark>
    </Document></kml>`;
    const file = await parseMapFile('pins.kml', 'kml', new TextEncoder().encode(kml).buffer as ArrayBuffer);
    expect(file.rows[0]).toMatchObject({ name: 'Bantad FCA', Category: 'Hand Tractor', [MAP_FILE_LATITUDE]: '13.45', [MAP_FILE_LONGITUDE]: '121.85' });
    expect(file.rows[1][MAP_FILE_LATITUDE]).toBe('');
    expect(file.rowNumbers).toEqual([1, 2]);
    // The line comes beside its row (Phase 16c).
    expect(file.lines).toEqual([null, [[[121.8, 13.4], [121.9, 13.5]]]]);
    expect(file.notes[0]).toMatch(/^1 placemark is a line\./);

    const zip = new JSZip();
    zip.file('doc.kml', kml);
    const kmz = await parseMapFile('pins.kmz', 'kmz', await zip.generateAsync({ type: 'arraybuffer' }));
    expect(kmz.rows).toHaveLength(2);
  });

  // Phase 16c: roads from a map file.
  it("reads a map file's lines beside its rows, in one part or several, without heights", async () => {
    (globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
    const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>Farm road A</name><LineString><coordinates>121.85,13.45,10 121.851,13.451,12</coordinates></LineString></Placemark>
      <Placemark><name>Farm road B</name><MultiGeometry>
        <LineString><coordinates>121.85,13.45 121.851,13.451</coordinates></LineString>
        <LineString><coordinates>121.852,13.452 121.853,13.453</coordinates></LineString>
      </MultiGeometry></Placemark>
    </Document></kml>`;
    const roads = await parseMapFile('roads.kml', 'kml', new TextEncoder().encode(kml).buffer as ArrayBuffer);
    // No points, so no coordinate columns.
    expect(roads.columns).toEqual(['name']);
    expect(roads.lines).toEqual([
      [[[121.85, 13.45], [121.851, 13.451]]],
      [[[121.85, 13.45], [121.851, 13.451]], [[121.852, 13.452], [121.853, 13.453]]],
    ]);
    expect(roads.notes).toEqual([expect.stringMatching(/^2 placemarks are lines\./)]);

    const geojson = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { Title: 'Road one', Municipality: 'Boac' }, geometry: { type: 'LineString', coordinates: [[121.85, 13.45, 0], [121.851, 13.451, 0]] } },
        { type: 'Feature', properties: { Title: 'Road two' }, geometry: { type: 'MultiLineString', coordinates: [[[121.85, 13.45], [121.851, 13.451]]] } },
        { type: 'Feature', properties: { Title: 'Road three', Survey: { by: 'MAO' } }, geometry: { type: 'MultiLineString', coordinates: [[[121.85, 13.45], [121.851, 13.451]], [[121.852, 13.452], [121.853, 13.453]]] } },
        { type: 'Feature', properties: { Title: 'A pump' }, geometry: { type: 'Point', coordinates: [121.85, 13.45] } },
        { type: 'Feature', properties: { Title: 'A field' }, geometry: { type: 'Polygon', coordinates: [[[121.85, 13.45], [121.851, 13.45], [121.851, 13.451], [121.85, 13.45]]] } },
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[121.85, 13.45], [121.851, 13.451]] } },
        { type: 'Feature', properties: {}, geometry: null },
      ],
    };
    const file = parseGeoJson('roads.geojson', JSON.stringify(geojson));
    expect(file.kind).toBe('geojson');
    expect(file.columns).toEqual(['Title', 'Municipality', 'Survey', MAP_FILE_LATITUDE, MAP_FILE_LONGITUDE]);
    // A feature with only a line still counts, and one with nothing at all is left out.
    expect(file.rowNumbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(file.rows[2].Survey).toBe('{"by":"MAO"}');
    expect(file.rows[3]).toMatchObject({ Title: 'A pump', [MAP_FILE_LATITUDE]: '13.45', [MAP_FILE_LONGITUDE]: '121.85' });
    expect(file.lines!.map((line) => line?.length ?? null)).toEqual([1, 1, 2, null, null, 1]);
    expect(file.lines![0]).toEqual([[[121.85, 13.45], [121.851, 13.451]]]);
    expect(file.notes).toEqual([expect.stringMatching(/^4 features are lines\./), expect.stringMatching(/^1 feature is a point/), expect.stringMatching(/^1 feature is an area/)]);
    expect([fileKind('roads.geojson'), fileKind('roads.json')]).toEqual(['geojson', 'geojson']);
  });

  it('refuses a GeoJSON file in another coordinate system, a damaged one, and one that isn\'t GeoJSON', () => {
    const line = (coordinates: number[][]) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] });
    // Metres, as a file saved in UTM zone 51N has them.
    expect(() => parseGeoJson('utm.geojson', JSON.stringify(line([[380000, 1487000], [381000, 1488000]])))).toThrow(/WGS 84/);
    expect(() => parseGeoJson('named.geojson', JSON.stringify({ ...line([[121.85, 13.45], [121.86, 13.46]]), crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32651' } } }))).toThrow(/WGS 84/);
    expect(parseGeoJson('crs84.geojson', JSON.stringify({ ...line([[121.85, 13.45], [121.86, 13.46]]), crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } } })).rows).toHaveLength(1);
    expect(() => parseGeoJson('broken.geojson', '{"type":')).toThrow(/couldn't be read/);
    expect(() => parseGeoJson('other.json', '{"name":"not a map"}')).toThrow(/isn't GeoJSON/);
  });

  it('reads dates as a sheet might hold them, and refuses what isn\'t one', () => {
    expect(['2024-03-05', '2024/3/5', '3/5/2024', '5 March 2024', 'Mar. 5, 2024', '45356', '2024-03-05T00:00:00'].map(dateFrom)).toEqual(Array(7).fill('2024-03-05'));
    expect(dateFrom('')).toBeNull();
    expect(['2024-02-30', 'next week', '13/13/2024'].map(dateFrom)).toEqual(['invalid', 'invalid', 'invalid']);
  });
});

describe('guessing the columns', () => {
  it('knows the usual names, puts the name of a field first, gives each field one column, and the last file from a source wins', () => {
    const targets = targetsFor(machinery());
    const columns = ['No.', 'Name of FCA', 'Brgy.', 'Municipality', 'Qty', 'Program', 'Lat', 'Long', 'Date Turned Over', 'Variant', 'Beneficiary'];
    const guess = guessMapping(columns, targets);
    // Beneficiary and Date turned over are fields' own names, so they win over a usual name for one.
    expect(guess).toMatchObject({ 'No.': 'source_id', 'Name of FCA': '', 'Brgy.': 'barangay', Municipality: 'municipality', Qty: 'quantity', Program: 'banner_program', Lat: 'latitude', Long: 'longitude', 'Date Turned Over': 'attr:date_turned_over', Variant: 'attr:variant', Beneficiary: 'beneficiary' });
    expect(guessMapping(['Name of FCA', 'Turnover Date'], targets)).toEqual({ 'Name of FCA': 'beneficiary', 'Turnover Date': 'status_date' });
    const remembered = guessMapping(columns, targets, { Beneficiary: '', 'Name of FCA': 'beneficiary' });
    expect(remembered).toMatchObject({ Beneficiary: '', 'Name of FCA': 'beneficiary' });
  });
});

describe('building records', () => {
  it('brings the RAED machinery file in as the seed stored it: the same barangays and the same flags', async () => {
    const source = parseCsv('seed_interventions.csv', readFileSync(join(import.meta.dirname, '..', 'data', 'source', 'seed_interventions.csv'), 'utf8'));
    const machineryRows = source.rows.map((row, index) => [row, source.rowNumbers[index]] as const).filter(([row]) => row.intervention_type === 'machinery');
    const file = { ...source, rows: machineryRows.map(([row]) => row), rowNumbers: machineryRows.map(([, number]) => number) };
    const mapping = {
      ...Object.fromEntries(file.columns.map((column) => [column, ''])),
      source_id: 'source_id',
      category: 'category',
      category_variant: 'attr:variant',
      banner_program: 'banner_program',
      year_funded: 'year_funded',
      quantity: 'quantity',
      beneficiary: 'beneficiary',
      municipality: 'municipality',
      barangay: 'barangay',
      latitude: 'latitude',
      longitude: 'longitude',
      status: 'status',
    };
    const preview = buildPreview(file, settings({ dataSource: 'RAED 2026-10-21', mapping, statusDate: '2026-10-21' }), emptyMap(), places, '2026-11-09');
    expect(summarize(preview)).toMatchObject({ rows: 195, ready: 195, toFix: 0 });

    const stored = new Map(data.interventions.map((record) => [record.source_id, record]));
    for (const row of preview) {
      const record = stored.get(row.input!.source_id)!;
      expect(row.input!.values.barangay_id, row.input!.source_id!).toBe(record.barangay_id);
      // The name check is a person's flag, carried over from the source file, not worked out.
      const expected = record.qa_flags.filter((flag) => flag !== 'beneficiary_name_check').sort();
      expect([...row.flags].sort(), row.input!.source_id!).toEqual(expected);
      expect(row.input!.status.status_id).toBe(record.status_id);
    }
  });

  it('asks about values the lists don\'t know, and a choice settles every row with that value', () => {
    const file = parseCsv('abemis.csv', 'ID,Beneficiary,Municipality,Barangay,Program,Category,Year\nA1,Bantad FCA,Boac,Bantad,RICE BANNER PROGRAM,Hand Tractor,2024\nA2,Tumapon FA,Sta. Cruz,Tumapon,Rice Banner Program,Hand Tractor,2024\n');
    const mapping = guessMapping(file.columns, targetsFor(machinery()));
    const category = data.categories.find((candidate) => candidate.intervention_type_id === machinery().id)!;
    const asked = unmatchedValues(file, settings({ mapping }), data);
    expect(asked.map((value) => [value.target, value.raw, value.rows])).toEqual([
      ['category', 'Hand Tractor', 2],
      ['banner_program', 'RICE BANNER PROGRAM', 2],
    ]);
    // Sta. Cruz is Santa Cruz.
    const before = buildPreview(file, settings({ mapping }), data, places);
    expect(before[1].municipality).toBe('Santa Cruz');
    expect(before.every((row) => row.input === null && row.errors.some((error) => /isn't matched/.test(error)))).toBe(true);

    const rice = data.programs.find((program) => program.code === 'rice')!;
    const choices = { category: { [asked[0].key]: String(category.id) }, banner_program: { [asked[1].key]: String(rice.id) } };
    expect(unmatchedValues(file, settings({ mapping, choices }), data)).toEqual([]);
    const after = buildPreview(file, settings({ mapping, choices }), data, places);
    expect(after.map((row) => [row.errors, row.input?.values.banner_program_id, row.input?.values.category_id])).toEqual([
      [[], rice.id, category.id],
      [[], rice.id, category.id],
    ]);
  });

  it('keeps a barangay it can\'t match, with the nearest names, and flags it', () => {
    const file = parseCsv('a.csv', 'Beneficiary,Municipality,Barangay,Latitude,Longitude\nOne FCA,Boac,Bantadd,13.45,121.85\n');
    const mapping = guessMapping(file.columns, targetsFor(machinery()));
    const category = data.categories.find((candidate) => candidate.intervention_type_id === machinery().id)!;
    const [row] = buildPreview(file, settings({ mapping: { ...mapping }, choices: {} }), emptyMap(), places);
    expect(row.barangayMatched).toBe(false);
    expect(row.candidates[0]).toBe('Bantad');
    expect(row.flags).toContain('barangay_unmatched');
    // What the type requires, as on the form, and in its words.
    expect(row.errors).toEqual(['Category is required for Farm Machinery.', 'Year funded is required for Farm Machinery.', 'Banner program is required for Farm Machinery.']);
    expect(category).toBeTruthy();
  });

  it('says what has to be fixed, in the form\'s words, and what\'s worth a look', () => {
    const file = parseCsv('a.csv', 'ID,Beneficiary,Municipality,Barangay,Category,Program,Year,Qty,Coordinates,Status,Status date\nX1,Bantad FCA,Boac,Bantad,Hand Tractor,Rice Program,2999,two,not a place,Lost,soon\n');
    const category = data.categories.find((candidate) => candidate.intervention_type_id === machinery().id)!;
    const mapping = guessMapping(file.columns, targetsFor(machinery()));
    const [bad] = buildPreview(file, settings({ mapping, choices: { category: { handtractor: String(category.id) } } }), data, places, '2026-11-09');
    expect(bad.input).toBeNull();
    expect(bad.errors).toEqual([
      'Quantity "two" isn\'t a whole number of 1 or more.',
      'Status "Lost" isn\'t matched to the list yet.',
      'Status date "soon" isn\'t a date. Use YYYY-MM-DD.',
      'Year funded can\'t be in the future.',
    ]);
    expect(bad.warnings).toEqual(['The coordinates "not a place" couldn\'t be read, so it comes in without them.']);

    // Leaving a status blank means the type's usual one.
    const [blank] = buildPreview(file, settings({ mapping, choices: { category: { handtractor: String(category.id) }, status: { lost: null } } }), data, places, '2026-11-09');
    expect(blank.errors.some((error) => /Status "Lost"/.test(error))).toBe(false);

    // A municipality the list doesn't know, chosen as blank, is still no municipality.
    const nowhere = parseCsv('b.csv', 'Beneficiary,Municipality,Category,Program,Year\nBantad FCA,Atlantis,Hand Tractor,Rice Program,2020\n');
    const [lost] = buildPreview(nowhere, settings({ mapping: guessMapping(nowhere.columns, targetsFor(machinery())), choices: { category: { handtractor: String(category.id) }, municipality: { atlantis: null } } }), data, places);
    expect(lost.input).toBeNull();
    expect(lost.errors).toEqual(['No municipality. Every record needs one.']);
  });

  it('warns about what looks like it\'s already on the map, or twice in the file, without stopping it', () => {
    const existing = data.interventions.find((record) => record.barangay_id !== null && record.category_id !== null && record.year_funded !== null && record.beneficiary)!;
    const barangay = data.barangays.find((candidate) => candidate.id === existing.barangay_id)!;
    const municipality = data.municipalities.find((candidate) => candidate.id === barangay.municipality_id)!;
    const category = data.categories.find((candidate) => candidate.id === existing.category_id)!;
    const program = data.programs.find((candidate) => candidate.id === existing.banner_program_id)!;
    const line = `${existing.source_id},"${existing.beneficiary}",${municipality.name},${barangay.name},${category.name},${program.name},${existing.year_funded}`;
    const file = parseCsv('again.csv', `ID,Beneficiary,Municipality,Barangay,Category,Program,Year\n${line}\n${line}\n`);
    const mapping = guessMapping(file.columns, targetsFor(machinery()));
    const rows = buildPreview(file, settings({ mapping, dataSource: 'raed 2026-10-21' }), data, places);
    expect(rows.every((row) => row.input !== null)).toBe(true);
    expect(rows.map((row) => row.alreadyImported)).toEqual([true, true]);
    expect(rows[0].warnings).toEqual([
      'Looks like a record already on the map: same category, beneficiary, year and barangay.',
      'Already imported from raed 2026-10-21 with this ID.',
      'Another row in this file has the same category, beneficiary, year and barangay.',
    ]);
  });
});

// Phase 16c: a road type's rows take their line from the map file.
describe('building roads from a map file', () => {
  const road = () => data.types.find((type) => type.code === 'fmr')!;
  const proposed = () => data.statuses.find((status) => status.name === 'Proposed')!.id;
  // A record clear inside its barangay, to draw short lines beside.
  const clean = () => data.interventions.find((record) => record.qa_flags.length === 0 && record.geojson?.type === 'Point' && record.barangay_id !== null)!;

  function roadsFile() {
    const at = clean();
    const [lng, lat] = (at.geojson as GeoJSON.Point).coordinates;
    const near = (step: number): [number, number] => [Number((lng + step).toFixed(6)), Number((lat + step).toFixed(6))];
    const one = [[near(0), near(0.0002)]];
    const two = [
      [near(0), near(0.0001)],
      [near(0.0002), near(0.0003)],
    ];
    const municipality = data.municipalities.find((candidate) => candidate.id === at.municipality_id)!.name;
    const barangay = data.barangays.find((candidate) => candidate.id === at.barangay_id)!.name;
    const file: ParsedFile = {
      fileName: 'roads.geojson',
      kind: 'geojson',
      columns: ['Title', 'Municipality', 'Barangay'],
      rows: [
        { Title: 'Road one', Municipality: municipality, Barangay: barangay },
        { Title: 'Road two', Municipality: '', Barangay: '' },
        { Title: 'Road three', Municipality: municipality, Barangay: barangay },
      ],
      rowNumbers: [1, 2, 3],
      lines: [one, two, null],
      notes: [],
    };
    return { file, one, two };
  }

  it('offers no point columns for a road', () => {
    const offered = targetsFor(road()).map((target) => target.id);
    expect(offered).not.toContain('latitude');
    expect(offered).not.toContain('longitude');
    expect(offered).not.toContain('coordinates');
    expect(targetsFor(machinery()).map((target) => target.id)).toContain('latitude');
  });

  it('brings a line in one part, or in several, or none so the road waits for one', () => {
    const { file, one, two } = roadsFile();
    const mapping = guessMapping(file.columns, targetsFor(road()));
    const rows = buildPreview(file, settings({ type: road(), mapping, defaultStatusId: proposed() }), data, places);
    expect(rows.map((row) => row.errors)).toEqual([[], [], []]);
    expect(rows.map((row) => row.title)).toEqual(['Road one', 'Road two', 'Road three']);

    // One part is a line as the forms draw it, so it can be reshaped there later.
    expect(rows[0].input!.values).toMatchObject({ point: null, line: one[0] });
    expect(rows[0].input!.values).not.toHaveProperty('line_parts');
    expect(rows[0].flags).not.toContain('no_coords');
    expect(rows[0].line).toEqual({ km: lineLengthKm(one), parts: 1 });

    // Two parts, and no place in the file: the place is where the line is, and it says so.
    const located = data.barangays.find((candidate) => candidate.id === locateShape({ point: null, line: two }, places))!;
    expect(rows[1].input!.values).toMatchObject({ line_parts: two, municipality_id: located.municipality_id, barangay_id: located.id });
    expect(rows[1].input!.values).not.toHaveProperty('line');
    expect(rows[1].warnings).toEqual([expect.stringMatching(new RegExp(`^No municipality in the file, so it's taken from where the line is: ${located.name}, `))]);
    expect(rows[1].line).toEqual({ km: lineLengthKm(two), parts: 2 });

    // No line in the file: the road comes in waiting for its traced line.
    expect(rows[2].input!.values).not.toHaveProperty('line');
    expect(rows[2].warnings).toEqual(['No line for this row in the file, so the road comes in waiting for its traced line.']);
    expect(rows[2].flags).toContain('no_coords');
    expect(rows[2].line).toBeNull();
  });

  it("says a line can't be a point type's location, and brings the row in without coordinates", () => {
    const { file } = roadsFile();
    const rows = buildPreview(file, settings({ mapping: guessMapping(file.columns, targetsFor(machinery())) }), data, places);
    expect(rows[0].warnings).toContain('This row is a line in the file, not a point, so it comes in without coordinates.');
    expect(rows[0].input?.values ?? {}).not.toHaveProperty('line');
    expect(rows[0].line).toBeNull();
  });
});
