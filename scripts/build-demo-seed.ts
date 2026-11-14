// The demo site's data: the local dataset with made-up names. Run `npm run build:local-seed` first,
// then `npm run build:demo-seed`. `npm run build:demo` runs this itself.
//
// The demo site is public, so every beneficiary and signatory name is swapped (scripts/lib/anonymize.ts),
// remarks are blanked, and the audit log is left out, as it quotes names inside longer text. The file
// isn't written if a real name is still in it. scripts/check-bundle.ts checks the built site again.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anonymize, findRealNames } from './lib/anonymize';

const ROOT = resolve(import.meta.dirname, '..');
const LOCAL_SEED = resolve(ROOT, 'data', 'local', 'local-seed.json');
export const DEMO_SEED = resolve(ROOT, 'data', 'demo', 'demo-seed.json');

export function buildDemoSeed(localSeedText: string): string {
  const { text, names } = anonymize(localSeedText, { withoutHistory: true });
  const left = findRealNames(text, names);
  if (left.length > 0) throw new Error(`${left.length} real beneficiary name(s) would still be in the demo's data. Not written.`);
  return text;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(LOCAL_SEED)) {
    console.error('The local dataset is missing. Run npm run build:local-seed first.');
    process.exit(1);
  }
  const text = buildDemoSeed(readFileSync(LOCAL_SEED, 'utf8'));
  mkdirSync(dirname(DEMO_SEED), { recursive: true });
  writeFileSync(DEMO_SEED, text);
  const seed = JSON.parse(text) as { interventions: unknown[] };
  console.log(`Wrote data/demo/demo-seed.json: ${seed.interventions.length} records, with made-up names and no history.`);
}
