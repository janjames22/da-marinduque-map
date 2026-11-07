// The Edge Function behind the Users page, against a stand-in for Supabase Auth and its REST API. The
// secret key can do anything, so most of this is about where it goes and who gets to use it.
import { describe, expect, it } from 'vitest';
import { handleRequest, type AdminUsersEnv } from '../supabase/functions/admin-users/handler';

const ENV: AdminUsersEnv = { url: 'https://project.supabase.co', publishableKey: 'sb_publishable_key', secretKey: 'sb_secret_key' };

const ADMIN = 'a0000000-0000-4000-8000-000000000001';
const VIEWER = 'a0000000-0000-4000-8000-000000000002';
const ENCODER = 'a0000000-0000-4000-8000-000000000003';
const FORMER = 'a0000000-0000-4000-8000-000000000004';
const INVITED = 'a0000000-0000-4000-8000-000000000005';
const NO_ROLE = 'a0000000-0000-4000-8000-000000000006';
const NEW_PERSON = 'a0000000-0000-4000-8000-000000000099';

interface Call {
  method: string;
  path: string;
  search: string;
  auth: string;
  apikey: string;
  body: Record<string, unknown> | null;
}

function services(overrides: { invite?: Response; patch?: Response; failAll?: boolean } = {}) {
  const users = [
    { id: ADMIN, email: 'ana@example.com', email_confirmed_at: '2026-01-01', last_sign_in_at: '2026-11-06T10:00:00Z', invited_at: '2026-01-01' },
    { id: VIEWER, email: 'vera@example.com', email_confirmed_at: '2026-01-01', last_sign_in_at: null },
    { id: ENCODER, email: 'enzo@example.com', email_confirmed_at: '2026-01-01', last_sign_in_at: '2026-10-01T00:00:00Z' },
    { id: FORMER, email: 'former@example.com', email_confirmed_at: '2026-01-01', last_sign_in_at: null },
    { id: INVITED, email: 'invited@example.com', email_confirmed_at: null, invited_at: '2026-11-01' },
    { id: NO_ROLE, email: 'norole@example.com', email_confirmed_at: '2026-01-01' },
  ];
  const profiles = [
    { id: ADMIN, full_name: 'Ana Admin', role: 'admin', deactivated_at: null },
    { id: VIEWER, full_name: 'Vera Viewer', role: 'viewer', deactivated_at: null },
    { id: ENCODER, full_name: 'Enzo Encoder', role: 'encoder', deactivated_at: null },
    { id: FORMER, full_name: 'Former Admin', role: 'admin', deactivated_at: '2026-02-01' },
    { id: INVITED, full_name: 'Invited Person', role: 'viewer', deactivated_at: null },
  ];
  const tokens: Record<string, string> = { 'admin-token': ADMIN, 'viewer-token': VIEWER, 'encoder-token': ENCODER, 'former-token': FORMER, 'norole-token': NO_ROLE };
  const calls: Call[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    if (overrides.failAll) throw new Error('secret detail about the network');
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const auth = headers.get('authorization') ?? '';
    const apikey = headers.get('apikey') ?? '';
    const method = init.method ?? 'GET';
    calls.push({ method, path: url.pathname, search: url.search, auth, apikey, body });
    const caller = tokens[auth.replace('Bearer ', '')];

    if (url.pathname === '/auth/v1/user') return caller ? json({ id: caller }) : json({ msg: 'bad token' }, 401);
    if (url.pathname === '/rest/v1/profiles') {
      if (method === 'GET') {
        const id = url.searchParams.get('id')?.replace('eq.', '');
        return json(id ? profiles.filter((p) => p.id === id) : profiles);
      }
      if (method === 'PATCH') return overrides.patch ?? json(profiles.filter((p) => `eq.${p.id}` === url.searchParams.get('id')));
      return new Response(null, { status: 201 });
    }
    if (url.pathname === '/auth/v1/admin/users' && method === 'GET') return json({ users });
    if (url.pathname.startsWith('/auth/v1/admin/users/')) return json({});
    if (url.pathname === '/auth/v1/invite') return overrides.invite ?? json({ id: users.find((u) => u.email === body?.email)?.id ?? NEW_PERSON });
    if (url.pathname === '/auth/v1/recover') return json({});
    if (url.pathname === '/auth/v1/admin/generate_link') {
      return json({ id: users.find((u) => u.email === body?.email)?.id ?? NEW_PERSON, action_link: 'https://project.supabase.co/auth/v1/verify?token=abc' });
    }
    return json({ msg: `not faked: ${url.pathname}` }, 404);
  }) as typeof fetch;

  const send = (token: string | null, body: Record<string, unknown>, method = 'POST') =>
    handleRequest(
      new Request('https://project.supabase.co/functions/v1/admin-users', {
        method,
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: method === 'POST' ? JSON.stringify(body) : undefined,
      }),
      ENV,
      fetcher,
    );

  return { calls, send };
}

const REDIRECT = 'https://da-marinduque-map.netlify.app';

describe('who gets in', () => {
  it('answers a browser\'s preflight, and only takes POST', async () => {
    const { send } = services();
    const preflight = await send(null, {}, 'OPTIONS');
    expect(preflight.status).toBe(200);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization');
    expect((await send('admin-token', {}, 'GET')).status).toBe(405);
  });

  it.each([
    ['no login', null, 401],
    ['a token Auth doesn\'t know', 'made-up-token', 401],
    ['a Viewer', 'viewer-token', 403],
    ['an Encoder', 'encoder-token', 403],
    ['a deactivated Admin', 'former-token', 403],
    ['an account with no role', 'norole-token', 403],
  ])('refuses %s, and never reaches for the secret key', async (_name, token, status) => {
    const { send, calls } = services();
    for (const action of ['list', 'invite', 'deactivate']) {
      const response = await send(token, { action, id: VIEWER, email: 'x@example.com', full_name: 'X', role: 'admin' });
      expect(response.status).toBe(status);
    }
    expect(calls.filter((call) => call.apikey === ENV.secretKey || call.auth.includes(ENV.secretKey))).toEqual([]);
  });
});

describe('where the secret key goes', () => {
  const everything: Record<string, unknown>[] = [
    { action: 'list' },
    { action: 'invite', email: 'new@example.com', full_name: 'New Person', role: 'encoder', delivery: 'email', redirect_to: REDIRECT },
    { action: 'invite', email: 'new@example.com', full_name: 'New Person', role: 'encoder', delivery: 'link', redirect_to: REDIRECT },
    { action: 'new_link', id: VIEWER, delivery: 'email' },
    { action: 'new_link', id: VIEWER, delivery: 'link' },
    { action: 'update', id: VIEWER, role: 'encoder', full_name: 'Vera V.' },
    { action: 'deactivate', id: VIEWER },
    { action: 'reactivate', id: FORMER },
  ];

  it('only to Auth, never the database, and never back in an answer', async () => {
    for (const body of everything) {
      const { send, calls } = services();
      const response = await send('admin-token', body);
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(await response.text()).not.toContain(ENV.secretKey);
      for (const call of calls) {
        const usesSecret = call.apikey === ENV.secretKey || call.auth.includes(ENV.secretKey);
        if (call.path.startsWith('/rest/')) expect(usesSecret, call.path).toBe(false);
        if (usesSecret) expect(call.path).toMatch(/^\/auth\/v1\/(admin|invite|recover)/);
      }
    }
  });

  it('database changes carry the Admin\'s own login, so the audit log names them', async () => {
    for (const body of everything.slice(1)) {
      const { send, calls } = services();
      await send('admin-token', body);
      for (const call of calls.filter((c) => c.path === '/rest/v1/profiles' && c.method !== 'GET')) {
        expect(call.auth, JSON.stringify(body)).toBe('Bearer admin-token');
        expect(call.apikey).toBe(ENV.publishableKey);
      }
    }
  });
});

describe('listing people', () => {
  it('gives names, roles and where each person stands, and nothing else from Auth', async () => {
    const { send } = services();
    const { people } = (await (await send('admin-token', { action: 'list' })).json()) as { people: Record<string, unknown>[] };
    const statuses = Object.fromEntries(people.map((person) => [person.email, person.status]));
    expect(statuses).toEqual({
      'ana@example.com': 'active',
      'vera@example.com': 'active',
      'enzo@example.com': 'active',
      'former@example.com': 'deactivated',
      'invited@example.com': 'invited',
      'norole@example.com': 'no_access',
    });
    expect(people[0]).toEqual({
      id: ADMIN,
      email: 'ana@example.com',
      full_name: 'Ana Admin',
      role: 'admin',
      status: 'active',
      invited_at: '2026-01-01',
      last_sign_in_at: '2026-11-06T10:00:00Z',
    });
    expect(people.find((person) => person.email === 'norole@example.com')).toMatchObject({ full_name: null, role: null });
  });
});

describe('inviting', () => {
  const invite = { action: 'invite', email: 'New@Example.com ', full_name: ' New Person ', role: 'encoder', redirect_to: REDIRECT };

  it('by email: Auth sends it, then the person gets their role', async () => {
    const { send, calls } = services();
    const response = await send('admin-token', { ...invite, delivery: 'email' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: NEW_PERSON, link: null });

    const sent = calls.find((call) => call.path === '/auth/v1/invite')!;
    expect(sent.body).toEqual({ email: 'new@example.com' });
    expect(new URLSearchParams(sent.search).get('redirect_to')).toBe(REDIRECT);
    const saved = calls.find((call) => call.path === '/rest/v1/profiles' && call.method === 'POST')!;
    expect(saved.body).toEqual({ id: NEW_PERSON, full_name: 'New Person', role: 'encoder' });
    // An upsert would need the right to update a profile's id, which the grants rightly refuse.
    expect(saved.search).toBe('');
    expect(calls.some((call) => call.search.includes('on_conflict'))).toBe(false);
  });

  it('by link: nothing is emailed, and the Admin gets the link', async () => {
    const { send, calls } = services();
    const response = await send('admin-token', { ...invite, delivery: 'link' });
    expect(await response.json()).toEqual({ id: NEW_PERSON, link: 'https://project.supabase.co/auth/v1/verify?token=abc' });
    expect(calls.some((call) => call.path === '/auth/v1/invite')).toBe(false);
    expect(calls.find((call) => call.path === '/auth/v1/admin/generate_link')?.body).toEqual({ type: 'invite', email: 'new@example.com', redirect_to: REDIRECT });
  });

  it.each([
    ['a bad email', { email: 'not an email' }, /valid email/],
    ['no name', { full_name: '  ' }, /their name/],
    ['an unknown role', { role: 'superuser' }, /Choose a role/],
    ['no role', { role: undefined }, /Choose a role/],
  ])('refuses %s, before anything happens', async (_name, change, message) => {
    const { send, calls } = services();
    const response = await send('admin-token', { ...invite, ...change });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toMatch(message);
    expect(calls.some((call) => ['/auth/v1/invite', '/auth/v1/admin/generate_link'].includes(call.path))).toBe(false);
  });

  it('won\'t re-invite someone who already has an account, or who was deactivated', async () => {
    const { send } = services();
    const active = await send('admin-token', { ...invite, email: 'VERA@example.com' });
    expect(active.status).toBe(409);
    expect(((await active.json()) as { message: string }).message).toMatch(/already has an account/);
    const deactivated = await send('admin-token', { ...invite, email: 'former@example.com' });
    expect(deactivated.status).toBe(409);
    expect(((await deactivated.json()) as { message: string }).message).toMatch(/Reactivate/);
  });

  it('sends a pending invitation again, updating their details', async () => {
    const { send, calls } = services();
    expect((await send('admin-token', { ...invite, email: 'invited@example.com' })).status).toBe(200);
    expect(calls.some((call) => call.path === '/auth/v1/invite')).toBe(true);
    expect(calls.some((call) => call.path === '/rest/v1/profiles' && call.method === 'POST')).toBe(false);
    const updated = calls.find((call) => call.path === '/rest/v1/profiles' && call.method === 'PATCH')!;
    expect(updated.search).toBe(`?id=eq.${INVITED}`);
    expect(updated.body).toEqual({ full_name: 'New Person', role: 'encoder' });
  });

  it('gives a role to an account that never had one, by a reset, as Auth won\'t invite them twice', async () => {
    const { send, calls } = services();
    expect((await send('admin-token', { ...invite, email: 'norole@example.com' })).status).toBe(200);
    expect(calls.some((call) => call.path === '/auth/v1/invite')).toBe(false);
    expect(calls.some((call) => call.path === '/auth/v1/recover')).toBe(true);
    expect(calls.find((call) => call.path === '/rest/v1/profiles' && call.method === 'POST')?.body).toMatchObject({ id: NO_ROLE, role: 'encoder' });
  });

  it('says so when the email can\'t go, and points to the link instead', async () => {
    const failed = services({ invite: new Response(JSON.stringify({ msg: 'Error sending invite email' }), { status: 500 }) });
    const response = await failed.send('admin-token', { ...invite, delivery: 'email' });
    expect(response.status).toBe(502);
    const { message } = (await response.json()) as { message: string };
    expect(message).toMatch(/could not be sent/);
    expect(message).toMatch(/get a link/);
    expect(failed.calls.some((call) => call.path === '/rest/v1/profiles' && call.method === 'POST')).toBe(false);

    const limited = services({ invite: new Response(JSON.stringify({ msg: 'email rate limit exceeded' }), { status: 429 }) });
    const tooMany = await limited.send('admin-token', { ...invite, delivery: 'email' });
    expect(tooMany.status).toBe(429);
    expect(((await tooMany.json()) as { message: string }).message).toMatch(/Too many emails/);
  });
});

describe('a new link', () => {
  it('is a password reset for someone who has one, and a fresh invite for someone who doesn\'t yet', async () => {
    const confirmed = services();
    expect(await (await confirmed.send('admin-token', { action: 'new_link', id: VIEWER, delivery: 'link' })).json()).toMatchObject({ link: expect.stringContaining('verify') });
    expect(confirmed.calls.find((call) => call.path.endsWith('generate_link'))?.body).toMatchObject({ type: 'recovery', email: 'vera@example.com' });

    const pending = services();
    await pending.send('admin-token', { action: 'new_link', id: INVITED, delivery: 'link' });
    expect(pending.calls.find((call) => call.path.endsWith('generate_link'))?.body).toMatchObject({ type: 'invite', email: 'invited@example.com' });
  });

  it('can be emailed instead', async () => {
    const confirmed = services();
    expect(await (await confirmed.send('admin-token', { action: 'new_link', id: VIEWER, delivery: 'email' })).json()).toMatchObject({ link: null });
    expect(confirmed.calls.find((call) => call.path === '/auth/v1/recover')?.body).toEqual({ email: 'vera@example.com' });
    const pending = services();
    await pending.send('admin-token', { action: 'new_link', id: INVITED, delivery: 'email' });
    expect(pending.calls.find((call) => call.path === '/auth/v1/invite')?.body).toEqual({ email: 'invited@example.com' });
  });

  it('refuses an id that isn\'t one, so nothing odd reaches an address', async () => {
    const { send } = services();
    expect((await send('admin-token', { action: 'new_link', id: '../../secrets' })).status).toBe(400);
    expect((await send('admin-token', { action: 'update', id: `${VIEWER}&role=eq.admin`, role: 'admin' })).status).toBe(400);
    expect((await send('admin-token', { action: 'new_link', id: '99999999-0000-4000-8000-000000000000' })).status).toBe(404);
  });
});

describe('changing someone', () => {
  it('sets a role or a name', async () => {
    const { send, calls } = services();
    expect((await send('admin-token', { action: 'update', id: VIEWER, role: 'encoder' })).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/rest/v1/profiles', search: `?id=eq.${VIEWER}`, body: { role: 'encoder' } });
    expect((await send('admin-token', { action: 'update', id: ADMIN, full_name: ' Ana A. ' })).status).toBe(200);
    expect(calls.at(-1)?.body).toEqual({ full_name: 'Ana A.' });
  });

  it('won\'t change an Admin\'s own role, or take a role or name that isn\'t valid', async () => {
    const { send } = services();
    const own = await send('admin-token', { action: 'update', id: ADMIN, role: 'viewer' });
    expect(own.status).toBe(409);
    expect(((await own.json()) as { message: string }).message).toMatch(/your own role/);
    expect((await send('admin-token', { action: 'update', id: VIEWER, role: 'superuser' })).status).toBe(400);
    expect((await send('admin-token', { action: 'update', id: VIEWER, full_name: ' ' })).status).toBe(400);
    expect((await send('admin-token', { action: 'update', id: VIEWER })).status).toBe(400);
  });

  it('passes on the database\'s refusal to lose the last Admin', async () => {
    const { send } = services({ patch: new Response(JSON.stringify({ message: 'There has to be at least one active Admin, so this change was refused.' }), { status: 400 }) });
    const response = await send('admin-token', { action: 'update', id: VIEWER, role: 'viewer' });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { message: string }).message).toMatch(/at least one active Admin/);
  });

  it('says when the person has no profile to change', async () => {
    const { send } = services();
    expect((await send('admin-token', { action: 'update', id: NO_ROLE, role: 'viewer' })).status).toBe(404);
  });
});

describe('deactivating', () => {
  it('removes access, then blocks sign-in with no end date', async () => {
    const { send, calls } = services();
    expect((await send('admin-token', { action: 'deactivate', id: VIEWER })).status).toBe(200);
    const patch = calls.find((call) => call.method === 'PATCH')!;
    expect(patch.body?.deactivated_at).toEqual(expect.any(String));
    const ban = calls.find((call) => call.method === 'PUT')!;
    expect(ban.path).toBe(`/auth/v1/admin/users/${VIEWER}`);
    expect(ban.body).toEqual({ ban_duration: '876000h' });
    expect(calls.indexOf(patch)).toBeLessThan(calls.indexOf(ban));
  });

  it('won\'t let an Admin deactivate themselves', async () => {
    const { send, calls } = services();
    const response = await send('admin-token', { action: 'deactivate', id: ADMIN });
    expect(response.status).toBe(409);
    expect(calls.some((call) => call.method === 'PATCH' || call.method === 'PUT')).toBe(false);
  });

  it('gives access back', async () => {
    const { send, calls } = services();
    expect((await send('admin-token', { action: 'reactivate', id: FORMER })).status).toBe(200);
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ deactivated_at: null });
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ ban_duration: 'none' });
  });
});

describe('when something goes wrong', () => {
  it('refuses an action it doesn\'t know', async () => {
    const { send } = services();
    expect((await send('admin-token', { action: 'delete_everyone' })).status).toBe(400);
  });

  it('hides the details of a network failure', async () => {
    const { send } = services({ failAll: true });
    const response = await send('admin-token', { action: 'list' });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret detail');
  });
});
