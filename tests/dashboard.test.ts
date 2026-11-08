// The dashboard's numbers, worked out by hand on small sets of records.
import { describe, expect, it } from 'vitest';
import type { Category, Intervention, InterventionBarangay, InterventionType, MapData, Status, TypeStatus } from '../src/modules/intervention-map/data/types';
import { buildDashboard } from '../src/modules/intervention-map/lib/dashboard';

const statuses: Status[] = [
  { id: 1, name: 'Turned-over', color: '#2e7d32', sort_order: 1, is_active: true, counts_as_assessed: false },
  { id: 2, name: 'Serviceable', color: '#43a047', sort_order: 2, is_active: true, counts_as_assessed: true },
  { id: 3, name: 'Needs Repair', color: '#f59e0b', sort_order: 3, is_active: true, counts_as_assessed: true },
  { id: 4, name: 'Operational', color: '#2e7d32', sort_order: 4, is_active: true, counts_as_assessed: true },
  { id: 5, name: 'Unknown', color: '#9e9e9e', sort_order: 5, is_active: true, counts_as_assessed: false },
];

const type = (id: number, code: string, name: string, is_active = true): InterventionType => ({
  id,
  code,
  name,
  geometry_kind: 'point',
  icon_id: null,
  color: '#111111',
  core_field_rules: {},
  field_schema: { fields: [] },
  sort_order: id,
  is_active,
  version: 1,
});

const typeStatus = (intervention_type_id: number, status_id: number, counts_as_operational: boolean): TypeStatus => ({ intervention_type_id, status_id, sort_order: status_id, is_default: false, counts_as_operational });

const categories: Category[] = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  code: `c${index + 1}`,
  name: `Category ${String(index + 1).padStart(2, '0')}`,
  intervention_type_id: 1,
  category_group_id: null,
  sort_order: index,
  is_active: true,
}));

const data = (links: InterventionBarangay[] = []) =>
  ({
    types: [type(1, 'farm-machinery', 'Farm Machinery'), type(2, 'ssip', 'SSIP'), type(3, 'fmr', 'Road', false), type(4, 'nursery', 'Nursery')],
    typeStatuses: [typeStatus(1, 1, true), typeStatus(1, 2, true), typeStatus(1, 3, false), typeStatus(1, 5, false), typeStatus(2, 4, true), typeStatus(2, 1, false)],
    statuses,
    municipalities: [
      { id: 1, name: 'Boac', psgc_code: '1' },
      { id: 2, name: 'Gasan', psgc_code: '2' },
    ],
    programs: [
      { id: 1, code: 'rice', name: 'Rice', color: '#2e7d32', sort_order: 1, is_active: true },
      { id: 2, code: 'corn', name: 'Corn', color: '#f59e0b', sort_order: 2, is_active: true },
    ],
    categories,
    links,
  }) as Pick<MapData, 'types' | 'typeStatuses' | 'statuses' | 'municipalities' | 'programs' | 'categories' | 'links'>;

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
  beneficiary: `FCA ${nextId}`,
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

const BARANGAYS = [{ id: 1 }, { id: 2 }, { id: 3 }];

describe('the key figures', () => {
  it('counts records and units apart, and each active type has a tile', () => {
    const numbers = buildDashboard([record({ quantity: 3 }), record({ quantity: 2 }), record({ intervention_type_id: 2 })], data(), BARANGAYS);
    expect(numbers.records).toBe(3);
    expect(numbers.types).toEqual([
      { typeId: 1, label: 'Machinery units', units: 5 },
      { typeId: 2, label: 'SSIPs', units: 1 },
      { typeId: 4, label: 'Nursery units', units: 0 },
    ]);
  });

  it('counts each beneficiary once, however it was typed', () => {
    const typed = ['Bantad FCA', ' bantad   fca ', 'Bantad F.C.A.', 'BANTAD-FCA', 'Bantad, FCA', 'Tumapon FA', 'Tumapon F.A.', 'Kiñaman FA', 'Kinaman FA', null, '  ', '.'];
    const numbers = buildDashboard(typed.map((beneficiary) => record({ beneficiary })), data(), BARANGAYS);
    expect(numbers.beneficiaries).toBe(3);
  });

  it('still tells names apart when their letters differ', () => {
    const numbers = buildDashboard([record({ beneficiary: 'Bantad FCA' }), record({ beneficiary: 'Bantad FA' }), record({ beneficiary: 'Bantad FCA 2' })], data(), BARANGAYS);
    expect(numbers.beneficiaries).toBe(3);
  });

  describe('% operational', () => {
    it('uses each type\'s own list of what counts, among assessed units', () => {
      const machine = record({ status_id: 2 }); // Serviceable, operational for machinery
      const broken = record({ status_id: 3 });
      const pumpWorking = record({ intervention_type_id: 2, status_id: 4 }); // operational for an SSIP
      const pumpServiceable = record({ intervention_type_id: 2, status_id: 2 }); // not on an SSIP's list as operational
      const { operational } = buildDashboard([machine, broken, pumpWorking, pumpServiceable], data(), BARANGAYS);
      expect(operational).toEqual({ percent: 50, units: 2, assessed: 4, notAssessed: [], noStatus: 0 });
    });

    it('leaves out statuses that aren\'t assessed, such as Turned-over and Unknown, and counts them apart', () => {
      const records = [record({ status_id: 2 }), record({ status_id: 1, quantity: 3 }), record({ status_id: 1 }), record({ status_id: 5 }), record({ status_id: null, quantity: 2 })];
      const { operational } = buildDashboard(records, data(), BARANGAYS);
      expect(operational).toEqual({
        percent: 100,
        units: 1,
        assessed: 1,
        notAssessed: [
          { key: '1', label: 'Turned-over', units: 4 },
          { key: '5', label: 'Unknown', units: 1 },
        ],
        noStatus: 2,
      });
    });

    it('follows the setting on each status, not its name', () => {
      const changed = { ...data(), statuses: statuses.map((status) => ({ ...status, counts_as_assessed: status.name !== 'Serviceable' })) };
      const { operational } = buildDashboard([record({ status_id: 1 }), record({ status_id: 2 }), record({ status_id: 3 })], changed, BARANGAYS);
      // Turned-over now counts, and is operational for machinery. Serviceable is set aside.
      expect(operational).toEqual({ percent: 50, units: 1, assessed: 2, notAssessed: [{ key: '2', label: 'Serviceable', units: 1 }], noStatus: 0 });
    });

    it('goes by units, as one record can hold several machines', () => {
      const { operational } = buildDashboard([record({ status_id: 2, quantity: 3 }), record({ status_id: 3, quantity: 1 })], data(), BARANGAYS);
      expect(operational).toMatchObject({ percent: 75, units: 3, assessed: 4 });
    });

    it('has no figure when nothing has been assessed', () => {
      const waiting = buildDashboard([record({ status_id: 1 })], data(), BARANGAYS).operational;
      expect(waiting.percent).toBeNull();
      expect(waiting.notAssessed).toEqual([{ key: '1', label: 'Turned-over', units: 1 }]);
      expect(buildDashboard([], data(), BARANGAYS).operational.percent).toBeNull();
    });
  });

  it('counts barangays with nothing in view, out of those in scope', () => {
    const first = record();
    const links: InterventionBarangay[] = [
      { intervention_id: first.id, barangay_id: 1, link_source: 'encoded' },
      { intervention_id: 'filtered-out', barangay_id: 2, link_source: 'encoded' },
    ];
    const numbers = buildDashboard([first], data(links), BARANGAYS);
    expect(numbers.barangaysWithout).toBe(2);
    expect(numbers.barangaysTotal).toBe(3);
    expect(buildDashboard([first], data(links), [{ id: 1 }]).barangaysWithout).toBe(0);
  });

  it('counts records needing QA, not those that only share a point', () => {
    const numbers = buildDashboard([record(), record({ qa_flags: ['duplicate_point'] }), record({ qa_flags: ['no_coords'] }), record({ qa_flags: ['duplicate_point', 'barangay_mismatch'] })], data(), BARANGAYS);
    expect(numbers.needingQa).toBe(2);
  });
});

describe('the charts', () => {
  it('by municipality: units, biggest first', () => {
    const numbers = buildDashboard([record({ municipality_id: 1 }), record({ municipality_id: 2, quantity: 5 })], data(), BARANGAYS);
    expect(numbers.byMunicipality.map(({ label, value }) => [label, value])).toEqual([
      ['Gasan', 5],
      ['Boac', 1],
    ]);
  });

  it('by program: with each program\'s own color, and records with none kept', () => {
    const numbers = buildDashboard([record({ banner_program_id: 2, quantity: 2 }), record({ banner_program_id: 1 }), record({ banner_program_id: null })], data(), BARANGAYS);
    expect(numbers.byProgram.map(({ label, value, color }) => [label, value, color])).toEqual([
      ['Corn', 2, '#f59e0b'],
      ['No program', 1, '#bdbdbd'],
      ['Rice', 1, '#2e7d32'],
    ]);
  });

  it('by year: every year from first to last, in order, with a year of nothing shown as nothing', () => {
    const numbers = buildDashboard([record({ year_funded: 2022 }), record({ year_funded: 2019, quantity: 2 }), record({ year_funded: null, quantity: 4 })], data(), BARANGAYS);
    expect(numbers.byYear.map(({ label, value }) => [label, value])).toEqual([
      ['2019', 2],
      ['2020', 0],
      ['2021', 0],
      ['2022', 1],
    ]);
    expect(numbers.noYearUnits).toBe(4);
  });

  it('by year: nothing to show when no record has one', () => {
    expect(buildDashboard([record({ year_funded: null })], data(), BARANGAYS).byYear).toEqual([]);
  });

  it('by category: the top 15, saying what was left out', () => {
    const records = categories.map((category, index) => record({ category_id: category.id, quantity: index + 1 }));
    const numbers = buildDashboard(records, data(), BARANGAYS);
    expect(numbers.byCategory).toHaveLength(15);
    expect(numbers.byCategory[0]).toMatchObject({ label: 'Category 20', value: 20 });
    expect(numbers.byCategory.at(-1)).toMatchObject({ label: 'Category 06', value: 6 });
    expect(numbers.categoriesLeftOut).toBe(5);
    expect(numbers.unitsLeftOut).toBe(1 + 2 + 3 + 4 + 5);
  });

  it('by category: a record with none is kept, and nothing is left out when there are few', () => {
    const numbers = buildDashboard([record({ category_id: null, title: 'Custom' })], data(), BARANGAYS);
    expect(numbers.byCategory.map(({ label }) => label)).toEqual(['No category']);
    expect(numbers.categoriesLeftOut).toBe(0);
  });

  it('status by municipality: each stack adds up, in the lists\' order and colors', () => {
    const numbers = buildDashboard(
      [record({ municipality_id: 2, status_id: 3 }), record({ municipality_id: 2, status_id: 1, quantity: 2 }), record({ municipality_id: 1, status_id: 1 }), record({ municipality_id: 1, status_id: null })],
      data(),
      BARANGAYS,
    );
    expect(numbers.statusSeries).toEqual([
      { key: '1', label: 'Turned-over', color: '#2e7d32' },
      { key: '3', label: 'Needs Repair', color: '#f59e0b' },
      { key: 'none', label: 'No status', color: '#bdbdbd' },
    ]);
    expect(numbers.byStatus).toEqual([
      { key: '1', label: 'Boac', total: 2, values: { '1': 1, none: 1 } },
      { key: '2', label: 'Gasan', total: 3, values: { '3': 1, '1': 2 } },
    ]);
  });

  it('every chart adds up to the same total', () => {
    const records = [record({ quantity: 2, municipality_id: 2 }), record({ banner_program_id: 2, status_id: 3, year_funded: 2025, category_id: 3 }), record({ year_funded: null, category_id: null, banner_program_id: null, status_id: null, quantity: 4 })];
    const numbers = buildDashboard(records, data(), BARANGAYS);
    const sum = (rows: { value: number }[]) => rows.reduce((total, row) => total + row.value, 0);
    expect(sum(numbers.byMunicipality)).toBe(7);
    expect(sum(numbers.byProgram)).toBe(7);
    expect(sum(numbers.byYear) + numbers.noYearUnits).toBe(7);
    expect(sum(numbers.byCategory) + numbers.unitsLeftOut).toBe(7);
    expect(numbers.byStatus.reduce((total, row) => total + row.total, 0)).toBe(7);
    expect(numbers.types.reduce((total, tile) => total + tile.units, 0)).toBe(7);
  });

  it('with nothing to show, everything is empty rather than broken', () => {
    const numbers = buildDashboard([], data(), BARANGAYS);
    expect(numbers).toMatchObject({ records: 0, beneficiaries: 0, needingQa: 0, barangaysWithout: 3, byMunicipality: [], byProgram: [], byYear: [], byCategory: [], byStatus: [], statusSeries: [] });
  });

  it('an inactive type gets a tile only if its records are showing', () => {
    expect(buildDashboard([], data(), BARANGAYS).types.map((tile) => tile.label)).not.toContain('Road units');
    expect(buildDashboard([record({ intervention_type_id: 3 })], data(), BARANGAYS).types.map((tile) => tile.label)).toContain('Road units');
  });
});
