// Manages who can use the map. Uses the secret key from .env.local, so it only runs on an Admin's
// computer. See docs/OPERATIONS.md.
//
//   npm run users -- list
//   npm run users -- invite someone@example.com --role encoder --name "Full Name"
//   npm run users -- invite someone@example.com --role encoder --name "Full Name" --send-email
//   npm run users -- link someone@example.com
//   npm run users -- role someone@example.com viewer
//   npm run users -- deactivate someone@example.com
//   npm run users -- reactivate someone@example.com
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { adminClient, appUrl, loadEnv, run } from './lib/env';

const ROLES = ['admin', 'encoder', 'viewer'];
const NEVER_ENDS = '876000h'; // how Supabase spells a ban with no end date

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

function roleFrom(value: string | undefined): string {
  if (!value || !ROLES.includes(value)) throw new Error(`The role must be one of: ${ROLES.join(', ')}.`);
  return value;
}

async function allUsers(admin: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function findUser(admin: SupabaseClient, email: string): Promise<User> {
  const user = (await allUsers(admin)).find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`No account for ${email}. Invite them first.`);
  return user;
}

async function setProfile(admin: SupabaseClient, id: string, values: Record<string, unknown>) {
  const { error } = await admin.from('profiles').upsert({ id, ...values });
  if (error) throw new Error(error.message);
}

const commands: Record<string, (admin: SupabaseClient, args: string[]) => Promise<void>> = {
  async list(admin) {
    const users = await allUsers(admin);
    const { data, error } = await admin.from('profiles').select('id, full_name, role, deactivated_at');
    if (error) throw new Error(error.message);
    const rows = users.map((user) => {
      const profile = data.find((p) => p.id === user.id);
      return {
        email: user.email,
        name: profile?.full_name ?? '',
        role: profile?.role ?? '(no access)',
        status: profile?.deactivated_at ? 'deactivated' : profile ? 'active' : '',
        'last sign-in': user.last_sign_in_at?.slice(0, 10) ?? 'never',
      };
    });
    console.table(rows);
  },

  async invite(admin, args) {
    const email = args[0];
    const role = roleFrom(option(args, 'role'));
    const name = option(args, 'name');
    if (!email?.includes('@')) throw new Error('Give the person\'s email address.');
    if (!name) throw new Error('Give their name with --name "Full Name". It appears on what they encode.');
    const redirectTo = appUrl();

    if (args.includes('--send-email')) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (error) throw new Error(error.message);
      await setProfile(admin, data.user.id, { full_name: name, role, deactivated_at: null });
      console.log(`Invited ${email} as ${role}. Supabase has sent the email.`);
      return;
    }

    const { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } });
    if (error) throw new Error(error.message);
    await setProfile(admin, data.user.id, { full_name: name, role, deactivated_at: null });
    console.log(`Added ${email} as ${role}. Send them this link. It works once, so treat it like a password:\n`);
    console.log(data.properties.action_link);
  },

  async link(admin, args) {
    const user = await findUser(admin, args[0]);
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: user.email!,
      options: { redirectTo: appUrl() },
    });
    if (error) throw new Error(error.message);
    console.log(`Send this to ${user.email} so they can set a password. It works once, so treat it like a password:\n`);
    console.log(data.properties.action_link);
  },

  async role(admin, args) {
    const user = await findUser(admin, args[0]);
    const role = roleFrom(args[1]);
    await setProfile(admin, user.id, { role });
    console.log(`${user.email} is now ${role}. It takes effect the next time they load the map.`);
  },

  async deactivate(admin, args) {
    const user = await findUser(admin, args[0]);
    await setProfile(admin, user.id, { deactivated_at: new Date().toISOString() });
    const { error } = await admin.auth.admin.updateUserById(user.id, { ban_duration: NEVER_ENDS });
    if (error) throw new Error(error.message);
    console.log(`${user.email} can no longer read or change anything. Their name stays on what they encoded.`);
  },

  async reactivate(admin, args) {
    const user = await findUser(admin, args[0]);
    await setProfile(admin, user.id, { deactivated_at: null });
    const { error } = await admin.auth.admin.updateUserById(user.id, { ban_duration: 'none' });
    if (error) throw new Error(error.message);
    console.log(`${user.email} has access again.`);
  },
};

run(async () => {
  const [command, ...args] = process.argv.slice(2);
  const action = commands[command];
  if (!action) throw new Error(`Commands: ${Object.keys(commands).join(', ')}. See docs/OPERATIONS.md.`);
  loadEnv();
  await action(adminClient(), args);
});
