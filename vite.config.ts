import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

export default defineConfig({
  plugins: [react(), localSeed()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
