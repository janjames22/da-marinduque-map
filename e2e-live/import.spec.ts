// The import wizard on the real service, under the real site's security rules: a file comes in from one
// browser and reaches another person's open map, and undoing it takes it off again. What it makes
// belongs to the temporary accounts, and is removed at the end. Nothing from a real record is printed.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { TestAccount } from '../scripts/lib/test-accounts';
import { readAccounts } from './accounts';
import { skipNetlifyBadge } from './netlify';

const LIVE_LIMIT_MS = 2500; // "about 2 s" in the spec

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

async function open(browser: Browser, account: TestAccount, path: string) {
  const context = await browser.newContext();
  contexts.push(context);
  await skipNetlifyBadge(context);
  const page = await context.newPage();
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.abort());
  await page.goto(path);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return page;
}

const records = async (page: Page) => Number((await page.locator('[data-kpi="records"] .kpi-value').textContent())?.replace(/,/g, ''));

test('a file imported in the wizard reaches another person\'s map, and undoing it takes it off again', async ({ browser }) => {
  const accounts = readAccounts();
  const blocked: string[] = [];

  const map = await open(browser, accounts.viewer, '/');
  await expect(map.locator('.barangay-shape')).toHaveCount(218, { timeout: 30_000 });
  await expect(map.locator('[data-kpi="records"] .kpi-value')).toBeVisible({ timeout: 30_000 });
  const before = await records(map);

  const wizard = await open(browser, accounts.encoder, '/import');
  wizard.on('console', (message) => {
    if (/Content Security Policy|Refused to/.test(message.text())) blocked.push(message.text());
  });
  const step = wizard.getByRole('form', { name: 'Choose a file' });
  await expect(step).toBeVisible({ timeout: 30_000 });
  await step.getByLabel(/^What the file lists/).selectOption({ label: 'Farm Machinery' });
  await step.getByLabel(/^Where it came from/).fill('Live test export');
  const csv = 'Beneficiary,Category,Program,Year,Municipality,Barangay,Latitude,Longitude\nLive test browser import,Rice Thresher,Rice Program,2024,Boac,Bantad,13.4501,121.8502\n';
  await step.getByLabel(/^File/).setInputFiles({ name: 'live-test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await step.getByRole('button', { name: 'Next: columns' }).click();
  await wizard.getByRole('button', { name: 'Next: check' }).click();
  await expect(wizard.locator('.import-summary')).toHaveText('1 row: 1 ready, 0 to fix, 0 with warnings.');

  const started = Date.now();
  await wizard.getByRole('button', { name: 'Import 1 record' }).click();
  await expect.poll(() => records(map), { timeout: 10_000, intervals: [100] }).toBe(before + 1);
  const arrived = Date.now() - started;
  console.log(`An import reached the other map in ${arrived} ms`);
  expect(arrived).toBeLessThan(LIVE_LIMIT_MS + 1000);
  await expect(wizard.getByRole('heading', { name: 'Imported 1 record' })).toBeVisible();

  // Undone straight from the page that says it came in.
  const batch = wizard.locator('.import-batches .queue-item').filter({ hasText: 'live-test.csv' });
  await batch.getByRole('button', { name: 'Undo this import' }).click();
  await wizard.getByRole('form', { name: 'Undo live-test.csv' }).getByLabel(/^Reason/).fill('Live test');
  await wizard.getByRole('form', { name: 'Undo live-test.csv' }).getByRole('button', { name: 'Undo the import' }).click();
  await expect(wizard.locator('.admin-notice')).toContainText('live-test.csv was undone.');
  await expect.poll(() => records(map), { timeout: 10_000 }).toBe(before);
  expect(blocked).toEqual([]);
});
