// The admin-users function's code against the real Auth and database, with temporary accounts. It runs
// here rather than as a deployed function, so it can be proved before anything is deployed. It only
// ever makes links, so no email goes out. e2e-live/admin.spec.ts tries the deployed function.
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDb, loadEnv, projectUrl, publicKey, secretKey } from '../../scripts/lib/env';
import { createTestAccounts, removeTestAccounts, type TestAccount, type TestAccounts } from '../../scripts/lib/test-accounts';
import { handleRequest, type AdminUsersEnv } from '../../supabase/functions/admin-users/handler';

loadEnv();

const env: AdminUsersEnv = { url: projectUrl(), publishableKey: publicKey(), secretKey: secretKey() };

let accounts: TestAccounts;
let adminToken: string;
let viewerToken: string;
let invitedEmail: string;

const newClient = () => createClient(projectUrl(), publicKey(), { auth: { persistSession: false, autoRefreshToken: false } });

async function tokenFor(account: TestAccount) {
  const { data, error } = await newClient().auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw new Error(`${account.email}: ${error.message}`);
  return data.session.access_token;
}

interface Answer {
  people: { id: string; email: string; full_name: string | null; role: string | null; status: string; last_sign_in_at: string | null }[];
  id: string;
  link: string | null;
  message: string;
}

async function send(token: string | null, body: Record<string, unknown>) {
  const response = await handleRequest(
    new Request(`${env.url}/functions/v1/admin-users`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: response.status, body: (await response.json()) as Answer };
}

const listed = async (email: string) => (await send(adminToken, { action: 'list' })).body.people.find((person) => person.email === email);

beforeAll(async () => {
  accounts = await createTestAccounts();
  adminToken = await tokenFor(accounts.admin);
  viewerToken = await tokenFor(accounts.viewer);
  invitedEmail = `e2e-test-invited-${Date.now()}@example.com`;
});

afterAll(async () => {
  await removeTestAccounts();
});

describe('who gets in', () => {
  it('refuses no login, a made-up token, a Viewer and an account with no role', async () => {
    expect((await send(null, { action: 'list' })).status).toBe(401);
    expect((await send('made-up-token', { action: 'list' })).status).toBe(401);
    expect((await send(viewerToken, { action: 'list' })).status).toBe(403);
    expect((await send(await tokenFor(accounts.stranger), { action: 'list' })).status).toBe(403);
    expect((await send(await tokenFor(accounts.encoder), { action: 'invite', email: invitedEmail, full_name: 'X', role: 'admin', delivery: 'link' })).status).toBe(403);
    expect((await send(adminToken, { action: 'list' })).status).toBe(200);
  });
});

describe('listing', () => {
  it('gives each person\'s email, name, role and where they stand', async () => {
    expect(await listed(accounts.viewer.email)).toMatchObject({ full_name: 'Test viewer', role: 'viewer', status: 'active', id: accounts.viewer.id });
    expect(await listed(accounts.stranger.email)).toMatchObject({ role: null, status: 'no_access' });
    expect((await listed(accounts.admin.email))?.last_sign_in_at).not.toBeNull();
  });
});

describe('inviting by link', () => {
  it('makes the account, a working invite link and their profile', async () => {
    const { status, body } = await send(adminToken, { action: 'invite', email: invitedEmail, full_name: 'Test Invited', role: 'encoder', delivery: 'link', redirect_to: projectUrl() });
    expect(status, body.message).toBe(200);
    expect(body.link).toContain('/auth/v1/verify');
    expect(body.link).toContain('type=invite');
    expect(await listed(invitedEmail)).toMatchObject({ full_name: 'Test Invited', role: 'encoder', status: 'invited' });
  });

  it('can do it again for someone who hasn\'t accepted, updating their details', async () => {
    const { status, body } = await send(adminToken, { action: 'invite', email: invitedEmail.toUpperCase(), full_name: 'Test Invited Again', role: 'viewer', delivery: 'link' });
    expect(status, body.message).toBe(200);
    expect(await listed(invitedEmail)).toMatchObject({ full_name: 'Test Invited Again', role: 'viewer', status: 'invited' });
  });

  it('won\'t invite someone who already has an account', async () => {
    const { status, body } = await send(adminToken, { action: 'invite', email: accounts.viewer.email, full_name: 'X', role: 'admin', delivery: 'link' });
    expect(status).toBe(409);
    expect(body.message).toMatch(/already has an account/);
    expect((await listed(accounts.viewer.email))?.role).toBe('viewer');
  });

  it('gives a role to an account that has none, with a reset link', async () => {
    const { status, body } = await send(adminToken, { action: 'invite', email: accounts.stranger.email, full_name: 'Test Stranger', role: 'viewer', delivery: 'link' });
    expect(status, body.message).toBe(200);
    expect(body.link).toContain('type=recovery');
    expect(await listed(accounts.stranger.email)).toMatchObject({ role: 'viewer', status: 'active' });
  });
});

describe('a new link', () => {
  it('is a reset for someone with a password, and an invite for someone without', async () => {
    const confirmed = await send(adminToken, { action: 'new_link', id: accounts.viewer.id, delivery: 'link' });
    expect(confirmed.body.link).toContain('type=recovery');
    const invited = (await listed(invitedEmail))!;
    const pending = await send(adminToken, { action: 'new_link', id: invited.id, delivery: 'link' });
    expect(pending.body.link).toContain('type=invite');
  });
});

describe('changing someone', () => {
  it('sets a role and a name, and the audit log names the Admin, not the service', async () => {
    const { status, body } = await send(adminToken, { action: 'update', id: accounts.encoder.id, role: 'viewer', full_name: 'Test renamed' });
    expect(status, body.message).toBe(200);
    expect(await listed(accounts.encoder.email)).toMatchObject({ role: 'viewer', full_name: 'Test renamed' });

    const db = await connectDb();
    try {
      const { rows } = await db.query<{ actor_id: string }>(`select actor_id from public.audit_log where table_name = 'profiles' and record_id = $1 order by id desc limit 1`, [accounts.encoder.id]);
      expect(rows[0].actor_id).toBe(accounts.admin.id);
    } finally {
      await db.end();
    }
    await send(adminToken, { action: 'update', id: accounts.encoder.id, role: 'encoder' });
  });

  it('won\'t change the Admin\'s own role, or deactivate them', async () => {
    expect((await send(adminToken, { action: 'update', id: accounts.admin.id, role: 'viewer' })).status).toBe(409);
    expect((await send(adminToken, { action: 'deactivate', id: accounts.admin.id })).status).toBe(409);
  });
});

describe('deactivating', () => {
  it('stops them signing in, and reactivating lets them back', async () => {
    const { status, body } = await send(adminToken, { action: 'deactivate', id: accounts.viewer.id });
    expect(status, body.message).toBe(200);
    expect((await listed(accounts.viewer.email))?.status).toBe('deactivated');

    const refused = await newClient().auth.signInWithPassword({ email: accounts.viewer.email, password: accounts.viewer.password });
    expect(refused.error?.message).toMatch(/banned/i);
    expect((await send(adminToken, { action: 'invite', email: accounts.viewer.email, full_name: 'X', role: 'viewer', delivery: 'link' })).status).toBe(409);

    expect((await send(adminToken, { action: 'reactivate', id: accounts.viewer.id })).status).toBe(200);
    expect((await listed(accounts.viewer.email))?.status).toBe('active');
    const back = await newClient().auth.signInWithPassword({ email: accounts.viewer.email, password: accounts.viewer.password });
    expect(back.error).toBeNull();
  });
});
