// An Admin's changes to the lists and forms: the browser's rules against the real triggers, what each
// role can do, the Supabase store against the real database functions, and local mode doing the same.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildLocalSeed } from '../scripts/build-local-seed';
import * as localAdmin from '../src/modules/intervention-map/data/local-admin';
import * as engine from '../src/modules/intervention-map/data/local-engine';
import { stateFromSeed, type LocalSeed, type LocalState } from '../src/modules/intervention-map/data/local-store';
import { ConflictError, ValidationError, type DataStore, type InterventionValues, type TypeStatusValues, type TypeValues } from '../src/modules/intervention-map/data/store';
import { createSupabaseStore } from '../src/modules/intervention-map/data/supabase-store';
import type { FieldDefinition, FieldSchema, MapData } from '../src/modules/intervention-map/data/types';
import { buildFields } from '../src/modules/intervention-map/export/fields';
import {
  coreRulesProblem,
  draftProblems,
  draftsFromSchema,
  fieldSchemaChangeProblem,
  fieldSchemaProblem,
  iconProblem,
  newCode,
  newFieldKey,
  schemaFromDrafts,
  type FieldDraft,
} from '../src/modules/intervention-map/lib/admin-rules';
import { fieldValue } from '../src/modules/intervention-map/lib/display';
import { buildPatch, defaultStatusId, PENDING_PHOTO, statusChoices } from '../src/modules/intervention-map/lib/form-values';
import { buildPlaceIndex } from '../src/modules/intervention-map/lib/qa';
import { createTestDb } from './helpers/db';
import { createPgliteBackend, type PgliteBackend } from './helpers/pglite-backend';

const ADMIN = 'd0000000-0000-4000-8000-000000000001';
const ENCODER = 'd0000000-0000-4000-8000-000000000002';
const VIEWER = 'd0000000-0000-4000-8000-000000000003';
const NO_PROFILE = 'd0000000-0000-4000-8000-000000000004';
const FORMER_ADMIN = 'd0000000-0000-4000-8000-000000000005';

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/></svg>';

let db: PGlite;
let adminBackend: PgliteBackend;
let admin: DataStore;
let encoder: DataStore;
let viewer: DataStore;
let data: MapData;
let local: LocalState;
let context: engine.EngineContext;

const storeFor = (id: string, role: 'admin' | 'encoder' | 'viewer') => {
  const backend = createPgliteBackend(db, id);
  return { backend, store: createSupabaseStore(backend, { id, full_name: role, role }) };
};

// Always rolled back, so a case can't affect the next one.
async function attempt(account: string, sql: string, params: unknown[] = [], setup?: string) {
  await db.exec('begin');
  try {
    if (setup) await db.exec(setup);
    await db.exec(account ? 'set local role authenticated' : 'set local role anon');
    await db.query(`select set_config('request.jwt.sub', $1, true)`, [account]);
    const result = await db.query<Record<string, unknown>>(sql, params);
    return { ok: true, rows: result.rows, affected: result.affectedRows ?? 0, code: undefined as string | undefined, message: undefined as string | undefined };
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return { ok: false, rows: [], affected: 0, code: failure.code, message: failure.message };
  } finally {
    await db.exec('rollback');
  }
}

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [ADMIN, ENCODER, VIEWER, NO_PROFILE, FORMER_ADMIN]) await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(
    `insert into profiles (id, full_name, role, deactivated_at) values
       ($1, 'Ana Admin', 'admin', null), ($2, 'Enzo Encoder', 'encoder', null), ($3, 'Vera Viewer', 'viewer', null), ($4, 'Former Admin', 'admin', now())`,
    [ADMIN, ENCODER, VIEWER, FORMER_ADMIN],
  );

  const parts = storeFor(ADMIN, 'admin');
  adminBackend = parts.backend;
  admin = parts.store;
  encoder = storeFor(ENCODER, 'encoder').store;
  viewer = storeFor(VIEWER, 'viewer').store;
  data = await admin.load();

  // Local mode starts from the same lists, from the real migrations.
  local = stateFromSeed(JSON.parse(JSON.stringify(await buildLocalSeed(db))) as LocalSeed, 'test');
  const boundary = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'boundaries', `${name}.geojson`), 'utf8')) as GeoJSON.FeatureCollection;
  let next = 0;
  context = {
    types: local.fixed.types,
    categories: local.fixed.categories,
    typeStatuses: local.fixed.typeStatuses,
    municipalities: local.fixed.municipalities,
    barangayFields: local.fixed.barangayFields,
    lists: local.fixed,
    places: buildPlaceIndex({ barangays: boundary('barangays'), municipalities: boundary('municipalities') }, { barangays: local.rows.barangays, municipalities: local.fixed.municipalities }),
    now: () => '2026-11-07T00:00:00.000Z',
    newId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
  };
}, 180_000);

afterAll(async () => {
  await db.close();
});

const field = (over: Partial<FieldDefinition> = {}) => ({ key: 'a', label: 'A', input: 'text', ...over }) as FieldDefinition;
const schemaOf = (...fields: FieldDefinition[]): FieldSchema => ({ fields });
const statusId = (name: string) => data.statuses.find((s) => s.name === name)!.id;

const typeValues = (over: Partial<TypeValues> = {}): TypeValues => ({
  code: `type-${Math.random().toString(36).slice(2, 10)}`,
  name: `Type ${Math.random().toString(36).slice(2, 10)}`,
  geometry_kind: 'point',
  icon_id: null,
  color: '#123456',
  core_field_rules: {},
  field_schema: { fields: [] },
  sort_order: 50,
  is_active: true,
  ...over,
});

const statusList = (names: string[], defaultName = names[0]): TypeStatusValues[] =>
  names.map((name) => ({ status_id: statusId(name), is_default: name === defaultName, counts_as_operational: name === 'Operational' }));

const typeArgs = (values: TypeValues, statuses: TypeStatusValues[]) => [null, null, JSON.stringify(values), JSON.stringify(statuses)];
const SAVE_TYPE = 'select public.save_intervention_type($1, $2, $3::jsonb, $4::jsonb)';

const recordValues = (typeId: number, over: Partial<InterventionValues> = {}): InterventionValues => {
  const barangay = data.barangays.find((b) => b.name === 'Bantad')!;
  return {
    intervention_type_id: typeId,
    category_id: null,
    title: 'A test record',
    banner_program_id: null,
    year_funded: 2024,
    quantity: 1,
    unit_cost: null,
    fund_source: null,
    beneficiary: 'Test FCA',
    beneficiary_type_id: null,
    municipality_id: barangay.municipality_id,
    barangay_id: barangay.id,
    location_basis_id: null,
    point: null,
    attributes: {},
    remarks: null,
    ...over,
  };
};

const jpeg = (name = 'site.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, { type: 'image/jpeg' });

describe('the browser\'s rules match the database', () => {
  const inDatabase = (schema: unknown) => attempt(ADMIN, `update public.intervention_types set field_schema = $1::jsonb where code = 'other'`, [JSON.stringify(schema)]);

  describe.each([
    ['a plain field', schemaOf(field()), true],
    ['several kinds', schemaOf(field(), field({ key: 'b', label: 'B', input: 'number', unit: 'ha' }), field({ key: 'c', label: 'C', input: 'date' }), field({ key: 'd', label: 'D', input: 'yes_no' }), field({ key: 'e', label: 'E', input: 'photo' })), true],
    ['a dropdown', schemaOf(field({ input: 'dropdown', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y', archived: true }] })), true],
    ['a key with capitals', schemaOf(field({ key: 'Bad Key' })), false],
    ['a key starting with a digit', schemaOf(field({ key: '1a' })), false],
    ['the same key twice', schemaOf(field(), field({ label: 'Other' })), false],
    ['a blank label', schemaOf(field({ label: '   ' })), false],
    ['an unknown kind', schemaOf(field({ input: 'colour' as FieldDefinition['input'] })), false],
    ['a dropdown with no options', schemaOf(field({ input: 'dropdown', options: [] })), false],
    ['an option with a blank label', schemaOf(field({ input: 'dropdown', options: [{ value: 'x', label: ' ' }] })), false],
    ['an option with a blank value', schemaOf(field({ input: 'dropdown', options: [{ value: '', label: 'X' }] })), false],
    ['the same option twice', schemaOf(field({ input: 'dropdown', options: [{ value: 'x', label: 'X' }, { value: 'x', label: 'Y' }] })), false],
  ])('a field schema with %s', (_name, schema, allowed) => {
    it('gets the same answer from both', async () => {
      expect(fieldSchemaProblem(schema) === null).toBe(allowed);
      expect((await inDatabase(schema)).ok).toBe(allowed);
    });
  });

  describe('changing a saved schema', () => {
    const before = schemaOf(field({ input: 'dropdown', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] }), field({ key: 'b', label: 'B' }));
    const setup = `update public.intervention_types set field_schema = '${JSON.stringify(before)}'::jsonb where code = 'other'`;

    it.each([
      ['relabelling and reordering', schemaOf(field({ key: 'b', label: 'New B' }), field({ label: 'New A', input: 'dropdown', options: [{ value: 'y', label: 'New Y' }, { value: 'x', label: 'X' }] })), true],
      ['archiving a field and an option', schemaOf(field({ input: 'dropdown', options: [{ value: 'x', label: 'X', archived: true }, { value: 'y', label: 'Y' }] }), field({ key: 'b', label: 'B', archived: true })), true],
      ['adding a field and an option', schemaOf(field({ input: 'dropdown', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }] }), field({ key: 'b', label: 'B' }), field({ key: 'c', label: 'C' })), true],
      ['removing a field', schemaOf(field({ input: 'dropdown', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] })), false],
      ['removing an option', schemaOf(field({ input: 'dropdown', options: [{ value: 'x', label: 'X' }] }), field({ key: 'b', label: 'B' })), false],
      ['changing a kind', schemaOf(field({ input: 'dropdown', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] }), field({ key: 'b', label: 'B', input: 'number' })), false],
    ])('%s', async (_name, after, allowed) => {
      expect(fieldSchemaChangeProblem(before, after) === null).toBe(allowed);
      const result = await attempt(ADMIN, `update public.intervention_types set field_schema = $1::jsonb where code = 'other'`, [JSON.stringify(after)], setup);
      expect(result.ok, result.message).toBe(allowed);
    });
  });

  it.each([
    ['required, optional and hidden', { category_id: 'required', title: 'optional', remarks: 'hidden' }, true],
    ['a field that isn\'t a standard one', { engine_no: 'required' }, false],
    ['an unknown rule', { title: 'sometimes' }, false],
    ['both ways of naming a record hidden', { category_id: 'hidden', title: 'hidden' }, false],
  ])('standard field rules: %s', async (_name, rules, allowed) => {
    expect(coreRulesProblem(rules as never) === null).toBe(allowed);
    const result = await attempt(ADMIN, `update public.intervention_types set core_field_rules = $1::jsonb where code = 'other'`, [JSON.stringify(rules)]);
    expect(result.ok, result.message).toBe(allowed);
  });

  it.each([
    ['a plain drawing', ICON, true],
    ['with paths and a transform', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g transform="rotate(5)"><path d="M1 1h2"/></g></svg>', true],
    ['not an SVG', '<div>hello</div>', false],
    ['no viewBox', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>', false],
    ['not closed', '<svg viewBox="0 0 1 1"><circle r="1"/>', false],
    ['a script', '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>', false],
    ['a script in capitals', '<svg viewBox="0 0 1 1"><SCRIPT>alert(1)</SCRIPT></svg>', false],
    ['an event handler', '<svg viewBox="0 0 1 1" onload="alert(1)"><circle r="1"/></svg>', false],
    ['a link', '<svg viewBox="0 0 1 1"><a href="https://example.com"><circle r="1"/></a></svg>', false],
    ['an outside image', '<svg viewBox="0 0 1 1"><image href="https://example.com/x.png"/></svg>', false],
    ['embedded HTML', '<svg viewBox="0 0 1 1"><foreignObject><div/></foreignObject></svg>', false],
    ['a stylesheet', '<svg viewBox="0 0 1 1"><style>*{fill:red}</style></svg>', false],
    ['an outside reference in a style', '<svg viewBox="0 0 1 1"><circle r="1" fill="url(https://example.com/x)"/></svg>', false],
    ['too big', `<svg viewBox="0 0 1 1">${'<circle r="1"/>'.repeat(2000)}</svg>`, false],
  ])('icons: %s', async (_name, svg, allowed) => {
    expect(iconProblem(svg) === null).toBe(allowed);
    const result = await attempt(ADMIN, `insert into public.icons (name, image) values ('Test icon', $1)`, [svg]);
    expect(result.ok, result.message).toBe(allowed);
  });

  it('every icon already in the database passes', () => {
    for (const icon of data.icons) expect(iconProblem(icon.image), icon.name).toBeNull();
  });
});

describe('who can change the lists and forms', () => {
  const ACCOUNTS: [string, string, boolean][] = [
    ['an Admin', ADMIN, true],
    ['an Encoder', ENCODER, false],
    ['a Viewer', VIEWER, false],
    ['an account with no role', NO_PROFILE, false],
    ['a deactivated Admin', FORMER_ADMIN, false],
    ['a visitor', '', false],
  ];

  const expectResult = (result: Awaited<ReturnType<typeof attempt>>, allowed: boolean) => {
    if (allowed) {
      expect(result.ok, result.message).toBe(true);
      expect(result.affected + result.rows.length).toBeGreaterThan(0);
    } else if (result.ok) {
      expect(result.affected).toBe(0); // row-level security filtered it down to nothing
    } else {
      expect(result.code, result.message).toBe('42501');
    }
  };

  describe.each(ACCOUNTS)('%s', (_name, account, allowed) => {
    it('saving a type', async () => {
      expectResult(await attempt(account, SAVE_TYPE, typeArgs(typeValues(), statusList(['Proposed']))), allowed);
    });
    it('saving the barangay fields', async () => {
      expectResult(await attempt(account, `select public.save_barangay_fields(1, $1::jsonb)`, [JSON.stringify(data.barangayFields)]), allowed);
    });
    it('adding to a list', async () => {
      expectResult(await attempt(account, `insert into public.programs (code, name, color) values ('tested', 'Tested', '#000000')`), allowed);
    });
    it('editing a list', async () => {
      expectResult(await attempt(account, `update public.programs set name = 'Renamed' where code = 'rice'`), allowed);
    });
    it('taking a status off a type\'s list', async () => {
      const inactive = data.types.find((t) => t.code === 'other')!.id;
      expectResult(await attempt(account, `delete from public.intervention_type_statuses where intervention_type_id = ${inactive} and status_id = ${statusId('Unknown')}`), allowed);
    });
  });

  it('turns a refusal through the store into plain words', async () => {
    await expect(encoder.saveLookup('programs', null, { code: 'tried', name: 'Tried', color: '#000000' })).rejects.toThrow(/permission/);
    await expect(viewer.saveType(null, null, typeValues(), [])).rejects.toThrow();
  });
});

describe('what the Users page does to a profile', () => {
  it('an Admin can add one and change its name, role and deactivation, under the real grants', async () => {
    const setup = `insert into auth.users (id) values ('${'e'.repeat(8)}-0000-4000-8000-000000000001')`;
    const id = `${'e'.repeat(8)}-0000-4000-8000-000000000001`;
    const added = await attempt(ADMIN, `insert into public.profiles (id, full_name, role) values ('${id}', 'New Person', 'encoder')`, [], setup);
    expect(added.ok, added.message).toBe(true);

    for (const sql of [`set full_name = 'Renamed'`, `set role = 'viewer'`, `set deactivated_at = now()`, `set full_name = 'Renamed', role = 'viewer'`]) {
      const changed = await attempt(ADMIN, `update public.profiles ${sql} where id = '${VIEWER}'`);
      expect(changed.ok, changed.message).toBe(true);
      expect(changed.affected, sql).toBe(1);
    }
  });

  it('nobody can change a profile\'s id, which is why the function doesn\'t upsert', async () => {
    const result = await attempt(ADMIN, `insert into public.profiles (id, full_name, role) values ('${VIEWER}', 'X', 'viewer') on conflict (id) do update set id = excluded.id, full_name = excluded.full_name`);
    expect(result.code).toBe('42501');
  });
});

describe('an active Admin always remains', () => {
  const demote = `update public.profiles set role = 'viewer' where id = '${ADMIN}'`;
  const deactivate = `update public.profiles set deactivated_at = now() where id = '${ADMIN}'`;
  const secondAdmin = `update public.profiles set role = 'admin' where id = '${ENCODER}'`;

  it('refuses to demote or deactivate the only one, and a deactivated Admin doesn\'t count', async () => {
    for (const sql of [demote, deactivate]) {
      const result = await attempt(ADMIN, sql);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/at least one active Admin/);
    }
  });

  it('allows it once there\'s another', async () => {
    for (const sql of [demote, deactivate]) expect((await attempt(ADMIN, sql, [], secondAdmin)).ok).toBe(true);
  });

  it('refuses to remove the only one\'s profile', async () => {
    await db.exec('begin');
    await expect(db.exec(`delete from public.profiles where id = '${ADMIN}'`)).rejects.toThrow(/at least one active Admin/);
    await db.exec('rollback');
  });

  it('doesn\'t mind changes to anyone else', async () => {
    expect((await attempt(ADMIN, `update public.profiles set role = 'viewer' where id = '${ENCODER}'`)).ok).toBe(true);
    expect((await attempt(ADMIN, `update public.profiles set full_name = 'Ana A.' where id = '${ADMIN}'`)).ok).toBe(true);
  });
});

describe('a type', () => {
  const dropdown = field({ key: 'drive', label: 'Drive', input: 'dropdown', required: true, options: [{ value: 'solar', label: 'Solar' }, { value: 'engine', label: 'Engine' }] });

  it('can be created with its form and status list, then used with no code change', async () => {
    const saved = await admin.saveType(null, null, typeValues({ code: 'nursery', name: 'Nursery', core_field_rules: { title: 'required', remarks: 'hidden' }, field_schema: schemaOf(dropdown, field({ key: 'area', label: 'Area', input: 'number', unit: 'ha' })) }), statusList(['Proposed', 'Operational'], 'Operational'));
    expect(saved).toMatchObject({ code: 'nursery', version: 1, is_active: true });

    const loaded = await admin.load();
    expect(loaded.typeStatuses.filter((s) => s.intervention_type_id === saved.id).map((s) => [s.status_id, s.sort_order, s.is_default, s.counts_as_operational])).toEqual([
      [statusId('Proposed'), 1, false, false],
      [statusId('Operational'), 2, true, true],
    ]);

    await expect(admin.createIntervention(recordValues(saved.id, { attributes: {} }), { status_id: statusId('Proposed'), status_date: '2024-01-01', remarks: null })).rejects.toThrow(ValidationError);
    await expect(admin.createIntervention(recordValues(saved.id, { attributes: { drive: 'wind' } }), { status_id: statusId('Proposed'), status_date: '2024-01-01', remarks: null })).rejects.toThrow(ValidationError);
    const record = await encoder.load().then(() => encoder.createIntervention(recordValues(saved.id, { attributes: { drive: 'solar', area: 2.5 } }), { status_id: statusId('Operational'), status_date: '2024-01-01', remarks: null }));
    expect(record.attributes).toEqual({ drive: 'solar', area: 2.5 });
    expect(record.status_id).toBe(statusId('Operational'));
    await expect(encoder.createIntervention(recordValues(saved.id, { attributes: { drive: 'solar' } }), { status_id: statusId('Unknown'), status_date: '2024-01-01', remarks: null })).rejects.toThrow();
  });

  it('can be a line or polygon, but stays inactive until drawing exists', async () => {
    for (const geometry_kind of ['line', 'polygon'] as const) {
      const active = typeValues({ geometry_kind });
      await expect(admin.saveType(null, null, active, statusList(['Proposed']))).rejects.toThrow('Needs drawing tools (not yet built)');
      expect((await attempt(ADMIN, SAVE_TYPE, typeArgs(active, statusList(['Proposed'])))).message).toMatch(/cannot be active until drawing tools are built/);

      const saved = await admin.saveType(null, null, { ...active, is_active: false }, statusList(['Proposed']));
      expect(saved).toMatchObject({ geometry_kind, is_active: false });
      expect((await attempt(ADMIN, `update public.intervention_types set is_active = true where id = ${saved.id}`)).message).toMatch(/drawing tools/);
    }
  });

  it('can\'t get there from an active point type, and a point type can still be switched on', async () => {
    const point = await admin.saveType(null, null, typeValues(), statusList(['Proposed']));
    expect((await attempt(ADMIN, `update public.intervention_types set geometry_kind = 'polygon' where id = ${point.id}`)).message).toMatch(/drawing tools/);
    expect((await attempt(ADMIN, `update public.intervention_types set geometry_kind = 'polygon', is_active = false where id = ${point.id}`)).ok).toBe(true);

    expect((await attempt(ADMIN, `update public.intervention_types set is_active = true where code = 'fmr'`)).message).toMatch(/drawing tools/);
    expect((await attempt(ADMIN, `update public.intervention_types set is_active = true where code = 'other'`)).ok).toBe(true);
  });

  it('takes no record of a line or polygon type without its shape, for anyone', async () => {
    const line = data.types.find((t) => t.code === 'fmr')!;
    const status = { status_id: statusId('Proposed'), status_date: '2024-01-01', remarks: null };
    await encoder.load();
    await expect(encoder.createIntervention(recordValues(line.id), status)).rejects.toThrow(/drawing tools/);

    const values = { intervention_type_id: line.id, title: 'No shape', municipality_id: data.municipalities[0].id, year_funded: 2024 };
    const refused = await attempt(ENCODER, 'select public.create_intervention($1::jsonb, $2::jsonb)', [JSON.stringify(values), JSON.stringify(status)]);
    expect(refused.message).toMatch(/needs its shape/);
  });

  it('refuses a stale save, and names no winner silently', async () => {
    const saved = await admin.saveType(null, null, typeValues(), statusList(['Proposed']));
    const values = typeValues({ code: saved.code, name: saved.name });
    const second = await admin.saveType(saved.id, saved.version, { ...values, color: '#111111' }, statusList(['Proposed']));
    expect(second.version).toBe(saved.version + 1);
    await expect(admin.saveType(saved.id, saved.version, { ...values, color: '#222222' }, statusList(['Proposed']))).rejects.toThrow(ConflictError);
    await admin.load();
    expect((await admin.load()).types.find((t) => t.id === saved.id)?.color).toBe('#111111');
  });

  it('needs a status, and exactly one default', async () => {
    const values = typeValues();
    for (const list of [[], statusList(['Proposed', 'Unknown'], 'none'), statusList(['Proposed']).concat({ status_id: statusId('Unknown'), is_default: true, counts_as_operational: false })]) {
      await expect(admin.saveType(null, null, values, list)).rejects.toThrow(ValidationError);
      const result = await attempt(ADMIN, SAVE_TYPE, typeArgs(values, list));
      expect(result.ok, JSON.stringify(list)).toBe(false);
    }
  });

  describe('once it has records', () => {
    let typeId: number;
    let version: number;
    let values: TypeValues;

    beforeAll(async () => {
      values = typeValues({ field_schema: schemaOf(field({ key: 'note', label: 'Note', required: true })) });
      const saved = await admin.saveType(null, null, values, statusList(['Proposed', 'Operational', 'Unknown']));
      typeId = saved.id;
      version = saved.version;
      await admin.load();
      await admin.createIntervention(recordValues(typeId, { attributes: { note: 'kept' } }), { status_id: statusId('Operational'), status_date: '2024-01-01', remarks: null });
      await admin.load();
    });

    it('keeps its geometry and its code', async () => {
      const changed = { ...values, geometry_kind: 'line' as const };
      await expect(admin.saveType(typeId, version, changed, statusList(['Proposed', 'Operational', 'Unknown']))).rejects.toThrow(/geometry/);
      expect((await attempt(ADMIN, `update public.intervention_types set geometry_kind = 'line' where id = ${typeId}`)).message).toMatch(/geometry/);
      expect((await attempt(ADMIN, `update public.intervention_types set code = 'renamed' where id = ${typeId}`)).message).toMatch(/code cannot change/);
    });

    it('keeps a status on its list while a record is at it, but not one that\'s only in the past', async () => {
      await expect(admin.saveType(typeId, version, values, statusList(['Proposed', 'Unknown']))).rejects.toThrow(ValidationError);
      expect((await attempt(ADMIN, `delete from public.intervention_type_statuses where intervention_type_id = ${typeId} and status_id = ${statusId('Operational')}`)).message).toMatch(/records are at this status/);

      const removed = await admin.saveType(typeId, version, values, statusList(['Operational', 'Unknown'], 'Unknown'));
      version = removed.version;
      const list = (await admin.load()).typeStatuses.filter((s) => s.intervention_type_id === typeId);
      expect(list.map((s) => s.status_id)).toEqual([statusId('Operational'), statusId('Unknown')]);
      expect(list.find((s) => s.is_default)?.status_id).toBe(statusId('Unknown'));
    });

    it('archiving a required field keeps its values, and stops asking for it', async () => {
      const archived = await admin.saveType(typeId, version, { ...values, field_schema: schemaOf(field({ key: 'note', label: 'Note', required: true, archived: true })) }, statusList(['Operational', 'Unknown'], 'Unknown'));
      version = archived.version;
      await admin.load();
      const record = (await admin.load()).interventions.find((r) => r.intervention_type_id === typeId)!;
      expect(record.attributes).toEqual({ note: 'kept' });
      const added = await admin.createIntervention(recordValues(typeId), { status_id: statusId('Unknown'), status_date: '2024-01-01', remarks: null });
      expect(added.attributes).toEqual({});
    });

    it('won\'t lose a field', async () => {
      await admin.load();
      await expect(admin.saveType(typeId, version, { ...values, field_schema: { fields: [] } }, statusList(['Operational', 'Unknown'], 'Unknown'))).rejects.toThrow(/Archive it/);
    });
  });
});

describe('the lists', () => {
  it('add, rename and archive, in their own order', async () => {
    await admin.load();
    await admin.saveLookup('programs', null, { code: 'coconut', name: 'Coconut Program', color: '#654321', sort_order: 0 });
    let loaded = await admin.load();
    expect(loaded.programs[0]).toMatchObject({ code: 'coconut', name: 'Coconut Program', color: '#654321', is_active: true });

    const { id } = loaded.programs[0];
    await admin.saveLookup('programs', id, { name: 'Coconut', is_active: false, sort_order: 99 });
    loaded = await admin.load();
    expect(loaded.programs.at(-1)).toMatchObject({ id, name: 'Coconut', is_active: false, color: '#654321' });
  });

  it('won\'t take a name that\'s used, a blank name or a bad color, wherever it\'s caught', async () => {
    await admin.load();
    await expect(admin.saveLookup('programs', null, { code: 'x1', name: 'Rice Program', color: '#000000' })).rejects.toThrow(ValidationError);
    await expect(admin.saveLookup('programs', null, { code: 'x2', name: '  ', color: '#000000' })).rejects.toThrow(ValidationError);
    await expect(admin.saveLookup('programs', null, { code: 'x3', name: 'Bad color', color: 'green' })).rejects.toThrow(ValidationError);

    // A store that hasn't loaded yet leaves it to the database.
    const fresh = storeFor(ADMIN, 'admin').store;
    await expect(fresh.saveLookup('programs', null, { code: 'x4', name: 'Rice Program', color: '#000000' })).rejects.toThrow('That name is already used.');
    await expect(fresh.saveLookup('programs', null, { code: 'x5', name: '  ', color: '#000000' })).rejects.toThrow();
    await expect(fresh.saveLookup('programs', null, { code: 'x6', name: 'Bad color', color: 'green' })).rejects.toThrow();
  });

  it('never change a code', async () => {
    for (const table of ['programs', 'categories', 'category_groups']) {
      const result = await attempt(ADMIN, `update public.${table} set code = 'renamed' where id = (select min(id) from public.${table})`);
      expect(result.message, table).toMatch(/code cannot change/);
    }
  });

  it('give a new category its group\'s icon, unless it has its own', async () => {
    await admin.load();
    const group = data.categoryGroups.find((g) => g.code === 'harvesting')!;
    const own = data.icons.find((i) => i.name === 'Sun')!;
    await admin.saveLookup('categories', null, { code: 'cat-a', name: 'Category A', category_group_id: group.id });
    await admin.saveLookup('categories', null, { code: 'cat-b', name: 'Category B', category_group_id: group.id, icon_id: own.id });
    const loaded = await admin.load();
    expect(loaded.categories.find((c) => c.code === 'cat-a')?.icon_id).toBe(group.icon_id);
    expect(loaded.categories.find((c) => c.code === 'cat-b')?.icon_id).toBe(own.id);
  });

  it('take a new icon, and refuse a file that isn\'t a plain drawing', async () => {
    await admin.saveLookup('icons', null, { name: 'Circle', image: ICON });
    expect((await admin.load()).icons.find((i) => i.name === 'Circle')?.is_active).toBe(true);
    await expect(admin.saveLookup('icons', null, { name: 'Bad', image: '<svg viewBox="0 0 1 1"><script/></svg>' })).rejects.toThrow(ValidationError);
    await expect(storeFor(ADMIN, 'admin').store.saveLookup('icons', null, { name: 'Bad', image: '<svg viewBox="0 0 1 1"><script/></svg>' })).rejects.toThrow(/scripts or links/);
  });

  it('stop offering an archived status, without touching anything already at it', () => {
    const lists = {
      statuses: [
        { id: 1, name: 'First', color: '#000000', sort_order: 1, is_active: false },
        { id: 2, name: 'Second', color: '#000000', sort_order: 2, is_active: true },
      ],
      typeStatuses: [
        { intervention_type_id: 9, status_id: 1, sort_order: 1, is_default: true, counts_as_operational: false },
        { intervention_type_id: 9, status_id: 2, sort_order: 2, is_default: false, counts_as_operational: false },
      ],
    };
    expect(statusChoices(lists, 9)).toEqual([{ value: 2, label: 'Second' }]);
    expect(defaultStatusId(lists, 9)).toBe('2');
  });
});

describe('the barangay form', () => {
  it('gets a new field, which a baseline can then hold, and refuses a stale save', async () => {
    await admin.load();
    const start = (await admin.load()).barangayFieldsVersion;
    const schema = { fields: [...data.barangayFields.fields, field({ key: 'rainfall', label: 'Rainfall', input: 'number', unit: 'mm' })] };
    await admin.saveBarangayFields(start, schema);

    const loaded = await admin.load();
    expect(loaded.barangayFieldsVersion).toBe(start + 1);
    expect(loaded.barangayFields.fields.at(-1)?.key).toBe('rainfall');

    const barangay = loaded.barangays[0];
    const saved = await encoder.load().then(() => encoder.updateBarangayBaseline(barangay.id, barangay.version, { rainfall: 1200 }));
    expect(saved.attributes).toEqual({ rainfall: 1200 });

    await expect(admin.saveBarangayFields(start, schema)).rejects.toThrow(ConflictError);
  });

  it('can\'t lose a field or take a photo', async () => {
    const loaded = await admin.load();
    const version = loaded.barangayFieldsVersion;
    await expect(admin.saveBarangayFields(version, { fields: [] })).rejects.toThrow(/Archive it/);
    const withPhoto = { fields: [...loaded.barangayFields.fields, field({ key: 'view', label: 'View', input: 'photo' })] };
    const result = await attempt(ADMIN, `select public.save_barangay_fields(${version}, $1::jsonb)`, [JSON.stringify(withPhoto)]);
    expect(result.message).toMatch(/cannot be photos/);
  });
});

describe('a photo field', () => {
  let typeId: number;
  const photoField = field({ key: 'site_photo', label: 'Site photo', input: 'photo' });
  const status = () => ({ status_id: statusId('Proposed'), status_date: '2024-01-01', remarks: null });

  beforeAll(async () => {
    await admin.load();
    typeId = (await admin.saveType(null, null, typeValues({ field_schema: schemaOf(photoField) }), statusList(['Proposed']))).id;
    await admin.load();
  });

  const photosOf = async (recordId: string) =>
    (await db.query<{ id: string; storage_path: string; caption: string | null }>(`select id, storage_path, caption from public.intervention_photos where intervention_id = $1 order by created_at`, [recordId])).rows;

  it('stores the file under its record and the photo\'s id as the value, with the field\'s label as its caption', async () => {
    const record = await admin.createIntervention(recordValues(typeId, { attributes: { site_photo: PENDING_PHOTO }, field_photos: { site_photo: jpeg() } }), status());
    const photoId = record.attributes.site_photo as string;
    expect(photoId).toMatch(/^[0-9a-f-]{36}$/);
    const [photo] = await photosOf(record.id);
    expect(photo).toMatchObject({ id: photoId, caption: 'Site photo' });
    expect(photo.storage_path).toBe(`${record.id}/${photoId}.jpg`);
    expect(adminBackend.files.has(photo.storage_path)).toBe(true);
  });

  it('replacing it keeps the old photo in the record\'s history', async () => {
    const record = await admin.createIntervention(recordValues(typeId, { attributes: { site_photo: PENDING_PHOTO }, field_photos: { site_photo: jpeg() } }), status());
    const first = record.attributes.site_photo as string;
    await admin.load();
    const updated = await admin.updateIntervention(record.id, record.version, { attributes: { site_photo: PENDING_PHOTO }, field_photos: { site_photo: jpeg('new.jpg') } });
    expect(updated.attributes.site_photo).not.toBe(first);
    expect((await photosOf(record.id)).map((p) => p.id).sort()).toEqual([first, updated.attributes.site_photo as string].sort());
  });

  it('removes the file again if the save fails', async () => {
    const before = adminBackend.files.size;
    await expect(admin.createIntervention(recordValues(typeId, { attributes: { site_photo: PENDING_PHOTO }, field_photos: { site_photo: jpeg() } }), { ...status(), status_date: '2999-01-01' })).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(adminBackend.files.size).toBe(before);
  });

  it('can\'t attach a file stored under another record', async () => {
    const other = '11111111-1111-4111-8111-111111111111';
    const values = { ...recordValues(typeId), attributes: { site_photo: other }, id: other.replace(/1/g, '2'), field_photos: [{ id: other, storage_path: `${other}/${other}.jpg` }] };
    const result = await attempt(ADMIN, `select public.create_intervention($1::jsonb, $2::jsonb)`, [JSON.stringify(values), JSON.stringify(status())]);
    expect(result.message).toMatch(/not stored under this record/);
  });

  it('shows as a photo, not an id, wherever a value is written out', () => {
    expect(fieldValue(photoField, 'some-id')).toBe('Photo');
    const records = [{ intervention_type_id: 1, attributes: { site_photo: 'some-id' }, qa_flags: [], id: 'r' }] as never;
    const fields = buildFields(records, { ...data, types: [{ ...data.types[0], id: 1, field_schema: schemaOf(photoField) }] });
    expect(fields.find((f) => f.key === 'SitePhoto')?.read((records as { attributes: object }[])[0] as never)).toBe('Photo attached');
  });

  it('goes in an edit\'s patch only when there\'s a new file', () => {
    const base = { attributes: {}, geojson: null } as never;
    const values = recordValues(1, { attributes: { site_photo: PENDING_PHOTO }, field_photos: { site_photo: jpeg() } });
    expect(buildPatch(base, values, base).field_photos?.site_photo.name).toBe('site.jpg');
    expect(buildPatch(base, recordValues(1, { field_photos: {} }), base)).not.toHaveProperty('field_photos');
  });
});

describe('open maps hear about it', () => {
  const signals = async () => (await db.query<{ n: number }>(`select count(*)::int as n from realtime.messages where topic = 'map-changes'`)).rows[0].n;

  it.each([
    ['a list', async () => admin.saveLookup('beneficiary_types', null, { name: `Signal ${Math.random()}` })],
    ['a type', async () => admin.saveType(null, null, typeValues(), statusList(['Proposed']))],
    ['the barangay form', async () => admin.saveBarangayFields((await admin.load()).barangayFieldsVersion, (await admin.load()).barangayFields)],
  ])('when %s changes', async (_name, change) => {
    await admin.load();
    const before = await signals();
    await change();
    expect(await signals()).toBeGreaterThan(before);
  });
});

describe('every change is in the audit log, with who made it', () => {
  it('names the Admin', async () => {
    await admin.load();
    await admin.saveLookup('statuses', null, { name: 'Audited', color: '#000000' });
    const { rows } = await db.query<{ actor_id: string; action: string }>(`select actor_id, action from public.audit_log where table_name = 'statuses' and new_row ->> 'name' = 'Audited'`);
    expect(rows).toEqual([{ actor_id: ADMIN, action: 'insert' }]);
  });
});

describe('local mode', () => {
  const lists = () => local.fixed;

  it('adds, renames and archives in a list, by the same rules', () => {
    localAdmin.saveLookup(local.rows, context, 'programs', null, { code: 'coconut', name: ' Coconut ', color: '#654321', sort_order: 9 });
    const added = lists().programs.find((p) => p.code === 'coconut')!;
    expect(added).toMatchObject({ name: 'Coconut', is_active: true });

    localAdmin.saveLookup(local.rows, context, 'programs', added.id, { is_active: false });
    expect(added.is_active).toBe(false);
    expect(local.rows.auditLog.at(-1)).toMatchObject({ table_name: 'programs', action: 'update' });

    expect(() => localAdmin.saveLookup(local.rows, context, 'programs', null, { code: 'x', name: 'Rice Program', color: '#000000' })).toThrow(ValidationError);
    expect(() => localAdmin.saveLookup(local.rows, context, 'programs', added.id, { code: 'renamed' })).toThrow(ValidationError);
    expect(() => localAdmin.saveLookup(local.rows, context, 'icons', null, { name: 'Bad', image: '<svg viewBox="0 0 1 1"><script/></svg>' })).toThrow(ValidationError);
  });

  it('gives a new category its group\'s icon', () => {
    const group = lists().categoryGroups.find((g) => g.code === 'harvesting')!;
    localAdmin.saveLookup(local.rows, context, 'categories', null, { code: 'local-cat', name: 'Local category', category_group_id: group.id });
    expect(lists().categories.find((c) => c.code === 'local-cat')?.icon_id).toBe(group.icon_id);
  });

  it('saves a type with its status list, and refuses a stale save', () => {
    const statuses = () => statusList(['Proposed', 'Operational'], 'Operational');
    const values = typeValues({ code: 'local-type', name: 'Local type' });
    const saved = localAdmin.saveType(local.rows, context, null, null, values, statuses());
    expect(saved).toMatchObject({ code: 'local-type', version: 1 });
    expect(lists().typeStatuses.filter((s) => s.intervention_type_id === saved.id).map((s) => s.sort_order)).toEqual([1, 2]);

    const updated = localAdmin.saveType(local.rows, context, saved.id, 1, { ...values, color: '#111111' }, statuses());
    expect(updated.version).toBe(2);
    expect(() => localAdmin.saveType(local.rows, context, saved.id, 1, values, statuses())).toThrow(ConflictError);
    expect(() => localAdmin.saveType(local.rows, context, null, null, typeValues(), [])).toThrow(ValidationError);
  });

  it('keeps a type\'s geometry and status once it has records', () => {
    const values = typeValues({ code: 'with-records', name: 'With records' });
    const saved = localAdmin.saveType(local.rows, context, null, null, values, statusList(['Proposed', 'Unknown']));
    const record = engine.createIntervention(local.rows, { ...context, types: lists().types, typeStatuses: lists().typeStatuses }, recordValues(saved.id));
    engine.addStatus(local.rows, { ...context, types: lists().types, typeStatuses: lists().typeStatuses }, record.id, { status_id: statusId('Unknown'), status_date: '2024-01-01', remarks: null });

    expect(() => localAdmin.saveType(local.rows, context, saved.id, 1, { ...values, geometry_kind: 'line' }, statusList(['Proposed', 'Unknown']))).toThrow(/geometry/);
    expect(() => localAdmin.saveType(local.rows, context, saved.id, 1, values, statusList(['Proposed']))).toThrow(ValidationError);
    expect(() => localAdmin.saveType(local.rows, context, saved.id, 1, values, statusList(['Unknown']))).not.toThrow();
  });

  it('keeps a line or polygon type inactive, and takes no record of it without a shape', () => {
    const line = typeValues({ code: 'local-line', name: 'Local line', geometry_kind: 'line' });
    expect(() => localAdmin.saveType(local.rows, context, null, null, line, statusList(['Proposed']))).toThrow('Needs drawing tools (not yet built)');
    const saved = localAdmin.saveType(local.rows, context, null, null, { ...line, is_active: false }, statusList(['Proposed']));
    expect(saved).toMatchObject({ geometry_kind: 'line', is_active: false });

    const contextNow = { ...context, types: lists().types, typeStatuses: lists().typeStatuses };
    expect(() => engine.createIntervention(local.rows, contextNow, recordValues(saved.id))).toThrow(/drawing tools/);
  });

  it('saves the barangay form, refusing a stale save, a lost field and a photo', () => {
    const version = lists().barangayFieldsVersion;
    const schema = { fields: [...lists().barangayFields.fields, field({ key: 'rainfall', label: 'Rainfall', input: 'number' })] };
    localAdmin.saveBarangayFields(local.rows, context, version, schema);
    expect(lists().barangayFieldsVersion).toBe(version + 1);
    expect(lists().barangayFields).toEqual(schema);
    expect(() => localAdmin.saveBarangayFields(local.rows, context, version, schema)).toThrow(ConflictError);
    expect(() => localAdmin.saveBarangayFields(local.rows, context, version + 1, { fields: [] })).toThrow(ValidationError);
    expect(() => localAdmin.saveBarangayFields(local.rows, context, version + 1, { fields: [...schema.fields, field({ key: 'view', label: 'View', input: 'photo' })] })).toThrow(ValidationError);
  });
});

describe('making stable names', () => {
  it('turns words into a code, keeping it unique', () => {
    expect(newCode('Rice Program', [])).toBe('rice-program');
    expect(newCode('Niño & Peñafrancia', [])).toBe('nino-penafrancia');
    expect(newCode('Rice Program', ['rice-program', 'rice-program-2'])).toBe('rice-program-3');
    expect(newCode('!!!', [])).toBe('item');
  });

  it('turns a label into a field key the database accepts', () => {
    expect(newFieldKey('Engine No.', [])).toBe('engine_no');
    expect(newFieldKey('Engine No.', ['engine_no'])).toBe('engine_no_2');
    expect(newFieldKey('2nd operator', [])).toBe('field_2nd_operator');
    expect(newFieldKey('¿?', [])).toBe('field');
    for (const key of [newFieldKey('Pañe área', []), newFieldKey('2nd operator', []), newFieldKey('¿?', [])]) {
      expect(fieldSchemaProblem(schemaOf(field({ key })))).toBeNull();
    }
  });
});

describe('field drafts', () => {
  const draft = (over: Partial<FieldDraft>): FieldDraft => ({ draftId: `d${Math.random()}`, key: '', label: 'A', input: 'text', ...over });

  it('keep a saved field\'s key and give a new one its key from its label', () => {
    const start = draftsFromSchema(schemaOf(field({ key: 'engine_no', label: 'Engine No.' })));
    const schema = schemaFromDrafts([{ ...start[0], label: 'Engine number' }, draft({ label: 'Engine No.' }), draft({ label: 'Engine No. 2' })]);
    expect(schema.fields.map((f) => [f.key, f.label])).toEqual([
      ['engine_no', 'Engine number'],
      ['engine_no_2', 'Engine No.'],
      ['engine_no_2_2', 'Engine No. 2'],
    ]);
    expect(fieldSchemaProblem(schema)).toBeNull();
  });

  it('round-trip without changing what\'s saved', () => {
    const saved = schemaOf(
      field({ key: 'a', label: 'A', input: 'number', unit: 'ha', required: true }),
      field({ key: 'b', label: 'B', input: 'dropdown', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y', archived: true }] }),
      field({ key: 'c', label: 'C', archived: true }),
    );
    expect(schemaFromDrafts(draftsFromSchema(saved))).toEqual(saved);
  });

  it('give new options a value, and tidy what doesn\'t apply', () => {
    const [made] = schemaFromDrafts([
      draft({ label: ' Drive ', input: 'dropdown', required: false, unit: 'ha', options: [{ draftId: 'o1', value: '', label: 'Solar panel' }, { draftId: 'o2', value: 'solar_panel', label: 'Old' }] }),
    ]).fields;
    expect(made).toEqual({ key: 'drive', label: 'Drive', input: 'dropdown', options: [{ value: 'solar_panel_2', label: 'Solar panel' }, { value: 'solar_panel', label: 'Old' }] });
    expect(schemaFromDrafts([draft({ input: 'text', options: [{ draftId: 'o', value: 'x', label: 'X' }] })]).fields[0]).not.toHaveProperty('options');
  });

  it('say what to fix before saving', () => {
    const blank = draft({ label: ' ' });
    const noOptions = draft({ label: 'B', input: 'dropdown', options: [] });
    const blankOption = draft({ label: 'C', input: 'dropdown', options: [{ draftId: 'o', value: '', label: '' }] });
    const twice = draft({ label: 'D', input: 'dropdown', options: [{ draftId: 'o1', value: '', label: 'X' }, { draftId: 'o2', value: '', label: 'x' }] });
    const first = draft({ label: 'Same' });
    const second = draft({ label: 'same' });
    const archived = draft({ key: 'z', label: 'Same', archived: true });
    const problems = draftProblems([blank, noOptions, blankOption, twice, first, second, archived]);
    expect(Object.keys(problems).sort()).toEqual([blank, noOptions, blankOption, twice, second].map((d) => d.draftId).sort());
  });
});
