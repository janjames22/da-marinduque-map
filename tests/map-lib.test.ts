import { describe, expect, it } from 'vitest';
import { permissionsFor } from '../src/modules/intervention-map/lib/permissions';
import type { Intervention, InterventionBarangay, InterventionType, MapData, StatusEntry } from '../src/modules/intervention-map/data/types';
import {
  binFor,
  buildShading,
  countByBarangay,
  GAP_NONE_COLOR,
  GAP_SOME_COLOR,
  liveRecords,
  recordsInView,
  unassignedRecords,
  ZERO_COLOR,
  type ViewFilters,
} from '../src/modules/intervention-map/lib/choropleth';
import {
  escapeHtml,
  fieldValue,
  isOnMap,
  locationWarning,
  popupHtml,
  recordName,
  statusDateLabel,
  statusTimeline,
} from '../src/modules/intervention-map/lib/display';

const MACHINERY = 1;
const SSIP = 2;
const HIDDEN_TYPE = 3;
const RICE = 10;
const CORN = 11;

function record(over: Partial<Intervention> & { id: string }): Intervention {
  return {
    intervention_type_id: MACHINERY,
    category_id: 1,
    title: null,
    banner_program_id: RICE,
    year_funded: 2022,
    quantity: 1,
    unit_cost: null,
    fund_source: null,
    beneficiary: 'Test FA',
    beneficiary_type_id: null,
    municipality_id: 1,
    barangay_id: 100,
    barangay_raw: 'Alpha',
    location_basis_id: 1,
    status_id: 1,
    attributes: {},
    remarks: null,
    data_source: 'test',
    qa_flags: [],
    geojson: { type: 'Point', coordinates: [121.9, 13.4] },
    plotted_barangay_id: null,
    plotted_barangay: null,
    plotted_municipality: null,
    version: 1,
    created_at: '2026-10-21T00:00:00Z',
    updated_at: '2026-10-21T00:00:00Z',
    deleted_at: null,
    ...over,
  };
}

const view = (over: Partial<ViewFilters> = {}): ViewFilters => ({
  mode: 'count',
  pickedProgramId: null,
  pickedTypeId: null,
  hiddenTypeIds: [],
  programId: null,
  yearFrom: null,
  yearTo: null,
  ...over,
});

const types = [
  { id: MACHINERY, is_active: true },
  { id: SSIP, is_active: true },
  { id: HIDDEN_TYPE, is_active: false },
] as InterventionType[];

const link = (intervention_id: string, barangay_id: number, link_source: InterventionBarangay['link_source'] = 'encoded') => ({
  intervention_id,
  barangay_id,
  link_source,
});

const ids = (records: Intervention[]) => records.map((r) => r.id);

describe('liveRecords', () => {
  it('leaves out soft-deleted records and inactive types', () => {
    const records = [
      record({ id: 'keep' }),
      record({ id: 'deleted', deleted_at: '2026-01-01' }),
      record({ id: 'inactive', intervention_type_id: HIDDEN_TYPE }),
    ];
    expect(ids(liveRecords(records, types))).toEqual(['keep']);
  });
});

describe('recordsInView', () => {
  const records = [
    record({ id: 'rice-2020', year_funded: 2020 }),
    record({ id: 'corn-2022', banner_program_id: CORN }),
    record({ id: 'ssip-2024', intervention_type_id: SSIP, year_funded: 2024 }),
    record({ id: 'no-year', year_funded: null }),
  ];

  it('shows everything by default', () => {
    expect(recordsInView(records, view())).toHaveLength(4);
  });

  it('respects the layer switches', () => {
    expect(ids(recordsInView(records, view({ hiddenTypeIds: [SSIP] })))).toEqual(['rice-2020', 'corn-2022', 'no-year']);
  });

  it('respects the program filter', () => {
    expect(ids(recordsInView(records, view({ programId: CORN })))).toEqual(['corn-2022']);
  });

  it('respects the year range, inclusive, and leaves out records with no year', () => {
    expect(ids(recordsInView(records, view({ yearFrom: 2022 })))).toEqual(['corn-2022', 'ssip-2024']);
    expect(ids(recordsInView(records, view({ yearTo: 2022 })))).toEqual(['rice-2020', 'corn-2022']);
    expect(ids(recordsInView(records, view({ yearFrom: 2022, yearTo: 2022 })))).toEqual(['corn-2022']);
  });

  it('uses the picked program in by-program mode, ignoring the program filter', () => {
    const result = recordsInView(records, view({ mode: 'program', pickedProgramId: CORN, programId: RICE }));
    expect(ids(result)).toEqual(['corn-2022']);
  });

  it('uses the picked type in by-type mode, even if that layer is switched off', () => {
    const result = recordsInView(records, view({ mode: 'type', pickedTypeId: SSIP, hiddenTypeIds: [SSIP] }));
    expect(ids(result)).toEqual(['ssip-2024']);
  });

  it('applies other filters on top of a gap view', () => {
    const result = recordsInView(records, view({ mode: 'gap', programId: CORN }));
    expect(ids(result)).toEqual(['corn-2022']);
  });
});

describe('countByBarangay', () => {
  it('counts a record in every barangay it is linked to', () => {
    const records = [record({ id: 'road' }), record({ id: 'point' })];
    const counts = countByBarangay(records, [
      link('road', 1, 'encoded'),
      link('road', 2, 'spatial'),
      link('road', 3, 'spatial'),
      link('point', 1),
    ]);
    expect([...counts.entries()].sort()).toEqual([
      [1, 2],
      [2, 1],
      [3, 1],
    ]);
  });

  it('ignores records outside the view', () => {
    const counts = countByBarangay([record({ id: 'a' })], [link('a', 1), link('filtered-out', 2)]);
    expect(counts.has(2)).toBe(false);
  });
});

describe('unassignedRecords', () => {
  it('lists records with no barangay link', () => {
    const records = [record({ id: 'linked' }), record({ id: 'loose', barangay_id: null })];
    expect(ids(unassignedRecords(records, [link('linked', 1)]))).toEqual(['loose']);
  });
});

describe('binFor', () => {
  it.each([
    [1, '1'],
    [2, '2'],
    [3, '3–4'],
    [4, '3–4'],
    [5, '5–9'],
    [9, '5–9'],
    [10, '10+'],
    [500, '10+'],
  ])('puts %i in the %s class', (count, label) => {
    expect(binFor(count)?.label).toBe(label);
  });

  it('has no class for zero', () => {
    expect(binFor(0)).toBeNull();
  });
});

describe('buildShading', () => {
  const barangays = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const counts = new Map([
    [1, 1],
    [2, 12],
  ]);

  it('shades by count, with a separate colour for zero, and darker for more', () => {
    const shading = buildShading('count', 'Title', counts, barangays);
    expect(shading.fillFor(3).color).toBe(ZERO_COLOR);
    expect(shading.fillFor(1).color).toBe(binFor(1)?.color);
    expect(shading.fillFor(2).color).toBe(binFor(10)?.color);
    expect(shading.fillFor(1).opacity).toBeGreaterThan(0);
  });

  it('gives a legend that accounts for every barangay', () => {
    const { legend } = buildShading('count', 'Title', counts, barangays);
    expect(legend.reduce((sum, entry) => sum + entry.barangays, 0)).toBe(4);
    expect(legend.find((e) => e.label === '0')?.barangays).toBe(2);
    expect(legend.find((e) => e.label === '1')?.barangays).toBe(1);
    expect(legend.find((e) => e.label === '10+')?.barangays).toBe(1);
  });

  it('splits the gap view into two classes, highlighting barangays with none', () => {
    const shading = buildShading('gap', 'Gap', counts, barangays);
    expect(shading.fillFor(3).color).toBe(GAP_NONE_COLOR);
    expect(shading.fillFor(1).color).toBe(GAP_SOME_COLOR);
    expect(shading.legend).toEqual([
      { label: 'None encoded yet', color: GAP_NONE_COLOR, barangays: 2 },
      { label: 'At least one', color: GAP_SOME_COLOR, barangays: 2 },
    ]);
  });

  it('has no fill or legend when switched off, but keeps the summary', () => {
    const shading = buildShading('off', 'Off', counts, barangays);
    expect(shading.fillFor(1).opacity).toBe(0);
    expect(shading.legend).toEqual([]);
    expect(shading.barangaysWithRecords).toBe(2);
  });
});

describe('statusDateLabel', () => {
  it('shows an as-of date as an as-of date, with its source', () => {
    expect(statusDateLabel({ status_date: '2026-10-21', date_basis: 'as_of', source_note: 'RAED report' })).toBe(
      'as of 2026-10-21 (RAED report)',
    );
  });

  it('shows a change date plainly', () => {
    expect(statusDateLabel({ status_date: '2026-11-02', date_basis: 'changed', source_note: null })).toBe('2026-11-02');
  });

  it('handles an as-of date with no source', () => {
    expect(statusDateLabel({ status_date: '2026-10-21', date_basis: 'as_of', source_note: null })).toBe('as of 2026-10-21');
  });
});

describe('statusTimeline', () => {
  it('runs oldest to newest for that record only', () => {
    const entry = (id: string, intervention_id: string, status_date: string, created_at = '2026-01-01') =>
      ({ id, intervention_id, status_date, created_at }) as StatusEntry;
    const history = [
      entry('c', 'r', '2025-01-01'),
      entry('a', 'r', '2023-01-01'),
      entry('other', 'x', '2024-01-01'),
      entry('b', 'r', '2024-01-01'),
    ];
    expect(statusTimeline('r', history).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

const places = {
  barangays: [{ id: 100, municipality_id: 1, name: 'Alpha', psgc_code: 'A', attributes: {}, version: 1 }],
  municipalities: [{ id: 1, name: 'Boac', psgc_code: 'B' }],
};

describe('isOnMap', () => {
  it('keeps unlocated and out-of-province records off the map', () => {
    expect(isOnMap(record({ id: 'a', geojson: null, qa_flags: ['no_coords'] }))).toBe(false);
    expect(isOnMap(record({ id: 'b', qa_flags: ['out_of_province'] }))).toBe(false);
  });

  it('keeps a mismatched point on the map', () => {
    expect(isOnMap(record({ id: 'c', qa_flags: ['barangay_mismatch'] }))).toBe(true);
  });
});

describe('locationWarning', () => {
  it('says where a mismatched point is plotted and how it was encoded', () => {
    const warning = locationWarning(
      record({ id: 'a', qa_flags: ['barangay_mismatch'], plotted_barangay: 'Beta', plotted_municipality: 'Gasan' }),
      places,
    );
    expect(warning).toBe('Plotted in Beta, Gasan; encoded as Alpha, Boac');
  });

  it('falls back to the raw name for a record with no linked barangay', () => {
    const warning = locationWarning(
      record({
        id: 'a',
        barangay_id: null,
        barangay_raw: 'Pingan',
        qa_flags: ['muni_mismatch'],
        plotted_barangay: 'Beta',
        plotted_municipality: 'Gasan',
      }),
      places,
    );
    expect(warning).toBe('Plotted in Beta, Gasan; encoded as Pingan, Boac');
  });

  it('explains why a record is not on the map', () => {
    expect(locationWarning(record({ id: 'a', geojson: null, qa_flags: ['no_coords'] }), places)).toMatch(/not on the map/);
    expect(locationWarning(record({ id: 'b', qa_flags: ['out_of_province'] }), places)).toMatch(/outside Marinduque/);
  });

  it('says nothing for a sound record, or one that only shares coordinates', () => {
    expect(locationWarning(record({ id: 'a' }), places)).toBeNull();
    expect(locationWarning(record({ id: 'b', qa_flags: ['duplicate_point'] }), places)).toBeNull();
  });
});

describe('fieldValue', () => {
  it('formats each input kind', () => {
    expect(fieldValue({ key: 'a', label: 'A', input: 'number', unit: 'ha' }, 12)).toBe('12 ha');
    expect(fieldValue({ key: 'a', label: 'A', input: 'yes_no' }, true)).toBe('Yes');
    expect(fieldValue({ key: 'a', label: 'A', input: 'yes_no' }, false)).toBe('No');
    const dropdown = { key: 'a', label: 'A', input: 'dropdown' as const, options: [{ value: 'on_going', label: 'On-going' }] };
    expect(fieldValue(dropdown, 'on_going')).toBe('On-going');
  });

  it('treats empty values as not set, but keeps a zero', () => {
    const field = { key: 'a', label: 'A', input: 'number' as const };
    expect(fieldValue(field, null)).toBeNull();
    expect(fieldValue(field, undefined)).toBeNull();
    expect(fieldValue(field, '')).toBeNull();
    expect(fieldValue(field, 0)).toBe('0');
  });
});

describe('recordName', () => {
  const data = { categories: [{ id: 1, name: 'Hand Tractor', intervention_type_id: 1, sort_order: 1, is_active: true }] };

  it('uses the title, then the category, and adds the variant', () => {
    expect(recordName(record({ id: 'a', title: 'Bacong SPIS' }), data)).toBe('Bacong SPIS');
    expect(recordName(record({ id: 'b' }), data)).toBe('Hand Tractor');
    expect(recordName(record({ id: 'c', attributes: { variant: 'Pull type' } }), data)).toBe('Hand Tractor (Pull type)');
  });
});

describe('popupHtml', () => {
  const data = {
    ...places,
    icons: [],
    programs: [{ id: RICE, code: 'rice', name: 'Rice Program', color: '#000000', sort_order: 1, is_active: true }],
    categories: [{ id: 1, name: 'Hand Tractor', intervention_type_id: 1, sort_order: 1, is_active: true }],
    statuses: [{ id: 1, name: 'Turned-over', color: '#000000' }],
    locationBases: [{ id: 1, name: 'Unknown', sort_order: 1, is_active: true }],
    beneficiaryTypes: [],
    typeStatuses: [],
    types: [
      {
        id: MACHINERY,
        code: 'm',
        name: 'Farm Machinery',
        geometry_kind: 'point',
        icon_id: null,
        color: '#000000',
        sort_order: 1,
        is_active: true,
        core_field_rules: {},
        field_schema: {
          fields: [
            { key: 'engine_no', label: 'Engine No.', input: 'text' },
            { key: 'old', label: 'Old field', input: 'text', archived: true },
          ],
        },
      },
    ],
    barangayFields: { fields: [] },
    interventions: [],
    links: [],
    photos: [],
    statusHistory: [
      {
        id: 's',
        intervention_id: 'a',
        status_id: 1,
        status_date: '2026-10-21',
        date_basis: 'as_of',
        source_note: 'RAED report',
        remarks: null,
        photo_id: null,
        created_at: '2026-11-05',
      },
    ],
    dataSources: [],
    members: [{ id: 'u1', full_name: 'Enzo <Encoder>' }],
  } as unknown as MapData;

  it('shows the details, location basis and the as-of status', () => {
    const html = popupHtml(record({ id: 'a', attributes: { engine_no: 'E-1', old: 'hidden' } }), data, permissionsFor('admin'));
    expect(html).toContain('Hand Tractor');
    expect(html).toContain('Rice Program');
    expect(html).toContain('Unknown');
    expect(html).toContain('as of 2026-10-21 (RAED report)');
    expect(html).toContain('Engine No.');
    expect(html).toContain('E-1');
    expect(html).not.toContain('Old field');
    expect(html).toContain('https://www.google.com/maps?q=13.4%2C121.9');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('shows the plotted-in warning', () => {
    const html = popupHtml(
      record({ id: 'a', qa_flags: ['barangay_mismatch'], plotted_barangay: 'Beta', plotted_municipality: 'Gasan' }),
      data,
      permissionsFor('viewer'),
    );
    expect(html).toContain('Plotted in Beta, Gasan; encoded as Alpha, Boac');
  });

  it('escapes every value from the data', () => {
    const attack = '<img src=x onerror=alert(1)>';
    const html = popupHtml(
      record({ id: 'a', title: attack, beneficiary: attack, remarks: attack, attributes: { engine_no: attack } }),
      data,
      permissionsFor('admin'),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  const actionsIn = (html: string) => [...html.matchAll(/data-action="([a-z-]+)"/g)].map((match) => match[1]);

  it('offers each role only what it can do', () => {
    const flagged = record({ id: 'a', qa_flags: ['barangay_mismatch'] });
    const editing = ['edit', 'status', 'resolve', 'history', 'delete'];
    expect(actionsIn(popupHtml(flagged, data, permissionsFor('admin')))).toEqual(expect.arrayContaining(editing));
    expect(actionsIn(popupHtml(flagged, data, permissionsFor('encoder')))).toEqual(expect.arrayContaining(editing));

    const forViewer = actionsIn(popupHtml(flagged, data, permissionsFor('viewer')));
    for (const action of editing) expect(forViewer).not.toContain(action);
    expect(forViewer).toContain('copy-coordinates');
  });

  it('shows a Viewer the status timeline', () => {
    expect(popupHtml(record({ id: 'a' }), data, permissionsFor('viewer'))).toContain('as of 2026-10-21 (RAED report)');
  });

  it('says who added a status, escaped, when that person is known', () => {
    const withPerson = {
      ...data,
      statusHistory: data.statusHistory.map((entry) => ({ ...entry, created_by: 'u1' })),
    };
    const html = popupHtml(record({ id: 'a' }), withPerson, permissionsFor('viewer'));
    expect(html).toContain('By Enzo &lt;Encoder&gt;');
    expect(popupHtml(record({ id: 'a' }), data, permissionsFor('viewer'))).not.toContain('By ');
  });

  it('escapes all five special characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;');
  });
});
