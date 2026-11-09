// The QA queue and the condition check's lists, worked out by hand on small sets of records.
import { describe, expect, it } from 'vitest';
import type { Intervention, MapData, QaDismissal, Status } from '../src/modules/intervention-map/data/types';
import { awaitingCheck, buildQueue, flagCounts, type QueueFilters } from '../src/modules/intervention-map/lib/qa-queue';

const statuses: Status[] = [
  { id: 1, name: 'Turned-over', color: '#2e7d32', sort_order: 1, is_active: true, counts_as_assessed: false },
  { id: 2, name: 'Serviceable', color: '#43a047', sort_order: 2, is_active: true, counts_as_assessed: true },
  { id: 3, name: 'Inventory', color: '#9e9e9e', sort_order: 3, is_active: true, counts_as_assessed: false },
  { id: 4, name: 'Unserviceable', color: '#c62828', sort_order: 4, is_active: true, counts_as_assessed: true },
];

let nextId = 0;
const record = (over: Partial<Intervention> = {}): Intervention => ({
  id: `r${++nextId}`,
  source_id: `SRC-${nextId}`,
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
  geojson: null,
  plotted_barangay_id: null,
  plotted_barangay: null,
  plotted_municipality: null,
  version: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  ...over,
});

const data = (interventions: Intervention[], qaDismissals: QaDismissal[] = []) =>
  ({
    interventions,
    qaDismissals,
    statuses,
    municipalities: [
      { id: 1, name: 'Boac', psgc_code: '1' },
      { id: 2, name: 'Gasan', psgc_code: '2' },
    ],
    categories: [
      { id: 1, code: 'tractor', name: 'Hand Tractor', intervention_type_id: 1, category_group_id: null, sort_order: 1, is_active: true },
      { id: 2, code: 'seeder', name: 'Seeder', intervention_type_id: 1, category_group_id: null, sort_order: 2, is_active: true },
    ],
    types: [],
  }) as unknown as MapData;

const dismissal = (intervention_id: string, flag: string): QaDismissal => ({ intervention_id, flag, reason: 'Checked', dismissed_by: null, dismissed_at: '2026-11-09T00:00:00Z' });
const ALL: QueueFilters = { municipalityId: null, flag: null, showDismissed: false, search: '' };

describe('the QA queue', () => {
  const outside = record({ qa_flags: ['out_of_province'], municipality_id: 2 });
  const mismatchGasan = record({ qa_flags: ['barangay_mismatch'], municipality_id: 2, category_id: 2 });
  const mismatchBoac = record({ qa_flags: ['barangay_mismatch', 'duplicate_point'] });
  const shared = record({ qa_flags: ['duplicate_point'] });
  const deleted = record({ qa_flags: ['no_coords'], deleted_at: '2026-11-01T00:00:00Z' });
  const dismissed = record({ qa_flags: ['barangay_mismatch'], category_id: 2 });
  const set = data([mismatchGasan, shared, outside, mismatchBoac, deleted, dismissed], [dismissal(dismissed.id, 'barangay_mismatch')]);

  it('puts the worst first, splits each flag by municipality, and leaves out deleted records and dismissed flags', () => {
    const groups = buildQueue(set, ALL);
    expect(groups.map((group) => [group.flag, group.total])).toEqual([
      ['out_of_province', 1],
      ['barangay_mismatch', 2],
      ['duplicate_point', 2],
    ]);
    expect(groups[1].municipalities.map((place) => [place.name, place.items.map((item) => item.record.id)])).toEqual([
      ['Boac', [mismatchBoac.id]],
      ['Gasan', [mismatchGasan.id]],
    ]);
  });

  it('shows a dismissed flag with its dismissal only when asked', () => {
    const groups = buildQueue(set, { ...ALL, showDismissed: true, flag: 'barangay_mismatch' });
    expect(groups).toHaveLength(1);
    const boac = groups[0].municipalities.find((place) => place.name === 'Boac')!;
    expect(boac.items.map((item) => [item.record.id, item.dismissal?.reason ?? null])).toEqual([
      [mismatchBoac.id, null],
      [dismissed.id, 'Checked'],
    ]);
  });

  it('filters by municipality, by flag, and by name, beneficiary or ID', () => {
    expect(buildQueue(set, { ...ALL, municipalityId: 2 }).map((group) => group.flag)).toEqual(['out_of_province', 'barangay_mismatch']);
    expect(buildQueue(set, { ...ALL, flag: 'duplicate_point' }).map((group) => group.total)).toEqual([2]);
    expect(buildQueue(set, { ...ALL, search: 'seeder' }).flatMap((group) => group.municipalities.flatMap((place) => place.items.map((item) => item.record.id)))).toEqual([mismatchGasan.id]);
    expect(buildQueue(set, { ...ALL, search: outside.source_id! }).map((group) => group.flag)).toEqual(['out_of_province']);
  });

  it('counts open flags of each kind, for the filter', () => {
    expect(flagCounts(set, null)).toEqual({ out_of_province: 1, barangay_mismatch: 2, duplicate_point: 2 });
    expect(flagCounts(set, 1)).toEqual({ barangay_mismatch: 1, duplicate_point: 2 });
  });
});

describe('the condition check', () => {
  const turnedOverBoac = record({ status_id: 1 });
  const turnedOverGasan = record({ status_id: 1, municipality_id: 2 });
  const inventory = record({ status_id: 3 });
  const serviceable = record({ status_id: 2 });
  const unserviceable = record({ status_id: 4 });
  const noStatus = record({ status_id: null });
  const gone = record({ status_id: 1, deleted_at: '2026-11-01T00:00:00Z' });
  const set = data([turnedOverBoac, turnedOverGasan, inventory, serviceable, unserviceable, noStatus, gone]);
  const ids = (records: Intervention[]) => records.map((item) => item.id);

  it('lists only units at a status that doesn\'t count as assessed, and not deleted ones', () => {
    expect(ids(awaitingCheck(set, { municipalityId: null, statusId: null }))).toEqual([turnedOverBoac.id, turnedOverGasan.id, inventory.id]);
  });

  it('narrows to one status and one municipality', () => {
    expect(ids(awaitingCheck(set, { municipalityId: null, statusId: 1 }))).toEqual([turnedOverBoac.id, turnedOverGasan.id]);
    expect(ids(awaitingCheck(set, { municipalityId: 2, statusId: null }))).toEqual([turnedOverGasan.id]);
    expect(ids(awaitingCheck(set, { municipalityId: 1, statusId: 3 }))).toEqual([inventory.id]);
  });
});
