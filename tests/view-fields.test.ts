// Filtering and coloring by any field, and what a saved view keeps. No database: these work from the
// record alone, which is what keeps the map, charts, table and exports in agreement.
import { describe, expect, it } from 'vitest';
import type { FieldDefinition, Intervention, InterventionBarangay, InterventionType, MapData, SavedView } from '../src/modules/intervention-map/data/types';
import { describeFilters, exportFileStem, filterLines, selectExportRecords } from '../src/modules/intervention-map/export/records';
import { buildShading, countByBarangay, pickViewFilters, recordsInView, visibleRecords, type ViewFilters } from '../src/modules/intervention-map/lib/choropleth';
import { captureView, readViewConfig, savedViewProblems, viewsInOrder, type ViewableState } from '../src/modules/intervention-map/lib/saved-views';
import {
  buildColorScale,
  CATEGORY_COLORS,
  describeFieldFilter,
  emptyFilter,
  foldText,
  isActiveFilter,
  matchesFilter,
  NOT_SET,
  readField,
  viewFields,
  type FieldFilter,
} from '../src/modules/intervention-map/lib/view-fields';

const machineryFields: FieldDefinition[] = [
  { key: 'drive', label: 'Drive', input: 'dropdown', options: [{ value: 'solar', label: 'Solar' }, { value: 'diesel', label: 'Diesel' }, { value: 'old', label: 'Old kind', archived: true }] },
  { key: 'insured', label: 'Insured', input: 'yes_no' },
  { key: 'power', label: 'Power', input: 'number', unit: 'hp' },
  { key: 'checked_on', label: 'Checked on', input: 'date' },
  { key: 'site_photo', label: 'Site photo', input: 'photo' },
  { key: 'serial', label: 'Serial', input: 'text' },
  { key: 'retired', label: 'Retired', input: 'text', archived: true },
];

const type = (id: number, code: string, fields: FieldDefinition[] = [], is_active = true): InterventionType => ({
  id,
  code,
  name: code === 'machinery' ? 'Machinery' : code === 'ssip' ? 'SSIP' : code,
  geometry_kind: 'point',
  icon_id: null,
  color: id === 1 ? '#111111' : '#222222',
  core_field_rules: {},
  field_schema: { fields },
  sort_order: id,
  is_active,
  version: 1,
});

let nextId = 0;
const record = (over: Partial<Intervention> = {}): Intervention => ({
  id: `r${++nextId}`,
  intervention_type_id: 1,
  category_id: 1,
  title: null,
  banner_program_id: 1,
  year_funded: 2020,
  quantity: 1,
  unit_cost: null,
  fund_source: null,
  beneficiary: 'Test FCA',
  beneficiary_type_id: null,
  municipality_id: 1,
  barangay_id: 1,
  barangay_raw: null,
  location_basis_id: null,
  status_id: 1,
  attributes: {},
  remarks: null,
  data_source: 'RAED',
  qa_flags: [],
  geojson: { type: 'Point', coordinates: [121.9, 13.4] },
  plotted_barangay_id: null,
  plotted_barangay: null,
  plotted_municipality: null,
  version: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  ...over,
});

const baseData = (interventions: Intervention[] = []): MapData =>
  ({
    icons: [],
    programs: [
      { id: 1, code: 'rice', name: 'Rice', color: '#2e7d32', sort_order: 1, is_active: true },
      { id: 2, code: 'corn', name: 'Corn', color: '#f59e0b', sort_order: 2, is_active: true },
      { id: 3, code: 'gone', name: 'Archived program', color: '#000000', sort_order: 3, is_active: false },
    ],
    categoryGroups: [],
    categories: [
      { id: 1, code: 'tractor', name: 'Tractor', intervention_type_id: 1, category_group_id: null, sort_order: 1, is_active: true },
      { id: 2, code: 'pump', name: 'Pump', intervention_type_id: 2, category_group_id: null, sort_order: 2, is_active: true },
      { id: 3, code: 'road', name: 'Road part', intervention_type_id: 3, category_group_id: null, sort_order: 3, is_active: true },
    ],
    statuses: [
      { id: 1, name: 'Serviceable', color: '#43a047', sort_order: 1, is_active: true, counts_as_assessed: true },
      { id: 2, name: 'Unknown', color: '#9e9e9e', sort_order: 2, is_active: true, counts_as_assessed: false },
    ],
    locationBases: [{ id: 1, name: 'Actual', color: '#2e7d32', sort_order: 1, is_active: true }],
    beneficiaryTypes: [{ id: 1, name: 'FCA', sort_order: 1, is_active: true }],
    types: [type(1, 'machinery', machineryFields), type(2, 'ssip', [{ key: 'power', label: 'Pump power', input: 'number' }]), type(3, 'fmr', [{ key: 'length', label: 'Length', input: 'number' }], false)],
    typeStatuses: [],
    municipalities: [
      { id: 1, name: 'Boac', psgc_code: '1' },
      { id: 2, name: 'Gasan', psgc_code: '2' },
    ],
    barangays: [
      { id: 1, municipality_id: 1, name: 'Bantad', psgc_code: 'a', attributes: {}, version: 1 },
      { id: 2, municipality_id: 2, name: 'Tiguion', psgc_code: 'b', attributes: {}, version: 1 },
    ],
    barangayFields: { fields: [] },
    barangayFieldsVersion: 1,
    interventions,
    links: [],
    statusHistory: [],
    photos: [],
    dataSources: [],
    members: [],
    savedViews: [],
    importBatches: [],
    qaDismissals: [],
  }) as MapData;

const NO_FILTERS: ViewFilters = { mode: 'count', pickedProgramId: null, pickedTypeId: null, hiddenTypeIds: [], programId: null, yearFrom: null, yearTo: null, municipalityId: null, barangayId: null };

describe('which fields there are', () => {
  const fields = viewFields(baseData());
  const field = (id: string) => fields.find((candidate) => candidate.id === id);

  it('has the record\'s own, and each active type\'s custom fields', () => {
    expect(field('status')).toMatchObject({ kind: 'choice', colorable: true });
    expect(field('year_funded')?.kind).toBe('number');
    expect(field('created_on')?.kind).toBe('date');
    expect(field('attr:1:drive')).toMatchObject({ kind: 'choice', group: 'Machinery', label: 'Drive' });
    expect(field('attr:1:insured')?.choices?.map((choice) => choice.value)).toEqual(['yes', 'no']);
    expect(field('attr:1:power')).toMatchObject({ kind: 'number', label: 'Power (hp)' });
    expect(field('attr:1:checked_on')?.kind).toBe('date');
    expect(field('attr:1:serial')?.kind).toBe('text');
    expect(field('photo:1:site_photo')?.kind).toBe('choice');
  });

  it('keeps two types\' fields with the same key apart', () => {
    expect(field('attr:1:power')?.label).toBe('Power (hp)');
    expect(field('attr:2:power')?.label).toBe('Pump power');
  });

  it('leaves out an inactive type\'s fields and categories, as they\'re hidden throughout', () => {
    expect(field('attr:3:length')).toBeUndefined();
    expect(field('category')?.choices?.map((choice) => choice.label)).toEqual(['Tractor', 'Pump']);
  });

  it('marks an archived field, and offers an archived choice only while a record has it', () => {
    expect(field('attr:1:retired')?.archived).toBe(true);
    expect(field('program')?.choices?.map((choice) => choice.label)).toEqual(['Rice', 'Corn']);
    const inUse = viewFields(baseData([record({ banner_program_id: 3 })]));
    expect(inUse.find((candidate) => candidate.id === 'program')?.choices?.map((choice) => choice.label)).toEqual(['Rice', 'Corn', 'Archived program']);
  });

  it('offers people only when there are any, and doesn\'t color by free text', () => {
    expect(field('encoded_by')).toBeUndefined();
    const withPeople = viewFields({ ...baseData(), members: [{ id: 'p1', full_name: 'Ana' }] });
    expect(withPeople.find((candidate) => candidate.id === 'encoded_by')?.choices).toEqual([{ value: 'p1', label: 'Ana' }]);
    expect(field('beneficiary')?.colorable).toBe(false);
    expect(field('remarks')?.colorable).toBe(false);
    expect(field('attr:1:serial')?.colorable).toBe(true);
  });
});

describe('reading a value', () => {
  it('reads a custom field only on its own type', () => {
    const machine = record({ attributes: { power: 12 } });
    const pump = record({ intervention_type_id: 2, attributes: { power: 5 } });
    expect(readField(machine, 'attr:1:power')).toBe(12);
    expect(readField(pump, 'attr:1:power')).toBeNull();
    expect(readField(pump, 'attr:2:power')).toBe(5);
  });

  it('treats blank as nothing, and turns yes/no and photos into choices', () => {
    expect(readField(record({ attributes: { serial: '' } }), 'attr:1:serial')).toBeNull();
    expect(readField(record({ fund_source: '' }), 'fund_source')).toBeNull();
    expect(readField(record({ attributes: { insured: true } }), 'attr:1:insured')).toBe('yes');
    expect(readField(record({ attributes: { insured: false } }), 'attr:1:insured')).toBe('no');
    expect(readField(record({ attributes: { site_photo: 'photo-id' } }), 'photo:1:site_photo')).toBe('yes');
    expect(readField(record({ attributes: {} }), 'photo:1:site_photo')).toBe('no');
    expect(readField(record({ intervention_type_id: 2 }), 'photo:1:site_photo')).toBeNull();
  });

  it('reads an unknown field as nothing', () => {
    expect(readField(record(), 'no_such_field')).toBeNull();
    expect(readField(record(), 'attr:99:gone')).toBeNull();
  });

  it('reads a timestamp as its Philippine calendar day', () => {
    expect(readField(record({ created_at: '2026-03-31T16:30:00Z' }), 'created_on')).toBe('2026-04-01');
    expect(readField(record({ created_at: '2026-03-31T15:59:00Z' }), 'created_on')).toBe('2026-03-31');
  });
});

describe('matching a filter', () => {
  const choice = (field: string, ...values: string[]): FieldFilter => ({ field, kind: 'choice', values });
  const number = (field: string, min: number | null, max: number | null): FieldFilter => ({ field, kind: 'number', min, max });
  const date = (field: string, from: string | null, to: string | null): FieldFilter => ({ field, kind: 'date', from, to });
  const text = (field: string, value: string): FieldFilter => ({ field, kind: 'text', text: value });

  it('dropdown: any chosen value, and Not set only finds records with none', () => {
    const solar = record({ attributes: { drive: 'solar' } });
    const blank = record();
    expect(matchesFilter(solar, choice('attr:1:drive', 'solar', 'diesel'))).toBe(true);
    expect(matchesFilter(solar, choice('attr:1:drive', 'diesel'))).toBe(false);
    expect(matchesFilter(blank, choice('attr:1:drive', 'solar'))).toBe(false);
    expect(matchesFilter(blank, choice('attr:1:drive', NOT_SET))).toBe(true);
    expect(matchesFilter(solar, choice('attr:1:drive', NOT_SET))).toBe(false);
  });

  it('yes/no', () => {
    expect(matchesFilter(record({ attributes: { insured: true } }), choice('attr:1:insured', 'yes'))).toBe(true);
    expect(matchesFilter(record({ attributes: { insured: false } }), choice('attr:1:insured', 'yes'))).toBe(false);
    expect(matchesFilter(record({ attributes: { insured: false } }), choice('attr:1:insured', 'no'))).toBe(true);
    expect(matchesFilter(record(), choice('attr:1:insured', 'no'))).toBe(false);
  });

  it('a list value such as QA flags matches on any of them, and Not set means none', () => {
    const flagged = record({ qa_flags: ['no_coords', 'no_barangay'] });
    expect(matchesFilter(flagged, choice('qa_flags', 'no_barangay'))).toBe(true);
    expect(matchesFilter(flagged, choice('qa_flags', 'out_of_province'))).toBe(false);
    expect(matchesFilter(record(), choice('qa_flags', NOT_SET))).toBe(true);
    expect(matchesFilter(flagged, choice('qa_flags', NOT_SET))).toBe(false);
  });

  it('number range: either end can be open, both ends count, and no value never matches', () => {
    const r = record({ attributes: { power: 10 } });
    expect(matchesFilter(r, number('attr:1:power', 10, 20))).toBe(true);
    expect(matchesFilter(r, number('attr:1:power', 5, 10))).toBe(true);
    expect(matchesFilter(r, number('attr:1:power', 11, null))).toBe(false);
    expect(matchesFilter(r, number('attr:1:power', null, 9))).toBe(false);
    expect(matchesFilter(r, number('attr:1:power', 0, null))).toBe(true);
    expect(matchesFilter(record(), number('attr:1:power', 0, null))).toBe(false);
    expect(matchesFilter(record({ attributes: { power: 'many' } }), number('attr:1:power', 0, null))).toBe(false);
    expect(matchesFilter(record({ year_funded: 2024 }), number('year_funded', 2023, 2025))).toBe(true);
  });

  it('date range: either end can be open, both ends count, and no value never matches', () => {
    const r = record({ attributes: { checked_on: '2026-03-15' } });
    expect(matchesFilter(r, date('attr:1:checked_on', '2026-03-15', '2026-03-15'))).toBe(true);
    expect(matchesFilter(r, date('attr:1:checked_on', '2026-03-16', null))).toBe(false);
    expect(matchesFilter(r, date('attr:1:checked_on', null, '2026-03-14'))).toBe(false);
    expect(matchesFilter(record(), date('attr:1:checked_on', '2000-01-01', null))).toBe(false);
    expect(matchesFilter(record({ created_at: '2026-03-31T16:30:00Z' }), date('created_on', '2026-04-01', null))).toBe(true);
  });

  it('text ignores case, spacing and marks', () => {
    const r = record({ beneficiary: 'Kiñaman  Farmers Association' });
    expect(matchesFilter(r, text('beneficiary', 'kinaman farmers'))).toBe(true);
    expect(matchesFilter(r, text('beneficiary', 'KIÑAMAN'))).toBe(true);
    expect(matchesFilter(r, text('beneficiary', 'Bantad'))).toBe(false);
    expect(matchesFilter(record({ beneficiary: null }), text('beneficiary', 'x'))).toBe(false);
    expect(foldText('  Kiñaman   FA ')).toBe('kinaman fa');
  });

  it('a filter still being filled in matches everything', () => {
    for (const field of viewFields(baseData())) {
      const filter = emptyFilter(field);
      expect(isActiveFilter(filter), field.id).toBe(false);
      expect(matchesFilter(record(), filter), field.id).toBe(true);
    }
    expect(matchesFilter(record({ beneficiary: null }), text('beneficiary', '   '))).toBe(true);
  });
});

describe('everything follows the same filters', () => {
  const solar = record({ id: 'solar', attributes: { drive: 'solar' }, barangay_id: 1 });
  const diesel = record({ id: 'diesel', attributes: { drive: 'diesel' }, barangay_id: 2 });
  const records = [solar, diesel];
  const links: InterventionBarangay[] = [
    { intervention_id: 'solar', barangay_id: 1, link_source: 'encoded' },
    { intervention_id: 'diesel', barangay_id: 2, link_source: 'encoded' },
  ];
  const view: ViewFilters = { ...NO_FILTERS, fieldFilters: [{ field: 'attr:1:drive', kind: 'choice', values: ['solar'] }] };

  it('the map\'s markers and shading', () => {
    expect(recordsInView(records, view, links)).toEqual([solar]);
    expect(visibleRecords(records, view, links)).toEqual([solar]);
    const counts = countByBarangay(recordsInView(records, view, links), links);
    expect(buildShading('count', 'x', counts, [{ id: 1 }, { id: 2 }]).barangaysWithRecords).toBe(1);
  });

  it('with no field filters, nothing changes', () => {
    expect(recordsInView(records, NO_FILTERS, links)).toEqual(records);
    expect(recordsInView(records, { ...NO_FILTERS, fieldFilters: [] }, links)).toEqual(records);
  });

  it('an export takes exactly the same records, and says why', () => {
    const data = baseData(records);
    expect(selectExportRecords(records, links, { view }, data)).toEqual([solar]);
    const filters = describeFilters({ view }, data);
    expect(filters.fields).toEqual(['Drive: Solar']);
    expect(filterLines(filters)).toEqual(['Drive: Solar']);
    expect(exportFileStem(filters, '2026-11-08')).toBe('Marinduque_Filtered_2026-11-08');
  });

  it('pickViewFilters keeps the filters and leaves the rest of the map\'s state behind', () => {
    const state = { ...view, basemap: 'osm', panelOpen: true } as ViewFilters;
    expect(pickViewFilters(state)).toEqual({ ...view });
    expect(pickViewFilters(state)).not.toHaveProperty('basemap');
  });

  describe('the records table\'s rows', () => {
    const data = baseData(records);
    const selection = { view: NO_FILTERS, recordIds: ['diesel', 'solar'], search: 'bantad' };

    it('go in the table\'s order, and only those', () => {
      expect(selectExportRecords(records, links, selection, data)).toEqual([diesel, solar]);
      expect(selectExportRecords(records, links, { view: NO_FILTERS, recordIds: ['solar'] }, data)).toEqual([solar]);
    });

    it('drop a record that has since left the filters', () => {
      expect(selectExportRecords(records, links, { ...selection, view }, data)).toEqual([solar]);
      expect(selectExportRecords(records, links, { ...selection, recordIds: ['gone', 'solar'] }, data)).toEqual([solar]);
    });

    it('name the search, but keep it out of the file name, as it can be someone\'s name', () => {
      const filters = describeFilters(selection, data);
      expect(filterLines(filters)).toEqual(['Search: "bantad"']);
      expect(exportFileStem(filters, '2026-11-08')).toBe('Marinduque_Filtered_2026-11-08');
    });
  });
});

describe('a filter in words', () => {
  const fields = viewFields(baseData());
  it('names each kind', () => {
    expect(describeFieldFilter({ field: 'attr:1:drive', kind: 'choice', values: ['solar', NOT_SET] }, fields)).toBe('Drive: Solar, Not set');
    expect(describeFieldFilter({ field: 'attr:1:power', kind: 'number', min: 5, max: 10 }, fields)).toBe('Power (hp): 5 to 10');
    expect(describeFieldFilter({ field: 'attr:1:power', kind: 'number', min: 5, max: null }, fields)).toBe('Power (hp): from 5');
    expect(describeFieldFilter({ field: 'attr:1:power', kind: 'number', min: null, max: 10 }, fields)).toBe('Power (hp): up to 10');
    expect(describeFieldFilter({ field: 'attr:1:power', kind: 'number', min: 7, max: 7 }, fields)).toBe('Power (hp): 7');
    expect(describeFieldFilter({ field: 'attr:1:checked_on', kind: 'date', from: '2026-01-01', to: '2026-02-01' }, fields)).toBe('Checked on: 2026-01-01 to 2026-02-01');
    expect(describeFieldFilter({ field: 'beneficiary', kind: 'text', text: ' fca ' }, fields)).toBe('Beneficiary contains "fca"');
  });

  it('says nothing about a filter that isn\'t filled in', () => {
    expect(describeFieldFilter({ field: 'attr:1:drive', kind: 'choice', values: [] }, fields)).toBeNull();
  });
});

describe('coloring by a field', () => {
  it('by default a marker has its program\'s color, or its type\'s without one', () => {
    const data = baseData();
    const rice = record({ banner_program_id: 1 });
    const none = record({ banner_program_id: null });
    const scale = buildColorScale('program', [rice, none], data);
    expect(scale.colorOf(rice)).toBe('#2e7d32');
    expect(scale.colorOf(none)).toBe('#111111');
    expect(scale.entries.map((entry) => entry.label)).toEqual(['Rice', 'Corn', 'Machinery, no program']);
    expect(scale.entries.find((entry) => entry.key === scale.keyOf(none))?.color).toBe('#111111');
  });

  it('uses the colors from the lists, so they match the charts and legend', () => {
    const r = record({ status_id: 2 });
    const scale = buildColorScale('status', [r], baseData());
    expect(scale.colorOf(r)).toBe('#9e9e9e');
    expect(scale.entries.find((entry) => entry.key === '1')?.color).toBe('#43a047');
  });

  it('gives a field with no colors of its own the palette, in its options\' order', () => {
    const solar = record({ attributes: { drive: 'solar' } });
    const diesel = record({ attributes: { drive: 'diesel' } });
    const blank = record();
    const scale = buildColorScale('attr:1:drive', [solar, diesel, blank], baseData());
    expect(scale.colorOf(solar)).toBe(CATEGORY_COLORS[0]);
    expect(scale.colorOf(diesel)).toBe(CATEGORY_COLORS[1]);
    expect(scale.keyOf(blank)).toBe(NOT_SET);
    expect(scale.entries.at(-1)?.label).toBe('Not set');
  });

  it('a color follows its value, whichever records are there', () => {
    const solar = record({ attributes: { drive: 'solar' } });
    const diesel = record({ attributes: { drive: 'diesel' } });
    const data = baseData();
    const all = buildColorScale('attr:1:drive', [solar, diesel], data);
    const onlyDiesel = buildColorScale('attr:1:drive', [diesel], data);
    expect(onlyDiesel.colorOf(diesel)).toBe(all.colorOf(diesel));
  });

  it('past the palette, the commonest keep a color and the rest fold into Other', () => {
    const options = Array.from({ length: 12 }, (_, index) => ({ value: `v${index}`, label: `Value ${index}` }));
    const data = baseData();
    data.types[0] = type(1, 'machinery', [{ key: 'kind', label: 'Kind', input: 'dropdown', options }]);
    const records = options.flatMap((option, index) => Array.from({ length: index + 1 }, () => record({ attributes: { kind: option.value } })));
    const scale = buildColorScale('attr:1:kind', records, data);
    const named = scale.entries.filter((entry) => entry.key !== NOT_SET);
    expect(named).toHaveLength(CATEGORY_COLORS.length);
    expect(named.at(-1)?.label).toBe('Other');
    expect(named.map((entry) => entry.key)).toContain('v11');
    expect(named.map((entry) => entry.key)).not.toContain('v0');
    expect(scale.keyOf(record({ attributes: { kind: 'v0' } }))).toBe('__other__');
    expect(new Set(named.map((entry) => entry.color)).size).toBe(named.length);
  });

  it('a number goes in ranges of about the same size, and a value never splits across two', () => {
    const even = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023].map((year) => record({ year_funded: year }));
    const evenRanges = buildColorScale('year_funded', even, baseData()).entries.filter((entry) => entry.key !== NOT_SET);
    expect(evenRanges.map((entry) => entry.label)).toEqual(['2014 to 2015', '2016 to 2017', '2018 to 2019', '2020 to 2021', '2022 to 2023']);
    expect(new Set(evenRanges.map((entry) => entry.color)).size).toBe(5);

    // A year with many records stays whole, even if that leaves fewer ranges.
    const years = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2024, 2024];
    const records = years.map((year) => record({ year_funded: year }));
    const scale = buildColorScale('year_funded', records, baseData());
    const ranges = scale.entries.filter((entry) => entry.key !== NOT_SET);
    expect(ranges.map((entry) => entry.label)).toEqual(['2014 to 2016', '2017 to 2019', '2020 to 2021', '2022 to 2024']);
    const keysFor2024 = new Set(records.filter((r) => r.year_funded === 2024).map(scale.keyOf));
    expect(keysFor2024.size).toBe(1);
    // Every record falls in one of them, and none is Not set.
    expect(records.every((r) => scale.keyOf(r) !== NOT_SET)).toBe(true);
  });

  it('a few numbers get one color each, and no value is Not set', () => {
    const records = [record({ quantity: 1 }), record({ quantity: 2 })];
    const scale = buildColorScale('quantity', records, baseData());
    expect(scale.entries.map((entry) => entry.label)).toEqual(['1', '2', 'Not set']);
    expect(scale.colorOf(records[0])).not.toBe(scale.colorOf(records[1]));
    const blank = record({ attributes: {} });
    expect(buildColorScale('attr:1:power', [blank, record({ attributes: { power: 3 } })], baseData()).keyOf(blank)).toBe(NOT_SET);
  });

  it('a date goes by its year', () => {
    const records = [record({ attributes: { checked_on: '2024-03-01' } }), record({ attributes: { checked_on: '2025-07-01' } }), record()];
    const scale = buildColorScale('attr:1:checked_on', records, baseData());
    expect(scale.entries.map((entry) => entry.label)).toEqual(['2024', '2025', 'Not set']);
    expect(scale.keyOf(records[2])).toBe(NOT_SET);
  });

  it('free text uses its commonest values', () => {
    const records = [record({ attributes: { serial: 'A' } }), record({ attributes: { serial: 'B' } })];
    expect(buildColorScale('attr:1:serial', records, baseData()).entries.map((entry) => entry.label)).toEqual(['A', 'B', 'Not set']);
  });

  it('a field that can\'t be colored by, or is gone, falls back to the program', () => {
    const data = baseData();
    expect(buildColorScale('beneficiary', [], data).field).toBe('program');
    expect(buildColorScale('attr:9:gone', [], data).field).toBe('program');
  });

  it('a QA flag colors by the first one a record has', () => {
    const r = record({ qa_flags: ['no_coords', 'no_barangay'] });
    expect(buildColorScale('qa_flags', [r], baseData()).keyOf(r)).toBe('no_coords');
  });
});

describe('a saved view', () => {
  const state: ViewableState = {
    hiddenTypeIds: [2],
    showMunicipal: false,
    showProvince: true,
    programId: 1,
    yearFrom: 2020,
    yearTo: 2024,
    municipalityId: 2,
    barangayId: 2,
    fieldFilters: [{ field: 'attr:1:power', kind: 'number', min: 5, max: null }],
    mode: 'gap',
    pickedProgramId: 2,
    pickedTypeId: 1,
    colorBy: 'attr:1:drive',
    basemap: 'hybrid',
  };
  const extent = { center: [13.4, 121.9] as [number, number], zoom: 13 };

  it('keeps layers, filters, style, basemap and extent, and reads back the same', () => {
    const config = captureView(state, extent);
    expect(readViewConfig(JSON.parse(JSON.stringify(config)), baseData())).toEqual(config);
  });

  it('ignores what no longer exists, rather than treating it as an error', () => {
    const config = captureView(state, extent);
    const old = JSON.parse(JSON.stringify(config));
    old.filters.fieldFilters.push({ field: 'attr:1:removed', kind: 'number', min: 1, max: 2 }, { field: 'attr:9:gone', kind: 'text', text: 'x' });
    old.filters.programId = 99;
    old.filters.municipalityId = 99;
    old.layers.hiddenTypeIds = [2, 99];
    old.style.colorBy = 'attr:9:gone';
    old.style.pickedTypeId = 99;

    const read = readViewConfig(old, baseData());
    expect(read.filters.fieldFilters).toEqual(config.filters.fieldFilters);
    expect(read.filters.programId).toBeNull();
    expect(read.filters.municipalityId).toBeNull();
    expect(read.filters.barangayId).toBeNull();
    expect(read.layers.hiddenTypeIds).toEqual([2]);
    expect(read.style.colorBy).toBe('program');
    expect(read.style.pickedTypeId).toBeNull();
  });

  it('drops a filter whose field changed kind, and a barangay outside its municipality', () => {
    const old = JSON.parse(JSON.stringify(captureView(state, extent)));
    old.filters.fieldFilters = [{ field: 'attr:1:power', kind: 'text', text: 'x' }];
    old.filters.barangayId = 1; // in Boac, while the view's municipality is Gasan
    const read = readViewConfig(old, baseData());
    expect(read.filters.fieldFilters).toEqual([]);
    expect(read.filters.barangayId).toBeNull();
  });

  it('can\'t be broken by a stored value that makes no sense', () => {
    for (const nonsense of [null, 'text', 7, [], { basemap: 'moon', style: { mode: 'x', colorBy: 3 }, filters: { fieldFilters: 'no', yearFrom: 'soon' }, layers: { hiddenTypeIds: 'none' }, extent: { center: ['a'], zoom: 'b' } }]) {
      const read = readViewConfig(nonsense, baseData());
      expect(read.basemap).toBe('osm');
      expect(read.style.mode).toBe('count');
      expect(read.style.colorBy).toBe('program');
      expect(read.filters.fieldFilters).toEqual([]);
      expect(read.filters.yearFrom).toBeNull();
      expect(read.layers.hiddenTypeIds).toEqual([]);
      expect(read.extent).toBeNull();
    }
  });

  it('keeps a saved date filter only if the dates are dates', () => {
    const old = { filters: { fieldFilters: [{ field: 'attr:1:checked_on', kind: 'date', from: '2026-01-01', to: 'soon' }] } };
    expect(readViewConfig(old, baseData()).filters.fieldFilters).toEqual([{ field: 'attr:1:checked_on', kind: 'date', from: '2026-01-01', to: null }]);
  });

  const view = (over: Partial<SavedView>): SavedView => ({ id: 'v', name: 'A view', owner_id: 'me', config: {}, is_shared: false, is_default: false, created_at: '', updated_at: '', ...over });

  it('needs a name, and one person\'s names stay apart', () => {
    const views = [view({ id: 'a', name: 'Rice' }), view({ id: 'b', name: 'Corn', owner_id: 'other' })];
    expect(savedViewProblems({ name: '  ' }, views, 'me', null).name).toMatch(/name/);
    expect(savedViewProblems({ name: ' rice ' }, views, 'me', null).name).toMatch(/already/);
    expect(savedViewProblems({ name: 'Corn' }, views, 'me', null)).toEqual({});
    expect(savedViewProblems({ name: 'Rice' }, views, 'me', 'a')).toEqual({});
    expect(savedViewProblems({ is_shared: true }, views, 'me', 'a')).toEqual({});
  });

  it('can\'t stop being shared while it\'s the default', () => {
    const views = [view({ id: 'a', is_shared: true, is_default: true })];
    expect(savedViewProblems({ is_shared: false }, views, 'me', 'a').is_shared).toMatch(/default/);
    expect(savedViewProblems({ config: {} } as { is_shared?: boolean }, views, 'me', 'a')).toEqual({});
  });

  it('lists the default first, then by name', () => {
    const order = viewsInOrder([view({ id: 'c', name: 'Beta' }), view({ id: 'a', name: 'Zeta', is_default: true }), view({ id: 'b', name: 'Alpha' })]);
    expect(order.map((entry) => entry.name)).toEqual(['Zeta', 'Alpha', 'Beta']);
  });
});
