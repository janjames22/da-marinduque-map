import { defineConfig, devices } from '@playwright/test';

// A production build against the real project in .env.local, with temporary accounts. Two browsers
// at once are what prove live updates. See docs/OPERATIONS.md.
export default defineConfig({
  testDir: 'e2e-live',
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  globalSetup: './e2e-live/global-setup.ts',
  globalTeardown: './e2e-live/global-teardown.ts',
  use: {
    ...devices['Desktop Chrome'],
    // The design's width, as in playwright.config.ts.
    viewport: { width: 1440, height: 900 },
    baseURL: process.env.LIVE_URL ?? 'http://localhost:5177',
    trace: 'retain-on-failure',
  },
  // With LIVE_URL set, the tests run against the deployed site instead.
  webServer: process.env.LIVE_URL
    ? undefined
    : {
        command: 'npx vite build --outDir .e2e-dist-live && npx vite preview --outDir .e2e-dist-live --port 5177 --strictPort',
        url: 'http://localhost:5177',
        reuseExistingServer: false,
        timeout: 180_000,
      },
});
