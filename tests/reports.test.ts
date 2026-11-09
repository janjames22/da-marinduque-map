// Reports, against the real migrations and the RAED data: the signature blocks and who may change them,
// report downloads in the export log, what each report says, and the PDF and Excel files themselves,
// read back the way a person's viewer would read them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildLocalSeed } from '../scripts/build-local-seed';
import { loadSeedFiles, seedInterventions } from '../scripts/seed-interventions';
import * as localAdmin from '../src/modules/intervention-map/data/local-admin';
import { stateFromSeed, toMapData, type LocalSeed } from '../src/modules/intervention-map/data/local-store';
import type { DataStore } from '../src/modules/intervention-map/data/store';
import { ValidationError } from '../src/modules/intervention-map/data/store';
import { createSupabaseStore } from '../src/modules/intervention-map/data/supabase-store';
import type { Intervention, MapData, ReportSignatory } from '../src/modules/intervention-map/data/types';
import { beneficiaryPdf } from '../src/modules/intervention-map/reports/beneficiary-pdf';
import { boundsOf, fitProjection, niceScale } from '../src/modules/intervention-map/reports/geo';
import { inventoryPdf } from '../src/modules/intervention-map/reports/inventory-pdf';
import { inventoryXlsx } from '../src/modules/intervention-map/reports/inventory-xlsx';
import { municipalPdf } from '../src/modules/intervention-map/reports/municipal-pdf';
import { pdfSafe } from '../src/modules/intervention-map/reports/pdf-common';
import { printMapPdf } from '../src/modules/intervention-map/reports/print-map-pdf';
import {
  beneficiaryGroups,
  beneficiaryRecords,
  dataSourceLine,
  INVENTORY_COLUMNS,
  inventorySections,
  inventoryTitle,
  municipalProfile,
  NO_INVENTORY_FILTERS,
  reportRecords,
} from '../src/modules/intervention-map/reports/report-data';
import type { Boundaries } from '../src/modules/intervention-map/state/use-map-data';
import { createTestDb } from './helpers/db';
import { createPgliteBackend } from './helpers/pglite-backend';

const ADMIN = 'f2000000-0000-4000-8000-000000000001';
const ENCODER = 'f2000000-0000-4000-8000-000000000002';
const VIEWER = 'f2000000-0000-4000-8000-000000000003';

let db: PGlite;
let admin: DataStore;
let encoder: DataStore;
let viewer: DataStore;
let data: MapData;
let seed: LocalSeed;

const storeFor = (id: string, role: 'admin' | 'encoder' | 'viewer') => createSupabaseStore(createPgliteBackend(db, id), { id, full_name: role, role });
const rows = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

async function attempt(account: string, sql: string, params: unknown[] = []) {
  await db.exec('begin');
  try {
    await db.exec(account ? 'set local role authenticated' : 'set local role anon');
    await db.query(`select set_config('request.jwt.sub', $1, true)`, [account]);
    await db.query(sql, params);
    return { ok: true, code: undefined as string | undefined };
  } catch (error) {
    return { ok: false, code: (error as { code?: string }).code };
  } finally {
    await db.exec('rollback');
  }
}

const boundary = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'boundaries', `${name}.geojson`), 'utf8'));
const boundaries: Boundaries = { province: boundary('province'), municipalities: boundary('municipalities'), barangays: boundary('barangays') };
const NOW = new Date('2026-11-09T02:30:00Z');

// What a PDF viewer reads off each page.
async function pdfText(bytes: Uint8Array): Promise<{ pages: string[]; size: { width: number; height: number } }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const pages: string[] = [];
  let size = { width: 0, height: 0 };
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    if (number === 1) {
      const view = page.getViewport({ scale: 1 });
      size = { width: Math.round(view.width), height: Math.round(view.height) };
    }
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' '));
  }
  return { pages, size };
}

beforeAll(async () => {
  db = await createTestDb();
  const { rows: csv } = loadSeedFiles();
  await seedInterventions(db, csv, []);
  seed = JSON.parse(JSON.stringify(await buildLocalSeed(db))) as LocalSeed;
  for (const id of [ADMIN, ENCODER, VIEWER]) await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Ana Admin', 'admin'), ($2, 'Enzo Encoder', 'encoder'), ($3, 'Vera Viewer', 'viewer')`, [ADMIN, ENCODER, VIEWER]);
  admin = storeFor(ADMIN, 'admin');
  encoder = storeFor(ENCODER, 'encoder');
  viewer = storeFor(VIEWER, 'viewer');
  data = await viewer.load();
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe('signature blocks', () => {
  it('start with the office\'s own, in order, and every member reads them', () => {
    expect(data.signatories.map((s) => [s.label, s.name, s.position, s.is_active])).toEqual([
      ['Prepared by', 'Engr. Jan James P. Graza', 'Agricultural and Biosystems Engineer', true],
      ['Noted by', 'Susana Arellano-Uy, RAgr., MPA', 'OIC Provincial Agriculturist', true],
    ]);
  });

  it('an Admin changes, adds, reorders and archives them, and each change is logged and signalled', async () => {
    const before = (await rows<{ n: number }>('select count(*)::int as n from realtime.messages'))[0].n;
    const [noted] = data.signatories.filter((s) => s.label === 'Noted by');
    await admin.saveLookup('report_signatories', noted.id, { name: 'Susana Arellano-Uy, RAgr., MPA, PhD' });
    await admin.saveLookup('report_signatories', null, { label: 'Approved by', name: 'Provincial Director', position: '', sort_order: 3 });
    const now = await admin.load();
    expect(now.signatories.map((s) => s.label)).toEqual(['Prepared by', 'Noted by', 'Approved by']);
    const approved = now.signatories.find((s) => s.label === 'Approved by')!;
    await admin.saveLookup('report_signatories', approved.id, { is_active: false });
    expect((await admin.load()).signatories.find((s) => s.id === approved.id)!.is_active).toBe(false);

    const lines = await rows<{ action: string; actor_id: string }>(`select action, actor_id from audit_log where table_name = 'report_signatories' order by id`);
    expect(lines.map((line) => line.action)).toEqual(['update', 'insert', 'update']);
    expect(new Set(lines.map((line) => line.actor_id))).toEqual(new Set([ADMIN]));
    expect((await rows<{ n: number }>('select count(*)::int as n from realtime.messages'))[0].n).toBeGreaterThan(before);
    await admin.saveLookup('report_signatories', noted.id, { name: 'Susana Arellano-Uy, RAgr., MPA' });
  });

  it('nobody else changes them, and none is ever deleted', async () => {
    const id = data.signatories[0].id;
    await expect(encoder.saveLookup('report_signatories', id, { name: 'Someone else' })).rejects.toThrow();
    await expect(viewer.saveLookup('report_signatories', null, { label: 'Prepared by', name: 'Me' })).rejects.toThrow();
    for (const account of [ENCODER, VIEWER]) {
      expect((await attempt(account, `insert into report_signatories (label, name) values ('Prepared by', 'Me')`)).ok).toBe(false);
      await attempt(account, `update report_signatories set name = 'Me' where id = $1`, [id]);
    }
    expect((await rows<{ name: string }>('select name from report_signatories where id = $1', [id]))[0].name).toBe('Engr. Jan James P. Graza');
    expect((await attempt(ADMIN, 'delete from report_signatories where id = $1', [id])).ok).toBe(false);
    expect((await attempt('', 'select * from report_signatories')).ok).toBe(false);
  });

  it('need a label and a name, within their lengths, in the database and in the forms', async () => {
    expect((await attempt(ADMIN, `insert into report_signatories (label, name) values ('  ', 'Someone')`)).code).toBe('23514');
    expect((await attempt(ADMIN, `insert into report_signatories (label, name) values ('Prepared by', '')`)).code).toBe('23514');
    expect((await attempt(ADMIN, `insert into report_signatories (label, name) values ($1, 'Someone')`, ['x'.repeat(61)])).code).toBe('23514');
    await expect(admin.saveLookup('report_signatories', null, { label: ' ', name: 'Someone' })).rejects.toBeInstanceOf(ValidationError);
    await expect(admin.saveLookup('report_signatories', null, { label: 'Prepared by', name: 'x'.repeat(121) })).rejects.toThrow(ValidationError);
    // One person may sign twice, under different labels.
    await expect(admin.saveLookup('report_signatories', null, { label: 'Reviewed by', name: 'Engr. Jan James P. Graza', is_active: false })).resolves.toBeUndefined();
  });

  it('local mode keeps the same rules', () => {
    const state = stateFromSeed(JSON.parse(JSON.stringify(seed)) as LocalSeed, 'test');
    const context = { lists: state.fixed, now: () => '2026-11-09T00:00:00Z', newId: () => 'x' } as unknown as Parameters<typeof localAdmin.saveLookup>[1];
    expect(state.fixed.signatories.map((s) => s.label)).toEqual(['Prepared by', 'Noted by']);
    expect(() => localAdmin.saveLookup(state.rows, context, 'report_signatories', null, { label: '', name: 'Someone' })).toThrow(ValidationError);
    localAdmin.saveLookup(state.rows, context, 'report_signatories', null, { label: ' Approved by ', name: ' Provincial Director ', sort_order: 3 });
    expect(state.fixed.signatories.at(-1)).toMatchObject({ label: 'Approved by', name: 'Provincial Director', position: '', is_active: true });
  });
});

describe('report downloads in the export log', () => {
  it('take PDF and Excel, by any member, and nothing it doesn\'t know', async () => {
    await viewer.logExport({ format: 'pdf', file_name: 'Inventory_Marinduque_2026-11-09.pdf', filters: { report: 'inventory' }, record_count: 199 });
    await encoder.logExport({ format: 'xlsx', file_name: 'Inventory_Marinduque_2026-11-09.xlsx', filters: { report: 'inventory' }, record_count: 199 });
    await expect(viewer.logExport({ format: 'docx', file_name: 'x.docx', filters: {}, record_count: 1 })).rejects.toThrow(/format/);
    const lines = await rows<{ actor_id: string; context: { format: string; filters: { report: string } } }>(`select actor_id, context from audit_log where action = 'export' order by id`);
    expect(lines.map((line) => [line.actor_id, line.context.format, line.context.filters.report])).toEqual([
      [VIEWER, 'pdf', 'inventory'],
      [ENCODER, 'xlsx', 'inventory'],
    ]);
  });
});

describe('what the reports say', () => {
  it('covers the records on the map, whatever its filters, leaving out deleted ones', () => {
    const deleted = { ...data.interventions[0], id: 'gone', deleted_at: '2026-11-01T00:00:00Z' } as Intervention;
    expect(reportRecords({ ...data, interventions: [...data.interventions, deleted] })).toHaveLength(199);
  });

  it('puts the inventory in the RAED columns: machinery by name, an SPIS by its kind and title', () => {
    const sections = inventorySections(data, NO_INVENTORY_FILTERS);
    expect(sections.map((section) => [section.type.code, section.layout, section.records.length])).toEqual([
      ['farm-machinery', 'machine', 195],
      ['ssip', 'project', 4],
    ]);
    expect(sections[0].columns).toEqual(INVENTORY_COLUMNS.machine);
    expect(sections[0].columns).toEqual(['Machine Name', 'Year Funded', 'Banner Program', 'Beneficiary', 'Status', 'Region', 'Province', 'Municipality', 'Barangay', 'Latitude', 'Longitude']);
    expect(sections[1].columns).toEqual(['Project Type', 'Project Title', 'Banner Program', 'Year Funded', 'Beneficiary', 'Region', 'Province', 'Municipality', 'Barangay', 'Latitude', 'Longitude', 'Stage']);
    expect(sections[0].rows.every((row) => row[5] === 'MIMAROPA (Region IV-B)' && row[6] === 'Marinduque')).toBe(true);
    expect(sections[1].rows.map((row) => row.at(-1)).sort()).toEqual(['Completed', 'Completed', 'Inventory', 'Inventory']);
    // By program, then year, as the RAED report runs.
    const order = sections[0].records.map((record) => [data.programs.find((p) => p.id === record.banner_program_id)!.sort_order, record.year_funded ?? 0]);
    expect(order).toEqual([...order].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  });

  it('narrows the inventory by municipality, program and year, and says so in its title', () => {
    const boac = data.municipalities.find((m) => m.name === 'Boac')!;
    const rice = data.programs.find((p) => p.code === 'rice')!;
    const filters = { municipalityId: boac.id, programId: rice.id, year: null };
    const sections = inventorySections(data, filters);
    const records = sections.flatMap((section) => section.records);
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => record.municipality_id === boac.id && record.banner_program_id === rice.id)).toBe(true);
    expect(inventoryTitle(sections, filters, data)).toEqual({
      title: 'CONSOLIDATED INVENTORY REPORT',
      subtitle: sections.length === 1 ? sections[0].type.name : `${sections[0].type.name} and ${sections[1].type.name}`,
      place: 'Municipality of Boac, Province of Marinduque',
      filters: ['Banner program: Rice Program'],
    });
    expect(inventorySections(data, { ...NO_INVENTORY_FILTERS, year: 2025 }).flatMap((section) => section.records).every((record) => record.year_funded === 2025)).toBe(true);
  });

  it('adds a units column only when a record holds several', () => {
    const several = data.interventions.map((record, index) => (index === 0 ? { ...record, quantity: 3 } : record));
    const [machinery] = inventorySections({ ...data, interventions: several }, NO_INVENTORY_FILTERS);
    expect(machinery.columns[1]).toBe('Qty');
    expect(machinery.units).toBe(197);
  });

  it('profiles a municipality: its figures, tallies and the barangays with nothing yet', () => {
    const boac = data.municipalities.find((m) => m.name === 'Boac')!;
    const profile = municipalProfile(data, boac.id)!;
    expect(profile.records).toHaveLength(38);
    expect(profile.numbers.records).toBe(38);
    expect(profile.byProgram.reduce((sum, row) => sum + row.records, 0)).toBe(38);
    expect(profile.byStatus.map((row) => row.label)).toEqual(['Serviceable', 'Turned-over', 'Completed'].filter((label) => profile.byStatus.some((row) => row.label === label)).sort((a, b) => data.statuses.find((s) => s.name === a)!.sort_order - data.statuses.find((s) => s.name === b)!.sort_order));
    expect(profile.gaps.length).toBe(profile.numbers.barangaysWithout);
    expect(profile.barangays.every((barangay) => barangay.municipality_id === boac.id)).toBe(true);
    expect(municipalProfile(data, 9999)).toBeNull();
  });

  it('groups a beneficiary however its name is written, under the spelling used most', () => {
    // A beneficiary already written the same way twice, so that spelling is the one used most.
    const twin = data.interventions.find((record) => record.beneficiary && data.interventions.filter((other) => other.beneficiary === record.beneficiary).length >= 2)!;
    const respelled = { ...twin, id: 'respelled', beneficiary: `  ${twin.beneficiary!.toUpperCase().replace(/ /g, '  ')}.` } as Intervention;
    const groups = beneficiaryGroups({ ...data, interventions: [...data.interventions, respelled] });
    const group = groups.find((candidate) => candidate.records.some((record) => record.id === 'respelled'))!;
    expect(group.records.length).toBeGreaterThanOrEqual(2);
    expect(group.name).toBe(twin.beneficiary!.trim());
    expect(group.spellings).toContain(respelled.beneficiary!.trim());
    expect(beneficiaryGroups(data).length).toBe(new Set(reportRecords(data).map((record) => record.beneficiary).filter(Boolean).map((name) => name!.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))).size);
  });

  it('gives each of a beneficiary\'s interventions its place and its whole status history, oldest first', () => {
    const group = beneficiaryGroups(data).sort((a, b) => b.records.length - a.records.length)[0];
    const records = beneficiaryRecords(group, data);
    expect(records).toHaveLength(group.records.length);
    for (const entry of records) {
      expect(entry.history.length).toBeGreaterThan(0);
      expect(entry.history.map((item) => item.entry.status_date)).toEqual([...entry.history.map((item) => item.entry.status_date)].sort());
      expect(entry.place).toContain(data.municipalities.find((m) => m.id === entry.record.municipality_id)!.name);
    }
  });

  it('names its data sources', () => {
    expect(dataSourceLine(reportRecords(data))).toBe('Intervention Map records (RAED 2026-10-21)');
    expect(dataSourceLine([])).toBe('Intervention Map records');
  });
});

describe('the maps in reports', () => {
  it('keep shapes true and north up, and a scale bar is a round length', () => {
    const projection = fitProjection({ west: 121.8, south: 13.2, east: 122.2, north: 13.6 }, { x: 0, y: 0, width: 400, height: 200 }, 0);
    const [left, top] = projection.project(121.8, 13.6);
    const [right, bottom] = projection.project(122.2, 13.2);
    expect(top).toBe(0);
    expect(bottom).toBeCloseTo(200);
    // Longitude is narrowed by the cosine of the latitude, so the shape is true, and it's centered.
    expect((right - left) / (bottom - top)).toBeCloseTo(Math.cos((13.4 * Math.PI) / 180), 5);
    expect(left).toBeCloseTo((400 - (right - left)) / 2);
    expect(niceScale(100, 120)).toEqual({ meters: 10000, units: 100, label: '10 km' });
    expect(niceScale(3, 120)).toMatchObject({ meters: 200, label: '200 m' });
    expect(boundsOf([], [])).toBeNull();
  });
});

describe('the files', () => {
  const signatories = () => data.signatories;

  it('keeps every name readable in a PDF, and spells out what the PDF font can\'t show', () => {
    expect(pdfSafe('Ñino FCA – “Pañalan” · 13°')).toBe('Ñino FCA – “Pañalan” · 13°');
    expect(pdfSafe('₱1,000 for 🌾 rice')).toBe('PHP 1,000 for ? rice');
  });

  it('the inventory PDF has the RAED cover and columns, on legal paper, landscape, then the signature blocks', async () => {
    const { bytes, records } = inventoryPdf({ data, filters: NO_INVENTORY_FILTERS, signatories: signatories(), now: NOW });
    expect(records).toBe(199);
    const { pages, size } = await pdfText(bytes);
    expect(size).toEqual({ width: 1008, height: 612 });
    expect(pages[0]).toContain('CONSOLIDATED INVENTORY REPORT');
    expect(pages[0]).toContain('Farm Machinery and SSIP');
    expect(pages[0]).toContain('Province of Marinduque');
    expect(pages[0]).toContain('Date: November 9, 2026');
    expect(pages[0]).toContain('Data Source: Intervention Map records (RAED 2026-10-21)');
    expect(pages[1]).toContain('Farm Machinery: 195 records, 195 units');
    expect(pages[1]).toContain('Machine Name Year Funded Banner Program Beneficiary Status Region Province Municipality Barangay Latitude Longitude');
    const last = pages.at(-1)!;
    expect(last).toContain('SSIP: 4 records, 4 units');
    expect(last).toContain('Project Type Project Title');
    expect(last).toContain('Prepared by: Engr. Jan James P. Graza Agricultural and Biosystems Engineer');
    expect(last).toContain('Noted by: Susana Arellano-Uy, RAgr., MPA OIC Provincial Agriculturist');
    pages.forEach((text, index) => expect(text).toContain(`Page ${index + 1} of ${pages.length}`));
    // Every record is in it once: each row carries the region once.
    expect(pages.join(' ').split('MIMAROPA').length - 1).toBe(199);
  });

  it('leaves out archived signature blocks, and prints without any', async () => {
    const archived = signatories().map((s, index) => (index === 1 ? { ...s, is_active: false } : s));
    const { pages } = await pdfText(inventoryPdf({ data, filters: NO_INVENTORY_FILTERS, signatories: archived, now: NOW }).bytes);
    expect(pages.at(-1)).toContain('Engr. Jan James P. Graza');
    expect(pages.at(-1)).not.toContain('Noted by');
    const none = await pdfText(inventoryPdf({ data, filters: NO_INVENTORY_FILTERS, signatories: [], now: NOW }).bytes);
    expect(none.pages.at(-1)).not.toContain('Prepared by:');
  });

  it('the inventory workbook has the same title, columns and rows, numbers as numbers, and prints legal and landscape', async () => {
    const { bytes, records } = await inventoryXlsx({ data, filters: NO_INVENTORY_FILTERS, signatories: signatories(), now: NOW });
    expect(records).toBe(199);
    const book = XLSX.read(bytes, { type: 'array' });
    expect(book.SheetNames).toEqual(['Inventory']);
    const grid = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Inventory, { header: 1, blankrows: true, defval: null });
    expect(grid.slice(0, 3).map((row) => row[0])).toEqual(['CONSOLIDATED INVENTORY REPORT', 'Farm Machinery and SSIP', 'Province of Marinduque']);
    const header = grid.findIndex((row) => row[0] === 'Machine Name');
    expect(grid[header]).toEqual(expect.arrayContaining(INVENTORY_COLUMNS.machine));
    const firstRow = grid[header + 1];
    expect(typeof firstRow[1]).toBe('number');
    expect(grid.some((row) => row[0] === 'Project Type')).toBe(true);
    expect(grid.flat()).toEqual(expect.arrayContaining(['Prepared by:', 'Engr. Jan James P. Graza', 'Agricultural and Biosystems Engineer', 'Noted by:']));
    const sheet = await (await JSZip.loadAsync(bytes)).file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toMatch(/<printOptions gridLines="1"\/><pageMargins[^>]*\/><pageSetup paperSize="5" orientation="landscape"\/>/);
  });

  it('the municipal profile is one A4 page, with its figures, tables, gaps and signatures', async () => {
    const boac = data.municipalities.find((m) => m.name === 'Boac')!;
    const made = municipalPdf({ data, boundaries, municipalityId: boac.id, signatories: signatories(), now: NOW })!;
    const { pages, size } = await pdfText(made.bytes);
    expect(size).toEqual({ width: 595, height: 842 });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('MUNICIPAL PROFILE: BOAC');
    expect(pages[0]).toContain('As of November 9, 2026');
    expect(pages[0]).toContain('38 interventions');
    expect(pages[0]).toContain('Program Records Units');
    expect(pages[0]).toContain('Barangays with no intervention yet');
    expect(pages[0]).toContain('N');
    expect(pages[0]).toMatch(/\d+ km/);
    expect(pages[0]).toContain('Prepared by:');
    expect(municipalPdf({ data, boundaries, municipalityId: 9999, signatories: signatories(), now: NOW })).toBeNull();
  });

  it('the beneficiary profile has each intervention and its status history', async () => {
    const group = beneficiaryGroups(data).sort((a, b) => b.records.length - a.records.length)[0];
    const made = beneficiaryPdf({ data, boundaries, beneficiaryKey: group.key, signatories: signatories(), now: NOW })!;
    expect(made.records).toBe(group.records.length);
    const text = (await pdfText(made.bytes)).pages.join(' ');
    expect(text).toContain('BENEFICIARY PROFILE');
    expect(text).toContain(pdfSafe(group.name));
    expect(text).toContain('Status history');
    expect(text).toContain('(RAED report)');
    expect(text).toContain('Noted by:');
    expect(beneficiaryPdf({ data, boundaries, beneficiaryKey: 'nobody', signatories: signatories(), now: NOW })).toBeNull();
  });

  it('the printed map has its title, filters, legend, north arrow, scale, date, sources and signatures', async () => {
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const bytes = printMapPdf({
      capture: { image: pixel, width: 800, height: 600, basemapLeftOut: false },
      metersPerPixel: 40,
      title: 'DA Interventions in Boac, Marinduque',
      lines: ['Municipality: Boac'],
      paper: 'a4',
      orientation: 'landscape',
      legend: [
        { title: 'Number of interventions', shape: 'square', entries: [{ color: '#eeeeee', label: '0', count: 41 }] },
        { title: 'Markers by program', shape: 'dot', entries: [{ color: '#2e7d32', label: 'Rice Program', count: 4 }] },
      ],
      sources: 'Intervention Map records (RAED 2026-10-21)',
      basemap: '© OpenStreetMap contributors',
      signatories: signatories(),
      now: NOW,
    });
    const { pages, size } = await pdfText(bytes);
    expect(size).toEqual({ width: 842, height: 595 });
    expect(pages[0]).toContain('DA Interventions in Boac, Marinduque');
    expect(pages[0]).toContain('Municipality: Boac');
    expect(pages[0]).toContain('Markers by program Rice Program 4');
    expect(pages[0]).toContain('N');
    expect(pages[0]).toMatch(/\d+ km/);
    expect(pages[0]).toContain('Date: November 9, 2026');
    expect(pages[0]).toContain('Basemap: © OpenStreetMap contributors');
    expect(pages[0]).toContain('Prepared by:');
  });
});

describe('local mode', () => {
  it('reads the signature blocks from its dataset, and a dataset from before them has none', () => {
    expect(toMapData(seed).signatories).toHaveLength(2);
    const older = JSON.parse(JSON.stringify(seed)) as LocalSeed;
    delete older.lookups.report_signatories;
    expect(toMapData(older).signatories).toEqual([] as ReportSignatory[]);
  });
});
