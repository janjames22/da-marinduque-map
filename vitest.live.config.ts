import { defineConfig } from 'vitest/config';

// Runs against the real project in .env.local with temporary accounts. See docs/OPERATIONS.md.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.live.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
