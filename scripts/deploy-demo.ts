// Uploads dist-demo to the demo site. Run through `npm run deploy:demo:preview` (a draft, free) or
// `npm run deploy:demo` (the demo's own address, which costs Netlify credits like the live site).
// Both build it first with `npm run build:demo`.
//
// The demo is a separate Netlify site, so this names it: NETLIFY_DEMO_SITE_ID in .env.local, the site
// id from Netlify's Site configuration page. This folder's own link (.netlify/) stays on the live site.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENV_PATH = resolve(ROOT, '.env.local');

if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
const site = process.env.NETLIFY_DEMO_SITE_ID?.trim();
if (!site) {
  console.error('NETLIFY_DEMO_SITE_ID is not set in .env.local. See "The demo site" in docs/OPERATIONS.md.');
  process.exit(1);
}
if (!existsSync(resolve(ROOT, 'dist-demo', 'demo', 'seed.json'))) {
  console.error('dist-demo has no demo data. Run npm run build:demo first.');
  process.exit(1);
}

const production = process.argv.includes('--prod');
const result = spawnSync('npx', ['netlify-cli', 'deploy', '--dir=dist-demo', `--site=${site}`, ...(production ? ['--prod'] : [])], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
