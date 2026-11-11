import { defineConfig, devices } from '@playwright/test';

const FAKE_SUPABASE = {
  VITE_SUPABASE_URL: 'https://fake.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  VITE_SUPABASE_ANON_KEY: '',
};

// Needs the local dataset: npm run build:local-seed
// Computer screens are tested at the design's width. Below 1440 px the full sidebar leaves the map
// page too little room, which Phase 14 (map restyle) is to fix. See docs/UI-UX-ROADMAP.md.
const DESKTOP = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };

// e2e/auth.spec.ts runs on a dev server and a production build that both think they have Supabase.
// Neither ever reaches the network: the tests answer every call. See e2e/helpers/fake-supabase.ts.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', testIgnore: /auth\.spec/, use: DESKTOP },
    { name: 'mobile', testIgnore: /auth\.spec/, use: { ...devices['Pixel 7'] } },
    { name: 'auth-desktop', testMatch: /auth\.spec/, use: { ...DESKTOP, baseURL: 'http://localhost:5175' } },
    { name: 'auth-mobile', testMatch: /auth\.spec/, use: { ...devices['Pixel 7'], baseURL: 'http://localhost:5175' } },
    { name: 'production', testMatch: /auth\.spec/, use: { ...DESKTOP, baseURL: 'http://localhost:5176' } },
  ],
  webServer: [
    {
      command: 'npm run dev:local -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
    },
    {
      command: 'npx vite --port 5175 --strictPort',
      url: 'http://localhost:5175',
      reuseExistingServer: true,
      env: FAKE_SUPABASE,
    },
    {
      command: 'npx vite build --outDir .e2e-dist && npx vite preview --outDir .e2e-dist --port 5176 --strictPort',
      url: 'http://localhost:5176',
      reuseExistingServer: true,
      timeout: 180_000,
      env: FAKE_SUPABASE,
    },
  ],
});
