import { describe, expect, it } from 'vitest';
import type { AuditEntry, FieldSchema, Intervention, InterventionType, MapData } from '../src/modules/intervention-map/data/types';
import { auditChanges, auditHeadline } from '../src/modules/intervention-map/lib/audit-display';
import { manilaDate, manilaToday, manilaYear, isValidDate } from '../src/modules/intervention-map/lib/dates';
import { attributesFromText, attributesToText, buildPatch, formFromRecord, valuesFromForm, valuesFromRecord } from '../src/modules/intervention-map/lib/form-values';
import { possibleDuplicates } from '../src/modules/intervention-map/lib/qa';
import { validateAttributes, validateIntervention, validateStatus } from '../src/modules/intervention-map/lib/validation';

const schema: FieldSchema = {
  fields: [
    { key: 'serial_no', label: 'Serial No.', input: 'text' },
    { key: 'area', label: 'Area', input: 'number', unit: 'ha' },
    { key: 'turned_over', label: 'Turned over', input: 'date' },
    { key: 'drive', label: 'Drive', input: 'dropdown', options: [{ value: 'solar', label: 'Solar' }, { value: 'old', label: 'Old', archived: true }] },
    { key: 'has_operator', label: 'Has operator', input: 'yes_no' },
    { key: 'retired', label: 'Retired', input: 'text', archived: true, required: true },
  ],
};

const type: InterventionType = {
  id: 1,
  code: 'farm-machinery',
  name: 'Farm Machinery',
  geometry_kind: 'point',
  icon_id: null,
  color: '#000000',
  core_field_rules: { category_id: 'required', year_funded: 'required', beneficiary: 'required' },
  field_schema: schema,
  sort_order: 1,
  is_active: true,
  version: 1,
};

function record(over: Partial<Intervention> = {}): Intervention {
  return {
    id: 'r1',
    intervention_type_id: 1,
    category_id: 5,
    title: null,
    banner_program_id: 2,
    year_funded: 2024,
    quantity: 1,
    unit_cost: null,
    fund_source: null,
    beneficiary: 'Tumapon FA',
    beneficiary_type_id: null,
    municipality_id: 1,
    barangay_id: 10,
    barangay_raw: null,
    location_basis_id: null,
    status_id: 1,
    attributes: {},
    remarks: null,
    data_source: null,
    qa_flags: [],
    geojson: { type: 'Point', coordinates: [122, 13.4] },
    plotted_barangay_id: null,
    plotted_barangay: null,
    plotted_municipality: null,
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...over,
  };
}

const context = {
  type,
  categories: [
    { id: 5, name: 'Tractor', intervention_type_id: 1, sort_order: 1, is_active: true },
    { id: 6, name: 'SPIS', intervention_type_id: 2, sort_order: 1, is_active: true },
    { id: 7, name: 'Other', intervention_type_id: null, sort_order: 1, is_active: true },
  ],
  barangays: [{ id: 10, municipality_id: 1, name: 'Alpha', psgc_code: 'a', attributes: {}, version: 1 }],
  now: new Date('2026-11-05T00:00:00Z'),
};

describe('custom field values', () => {
  it('turn stored values into text and back', () => {
    const stored = { serial_no: 'SN-1', area: 1.5, turned_over: '2026-01-02', drive: 'solar', has_operator: false };
    const entered = attributesToText(schema, stored);
    expect(entered).toMatchObject({ area: '1.5', has_operator: 'no' });
    expect(attributesFromText(schema, entered)).toEqual(stored);
  });

  it('remove blanks, and keep values of archived fields', () => {
    const result = attributesFromText(schema, { serial_no: '  ', area: '', has_operator: '' }, { serial_no: 'old', retired: 'keep' });
    expect(result).toEqual({ retired: 'keep' });
  });

  it('keep the value zero, which isn\'t blank', () => {
    expect(attributesFromText(schema, { area: '0' })).toEqual({ area: 0 });
  });
});

describe('validateAttributes', () => {
  it('accepts valid values', () => {
    expect(validateAttributes(schema, { serial_no: 'x', area: 2, turned_over: '2026-02-28', drive: 'old', has_operator: true })).toEqual({});
  });

  it('names each bad value', () => {
    const errors = validateAttributes(schema, { serial_no: 1, area: Number.NaN, turned_over: '2026-02-31', drive: 'gas', has_operator: 'yes', nope: 1 });
    expect(Object.keys(errors).sort()).toEqual([
      'attributes.area',
      'attributes.drive',
      'attributes.has_operator',
      'attributes.nope',
      'attributes.serial_no',
      'attributes.turned_over',
    ]);
  });

  it('requires a required field unless it\'s archived', () => {
    const required: FieldSchema = { fields: [{ key: 'a', label: 'A', input: 'text', required: true }] };
    expect(validateAttributes(required, {})).toEqual({ 'attributes.a': 'A is required.' });
    expect(validateAttributes(schema, {})).toEqual({});
  });
});

describe('validateIntervention', () => {
  const values = valuesFromRecord(record());

  it('accepts a complete record', () => {
    expect(validateIntervention(values, null, context)).toEqual({});
  });

  it("takes a line only for a line type, and only with two points or more", () => {
    const road = { ...context, type: { ...context.type, geometry_kind: 'line' as const } };
    expect(validateIntervention({ ...values, point: null, line: [[121.85, 13.45], [121.86, 13.46]] }, null, road)).toEqual({});
    expect(validateIntervention({ ...values, point: null, line: null }, null, road)).toEqual({});
    expect(Object.keys(validateIntervention({ ...values, point: null, line: [[121.85, 13.45]] }, null, road))).toEqual(['line']);
    expect(Object.keys(validateIntervention({ ...values, line: [[121.85, 13.45], [121.86, 13.46]] }, null, context))).toEqual(['intervention_type_id']);
    expect(Object.keys(validateIntervention({ ...values, point: { lat: 13.45, lng: 121.85 } }, null, road))).toEqual(['intervention_type_id']);
  });

  it('requires what the type requires on a new record', () => {
    const errors = validateIntervention({ ...values, category_id: null, year_funded: null, beneficiary: null, title: 'A title' }, null, context);
    expect(Object.keys(errors).sort()).toEqual(['beneficiary', 'category_id', 'year_funded']);
  });

  it('lets an old record missing a required value be edited, but not lose one', () => {
    const old = { ...values, beneficiary: null };
    expect(validateIntervention({ ...old, remarks: 'x' }, old, context)).toEqual({});
    expect(Object.keys(validateIntervention({ ...values, beneficiary: null }, values, context))).toEqual(['beneficiary']);
  });

  it('checks the year against the Philippine calendar', () => {
    expect(validateIntervention({ ...values, year_funded: 2026 }, null, context)).toEqual({});
    expect(validateIntervention({ ...values, year_funded: 2027 }, null, context).year_funded).toContain('future');
    expect(validateIntervention({ ...values, year_funded: 1999 }, null, context).year_funded).toContain('2000');
    expect(validateIntervention({ ...values, year_funded: 2024.5 }, null, context).year_funded).toBeDefined();
  });

  it('checks quantity and cost', () => {
    expect(validateIntervention({ ...values, quantity: 0 }, null, context).quantity).toBeDefined();
    expect(validateIntervention({ ...values, quantity: Number.NaN }, null, context).quantity).toBeDefined();
    expect(validateIntervention({ ...values, unit_cost: -1 }, null, context).unit_cost).toBeDefined();
  });

  it('allows a category of this type or of any type, but not another type\'s', () => {
    expect(validateIntervention({ ...values, category_id: 7 }, null, context)).toEqual({});
    expect(validateIntervention({ ...values, category_id: 6 }, null, context).category_id).toContain('belong');
  });

  it('needs the barangay to be in the municipality', () => {
    expect(validateIntervention({ ...values, municipality_id: 2 }, null, context).barangay_id).toBeDefined();
    expect(validateIntervention({ ...values, municipality_id: 0, barangay_id: null }, null, context).municipality_id).toBeDefined();
  });

  it('checks custom fields only when they change', () => {
    const required: InterventionType = { ...type, field_schema: { fields: [{ key: 'a', label: 'A', input: 'text', required: true }] } };
    const old = { ...values, attributes: {} };
    expect(validateIntervention({ ...old, remarks: 'x' }, old, { ...context, type: required })).toEqual({});
    expect(validateIntervention({ ...old, attributes: { a: '' } }, old, { ...context, type: required })).toEqual({});
    expect(validateIntervention(old, null, { ...context, type: required })['attributes.a']).toBeDefined();
  });
});

describe('validateStatus', () => {
  const list = [{ intervention_type_id: 1, status_id: 3, sort_order: 1, is_default: true, counts_as_operational: true }];
  const now = new Date('2026-11-05T17:00:00Z'); // already the 6th in Manila

  it('accepts today in Manila, even when it\'s still yesterday in UTC', () => {
    expect(validateStatus({ status_id: 3, status_date: '2026-11-06' }, 1, list, now)).toEqual({});
  });

  it('refuses a future date, a bad date and a status not on the list', () => {
    expect(validateStatus({ status_id: 3, status_date: '2026-11-07' }, 1, list, now).status_date).toContain('future');
    expect(validateStatus({ status_id: 3, status_date: '2026-02-30' }, 1, list, now).status_date).toContain('valid');
    expect(validateStatus({ status_id: 9, status_date: '2026-11-01' }, 1, list, now).status_id).toBeDefined();
    expect(validateStatus({ status_id: null, status_date: '2026-11-01' }, 1, list, now).status_id).toBeDefined();
  });
});

describe('dates', () => {
  it('uses the Philippine date', () => {
    expect(manilaToday(new Date('2026-12-31T16:30:00Z'))).toBe('2027-01-01');
    expect(manilaYear(new Date('2026-12-31T16:30:00Z'))).toBe(2027);
  });

  it('gives the Philippine date of a saved time, not the UTC one', () => {
    expect(manilaDate('2026-11-11T16:30:00+00:00')).toBe('2026-11-12');
    expect(manilaDate('2026-11-11T15:59:59Z')).toBe('2026-11-11');
    expect(manilaDate('2026-11-12')).toBe('2026-11-12');
  });

  it('rejects dates that don\'t exist', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('01/02/2026')).toBe(false);
  });
});

describe('buildPatch', () => {
  const valuesFor = (base: Intervention, change: (form: ReturnType<typeof formFromRecord>) => void) => {
    const form = formFromRecord(base, schema);
    change(form);
    return valuesFromForm(form, valuesFromRecord(base).point, schema, base.attributes);
  };

  it('is empty when nothing changed', () => {
    const base = record({ attributes: { area: 1.5 } });
    expect(buildPatch(base, valuesFor(base, () => {}), base)).toEqual({});
  });

  it('holds only what changed', () => {
    const base = record();
    expect(buildPatch(base, valuesFor(base, (form) => void (form.remarks = 'New')), base)).toEqual({ remarks: 'New' });
  });

  it('sends a moved or cleared location, and nothing if it\'s the same', () => {
    const base = record();
    const values = valuesFromRecord(base);
    expect(buildPatch(base, { ...values, point: { lat: 13.5, lng: 122 } }, base)).toEqual({ point: { lat: 13.5, lng: 122 } });
    expect(buildPatch(base, { ...values, point: null }, base)).toEqual({ point: null });
    expect(buildPatch(base, { ...values, point: { lat: 13.4, lng: 122 } }, base)).toEqual({});
  });

  // Phase 16b: a road's line, as the form draws it.
  it("sends a reshaped or cleared line, nothing for the same line, and keeps a line the form leaves out", () => {
    const LINE: [number, number][] = [[121.85, 13.45], [121.86, 13.46]];
    const road = record({ geojson: { type: 'LineString', coordinates: LINE } });
    const values = valuesFromRecord(road);
    expect(values.line).toEqual(LINE);
    expect(buildPatch(road, values, road)).toEqual({});
    expect(buildPatch(road, { ...values, line: [...LINE, [121.87, 13.47]] }, road)).toEqual({ line: [...LINE, [121.87, 13.47]] });
    expect(buildPatch(road, { ...values, line: null }, road)).toEqual({ line: null });
    const { line: _left, ...withoutLine } = values;
    expect(buildPatch(road, withoutLine, road)).toEqual({});

    // A road waiting for its line gets one.
    const waiting = record({ geojson: null });
    expect(valuesFromRecord(waiting)).not.toHaveProperty('line');
    expect(buildPatch(waiting, { ...valuesFromRecord(waiting), line: LINE }, waiting)).toEqual({ line: LINE });
    // A line in several parts can't be drawn here, so the form never sends it.
    const parts = record({ geojson: { type: 'MultiLineString', coordinates: [LINE, LINE] } });
    expect(valuesFromRecord(parts)).not.toHaveProperty('line');
  });

  it('keeps fields someone else changed in the meantime', () => {
    const base = record({ attributes: { serial_no: 'A', area: 1 } });
    const latest = record({ version: 2, remarks: 'Theirs', attributes: { serial_no: 'A', area: 9, drive: 'solar' } });
    const values = valuesFor(base, (form) => void (form.attributes.serial_no = 'B'));

    expect(buildPatch(base, values, latest)).toEqual({ attributes: { serial_no: 'B', area: 9, drive: 'solar' } });
  });

  it('removes only the custom field this person cleared', () => {
    const base = record({ attributes: { serial_no: 'A', area: 1 } });
    const latest = record({ version: 2, attributes: { serial_no: 'A', area: 1, drive: 'solar' } });
    const values = valuesFor(base, (form) => void (form.attributes.serial_no = ''));
    expect(buildPatch(base, values, latest)).toEqual({ attributes: { area: 1, drive: 'solar' } });
  });
});

describe('possibleDuplicates', () => {
  const input = { id: null, category_id: 5, beneficiary: ' tumapon  fa ', year_funded: 2024, barangay_id: 10 };

  it('matches on category, beneficiary, year and barangay, ignoring case and spacing', () => {
    expect(possibleDuplicates(input, [record()]).map((r) => r.id)).toEqual(['r1']);
  });

  it.each([
    ['category', { category_id: 6 }],
    ['beneficiary', { beneficiary: 'Other FA' }],
    ['year', { year_funded: 2023 }],
    ['barangay', { barangay_id: 11 }],
  ])('a different %s is not a duplicate', (_name, over) => {
    expect(possibleDuplicates(input, [record(over)])).toEqual([]);
  });

  it('ignores the record itself and deleted records', () => {
    expect(possibleDuplicates({ ...input, id: 'r1' }, [record()])).toEqual([]);
    expect(possibleDuplicates(input, [record({ deleted_at: '2026-01-01' })])).toEqual([]);
  });

  it('doesn\'t guess until all four are known', () => {
    expect(possibleDuplicates({ ...input, beneficiary: '' }, [record()])).toEqual([]);
    expect(possibleDuplicates({ ...input, year_funded: null }, [record()])).toEqual([]);
    expect(possibleDuplicates({ ...input, barangay_id: null }, [record({ barangay_id: null })])).toEqual([]);
    expect(possibleDuplicates({ ...input, category_id: null }, [record({ category_id: null })])).toEqual([]);
  });
});

describe('audit display', () => {
  const lookups = {
    categories: context.categories,
    programs: [{ id: 2, code: 'rice', name: 'Rice Program', color: '#000000', sort_order: 1, is_active: true }],
    beneficiaryTypes: [],
    municipalities: [{ id: 1, name: 'Boac', psgc_code: 'b' }],
    barangays: [
      { id: 10, municipality_id: 1, name: 'Alpha', psgc_code: 'a', attributes: {}, version: 1 },
      { id: 11, municipality_id: 1, name: 'Beta', psgc_code: 'c', attributes: {}, version: 1 },
    ],
    locationBases: [],
    statuses: [{ id: 3, name: 'Serviceable', color: '#000000' }],
    types: [type],
  } as unknown as Pick<MapData, 'categories' | 'programs' | 'beneficiaryTypes' | 'municipalities' | 'barangays' | 'locationBases' | 'statuses' | 'types'>;

  const entry = (over: Partial<AuditEntry>): AuditEntry => ({
    id: 1,
    table_name: 'interventions',
    record_id: 'r1',
    action: 'update',
    old_row: null,
    new_row: null,
    actor_id: null,
    context: null,
    at: '2026-11-05T00:00:00Z',
    ...over,
  });

  it('describes an edit in words, without bookkeeping columns', () => {
    const changes = auditChanges(
      entry({
        old_row: { barangay_id: 10, remarks: null, version: 1, updated_at: 'a', qa_flags: ['x'], geojson: { type: 'Point', coordinates: [122, 13] }, attributes: { area: 1 } },
        new_row: { barangay_id: 11, remarks: 'Note', version: 2, updated_at: 'b', qa_flags: [], geojson: { type: 'Point', coordinates: [122.5, 13.5] }, attributes: { area: 2, serial_no: 'S' } },
      }),
      lookups,
      schema,
    );
    expect(changes).toEqual([
      { field: 'Barangay', from: 'Alpha', to: 'Beta' },
      { field: 'Remarks', from: '(none)', to: 'Note' },
      { field: 'Location', from: '13, 122', to: '13.5, 122.5' },
      { field: 'Area', from: '1 ha', to: '2 ha' },
      { field: 'Serial No.', from: '(none)', to: 'S' },
    ]);
  });

  it('has no changes to list for a new row', () => {
    expect(auditChanges(entry({ action: 'insert', new_row: { remarks: 'x' } }), lookups)).toEqual([]);
  });

  it('gives each kind of entry a headline', () => {
    expect(auditHeadline(entry({ action: 'insert' }), lookups)).toBe('Record created');
    expect(auditHeadline(entry({ action: 'soft_delete' }), lookups)).toBe('Record deleted');
    expect(auditHeadline(entry({ action: 'restore' }), lookups)).toBe('Record restored');
    expect(auditHeadline(entry({}), lookups)).toBe('Record edited');
    expect(auditHeadline(entry({ table_name: 'status_history', action: 'insert', new_row: { status_id: 3 } }), lookups)).toBe('Status set to Serviceable');
    expect(auditHeadline(entry({ table_name: 'intervention_photos', action: 'insert' }), lookups)).toBe('Photo added');
  });
});
