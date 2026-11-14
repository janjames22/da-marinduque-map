import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Local mode's dataset holds beneficiary names. It is served only by the dev server, and nothing
// imports it, so it can't end up in a production build.
function localSeed(): Plugin {
  return {
    name: 'local-seed',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__local/seed.json', async (_request, response) => {
        try {
          const seed = await readFile(resolve(import.meta.dirname, 'data/local/local-seed.json'));
          response.setHeader('Content-Type', 'application/json');
          response.end(seed);
        } catch {
          response.statusCode = 404;
          response.end('Run npm run build:local-seed');
        }
      });
    },
  };
}

// The demo site's data, with made-up names (scripts/build-demo-seed.ts). Only `--mode demo` has it: the
// dev server serves it, and the build adds it as demo/seed.json. Any other build never sees the file.
function demoSeed(mode: string): Plugin {
  const file = resolve(import.meta.dirname, 'data/demo/demo-seed.json');
  const missing = 'The demo data is missing. Run npm run build:demo-seed.';
  return {
    name: 'demo-seed',
    apply: () => mode === 'demo',
    configureServer(server) {
      server.middlewares.use('/demo/seed.json', async (_request, response) => {
        try {
          const seed = await readFile(file);
          response.setHeader('Content-Type', 'application/json');
          response.end(seed);
        } catch {
          response.statusCode = 404;
          response.end(missing);
        }
      });
    },
    async generateBundle() {
      let source: Buffer;
      try {
        source = await readFile(file);
      } catch {
        throw new Error(missing);
      }
      this.emitFile({ type: 'asset', fileName: 'demo/seed.json', source });
    },
  };
}

// Phones only share GPS, and allow copying, over https. "npm run dev:phone" gives the dev server a
// self-signed certificate and opens it to the local network, so it's for testing on a trusted network.
export default defineConfig(({ mode }) => ({
  plugins: [react(), localSeed(), demoSeed(mode), ...(mode === 'phone' ? [basicSsl()] : [])],
  // The demo site carries nothing about the real project: Vite writes the settings it reads from
  // .env.local into the build, so the demo reads no settings files at all.
  envDir: mode === 'demo' ? false : undefined,
  test: {
    include: ['tests/**/*.test.ts'],
    // Many files each run a real database at once, and these limits aren't what they test.
    testTimeout: 30_000,
  },
}));
