// Puts the Edge Function behind the Users page on the project in .env.local. Supabase gives a function
// the project's keys itself, so none of them are sent from here.
//
// The first time, sign the Supabase command line in once: npx supabase@3 login
//
// Usage: npm run deploy:functions
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnv, projectUrl, run } from './lib/env';

const ROOT = resolve(import.meta.dirname, '..');

run(async () => {
  loadEnv();
  const ref = new URL(projectUrl()).hostname.split('.')[0];
  const result = spawnSync('npx', ['-y', 'supabase@3', 'functions', 'deploy', 'admin-users', `--remote=${ref}`, '--no-verify-jwt', '--use-api', '--yes'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error('The function was not deployed. If it says you need to sign in, run: npx supabase@3 login');
  }
  console.log('\nDeployed. Check it with: npm run check:supabase');
});
