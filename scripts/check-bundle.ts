// Runs after every production build. Fails it if the website would give away anything private:
// a secret key, the database password, the local dataset's address, or a beneficiary name.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSeedFiles } from './seed-interventions';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const ENV_PATH = join(ROOT, '.env.local');
const MIN_NAME_LENGTH = 6; // shorter ones can match ordinary code by chance

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

// Any key of this shape is a leak, including one from another project that .env.local doesn't name.
// The bare prefix is fine: the Supabase library itself mentions it, to warn against browser use.
const SECRET_KEY_SHAPE = /sb_secret_[A-Za-z0-9_-]{16,}/;
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g;

function hasServiceRoleToken(text: string): boolean {
  for (const [, payload] of text.matchAll(JWT_SHAPE)) {
    try {
      if ((JSON.parse(Buffer.from(payload, 'base64url').toString()) as { role?: string }).role === 'service_role') return true;
    } catch {
      // Not a real token.
    }
  }
  return false;
}

export function findLeaks(files: { name: string; text: string }[], secrets: { label: string; value: string }[]): string[] {
  const problems: string[] = [];
  for (const { name, text } of files) {
    for (const { label, value } of secrets) {
      if (text.includes(value)) problems.push(`${name} contains ${label}`);
    }
    if (SECRET_KEY_SHAPE.test(text)) problems.push(`${name} contains a secret key`);
    if (hasServiceRoleToken(text)) problems.push(`${name} contains a service role key`);
  }
  return problems;
}

function secretsToFind() {
  const secrets: { label: string; value: string }[] = [
    { label: 'the local dataset address', value: '/__local/seed.json' },
  ];

  if (existsSync(ENV_PATH)) {
    process.loadEnvFile(ENV_PATH);
    for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']) {
      const value = process.env[name]?.trim();
      if (value) secrets.push({ label: name, value });
    }
    const dbUrl = process.env.SUPABASE_DB_URL?.trim();
    if (dbUrl) {
      secrets.push({ label: 'SUPABASE_DB_URL', value: dbUrl });
      const password = URL.canParse(dbUrl) ? decodeURIComponent(new URL(dbUrl).password) : '';
      if (password) secrets.push({ label: 'the database password', value: password });
    }
  }

  const { rows } = loadSeedFiles();
  const names = new Set(rows.flatMap((row) => [row.beneficiary, row.beneficiary_raw]).map((name) => name?.trim()).filter((name) => name && name.length >= MIN_NAME_LENGTH));
  for (const name of names) secrets.push({ label: 'a beneficiary name', value: name });
  return secrets;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = filesUnder(DIST)
    .filter((path) => /\.(js|css|html|json|map|txt)$/.test(path))
    .map((path) => ({ name: relative(ROOT, path), text: readFileSync(path, 'utf8') }));
  const problems = findLeaks(files, secretsToFind());

  if (problems.length > 0) {
    // Names which file and what kind of thing, and never the value.
    for (const problem of new Set(problems)) console.error(problem);
    console.error('\nThe build must not be deployed.');
    process.exit(1);
  }
  console.log(`Checked ${files.length} files in dist: nothing private found.`);
}
