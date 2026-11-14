// Takes the user guide's screenshots (docs/guide/*.png) from local mode. Run `npm run dev:local` first,
// then `npm run guide:screenshots`. Retake them after a change to a screen the guide shows.
//
// The repository is public, and the local dataset holds the real beneficiary names. So before the app
// sees the data, every beneficiary name is swapped for a made-up one and remarks are blanked, and each
// screenshot is refused if the page still shows a real name.
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, devices, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { anonymize, findRealNames } from './lib/anonymize';


const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs', 'guide');
const BASE = process.env.GUIDE_URL ?? 'http://localhost:5173';
const DESKTOP: BrowserContextOptions = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const PHONE: BrowserContextOptions = { ...devices['Pixel 7'], deviceScaleFactor: 2 };

interface Shot {
  file: string;
  role?: 'admin' | 'encoder' | 'viewer';
  device?: BrowserContextOptions;
  path: string;
  // What to do before the picture, and what must be on screen.
  prepare?(page: Page): Promise<void>;
}

async function settle(page: Page) {
  await page.mouse.move(1, 1); // no hover label left over from a click
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600); // panels and the legend finish moving
}

const SHOTS: Shot[] = [
  { file: 'home.png', path: '/', prepare: async (page) => void (await page.getByRole('heading', { level: 1, name: /^Welcome/ }).waitFor()) },
  { file: 'map.png', path: '/map', prepare: async (page) => void (await page.locator('.barangay-shape').first().waitFor()) },
  {
    file: 'map-layers.png',
    path: '/map',
    prepare: async (page) => {
      await page.locator('.barangay-shape').first().waitFor();
      await page.getByRole('button', { name: 'Layers and filters' }).click();
      await page.getByRole('complementary', { name: 'Layers and filters' }).waitFor();
    },
  },
  {
    file: 'map-barangay.png',
    path: '/map',
    prepare: async (page) => {
      await page.locator('.barangay-shape').first().waitFor();
      await page.getByRole('button', { name: 'Layers and filters' }).click();
      await page.getByRole('complementary', { name: 'Layers and filters' }).getByLabel('Go to barangay').selectOption({ label: 'Tumapon' });
      await page.getByRole('button', { name: 'Close layers' }).click();
      await page.getByLabel(/^Profile of barangay/).waitFor();
    },
  },
  {
    file: 'map-record.png',
    path: '/map',
    prepare: async (page) => {
      await page.locator('.barangay-shape').first().waitFor();
      await page.getByRole('button', { name: 'Layers and filters' }).click();
      await page.getByRole('complementary', { name: 'Layers and filters' }).getByLabel('Go to barangay').selectOption({ label: 'Tumapon' });
      await page.getByRole('button', { name: 'Close layers' }).click();
      await page.getByLabel(/^Profile of barangay/).locator('.record-row .record-name').first().click();
      await page.locator('.record-popup').waitFor();
    },
  },
  {
    file: 'add-record.png',
    role: 'encoder',
    path: '/map?add=1',
    prepare: async (page) => {
      await page.locator('.barangay-shape').first().waitFor();
      await page.waitForTimeout(800);
      // The middle of Makulapnit, Boac, inland and clear of markers.
      const box = (await page.locator('[data-barangay-id="173"]').boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.getByRole('heading', { name: /intervention/i }).first().waitFor();
    },
  },
  { file: 'records.png', path: '/records', prepare: async (page) => void (await page.locator('.records-table tbody tr').first().waitFor()) },
  {
    file: 'record-page.png',
    path: '/records',
    prepare: async (page) => {
      await page.locator('.records-table tbody tr').first().click();
      await page.getByRole('link', { name: 'Interventions' }).first().waitFor();
    },
  },
  { file: 'dashboard.png', path: '/dashboard', prepare: async (page) => void (await page.locator('[data-tile="records"]').waitFor()) },
  { file: 'qa-queue.png', role: 'encoder', path: '/qa', prepare: async (page) => void (await page.getByRole('heading', { level: 1 }).waitFor()) },
  { file: 'import.png', path: '/import', prepare: async (page) => void (await page.getByRole('heading', { level: 1 }).waitFor()) },
  { file: 'reports.png', path: '/reports', prepare: async (page) => void (await page.getByRole('heading', { level: 1, name: 'Reports' }).waitFor()) },
  {
    file: 'export.png',
    path: '/map',
    prepare: async (page) => {
      await page.locator('.barangay-shape').first().waitFor();
      await page.locator('.map-toolbar').getByRole('button', { name: /Export/ }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  { file: 'admin-types.png', path: '/admin/types', prepare: async (page) => void (await page.getByRole('heading', { level: 1 }).waitFor()) },
  { file: 'phone-map.png', device: PHONE, path: '/map', prepare: async (page) => void (await page.locator('.barangay-shape').first().waitFor()) },
];

async function take(browser: Browser, shot: Shot, seed: string, names: string[]) {
  const context = await browser.newContext({ ...(shot.device ?? DESKTOP), reducedMotion: 'reduce' });
  await context.addInitScript((role) => localStorage.setItem('da-local-role', role), shot.role ?? 'admin');
  await context.route('**/__local/seed.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: seed }));
  const page = await context.newPage();
  await page.goto(BASE + shot.path);
  await shot.prepare?.(page);
  await settle(page);

  // Everything the page holds, hidden parts and marker titles included.
  const text = await page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[title],[aria-label]')].map((el) => `${el.getAttribute('title')} ${el.getAttribute('aria-label')}`).join(' '));
  const shown = findRealNames(text, names);
  if (shown.length > 0) throw new Error(`${shot.file} would show ${shown.length} real beneficiary name(s). Not saved.`);

  await page.screenshot({ path: join(OUT, shot.file) });
  console.log(`docs/guide/${shot.file}`);
  await context.close();
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { text, names } = anonymize(readFileSync(join(ROOT, 'data', 'local', 'local-seed.json'), 'utf8'));
  mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  const browser = await chromium.launch();
  try {
    for (const shot of SHOTS.filter((candidate) => only.length === 0 || only.includes(candidate.file))) await take(browser, shot, text, names);
  } finally {
    await browser.close();
  }
}
