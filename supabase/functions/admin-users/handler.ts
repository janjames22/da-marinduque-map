// What the Users page asks for that a browser can't do itself, as it takes the project's secret key:
// inviting people, listing their emails, and blocking sign-in. It has no imports, so the same file
// runs in Supabase's Deno runtime and in the tests.
//
// The secret key only reaches the Auth admin endpoints. Changes to a person's profile go through
// the database with the caller's own login, so row-level security still applies and the audit log
// names the Admin who made them.

export interface AdminUsersEnv {
  url: string;
  publishableKey: string;
  secretKey: string;
}

type Fetch = typeof fetch;

const ROLES = ['admin', 'encoder', 'viewer'];
const NEVER_ENDS = '876000h'; // how Supabase spells a ban with no end date
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE_SIZE = 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  // Every header the Supabase client can send, from its own list.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class Refusal extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

interface AuthUser {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  invited_at?: string | null;
  last_sign_in_at?: string | null;
}

interface Profile {
  id: string;
  full_name: string | null;
  role: string;
  deactivated_at: string | null;
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { msg?: string; message?: string; error_description?: string };
    return body.msg ?? body.message ?? body.error_description ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function statusOf(user: AuthUser, profile: Profile | undefined): string {
  if (!profile) return 'no_access';
  if (profile.deactivated_at) return 'deactivated';
  return user.email_confirmed_at ? 'active' : 'invited';
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export async function handleRequest(request: Request, env: AdminUsersEnv, fetcher: Fetch = fetch): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return reply(405, { message: 'Use POST.' });

  try {
    const header = request.headers.get('authorization') ?? '';
    if (!header.toLowerCase().startsWith('bearer ') || !header.slice(7).trim()) throw new Refusal(401, 'Sign in first.');

    const asCaller = (path: string, init: RequestInit = {}) =>
      fetcher(`${env.url}${path}`, {
        ...init,
        headers: { apikey: env.publishableKey, authorization: header, 'content-type': 'application/json', ...init.headers },
      });
    const asService = (path: string, init: RequestInit = {}) =>
      fetcher(`${env.url}/auth/v1${path}`, {
        ...init,
        headers: { apikey: env.secretKey, authorization: `Bearer ${env.secretKey}`, 'content-type': 'application/json', ...init.headers },
      });

    // Who's asking, according to Auth and then the database. A deactivated Admin's token can still be
    // valid for a while, but their profile says otherwise.
    const who = await asCaller('/auth/v1/user');
    if (!who.ok) throw new Refusal(401, 'Sign in first.');
    const caller = (await who.json()) as AuthUser;
    const ownProfile = await asCaller(`/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=role,deactivated_at`);
    if (!ownProfile.ok) throw new Refusal(403, 'Only an Admin can manage people.');
    const [me] = (await ownProfile.json()) as Pick<Profile, 'role' | 'deactivated_at'>[];
    if (me?.role !== 'admin' || me.deactivated_at) throw new Refusal(403, 'Only an Admin can manage people.');

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const allUsers = async () => {
      const users: AuthUser[] = [];
      for (let page = 1; ; page++) {
        const response = await asService(`/admin/users?page=${page}&per_page=${PAGE_SIZE}`);
        if (!response.ok) throw new Refusal(502, await errorText(response));
        const { users: batch } = (await response.json()) as { users: AuthUser[] };
        users.push(...batch);
        if (batch.length < PAGE_SIZE) return users;
      }
    };

    const allProfiles = async () => {
      const response = await asCaller('/rest/v1/profiles?select=id,full_name,role,deactivated_at');
      if (!response.ok) throw new Refusal(502, await errorText(response));
      return (await response.json()) as Profile[];
    };

    const redirectTo = () => {
      const value = text(body.redirect_to);
      return /^https?:\/\//.test(value) ? value : undefined;
    };

    const emailFailure = async (response: Response) => {
      const detail = await errorText(response);
      if (response.status === 429 || /rate/i.test(detail)) {
        return new Refusal(429, 'Too many emails have gone out for now. Wait a while, or choose to get a link instead.');
      }
      return new Refusal(502, `The email could not be sent: ${detail}. Check the email sender, or choose to get a link instead.`);
    };

    // By email, or as a link for the Admin to pass on. A person who already has a password gets a
    // reset rather than an invite, as Auth refuses a second invite to them.
    const sendAccess = async (email: string, confirmed: boolean, delivery: string): Promise<{ id: string | null; link: string | null }> => {
      const redirect = redirectTo();
      if (delivery === 'link') {
        const response = await asService('/admin/generate_link', {
          method: 'POST',
          body: JSON.stringify({ type: confirmed ? 'recovery' : 'invite', email, redirect_to: redirect }),
        });
        if (!response.ok) throw new Refusal(502, await errorText(response));
        const made = (await response.json()) as { id: string; action_link: string };
        return { id: made.id, link: made.action_link };
      }
      const query = redirect ? `?redirect_to=${encodeURIComponent(redirect)}` : '';
      const response = confirmed
        ? await asService(`/recover${query}`, { method: 'POST', body: JSON.stringify({ email }) })
        : await asService(`/invite${query}`, { method: 'POST', body: JSON.stringify({ email }) });
      if (!response.ok) throw await emailFailure(response);
      const made = (await response.json().catch(() => ({}))) as { id?: string };
      return { id: made.id ?? null, link: null };
    };

    const updateProfile = async (id: string, values: Record<string, unknown>) => {
      const response = await asCaller(`/rest/v1/profiles?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Refusal(response.status === 400 ? 409 : 502, await errorText(response));
      const rows = (await response.json()) as unknown[];
      if (rows.length === 0) throw new Refusal(404, 'That person has no profile yet. Invite them first.');
    };

    const setBan = async (id: string, duration: string) => {
      const response = await asService(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ ban_duration: duration }) });
      if (!response.ok) throw new Refusal(502, await errorText(response));
    };

    const personId = () => {
      const id = text(body.id);
      if (!UUID.test(id)) throw new Refusal(400, 'That person wasn\'t found.');
      return id;
    };

    const roleFrom = (value: unknown) => {
      if (typeof value !== 'string' || !ROLES.includes(value)) throw new Refusal(400, 'Choose a role.');
      return value;
    };

    switch (body.action) {
      case 'list': {
        const [users, profiles] = await Promise.all([allUsers(), allProfiles()]);
        const people = users.map((user) => {
          const profile = profiles.find((p) => p.id === user.id);
          return {
            id: user.id,
            email: user.email ?? '',
            full_name: profile?.full_name ?? null,
            role: profile?.role ?? null,
            status: statusOf(user, profile),
            invited_at: user.invited_at ?? null,
            last_sign_in_at: user.last_sign_in_at ?? null,
          };
        });
        return reply(200, { people });
      }

      case 'invite': {
        const email = text(body.email).toLowerCase();
        const fullName = text(body.full_name);
        const role = roleFrom(body.role);
        const delivery = body.delivery === 'link' ? 'link' : 'email';
        if (!EMAIL.test(email)) throw new Refusal(400, 'Enter a valid email address.');
        if (!fullName) throw new Refusal(400, 'Enter their name. It appears on what they encode.');

        const [users, profiles] = await Promise.all([allUsers(), allProfiles()]);
        const existing = users.find((user) => user.email?.toLowerCase() === email);
        const profile = profiles.find((p) => p.id === existing?.id);
        if (profile?.deactivated_at) throw new Refusal(409, 'This person was deactivated. Reactivate them instead.');
        if (existing?.email_confirmed_at && profile) throw new Refusal(409, 'This person already has an account. Use "New link" if they need to get back in.');

        const sent = await sendAccess(email, Boolean(existing?.email_confirmed_at), delivery);
        const id = sent.id ?? existing?.id;
        if (!id) throw new Refusal(502, 'The invitation was sent, but the account wasn\'t found. Try again.');

        // Not an upsert: that would need the right to update a profile's id, which nobody has.
        const saved = profile
          ? await asCaller(`/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ full_name: fullName, role }) })
          : await asCaller('/rest/v1/profiles', { method: 'POST', body: JSON.stringify({ id, full_name: fullName, role }) });
        if (!saved.ok) throw new Refusal(502, `The invitation went out, but their role wasn't saved: ${await errorText(saved)}`);
        return reply(200, { id, link: sent.link });
      }

      case 'new_link': {
        const id = personId();
        const user = (await allUsers()).find((u) => u.id === id);
        if (!user?.email) throw new Refusal(404, 'That person wasn\'t found.');
        const sent = await sendAccess(user.email, Boolean(user.email_confirmed_at), body.delivery === 'link' ? 'link' : 'email');
        return reply(200, { id, link: sent.link });
      }

      case 'update': {
        const id = personId();
        const values: Record<string, unknown> = {};
        if (body.role !== undefined) {
          if (id === caller.id) throw new Refusal(409, 'You can\'t change your own role. Ask another Admin.');
          values.role = roleFrom(body.role);
        }
        if (body.full_name !== undefined) {
          values.full_name = text(body.full_name);
          if (!values.full_name) throw new Refusal(400, 'Enter their name. It appears on what they encode.');
        }
        if (Object.keys(values).length === 0) throw new Refusal(400, 'Nothing to change.');
        await updateProfile(id, values);
        return reply(200, { id });
      }

      case 'deactivate': {
        const id = personId();
        if (id === caller.id) throw new Refusal(409, 'You can\'t deactivate yourself. Ask another Admin.');
        await updateProfile(id, { deactivated_at: new Date().toISOString() });
        await setBan(id, NEVER_ENDS);
        return reply(200, { id });
      }

      case 'reactivate': {
        const id = personId();
        await updateProfile(id, { deactivated_at: null });
        await setBan(id, 'none');
        return reply(200, { id });
      }

      default:
        throw new Refusal(400, 'Unknown action.');
    }
  } catch (error) {
    if (error instanceof Refusal) return reply(error.status, { message: error.message });
    return reply(502, { message: 'The service could not be reached. Try again.' });
  }
}
