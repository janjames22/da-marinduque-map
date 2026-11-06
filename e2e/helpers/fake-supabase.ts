// Answers the app's network calls the way hosted Supabase does, so sign-in, roles, saving, photos
// and live signals can run through the real client. It proves the app speaks the protocol
// correctly. Only the live tests in e2e-live prove that the hosted service answers this way.
import { readFileSync } from 'node:fs';
import type { Page, Route, WebSocketRoute } from '@playwright/test';

export const FAKE_HOST = 'https://fake.supabase.co';

const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as Record<string, unknown[]> & {
  lookups: Record<string, unknown[]>;
};

export const seedData = seed as unknown as {
  barangays: { id: number; name: string; municipality_id: number; attributes: Record<string, unknown>; version: number }[];
  interventions: { id: string; beneficiary: string; barangay_id: number | null; qa_flags: string[]; geojson: unknown; version: number; intervention_type_id: number; status_id: number }[];
  status_history: { id: string; intervention_id: string; status_id: number }[];
  intervention_barangays: { barangay_id: number; intervention_id: string }[];
};

export interface FakeUser {
  id: string;
  email: string;
  password?: string;
  profile: { full_name: string; role: 'admin' | 'encoder' | 'viewer'; deactivated_at?: string | null } | null;
}

export const USERS = {
  admin: { id: 'a0000000-0000-4000-8000-000000000001', email: 'admin@example.test', profile: { full_name: 'Ana Admin', role: 'admin' } },
  encoder: { id: 'a0000000-0000-4000-8000-000000000002', email: 'encoder@example.test', profile: { full_name: 'Enzo Encoder', role: 'encoder' } },
  viewer: { id: 'a0000000-0000-4000-8000-000000000003', email: 'viewer@example.test', profile: { full_name: 'Vera Viewer', role: 'viewer' } },
  stranger: { id: 'a0000000-0000-4000-8000-000000000004', email: 'stranger@example.test', profile: null },
  former: {
    id: 'a0000000-0000-4000-8000-000000000005',
    email: 'former@example.test',
    profile: { full_name: 'Former Staff', role: 'encoder', deactivated_at: '2026-01-01T00:00:00Z' },
  },
} satisfies Record<string, FakeUser>;

export const PASSWORD = 'correct horse battery';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function tokenFor(user: FakeUser) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub: user.id, email: user.email, role: 'authenticated', exp })}.signature`;
}

const authUser = (user: FakeUser) => ({
  id: user.id,
  aud: 'authenticated',
  role: 'authenticated',
  email: user.email,
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
});

const session = (user: FakeUser) => ({
  access_token: tokenFor(user),
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'refresh-token',
  user: authUser(user),
});

export function inviteHash(user: FakeUser, type: 'invite' | 'recovery') {
  return `#access_token=${tokenFor(user)}&expires_at=${Math.floor(Date.now() / 1000) + 3600}&expires_in=3600&refresh_token=refresh-token&token_type=bearer&type=${type}`;
}

export interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

export interface FakeSupabase {
  rpcCalls: RpcCall[];
  restCalls: string[];
  uploads: { path: string; contentType: string | null }[];
  passwordUpdates: string[];
  channelJoins: { topic: string; isPrivate: boolean; hasToken: boolean }[];
  // Answers an app function. Returning undefined falls through to the default for that function.
  onRpc(handler: (call: RpcCall) => { status: number; body: unknown } | undefined): void;
  tables: Record<string, unknown[]>;
  sendSignal(): void;
  dropSockets(): void;
  refuseSockets(refuse: boolean): void;
  failReads(fail: boolean): void;
}

export async function installFakeSupabase(page: Page, users: FakeUser[] = Object.values(USERS)): Promise<FakeSupabase> {
  let currentUser: FakeUser | null = null;
  let rpcHandler: Parameters<FakeSupabase['onRpc']>[0] = () => undefined;
  let refusing = false;
  let readsFail = false;
  const sockets = new Set<WebSocketRoute>();
  const topics = new Set<string>();

  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const tables: Record<string, unknown[]> = {
    ...clone(seed.lookups),
    municipalities: clone(seed.municipalities),
    barangays: clone(seed.barangays),
    interventions_v: clone(seed.interventions),
    intervention_barangays: clone(seed.intervention_barangays),
    status_history: clone(seed.status_history),
    intervention_photos: [],
    import_batches: clone(seed.import_batches),
  };

  const fake: FakeSupabase = {
    rpcCalls: [],
    restCalls: [],
    uploads: [],
    passwordUpdates: [],
    channelJoins: [],
    tables,
    onRpc: (handler) => {
      rpcHandler = handler;
    },
    sendSignal() {
      for (const socket of sockets) {
        for (const topic of topics) {
          socket.send(JSON.stringify([null, null, topic, 'broadcast', { type: 'broadcast', event: 'changed', payload: { table: 'interventions' } }]));
        }
      }
    },
    dropSockets() {
      for (const socket of sockets) void socket.close();
      sockets.clear();
    },
    refuseSockets(refuse) {
      refusing = refuse;
    },
    failReads(fail) {
      readsFail = fail;
    },
  };

  const respond = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const userFromRequest = (route: Route) => {
    const header = route.request().headers().authorization ?? '';
    const payload = header.split('.')[1];
    if (!payload) return null;
    const { sub } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub: string };
    return users.find((user) => user.id === sub) ?? null;
  };

  await page.route(`${FAKE_HOST}/auth/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

    if (url.pathname.endsWith('/token')) {
      const body = request.postDataJSON() as { email?: string; password?: string };
      const user = users.find((u) => u.email === body.email);
      if (!user || body.password !== PASSWORD) {
        return respond(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      currentUser = user;
      return respond(route, 200, session(user));
    }
    if (url.pathname.endsWith('/user')) {
      const user = userFromRequest(route) ?? currentUser;
      if (!user) return respond(route, 401, { code: 401, msg: 'No session' });
      currentUser = user;
      if (request.method() === 'PUT') fake.passwordUpdates.push((request.postDataJSON() as { password: string }).password);
      return respond(route, 200, authUser(user));
    }
    if (url.pathname.endsWith('/logout')) {
      currentUser = null;
      return route.fulfill({ status: 204, headers: CORS });
    }
    return respond(route, 404, { msg: `Not faked: ${url.pathname}` });
  });

  await page.route(`${FAKE_HOST}/rest/v1/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(request.url());
    const name = url.pathname.split('/').at(-1)!;
    const user = userFromRequest(route);

    if (url.pathname.includes('/rpc/')) {
      const call = { name, args: (request.postDataJSON() ?? {}) as Record<string, unknown> };
      fake.rpcCalls.push(call);
      const answer = rpcHandler(call);
      if (answer) return respond(route, answer.status, answer.body);
      if (name === 'member_names') return respond(route, 200, users.map((u) => ({ id: u.id, full_name: u.profile?.full_name ?? null })));
      if (name === 'audit_for_intervention') return respond(route, 200, []);
      return respond(route, 500, { code: 'XX000', message: `Not faked: ${name}` });
    }

    fake.restCalls.push(name);
    if (readsFail && name !== 'profiles') return respond(route, 500, { code: 'XX000', message: 'Database unavailable' });
    if (!user) return respond(route, 401, { code: '42501', message: 'permission denied' });
    if (name === 'profiles') {
      return respond(route, 200, user.profile ? [{ id: user.id, deactivated_at: null, ...user.profile }] : []);
    }
    return respond(route, 200, tables[name] ?? []);
  });

  await page.route(`${FAKE_HOST}/storage/v1/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.includes('/object/sign/')) {
      const file = path.split('/object/sign/intervention-photos/')[1];
      return respond(route, 200, { signedURL: `/object/sign/intervention-photos/${file}?token=signed-token` });
    }
    if (request.method() === 'POST' && path.includes('/object/intervention-photos/')) {
      const file = path.split('/object/intervention-photos/')[1];
      fake.uploads.push({ path: file, contentType: request.headers()['content-type'] ?? null });
      return respond(route, 200, { Key: `intervention-photos/${file}`, Id: file });
    }
    if (request.method() === 'GET') {
      // A one-pixel PNG, for a signed link being opened.
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: Buffer.from(png, 'base64') });
    }
    return respond(route, 200, []);
  });

  // The Realtime protocol: [join ref, ref, topic, event, payload].
  await page.routeWebSocket(/fake\.supabase\.co\/realtime/, (socket) => {
    if (refusing) {
      void socket.close();
      return;
    }
    sockets.add(socket);
    socket.onClose(() => sockets.delete(socket));
    socket.onMessage((message) => {
      if (typeof message !== 'string') return;
      const [joinRef, ref, topic, event, payload] = JSON.parse(message) as [string, string, string, string, Record<string, never>];
      if (event === 'phx_join') {
        const config = payload.config as unknown as { private?: boolean };
        fake.channelJoins.push({ topic, isPrivate: config?.private === true, hasToken: Boolean(payload.access_token) });
        topics.add(topic);
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: [] } }]));
      } else {
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
      }
    });
  });

  return fake;
}

export async function signIn(page: Page, user: FakeUser, password = PASSWORD) {
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
