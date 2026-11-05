// Temporary accounts for the live tests. Everything they create is removed afterwards, including
// from the audit log, so the real data is left as it was. Their emails all start the same way, so a
// run that crashed gets cleaned up by the next one.
import { randomBytes } from 'node:crypto';
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

export async function removeTestAccounts() {
  const admin = adminClient();
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
    await db.query('delete from public.interventions where id = any($1::uuid[])', [records]);
    await db.query('delete from public.saved_views where owner_id = any($1::uuid[])', [ids]);
    await db.query('delete from public.profiles where id = any($1::uuid[])', [ids]);
    await db.query(
      `delete from public.audit_log
       where actor_id = any($1::uuid[])
          or record_id = any($2::text[])
          or record_id = any($3::text[])
          or coalesce(new_row, old_row) ->> 'intervention_id' = any($2::text[])`,
      [ids, records, ids],
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

export async function createTestAccounts(): Promise<TestAccounts> {
  await removeTestAccounts();
  const admin = adminClient();
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
