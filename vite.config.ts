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

// Phones only share GPS, and allow copying, over https. "npm run dev:phone" gives the dev server a
// self-signed certificate and opens it to the local network, so it's for testing on a trusted network.
export default defineConfig(({ mode }) => ({
  plugins: [react(), localSeed(), ...(mode === 'phone' ? [basicSsl()] : [])],
  // The dev server prepares a page's code the first time it's asked for. The map loads apart from the
  // first screen since Phase 17b, so without this the first visit to it after starting the server
  // waits several seconds, long enough to fail the first end-to-end tests of a run.
  server: {
    warmup: { clientFiles: ['./src/main.tsx', './src/app/auth/AuthGate.tsx', './src/modules/intervention-map/MapPage.tsx', './src/modules/intervention-map/*/*Page.tsx'] },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Many files each run a real database at once, and these limits aren't what they test.
    testTimeout: 30_000,
  },
}));
