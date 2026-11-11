// The Home and Dashboard pages' own figures, worked out by hand on small sets of records.
import { describe, expect, it } from 'vitest';
import type { Category, CategoryGroup, Intervention, MapData } from '../src/modules/intervention-map/data/types';
import { awaitingCount, awaitingLocation, hasRoads, unitsByCategoryGroup, verificationRows, VERIFICATION_COLUMNS } from '../src/modules/intervention-map/lib/overview';
import { CATEGORY_COLORS } from '../src/modules/intervention-map/lib/view-fields';

const groups: CategoryGroup[] = [
  { id: 10, code: 'land', name: 'Land preparation', icon_id: null, sort_order: 1 },
  { id: 20, code: 'irrigation', name: 'Irrigation', icon_id: null, sort_order: 2 },
];

const category = (id: number, name: string, category_group_id: number | null): Category => ({ id, code: `c${id}`, name, intervention_type_id: 1, category_group_id, sort_order: id, is_active: true });
const categories = [category(1, 'Hand Tractor', 10), category(2, 'Pump and Engine Set', 20), category(3, 'Plastic Crate', null)];

let nextId = 0;
const record = (over: Partial<Intervention> = {}): Intervention =>
  ({
    id: `r${++nextId}`,
    source_id: null,
    intervention_type_id: 1,
    category_id: 1,
    title: null,
    quantity: 1,
    beneficiary: `FCA ${nextId}`,
    municipality_id: 1,
    barangay_id: 1,
    barangay_raw: null,
    attributes: {},
    qa_flags: [],
    geojson: { type: 'Point', coordinates: [121.9, 13.4] },
    deleted_at: null,
    ...over,
  }) as Intervention;

const data = {
  categories,
  categoryGroups: groups,
  municipalities: [
    { id: 1, name: 'Santa Cruz', psgc_code: '1' },
    { id: 2, name: 'Boac', psgc_code: '2' },
  ],
  barangays: [{ id: 1, name: 'Maniwaya', municipality_id: 1 }],
  types: [{ id: 1, code: 'farm-machinery', name: 'Farm Machinery', is_active: true }],
} as unknown as MapData;

describe('units by category group', () => {
  it('adds up units, not records, and puts the biggest first', () => {
    const rows = unitsByCategoryGroup([record({ category_id: 1 }), record({ category_id: 2, quantity: 3 }), record({ category_id: 2 })], data);
    expect(rows.map(({ label, value }) => [label, value])).toEqual([
      ['Irrigation', 4],
      ['Land preparation', 1],
    ]);
  });

  it("gives each group its place's color, whatever its rank", () => {
    const rows = unitsByCategoryGroup([record({ category_id: 2, quantity: 5 }), record({ category_id: 1 })], data);
    expect(rows.find((row) => row.label === 'Land preparation')!.color).toBe(CATEGORY_COLORS[0]);
    expect(rows.find((row) => row.label === 'Irrigation')!.color).toBe(CATEGORY_COLORS[1]);
  });

  it('keeps a record whose category has no group, or that has no category', () => {
    const rows = unitsByCategoryGroup([record({ category_id: 3 }), record({ category_id: null })], data);
    expect(rows).toEqual([expect.objectContaining({ key: 'none', label: 'No group', value: 2 })]);
  });
});

describe('records waiting for verified coordinates', () => {
  it('lists only what is not on the map, by municipality then ID, and says why', () => {
    const groups = awaitingLocation(
      [
        record({ source_id: 'RAED-2', geojson: null, qa_flags: ['no_coords'] }),
        record({ source_id: 'RAED-9' }),
        record({ source_id: 'RAED-1', geojson: null, qa_flags: ['no_coords'], barangay_id: null }),
        record({ source_id: 'RAED-5', municipality_id: 2, qa_flags: ['out_of_province'] }),
        record({ source_id: 'RAED-7', geojson: null, qa_flags: ['no_coords', 'barangay_not_in_marinduque'], barangay_id: null }),
      ],
      data,
    );
    expect(groups.map((group) => [group.municipality, group.records.map(({ record, issue }) => [record.source_id, issue])])).toEqual([
      ['Boac', [['RAED-5', 'Coordinates are outside Marinduque']]],
      [
        'Santa Cruz',
        [
          ['RAED-1', 'No coordinates yet, no barangay'],
          ['RAED-2', 'No coordinates yet'],
          ['RAED-7', 'No coordinates yet, barangay not in Marinduque'],
        ],
      ],
    ]);
    expect(awaitingCount(groups)).toBe(4);
  });

  it('writes the verification sheet in the columns the region already uses', () => {
    const groups = awaitingLocation([record({ source_id: 'RAED-3', category_id: 2, geojson: null, qa_flags: ['no_coords'], beneficiary: 'Maniwaya FA' })], data);
    const [row] = verificationRows(groups, data);
    expect(Object.keys(row)).toEqual([...VERIFICATION_COLUMNS]);
    expect(row).toMatchObject({
      ID: 'RAED-3',
      Type: 'Farm Machinery',
      'Machine / project': 'Pump and Engine Set',
      Beneficiary: 'Maniwaya FA',
      'Municipality (encoded)': 'Santa Cruz',
      'Barangay (encoded)': 'Maniwaya',
      Issue: 'No coordinates yet',
      'Verified latitude': '',
    });
  });

  it('falls back to the record id and the barangay as written', () => {
    const groups = awaitingLocation([record({ id: 'abc', geojson: null, barangay_id: null, barangay_raw: 'Barangay 367' })], data);
    expect(verificationRows(groups, data)[0]).toMatchObject({ ID: 'abc', 'Barangay (encoded)': 'Barangay 367' });
  });
});

describe('the Farm-to-Market Road card', () => {
  it('waits for its data until the type is switched on', () => {
    expect(hasRoads(data)).toBe(false);
    expect(hasRoads({ types: [...data.types, { id: 3, code: 'fmr', is_active: true }] } as unknown as MapData)).toBe(true);
  });
});
