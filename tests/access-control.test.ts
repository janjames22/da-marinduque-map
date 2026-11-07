// What each kind of account can do, tried against the real policies as that account. Every attempt
// runs in a transaction that is rolled back, so attempts can't affect each other.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './helpers/db';

const ADMIN = 'a0000000-0000-4000-8000-000000000001';
const ENCODER = 'a0000000-0000-4000-8000-000000000002';
const OTHER_ENCODER = 'a0000000-0000-4000-8000-000000000003';
const VIEWER = 'a0000000-0000-4000-8000-000000000004';
const NO_PROFILE = 'a0000000-0000-4000-8000-000000000005';
const DEACTIVATED = 'a0000000-0000-4000-8000-000000000006';

const LIVE = 'b0000000-0000-4000-8000-000000000001';
const DELETED = 'b0000000-0000-4000-8000-000000000002';

type Account = 'admin' | 'encoder' | 'viewer' | 'no profile' | 'deactivated' | 'anon';
const ACCOUNTS: Account[] = ['admin', 'encoder', 'viewer', 'no profile', 'deactivated', 'anon'];

const IDS: Record<Exclude<Account, 'anon'>, string> = {
  admin: ADMIN,
  encoder: ENCODER,
  viewer: VIEWER,
  'no profile': NO_PROFILE,
  deactivated: DEACTIVATED,
};

let db: PGlite;
let typeId: number;
let categoryId: number;
let programId: number;
let municipalityId: number;
let barangayId: number;
let statusId: number;

interface Attempt {
  ok: boolean;
  code?: string;
  message?: string;
  rows: Record<string, unknown>[];
  affected: number;
}

async function attempt(account: Account, sql: string, params: unknown[] = [], keep = false, setup?: string): Promise<Attempt> {
  await db.exec('begin');
  try {
    if (setup) await db.exec(setup);
    await db.exec(`set local role ${account === 'anon' ? 'anon' : 'authenticated'}`);
    await db.query(`select set_config('request.jwt.sub', $1, true)`, [account === 'anon' ? '' : IDS[account]]);
    const result = await db.query<Record<string, unknown>>(sql, params);
    return { ok: true, rows: result.rows, affected: result.affectedRows ?? 0 };
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return { ok: false, code: failure.code, message: failure.message, rows: [], affected: 0 };
  } finally {
    await db.exec(keep ? 'commit' : 'rollback');
  }
}

// A role can do something if it runs and changes something. An update that row-level security
// filters down to no rows is as much of a refusal as an error.
const didWrite = (result: Attempt) => result.ok && (result.affected > 0 || result.rows.length > 0);

// Fails on an error other than a refusal, so a broken statement can't pass as "denied".
function expectWrite(result: Attempt, allowed: boolean, label: string, otherRefusal?: RegExp) {
  if (!allowed && otherRefusal?.test(result.message ?? '')) return;
  if (allowed) {
    expect(result, label).toMatchObject({ ok: true });
    expect(didWrite(result), label).toBe(true);
  } else if (result.ok) {
    expect(didWrite(result), label).toBe(false);
  } else {
    expect(result.code, `${label}: ${result.message}`).toBe('42501');
  }
}

function checkAccess(sql: string | (() => string), allowed: Account[], params: () => unknown[] = () => [], otherRefusal?: RegExp) {
  it.each(ACCOUNTS)('%s', async (account) => {
    const text = typeof sql === 'function' ? sql() : sql;
    expectWrite(await attempt(account, text, params()), allowed.includes(account), `${account}: ${text}`, otherRefusal);
  });
}

const EDITORS: Account[] = ['admin', 'encoder'];
const ADMIN_ONLY: Account[] = ['admin'];
const NOBODY: Account[] = [];

beforeAll(async () => {
  db = await createTestDb();
  const one = async (sql: string) => (await db.query<{ id: number }>(sql)).rows[0].id;
  typeId = await one(`select id from intervention_types where code = 'farm-machinery'`);
  categoryId = await one(`select id from categories where code = 'seeder'`);
  programId = await one(`select id from programs where code = 'rice'`);
  municipalityId = await one(`select id from municipalities where name = 'Boac'`);
  barangayId = (
    await db.query<{ id: number }>(`select id from barangays where municipality_id = $1 order by id limit 1`, [municipalityId])
  ).rows[0].id;
  statusId = await one(`select id from statuses where name = 'Turned-over'`);

  for (const id of Object.values(IDS).concat(OTHER_ENCODER)) await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(
    `insert into profiles (id, full_name, role, deactivated_at) values
       ($1, 'An Admin', 'admin', null), ($2, 'An Encoder', 'encoder', null), ($3, 'Another Encoder', 'encoder', null),
       ($4, 'A Viewer', 'viewer', null), ($5, 'Former Admin', 'admin', now())`,
    [ADMIN, ENCODER, OTHER_ENCODER, VIEWER, DEACTIVATED],
  );

  for (const [id, deletedAt] of [[LIVE, null], [DELETED, new Date().toISOString()]] as const) {
    await db.query(
      `insert into interventions (id, intervention_type_id, category_id, banner_program_id, year_funded, beneficiary,
                                  municipality_id, barangay_id, geom, source_raw, deleted_at)
       values ($1, $2, $3, $4, 2024, 'Sample FCA', $5, $6, ST_SetSRID(ST_MakePoint(121.87, 13.46), 4326), '{"raw": "row"}', $7)`,
      [id, typeId, categoryId, programId, municipalityId, barangayId, deletedAt],
    );
    await db.query(
      `insert into status_history (intervention_id, status_id, status_date) values ($1, $2, '2024-01-15')`,
      [id, statusId],
    );
  }
  await db.query(
    `insert into intervention_photos (intervention_id, storage_path) values ($1, $2)`,
    [LIVE, `${LIVE}/c0000000-0000-4000-8000-000000000001.jpg`],
  );
}, 120_000);

afterAll(async () => {
  await db.close();
});

const newValues = () => ({
  intervention_type_id: typeId,
  category_id: categoryId,
  banner_program_id: programId,
  year_funded: 2024,
  quantity: 1,
  beneficiary: 'New FCA',
  municipality_id: municipalityId,
  barangay_id: barangayId,
  point: { lat: 13.46, lng: 121.87 },
  attributes: {},
});
const newStatus = () => ({ status_id: statusId, status_date: '2024-02-01', remarks: 'Delivered' });

describe('how the database is set up', () => {
  it('has row-level security and at least one policy on every table', async () => {
    const { rows } = await db.query<{ tablename: string; rowsecurity: boolean; policies: number }>(
      `select t.tablename, t.rowsecurity, (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename) as policies
       from pg_tables t where t.schemaname = 'public'`,
    );
    expect(rows.length).toBeGreaterThan(15);
    for (const row of rows) {
      expect(row, row.tablename).toMatchObject({ rowsecurity: true });
      expect(row.policies, row.tablename).toBeGreaterThan(0);
    }
  });

  it('gives anonymous visitors no table or function in the public schema', async () => {
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`,
    );
    expect(tables.rows).toEqual([]);
    const functions = await db.query<{ routine_name: string }>(
      `select p.proname as routine_name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(functions.rows).toEqual([]);
  });

  it('gives signed-in accounts no truncate, references or trigger rights', async () => {
    const { rows } = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'authenticated' and table_schema = 'public'
         and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')`,
    );
    expect(rows).toEqual([]);
  });

  it('leaves a future table closed until it is deliberately opened', async () => {
    await db.exec('begin');
    await db.exec('create table public.future_table (id int)');
    const { rows } = await db.query<{ can_read: boolean }>(`select has_table_privilege('authenticated', 'public.future_table', 'select') as can_read`);
    await db.exec('rollback');
    expect(rows[0].can_read).toBe(false);
  });

  it('pins the search path of every function that runs as its owner', async () => {
    const { rows } = await db.query<{ proname: string; proconfig: string[] | null }>(
      `select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef`,
    );
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) expect(row.proconfig?.join(), row.proname).toMatch(/search_path=/);
  });

  it('keeps the photo bucket private, with the size limit', async () => {
    const { rows } = await db.query(`select public, file_size_limit from storage.buckets where id = 'intervention-photos'`);
    const bucket = rows[0] as { public: boolean; file_size_limit: unknown };
    expect(bucket.public).toBe(false);
    expect(Number(bucket.file_size_limit)).toBe(10 * 1024 * 1024);
  });
});

describe('reading', () => {
  const count = async (account: Account, from: string) => {
    const result = await attempt(account, `select count(*)::int as n from ${from}`);
    return result.ok ? (result.rows[0].n as number) : `refused:${result.code}`;
  };

  it('shows records, without deleted ones, to Encoders and Viewers', async () => {
    expect(await count('encoder', 'interventions')).toBe(1);
    expect(await count('viewer', 'interventions')).toBe(1);
    expect(await count('encoder', 'interventions_v')).toBe(1);
    expect(await count('viewer', 'interventions_v')).toBe(1);
  });

  it('shows deleted records to Admins', async () => {
    expect(await count('admin', 'interventions')).toBe(2);
    expect(await count('admin', 'interventions_v')).toBe(2);
  });

  it.each(['no profile', 'deactivated'] as const)('shows an account with %s nothing', async (account) => {
    const { rows } = await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`);
    for (const { tablename } of rows) {
      // Their own profile is how the app knows to tell a deactivated person why they see nothing.
      if (tablename === 'profiles') continue;
      expect(await count(account, tablename), tablename).toBe(0);
    }
    expect(await count(account, 'profiles')).toBe(account === 'deactivated' ? 1 : 0);
    expect(await count(account, 'interventions_v')).toBe(0);
    expect(await count(account, 'member_names()')).toBe(0);
  });

  it('refuses anonymous visitors on every table and function', async () => {
    const { rows } = await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`);
    for (const { tablename } of rows) expect(await count('anon', tablename), tablename).toBe('refused:42501');
    expect(await count('anon', 'interventions_v')).toBe('refused:42501');
    expect(await count('anon', 'member_names()')).toBe('refused:42501');
  });

  it('lets every member read the lookups, boundaries and status timeline', async () => {
    for (const account of ['admin', 'encoder', 'viewer'] as const) {
      for (const table of ['programs', 'categories', 'statuses', 'intervention_types', 'municipalities', 'barangays', 'status_history', 'intervention_photos']) {
        expect(await count(account, table), `${account} ${table}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the full audit log to Admins', async () => {
    expect(await count('admin', 'audit_log')).toBeGreaterThan(0);
    expect(await count('encoder', 'audit_log')).toBe(0);
    expect(await count('viewer', 'audit_log')).toBe(0);
  });

  it('shows people their own profile, and Admins everyone', async () => {
    expect(await count('admin', 'profiles')).toBe(5);
    const own = await attempt('encoder', 'select id, role from profiles');
    expect(own.rows).toEqual([{ id: ENCODER, role: 'encoder' }]);
    expect(await count('viewer', 'profiles')).toBe(1);
  });

  it('gives members names only, not roles, through member_names', async () => {
    const result = await attempt('viewer', 'select * from member_names() order by full_name');
    expect(result.rows).toContainEqual({ id: ENCODER, full_name: 'An Encoder' });
    expect(Object.keys(result.rows[0]).sort()).toEqual(['full_name', 'id']);
  });
});

describe('record history (audit_for_intervention)', () => {
  const history = (account: Account, id: string) => attempt(account, 'select * from audit_for_intervention($1)', [id]);

  it('is open to Admins and Encoders, and refused to everyone else', async () => {
    expect((await history('admin', LIVE)).rows.length).toBeGreaterThan(0);
    expect((await history('encoder', LIVE)).rows.length).toBeGreaterThan(0);
    for (const account of ['viewer', 'no profile', 'deactivated', 'anon'] as const) {
      expect(await history(account, LIVE), account).toMatchObject({ ok: false, code: '42501' });
    }
  });

  it('keeps a deleted record to Admins', async () => {
    expect((await history('admin', DELETED)).rows.length).toBeGreaterThan(0);
    expect((await history('encoder', DELETED)).rows).toEqual([]);
  });

  it('includes the record, its status entries and photos, and only those', async () => {
    const { rows } = await history('encoder', LIVE);
    expect(new Set(rows.map((row) => row.table_name))).toEqual(new Set(['interventions', 'status_history', 'intervention_photos']));
    for (const row of rows) {
      const image = (row.new_row ?? row.old_row) as Record<string, unknown>;
      expect(row.table_name === 'interventions' ? image.id : image.intervention_id).toBe(LIVE);
    }
  });

  it('gives the location as GeoJSON and leaves the raw source row out', async () => {
    const { rows } = await history('encoder', LIVE);
    const created = rows.find((row) => row.table_name === 'interventions' && row.action === 'insert')!;
    const image = created.new_row as Record<string, unknown>;
    expect(image.geojson).toMatchObject({ type: 'Point', coordinates: [121.87, 13.46] });
    expect(image).not.toHaveProperty('geom');
    expect(image).not.toHaveProperty('source_raw');
  });
});

describe('writing through the app functions', () => {
  describe('create_intervention', () => {
    checkAccess('select create_intervention($1::jsonb, $2::jsonb)', EDITORS, () => [newValues(), newStatus()]);
  });
  describe('update_intervention', () => {
    checkAccess('select update_intervention($1, 1, $2::jsonb)', EDITORS, () => [LIVE, { remarks: 'changed' }]);
  });
  describe('add_status', () => {
    checkAccess('select add_status($1, $2::jsonb)', EDITORS, () => [LIVE, newStatus()]);
  });
  describe('update_barangay_baseline', () => {
    checkAccess('select update_barangay_baseline($1, 1, $2::jsonb)', EDITORS, () => [barangayId, { farmer_count: 12 }]);
  });
  describe('soft_delete_intervention', () => {
    checkAccess('select soft_delete_intervention($1, 1)', EDITORS, () => [LIVE]);
  });
  describe('restore_intervention', () => {
    checkAccess('select restore_intervention($1, 1)', ADMIN_ONLY, () => [DELETED]);
  });

  it('refuses to edit a deleted record, even for an Admin, until it is restored', async () => {
    expect(await attempt('admin', 'select update_intervention($1, 1, $2::jsonb)', [DELETED, { remarks: 'x' }])).toMatchObject({ ok: false, code: 'DA409' });
  });

  it('reports a stale version as a conflict, and changes nothing', async () => {
    for (const sql of [
      `select update_intervention('${LIVE}', 99, '{"remarks": "x"}'::jsonb)`,
      `select soft_delete_intervention('${LIVE}', 99)`,
      `select restore_intervention('${DELETED}', 99)`,
      `select update_barangay_baseline(${barangayId}, 99, '{}'::jsonb)`,
    ]) {
      expect(await attempt('admin', sql), sql).toMatchObject({ ok: false, code: 'DA409' });
    }
  });

  it('only changes the fields in the patch', async () => {
    const result = await attempt('encoder', 'select update_intervention($1, 1, $2::jsonb) as saved', [LIVE, { remarks: '  checked  ' }]);
    expect(result.rows[0].saved).toMatchObject({ remarks: 'checked', beneficiary: 'Sample FCA', year_funded: 2024, version: 2 });
  });

  it('clears a field set to null and treats blank text as null', async () => {
    const result = await attempt('encoder', 'select update_intervention($1, 1, $2::jsonb) as saved', [LIVE, { remarks: '   ', point: null }]);
    expect(result.rows[0].saved).toMatchObject({ remarks: null, geojson: null });
    expect((result.rows[0].saved as { qa_flags: string[] }).qa_flags).toContain('no_coords');
  });

  it('saves a record and its first status together, or neither', async () => {
    const bad = await attempt('encoder', 'select create_intervention($1::jsonb, $2::jsonb)', [newValues(), { ...newStatus(), status_date: '2999-01-01' }]);
    expect(bad).toMatchObject({ ok: false, code: '23514' });

    const count = await db.query<{ n: number }>(`select count(*)::int as n from interventions where beneficiary = 'New FCA'`);
    expect(count.rows[0].n).toBe(0);

    const good = await attempt('encoder', 'select (create_intervention($1::jsonb, $2::jsonb)) as saved', [newValues(), newStatus()]);
    expect(good.rows[0].saved).toMatchObject({ beneficiary: 'New FCA', status_id: statusId, data_source: 'Encoded on the map' });
  });

  it('applies the type and field rules to writes through the functions', async () => {
    const noBeneficiary = await attempt('encoder', 'select create_intervention($1::jsonb, $2::jsonb)', [{ ...newValues(), beneficiary: '  ' }, newStatus()]);
    expect(noBeneficiary).toMatchObject({ ok: false, code: '23514' });
    expect(noBeneficiary.message).toMatch(/beneficiary is required/);

    const unknownField = await attempt('encoder', 'select update_intervention($1, 1, $2::jsonb)', [LIVE, { attributes: { nope: 1 } }]);
    expect(unknownField).toMatchObject({ ok: false, code: '23514' });
  });

  it('refuses a photo stored under a different record', async () => {
    const result = await attempt('encoder', 'select add_status($1, $2::jsonb, $3::jsonb)', [LIVE, newStatus(), { storage_path: `${DELETED}/x.jpg` }]);
    expect(result).toMatchObject({ ok: false, code: '23514' });
  });

  it('saves a photo and its status entry together', async () => {
    const path = `${LIVE}/c0000000-0000-4000-8000-000000000009.jpg`;
    const result = await attempt('encoder', 'select add_status($1, $2::jsonb, $3::jsonb) as saved', [
      LIVE,
      newStatus(),
      { storage_path: path, taken_at: '2024-02-01T01:00:00Z', exif_location: { lat: 13.46, lng: 121.87 } },
    ]);
    expect(result).toMatchObject({ ok: true });
    expect((result.rows[0].saved as { photo_id: string | null }).photo_id).toEqual(expect.any(String));
  });
});

describe('writing to tables directly', () => {
  const direct: [string, string | (() => string), Account[], RegExp?][] = [
    ['add a record', () => `insert into interventions (intervention_type_id, category_id, banner_program_id, year_funded, beneficiary, municipality_id)
       values (${typeId}, ${categoryId}, ${programId}, 2024, 'Direct', ${municipalityId})`, EDITORS],
    ['edit a record', `update interventions set remarks = 'x' where id = '${LIVE}'`, EDITORS],
    ['erase a record', `delete from interventions where id = '${LIVE}'`, NOBODY],
    ['set deleted_at directly', `update interventions set deleted_at = now() where id = '${LIVE}'`, NOBODY],
    ['clear deleted_at directly', `update interventions set deleted_at = null where id = '${DELETED}'`, NOBODY],
    ['change who created a record', `update interventions set created_by = '${VIEWER}' where id = '${LIVE}'`, NOBODY],
    ['set the version', `update interventions set version = 50 where id = '${LIVE}'`, NOBODY],
    ['set the status cache', `update interventions set status_id = ${1} where id = '${LIVE}'`, NOBODY],
    ['change the raw source row', `update interventions set source_raw = '{}' where id = '${LIVE}'`, NOBODY],
    ['change the data source', `update interventions set data_source = 'x' where id = '${LIVE}'`, NOBODY],
    ['change the type of a record', `update interventions set intervention_type_id = intervention_type_id where id = '${LIVE}'`, NOBODY],
    ['claim another person created a record', () => `insert into interventions (intervention_type_id, category_id, banner_program_id, year_funded, beneficiary, municipality_id, created_by)
       values (${typeId}, ${categoryId}, ${programId}, 2024, 'Direct', ${municipalityId}, '${VIEWER}')`, NOBODY],

    ['add a status entry', () => `insert into status_history (intervention_id, status_id, status_date) values ('${LIVE}', ${statusId}, '2024-03-01')`, EDITORS,
      // This trigger runs before the policy, and can't see the record for someone without access.
      /status is not in the status list/],
    ['rewrite a status entry', `update status_history set remarks = 'x'`, NOBODY],
    ['erase a status entry', `delete from status_history`, NOBODY],
    ['claim another person added a status', () => `insert into status_history (intervention_id, status_id, status_date, created_by) values ('${LIVE}', ${statusId}, '2024-03-01', '${VIEWER}')`, NOBODY],
    ['add a photo row', `insert into intervention_photos (intervention_id, storage_path) values ('${LIVE}', '${LIVE}/x.jpg')`, EDITORS],
    ['erase a photo row', `delete from intervention_photos`, NOBODY],

    ['write to the audit log', `insert into audit_log (table_name, action) values ('x', 'insert')`, NOBODY],
    ['rewrite the audit log', `update audit_log set context = '{}'`, NOBODY],
    ['erase the audit log', `delete from audit_log`, NOBODY],

    ['edit a baseline', () => `update barangays set attributes = '{"farmer_count": 3}' where id = ${barangayId}`, EDITORS],
    ['rename a barangay', () => `update barangays set name = 'x' where id = ${barangayId}`, NOBODY],
    ['move a barangay boundary', () => `update barangays set boundary = null where id = ${barangayId}`, NOBODY],
    ['set a barangay version', () => `update barangays set version = 50 where id = ${barangayId}`, NOBODY],
    ['add a barangay', () => `insert into barangays (municipality_id, name) values (${municipalityId}, 'x')`, NOBODY],
    ['edit a municipality', `update municipalities set name = name`, NOBODY],
    ['write the record-barangay links', () => `insert into intervention_barangays (intervention_id, barangay_id, link_source) values ('${LIVE}', ${barangayId}, 'spatial')`, NOBODY],
    ['write import batches', `insert into import_batches (file_name, data_source) values ('x', 'y')`, NOBODY],

    ['add a program', `insert into programs (code, name, color) values ('x', 'X', '#000000')`, ADMIN_ONLY],
    ['edit a program', `update programs set color = '#000000' where code = 'rice'`, ADMIN_ONLY],
    ['edit a status', `update statuses set color = '#000000' where name = 'Unknown'`, ADMIN_ONLY],
    ['edit a category', `update categories set sort_order = 1 where code = 'seeder'`, ADMIN_ONLY],
    ['edit an intervention type', `update intervention_types set color = '#000000' where code = 'ssip'`, ADMIN_ONLY],
    ['edit the baseline field list', `update barangay_field_schema set field_schema = field_schema`, ADMIN_ONLY],
    ['erase a program', `delete from programs where code = 'urban'`, NOBODY],

    ['add a member', `insert into profiles (id, role) values ('${NO_PROFILE}', 'viewer')`, ADMIN_ONLY],
    ['change a role', `update profiles set role = 'viewer' where id = '${OTHER_ENCODER}'`, ADMIN_ONLY],
    ['deactivate a member', `update profiles set deactivated_at = now() where id = '${OTHER_ENCODER}'`, ADMIN_ONLY],
    ['erase a member', `delete from profiles where id = '${OTHER_ENCODER}'`, NOBODY],
  ];

  describe.each(direct)('%s', (_label, sql, allowed, otherRefusal) => {
    checkAccess(sql, allowed, () => [], otherRefusal);
  });

  it.each(['encoder', 'viewer'] as const)('stops a %s making themselves Admin', async (account) => {
    const result = await attempt(account, `update profiles set role = 'admin' where id = '${IDS[account]}'`);
    expectWrite(result, false, account);
  });

  it('stops a person with no profile giving themselves one', async () => {
    expectWrite(await attempt('no profile', `insert into profiles (id, role) values ('${NO_PROFILE}', 'admin')`), false, 'no profile');
  });

  it('stops anyone truncating a table', async () => {
    for (const account of ACCOUNTS) {
      for (const table of ['interventions', 'audit_log', 'status_history', 'profiles']) {
        expect(await attempt(account, `truncate ${table} cascade`), `${account} ${table}`).toMatchObject({ ok: false, code: '42501' });
      }
    }
  });
});

describe('saved views', () => {
  const add = (owner: string) => `insert into saved_views (name, owner_id) values ('Mine', '${owner}')`;

  beforeAll(async () => {
    await db.query(
      `insert into saved_views (id, name, owner_id, is_shared) values
         ('d0000000-0000-4000-8000-000000000001', 'Encoder view', $1, false),
         ('d0000000-0000-4000-8000-000000000002', 'Shared view', $1, true)`,
      [ENCODER],
    );
  });

  it('lets any member add a view as themselves, and no one as someone else', async () => {
    // owner_id isn't grantable, so a view always belongs to whoever saves it.
    expect(await attempt('viewer', add(ENCODER))).toMatchObject({ ok: false, code: '42501' });
    const own = await attempt('viewer', `insert into saved_views (name) values ('Mine') returning owner_id`);
    expect(own.rows).toEqual([{ owner_id: VIEWER }]);
    expect(await attempt('no profile', `insert into saved_views (name) values ('Mine')`)).toMatchObject({ ok: false, code: '42501' });
  });

  it('lets owners edit and delete their views, and an Admin take down a shared one', async () => {
    const edit = `update saved_views set name = 'x' where id = 'd0000000-0000-4000-8000-000000000002'`;
    const remove = `delete from saved_views where id = 'd0000000-0000-4000-8000-000000000002'`;
    const removePersonal = `delete from saved_views where id = 'd0000000-0000-4000-8000-000000000001'`;
    expect((await attempt('encoder', edit)).affected).toBe(1);
    expect((await attempt('encoder', remove)).affected).toBe(1);
    expect((await attempt('encoder', removePersonal)).affected).toBe(1);

    expect((await attempt('viewer', edit)).affected).toBe(0);
    expect((await attempt('viewer', remove)).affected).toBe(0);
    expect((await attempt('viewer', removePersonal)).affected).toBe(0);

    // Such as one left by someone who has moved on. It stays theirs to edit, and a personal one stays out of reach.
    expect((await attempt('admin', edit)).affected).toBe(0);
    expect((await attempt('admin', remove)).affected).toBe(1);
    expect((await attempt('admin', removePersonal)).affected).toBe(0);
  });
});

describe('photo storage', () => {
  const USED = `${LIVE}/c0000000-0000-4000-8000-000000000001.jpg`;
  const UNUSED = `${LIVE}/c0000000-0000-4000-8000-000000000002.jpg`;
  const upload = (name: string, bucket = 'intervention-photos') => `insert into storage.objects (bucket_id, name) values ('${bucket}', '${name}')`;

  beforeAll(async () => {
    await db.query(`insert into storage.buckets (id, name) values ('other', 'other')`);
    await db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('intervention-photos', $1, $2), ('intervention-photos', $3, $2)`, [USED, ENCODER, UNUSED]);
  });

  describe('uploading', () => {
    checkAccess(() => upload(`${LIVE}/c0000000-0000-4000-8000-000000000003.jpg`), EDITORS);
  });

  describe('replacing a file', () => {
    checkAccess(`update storage.objects set owner_id = owner_id where name = '${USED}'`, NOBODY);
  });

  it('lets every member read files, needed for a signed link, and nobody else', async () => {
    const read = `select name from storage.objects where bucket_id = 'intervention-photos'`;
    for (const account of ['admin', 'encoder', 'viewer'] as const) expect((await attempt(account, read)).rows.length, account).toBe(2);
    for (const account of ['no profile', 'deactivated'] as const) expect((await attempt(account, read)).rows.length, account).toBe(0);
  });

  it('refuses a path outside the expected pattern, or another bucket', async () => {
    for (const name of ['photo.jpg', '../x.jpg', `${LIVE}/x.jpg`, `${LIVE}/c0000000-0000-4000-8000-000000000003.jpg/y`]) {
      expect(await attempt('encoder', upload(name)), name).toMatchObject({ ok: false, code: '42501' });
    }
    expect(await attempt('admin', upload(`${LIVE}/c0000000-0000-4000-8000-000000000003.jpg`, 'other'))).toMatchObject({ ok: false, code: '42501' });
  });

  it('lets an uploader clear their own unused file, but never one on a record', async () => {
    const remove = (name: string) => `delete from storage.objects where name = '${name}'`;
    expect((await attempt('encoder', remove(UNUSED))).affected).toBe(1);
    expect((await attempt('encoder', remove(USED))).affected).toBe(0);
    expect((await attempt('admin', remove(UNUSED))).affected).toBe(0);
    expect((await attempt('viewer', remove(UNUSED))).affected).toBe(0);
  });
});

describe('live change signals', () => {
  const signals = (account: Account) =>
    attempt(account, `select topic, event, payload from realtime.messages`, [], false, `select set_config('realtime.topic', 'map-changes', true)`);

  it('sends a private signal with the write, carrying no record data', async () => {
    await db.exec('delete from realtime.messages');
    await attempt('encoder', 'select update_intervention($1, 1, $2::jsonb)', [LIVE, { remarks: 'Secret note' }], true);

    const { rows } = await db.query<{ topic: string; private: boolean; event: string; payload: unknown }>('select * from realtime.messages');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toMatchObject({ topic: 'map-changes', private: true, event: 'changed' });
      expect(JSON.stringify(row.payload)).not.toMatch(/Secret|Sample/);
    }
  });

  it('sends nothing for a write that fails', async () => {
    await db.exec('delete from realtime.messages');
    await attempt('viewer', 'select update_intervention($1, 1, $2::jsonb)', [LIVE, { remarks: 'x' }], false);
    await attempt('encoder', 'select update_intervention($1, 99, $2::jsonb)', [LIVE, { remarks: 'x' }], false);
    expect((await db.query('select 1 from realtime.messages')).rows).toEqual([]);
  });

  it('reaches members, on this topic only', async () => {
    await db.query(`insert into realtime.messages (topic, extension, event) values ('map-changes', 'broadcast', 'changed')`);
    for (const account of ['admin', 'encoder', 'viewer'] as const) expect((await signals(account)).rows.length, account).toBeGreaterThan(0);
    for (const account of ['no profile', 'deactivated'] as const) expect((await signals(account)).rows, account).toEqual([]);
    const otherTopic = await attempt('viewer', 'select 1 from realtime.messages', [], false, `select set_config('realtime.topic', 'other', true)`);
    expect(otherTopic.rows).toEqual([]);
  });

  it('never stops a save when the signal fails', async () => {
    await db.exec(`alter function realtime.send(jsonb, text, text, boolean) rename to send_real`);
    await db.exec(`create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
      returns void language plpgsql as $$ begin raise exception 'realtime is down'; end; $$`);
    try {
      const current = await db.query<{ version: number }>('select version from interventions where id = $1', [LIVE]);
      const result = await attempt('encoder', 'select update_intervention($1, $2, $3::jsonb) as saved', [LIVE, current.rows[0].version, { remarks: 'still saved' }]);
      expect(result.rows[0].saved).toMatchObject({ remarks: 'still saved' });
    } finally {
      await db.exec(`drop function realtime.send(jsonb, text, text, boolean)`);
      await db.exec(`alter function realtime.send_real(jsonb, text, text, boolean) rename to send`);
    }
  });
});

describe('the logged-in user is on the record', () => {
  it('names them on a new record, its status and the audit log, with the reason', async () => {
    const result = await attempt(
      'encoder',
      `with saved as (select create_intervention($1::jsonb, $2::jsonb, null, $3::jsonb) as record)
       select record -> 'id' as id from saved`,
      [newValues(), newStatus(), { kind: 'create', reason: 'Field visit' }],
      true,
    );
    const id = result.rows[0].id as string;

    const record = await db.query(`select created_by, updated_by from interventions where id = $1`, [id]);
    expect(record.rows[0]).toEqual({ created_by: ENCODER, updated_by: null });

    const status = await db.query(`select created_by from status_history where intervention_id = $1`, [id]);
    expect(status.rows).toEqual([{ created_by: ENCODER }]);

    const log = await db.query<{ table_name: string; actor_id: string; context: unknown }>(
      `select table_name, actor_id, context from audit_log
       where record_id = $1 or new_row ->> 'intervention_id' = $1 order by id`,
      [id],
    );
    expect(log.rows.map((row) => row.table_name)).toEqual(['interventions', 'status_history']);
    for (const row of log.rows) {
      expect(row).toMatchObject({ actor_id: ENCODER, context: { kind: 'create', reason: 'Field visit' } });
    }
  });

  it('names them as the editor, and the deleter or restorer', async () => {
    const steps: [Account, string, string][] = [
      ['encoder', `select update_intervention('${LIVE}', $1, '{"remarks": "by encoder"}'::jsonb, '{"kind": "edit"}'::jsonb)`, ENCODER],
      ['encoder', `select soft_delete_intervention('${LIVE}', $1, '{"kind": "delete", "reason": "Entered twice"}'::jsonb)`, ENCODER],
      ['admin', `select restore_intervention('${LIVE}', $1, '{"kind": "restore"}'::jsonb)`, ADMIN],
    ];
    for (const [account, sql, expected] of steps) {
      const { rows } = await db.query<{ version: number }>('select version from interventions where id = $1', [LIVE]);
      const result = await attempt(account, sql, [rows[0].version], true);
      expect(result, sql).toMatchObject({ ok: true });

      const updated = await db.query(`select updated_by from interventions where id = $1`, [LIVE]);
      expect(updated.rows[0]).toEqual({ updated_by: expected });
      const log = await db.query<{ actor_id: string }>(`select actor_id from audit_log where record_id = $1 order by id desc limit 1`, [LIVE]);
      expect(log.rows[0].actor_id).toBe(expected);
    }

    const actions = await db.query<{ action: string; reason: string | null }>(
      `select action, context ->> 'reason' as reason from audit_log where table_name = 'interventions' and record_id = $1 order by id desc limit 2`,
      [LIVE],
    );
    expect(actions.rows).toEqual([
      { action: 'restore', reason: null },
      { action: 'soft_delete', reason: 'Entered twice' },
    ]);
  });

  it('gives the History panel the person\'s name', async () => {
    const { rows } = await attempt('encoder', 'select actor_name from audit_for_intervention($1) where actor_id = $2 limit 1', [LIVE, ENCODER]);
    expect(rows[0].actor_name).toBe('An Encoder');
  });

  it('removes access the moment someone is deactivated, keeping their name on past work', async () => {
    const before = await attempt('encoder', 'select count(*)::int as n from interventions');
    expect(before.rows[0].n).toBeGreaterThan(0);

    await db.query('update profiles set deactivated_at = now() where id = $1', [ENCODER]);
    try {
      const after = await attempt('encoder', 'select count(*)::int as n from interventions');
      expect(after.rows[0].n).toBe(0);
      expect(await attempt('encoder', 'select update_intervention($1, 1, $2::jsonb)', [LIVE, { remarks: 'x' }])).toMatchObject({ ok: false, code: '42501' });

      const history = await attempt('admin', 'select actor_name from audit_for_intervention($1) where actor_id = $2 limit 1', [LIVE, ENCODER]);
      expect(history.rows[0].actor_name).toBe('An Encoder');
    } finally {
      await db.query('update profiles set deactivated_at = null where id = $1', [ENCODER]);
    }
  });
});
