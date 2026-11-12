// Farm-to-Market Roads (Phase 16): a road's length, whether it's finished, and the totals Home and the
// Dashboard show. The map and the record pages read the same functions.
import { describe, expect, it } from 'vitest';
import type { Intervention } from '../src/modules/intervention-map/data/types';
import { unplottedLabel } from '../src/modules/intervention-map/lib/display';
import { awaitingLocation } from '../src/modules/intervention-map/lib/overview';
import { formatKm, isUnfinished, lineLength, lineLengthKm, roadNote, roadTotals } from '../src/modules/intervention-map/lib/roads';

const ROAD_TYPE = { id: 3, code: 'fmr', geometry_kind: 'line' as const };
const MACHINERY_TYPE = { id: 1, code: 'farm-machinery', geometry_kind: 'point' as const };
const types = [MACHINERY_TYPE, ROAD_TYPE] as unknown as Parameters<typeof roadTotals>[1]['types'];
const statuses = [
  { id: 1, name: 'Proposed' },
  { id: 2, name: 'On-going' },
  { id: 3, name: 'Completed' },
  { id: 4, name: 'Operational' },
  { id: 5, name: 'ongoing' },
] as Parameters<typeof isUnfinished>[1]['statuses'];

// About 1.11 km north to south at Marinduque's latitude.
const LINE: GeoJSON.LineString = { type: 'LineString', coordinates: [[121.9, 13.4], [121.9, 13.41]] };

const record = (over: Partial<Intervention>): Intervention =>
  ({
    id: Math.random().toString(36).slice(2),
    intervention_type_id: ROAD_TYPE.id,
    municipality_id: 1,
    barangay_id: 1,
    attributes: {},
    geojson: LINE,
    qa_flags: [],
    status_id: 3,
    deleted_at: null,
    quantity: 1,
    ...over,
  }) as Intervention;

describe('a line\'s length', () => {
  it('follows the earth: a hundredth of a degree of latitude is about 1.11 km', () => {
    expect(lineLengthKm([LINE.coordinates as [number, number][]])).toBeCloseTo(1.112, 3);
  });

  it('adds up every part of a line', () => {
    const part = LINE.coordinates as [number, number][];
    expect(lineLengthKm([part, part])).toBeCloseTo(2 * lineLengthKm([part]), 9);
  });

  it('counts the reported length first, so the totals match the source', () => {
    expect(lineLength(record({ attributes: { length_km: 2.5 } }))).toMatchObject({ km: 2.5, basis: 'reported', reportedKm: 2.5 });
    expect(lineLength(record({ attributes: { length_km: '1.75' } })).km).toBe(1.75);
  });

  it('falls back to the traced line, and has none without either', () => {
    expect(lineLength(record({})).basis).toBe('traced');
    expect(lineLength(record({})).km).toBeCloseTo(1.112, 3);
    expect(lineLength(record({ geojson: null }))).toEqual({ km: null, basis: null, reportedKm: null, tracedKm: null });
    expect(lineLength(record({ geojson: null, attributes: { length_km: 0 } })).km).toBeNull();
  });

  it('reads with two decimals under 10 km and one from there', () => {
    expect(formatKm(1.112)).toBe('1.11 km');
    expect(formatKm(12.345)).toBe('12.3 km');
    expect(formatKm(1234.5)).toBe('1,234.5 km');
  });
});

describe('an unfinished road', () => {
  it('is one at Proposed or On-going, written either way', () => {
    expect([1, 2, 5].map((status_id) => isUnfinished({ status_id }, { statuses }))).toEqual([true, true, true]);
    expect([3, 4, null].map((status_id) => isUnfinished({ status_id }, { statuses }))).toEqual([false, false, false]);
  });
});

describe('road totals', () => {
  it('count roads and km, and say what the km rests on', () => {
    const records = [
      record({ attributes: { length_km: 2.5 } }),
      record({}),
      record({ geojson: null, attributes: { length_km: 3.2 } }),
      record({ geojson: null }),
      record({ deleted_at: '2026-11-01T00:00:00Z', attributes: { length_km: 9 } }),
      record({ intervention_type_id: MACHINERY_TYPE.id, geojson: { type: 'Point', coordinates: [121.9, 13.4] } }),
    ];
    const totals = roadTotals(records, { types });
    expect(totals).toMatchObject({ roads: 4, traced: 2, waiting: 2, tracedOnly: 1, noLength: 1 });
    expect(totals.km).toBeCloseTo(2.5 + 1.112 + 3.2, 3);
    expect(roadNote(totals)).toBe('4 roads · 2 not yet traced · 1 measured from the map · 1 with no length yet');
  });

  it('are nothing when there are no roads', () => {
    expect(roadTotals([], { types })).toEqual({ roads: 0, km: 0, traced: 0, waiting: 0, tracedOnly: 0, noLength: 0 });
    expect(roadNote(roadTotals([], { types }))).toBe('0 roads');
  });
});

describe('a road not on the map', () => {
  it('waits for its traced line, in the badge and the list for the region', () => {
    const waiting = record({ geojson: null, qa_flags: ['no_coords'] });
    const outside = record({ qa_flags: ['out_of_province'] });
    const machine = record({ intervention_type_id: MACHINERY_TYPE.id, geojson: null, qa_flags: ['no_coords'] });
    expect([waiting, outside, machine].map((r) => unplottedLabel(r, { types }))).toEqual(['No traced line yet', 'Line outside Marinduque', 'No coordinates yet']);

    const [group] = awaitingLocation([waiting, outside, machine], { municipalities: [{ id: 1, name: 'Boac', psgc_code: '' }], types });
    expect(group.records.map((entry) => entry.issue).sort()).toEqual(['Line runs outside Marinduque', 'No coordinates yet', 'No traced line yet']);
  });
});
