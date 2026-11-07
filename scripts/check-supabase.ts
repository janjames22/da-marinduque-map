// Checks the settings of the hosted project that the migrations can't set, and that the data is as
// expected. Reads only. Prints no keys and no record data.
//
// Usage: npm run check:supabase
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { appUrl, connectDb, loadEnv, projectUrl, publicKey, run } from './lib/env';

type Result = { check: string; result: 'ok' | 'PROBLEM' | 'note'; detail: string };

run(async () => {
  loadEnv();
  const results: Result[] = [];
  const add = (check: string, passed: boolean, detail: string) => results.push({ check, result: passed ? 'ok' : 'PROBLEM', detail });

  const settings = await fetch(`${projectUrl()}/auth/v1/settings`, { headers: { apikey: publicKey() } });
  if (settings.ok) {
    const body = (await settings.json()) as { disable_signup?: boolean; external?: { email?: boolean } };
    add('Public sign-ups are off', body.disable_signup === true, body.disable_signup ? '' : 'Authentication > Sign In / Providers: turn off "Allow new users to sign up"');
    add('Email and password sign-in is on', body.external?.email === true, '');
  } else {
    add('Reading auth settings', false, `HTTP ${settings.status}. Check the URL and publishable key.`);
  }

  // A browser's preflight needs no login, and says whether the function is there at all.
  const usersFunction = await fetch(`${projectUrl()}/functions/v1/admin-users`, { method: 'OPTIONS' }).catch(() => null);
  add('The Users page function is deployed', usersFunction?.ok === true, usersFunction?.ok ? '' : 'Run npm run deploy:functions');

  const visitor = createClient(projectUrl(), publicKey(), { auth: { persistSession: false } });
  for (const table of ['interventions', 'interventions_v', 'audit_log', 'profiles', 'barangays']) {
    const { data, error } = await visitor.from(table).select('*').limit(1);
    add(`A visitor can't read ${table}`, Boolean(error) || data?.length === 0, error ? '' : 'The request ran. Check that it returned nothing.');
  }
  const { error: rpcError } = await visitor.rpc('member_names');
  add('A visitor can\'t call the app functions', Boolean(rpcError), '');

  const { data: bucket } = visitor.storage.from('intervention-photos').getPublicUrl('nothing.jpg');
  const photo = await fetch(bucket.publicUrl);
  add('Photos have no public address', !photo.ok, `HTTP ${photo.status}`);

  const db = await connectDb();
  try {
    const one = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;
    const { rows: applied } = await db.query<{ file: string }>('select file from private.schema_migrations order by file');
    const expected = readdirSync(resolve(import.meta.dirname, '..', 'supabase', 'migrations')).filter((file) => file.endsWith('.sql'));
    const missing = expected.filter((file) => !applied.some((row) => row.file === file));
    add('Migrations applied', missing.length === 0, missing.length > 0 ? `Run npm run db:migrate. Missing: ${missing.join(', ')}` : applied.map((row) => row.file).join(', '));

    add('Every table has row-level security', (await one(`select count(*)::int as n from pg_tables where schemaname = 'public' and not rowsecurity`)) === 0, '');
    add('The photo bucket is private', (await one(`select count(*)::int as n from storage.buckets where id = 'intervention-photos' and not public`)) === 1, '');
    add('218 barangays', (await one('select count(*)::int as n from public.barangays')) === 218, '');

    const records = await one('select count(*)::int as n from public.interventions');
    add('Records loaded', records >= 199, `${records} records`);

    const admins = await one(`select count(*)::int as n from public.profiles where role = 'admin' and deactivated_at is null`);
    results.push({ check: 'At least one Admin', result: admins > 0 ? 'ok' : 'note', detail: `${admins} active. Add the first with npm run users.` });
  } finally {
    await db.end();
  }

  if (!appUrl()) results.push({ check: 'APP_URL', result: 'note', detail: 'Not set yet, so invite links go to the project\'s Site URL.' });

  console.table(results);
  if (results.some((result) => result.result === 'PROBLEM')) process.exitCode = 1;
});
