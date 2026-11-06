// Settings for scripts, from .env.local. Nothing here prints a value, so script output is safe to
// paste into a chat or a ticket.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

const ENV_PATH = resolve(import.meta.dirname, '..', '..', '.env.local');

// A VITE_ value ends up in the website, where anyone can read it.
function isSecret(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true;
  if (value.startsWith('postgres://') || value.startsWith('postgresql://')) return true;
  if (!value.startsWith('eyJ')) return false;
  try {
    const payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()) as { role?: string };
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

export function checkNoSecretInBrowserSettings(env: NodeJS.ProcessEnv = process.env) {
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('VITE_') && value && isSecret(value)) {
      throw new Error(`${name} holds a secret, and VITE_ settings are built into the website. Remove it from .env.local and rotate the key.`);
    }
  }
}

export function loadEnv() {
  if (!existsSync(ENV_PATH)) {
    throw new Error('.env.local was not found in the project folder. Copy .env.example to .env.local and fill it in.');
  }
  process.loadEnvFile(ENV_PATH);
  checkNoSecretInBrowserSettings();
}

function setting(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`${names.join(' or ')} is missing from .env.local. See .env.example.`);
}

export const projectUrl = () => setting('VITE_SUPABASE_URL');
export const publicKey = () => setting('VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY');
export const secretKey = () => setting('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
export const appUrl = () => process.env.APP_URL?.trim() || undefined;

// Without a limit, a request the service never answers waits about 5 minutes before failing. Photo
// transfers can be slow for good reason, so only callers that want a limit set one.
export function adminClient(requestTimeoutMs?: number): SupabaseClient {
  return createClient(projectUrl(), secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: requestTimeoutMs
      ? { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) }) }
      : undefined,
  });
}

export async function connectDb(): Promise<pg.Client> {
  const connectionString = setting('SUPABASE_DB_URL');
  // Certificates chain to Supabase's own authority, which Node doesn't know, so the connection is
  // encrypted but the server isn't verified. Run these scripts from a network you trust.
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

export function run(main: () => Promise<void>) {
  main().catch((error: Error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  });
}
