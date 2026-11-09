// Temporary accounts for the live tests. Everything they create is removed afterwards, including
// from the audit log, so the real data is left as it was. Their emails all start the same way, so a
// run that crashed gets cleaned up by the next one.
import { randomBytes } from 'node:crypto';
import type { Queryable } from '../seed-interventions';
import { adminClient, connectDb } from './env';

const EMAIL_PREFIX = 'e2e-test-';
const PHOTO_BUCKET = 'intervention-photos';

export type TestRole = 'admin' | 'encoder' | 'viewer' | 'stranger';

export interface TestAccount {
  id: string;
  email: string;
  password: string;
  full_name: string;
}

export type TestAccounts = Record<TestRole, TestAccount>;

const REQUEST_TIMEOUT_MS = 20_000;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;

// The service sometimes drops a request or never answers it. Starting over is safe, because the
// emails identify whatever a failed attempt made, and removal runs first. Only setup and cleanup
// retry: what the tests themselves measure still has to work the first time.
async function retrying<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (failure) {
      if (attempt === ATTEMPTS) throw failure;
      console.warn(`Test account setup failed, trying again (${attempt} of ${ATTEMPTS - 1}): ${(failure as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

export const removeTestAccounts = () => retrying(removeAccounts);
export const createTestAccounts = () => retrying(createAccounts);

// Lists are archived, never deleted, so these are the only rows of theirs that should ever go. Only
// their own lines leave the audit log: a real deletion is exactly what the log has to keep.
export async function removeTestLists(db: Queryable) {
  const { rows } = await db.query<{ id: number }>(`select id from public.intervention_types where code like 'e2e-test-%'`);
  const types = rows.map((row) => String(row.id));
  await db.query(`delete from public.programs where code like 'e2e-test-%'`);
  // Signature blocks are never deleted by the website, so only the live tests' own leave, by their label.
  // A database from before 0011 has none.
  const { rows: present } = await db.query<{ present: boolean }>(`select to_regclass('public.report_signatories') is not null as present`);
  const { rows: signers } = present[0].present
    ? await db.query<{ id: number }>(`delete from public.report_signatories where label like 'E2E test%' returning id`)
    : { rows: [] as { id: number }[] };
  await db.query(`delete from public.intervention_type_statuses where intervention_type_id in (select id from public.intervention_types where code like 'e2e-test-%')`);
  await db.query(`delete from public.intervention_types where code like 'e2e-test-%'`);
  await db.query(
    `delete from public.audit_log
     where action = 'delete' and actor_id is null
       and (
         (table_name in ('programs', 'intervention_types') and old_row ->> 'code' like 'e2e-test-%')
         or (table_name = 'intervention_type_statuses' and old_row ->> 'intervention_type_id' = any($1::text[]))
         or (table_name = 'report_signatories' and record_id = any($2::text[]))
       )`,
    [types, signers.map((signer) => String(signer.id))],
  );
}

async function removeAccounts() {
  const admin = adminClient(REQUEST_TIMEOUT_MS);
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  const users = data.users.filter((user) => user.email?.startsWith(EMAIL_PREFIX));
  if (users.length === 0) return;
  const ids = users.map((user) => user.id);

  const db = await connectDb();
  try {
    await db.query('begin');
    const { rows } = await db.query<{ id: string }>('select id from public.interventions where created_by = any($1::uuid[])', [ids]);
    const records = rows.map((row) => row.id);

    const { rows: photos } = await db.query<{ storage_path: string }>(
      'select storage_path from public.intervention_photos where intervention_id = any($1::uuid[])',
      [records],
    );
    // A dismissal names its person, so it goes before the profile, wherever it was made.
    await db.query('delete from public.qa_dismissals where dismissed_by = any($1::uuid[])', [ids]);
    await db.query('delete from public.interventions where id = any($1::uuid[])', [records]);
    // Their imports, once the records that came in with them are gone.
    const { rows: batches } = await db.query<{ id: string }>('delete from public.import_batches where imported_by = any($1::uuid[]) returning id', [ids]);
    const { rows: views } = await db.query<{ id: string }>('delete from public.saved_views where owner_id = any($1::uuid[]) returning id', [ids]);
    await removeTestLists(db);
    await db.query('delete from public.profiles where id = any($1::uuid[])', [ids]);
    await db.query(
      `delete from public.audit_log
       where actor_id = any($1::uuid[])
          or record_id = any($2::text[])
          or record_id = any($3::text[])
          or coalesce(new_row, old_row) ->> 'intervention_id' = any($2::text[])
          or (table_name = 'saved_views' and record_id = any($4::text[]))
          or (table_name = 'import_batches' and record_id = any($5::text[]))`,
      [ids, records, ids, views.map((view) => view.id), batches.map((batch) => batch.id)],
    );
    await db.query('commit');

    if (photos.length > 0) await admin.storage.from(PHOTO_BUCKET).remove(photos.map((photo) => photo.storage_path));
  } catch (failure) {
    await db.query('rollback');
    throw failure;
  } finally {
    await db.end();
  }

  for (const id of ids) {
    const { error: removeError } = await admin.auth.admin.deleteUser(id);
    if (removeError) throw new Error(removeError.message);
  }
}

async function createAccounts(): Promise<TestAccounts> {
  await removeAccounts();
  const admin = adminClient(REQUEST_TIMEOUT_MS);
  const run = randomBytes(4).toString('hex');

  const make = async (role: TestRole): Promise<TestAccount> => {
    const email = `${EMAIL_PREFIX}${role}-${run}@example.com`;
    const password = randomBytes(18).toString('base64url');
    const full_name = `Test ${role}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    if (role !== 'stranger') {
      const { error: profileError } = await admin.from('profiles').insert({ id: data.user.id, full_name, role });
      if (profileError) throw new Error(profileError.message);
    }
    return { id: data.user.id, email, password, full_name };
  };

  return {
    admin: await make('admin'),
    encoder: await make('encoder'),
    viewer: await make('viewer'),
    stranger: await make('stranger'),
  };
}
