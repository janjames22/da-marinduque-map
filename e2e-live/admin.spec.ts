// The admin screens on the real service, under the real site's security rules: a change to a list
// reaches someone else's open map, and the deployed function manages people. Only ever makes invite
// links, so no email goes out. Anything it creates is named e2e-test, and removed at the end.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { TestAccount } from '../scripts/lib/test-accounts';
import { readAccounts } from './accounts';
import { sidebar } from '../e2e/helpers/shell';
import { layersCard, openLayers } from './map';

const LIVE_LIMIT_MS = 2500; // "about 2 s" in the spec

// Every window a test opens is closed after it, as an open map reloads on every change and would
// slow the timing tests that come later.
const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

async function open(browser: Browser, account: TestAccount, path = '/map') {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.abort());
  await page.goto(path);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return page;
}

const row = (page: Page, name: string) => page.locator(`[data-row="${name}"]`);

test('a new program reaches someone else\'s open map, with no reload', async ({ browser }) => {
  const accounts = readAccounts();
  const watcher = await open(browser, accounts.viewer);
  await expect(watcher.locator('.barangay-shape')).toHaveCount(218, { timeout: 30_000 });
  // The program filter is in the layers card, put away when the map opens since Phase 16c.
  await openLayers(watcher);
  let reloads = 0;
  watcher.on('framenavigated', () => {
    reloads += 1;
  });

  const admin = await open(browser, accounts.admin, '/admin/programs');
  await admin.getByRole('button', { name: '+ Add program' }).click();
  const name = `E2E test program ${Date.now()}`;
  const add = admin.getByRole('form', { name: 'Add program' });
  await add.getByLabel('Name').fill(name);
  await add.getByRole('button', { name: 'Save' }).click();
  await expect(row(admin, name)).toBeVisible({ timeout: 15_000 });

  const started = Date.now();
  await expect(layersCard(watcher).getByRole('combobox', { name: /^Program/ }).locator('option', { hasText: name })).toHaveCount(1, { timeout: 10_000 });
  const elapsed = Date.now() - started;
  console.log(`A new program reached the other person's map in ${elapsed} ms`);
  expect(elapsed).toBeLessThan(LIVE_LIMIT_MS);
  expect(reloads).toBe(0);
});

test('a new type with a custom field is used on the real service', async ({ browser }) => {
  const accounts = readAccounts();
  const admin = await open(browser, accounts.admin, '/admin/types/new');
  const editor = admin.getByRole('form', { name: 'Type' });
  await editor.getByLabel('Name').fill(`E2E test type ${Date.now()}`);
  const typeName = await editor.getByLabel('Name').inputValue();
  await editor.getByRole('combobox', { name: /^Title/ }).selectOption('required');
  await editor.getByRole('button', { name: '+ Add a field' }).click();
  await editor.getByRole('group', { name: 'Field: new field' }).getByLabel('Label').fill('Test note');
  await editor.getByRole('button', { name: 'Save type' }).click();
  await expect(row(admin, typeName)).toBeVisible({ timeout: 15_000 });

  const encoder = await open(browser, accounts.encoder);
  await expect(encoder.locator('.barangay-shape')).toHaveCount(218, { timeout: 30_000 });
  await encoder.getByRole('button', { name: '+ Add intervention' }).click();
  const form = encoder.getByRole('form', { name: 'Add intervention' });
  await form.getByRole('combobox', { name: /^Type/ }).selectOption({ label: typeName });
  await form.getByLabel('Title').fill('Live test custom field');
  await form.getByLabel('Test note').fill('Saved through a field made on the website');
  await encoder.getByLabel('Type or paste coordinates').fill('13.4500, 121.8500');
  await encoder.getByRole('button', { name: 'Use', exact: true }).click();
  await form.getByRole('combobox', { name: /^Municipality/ }).selectOption({ label: 'Boac' });
  await form.getByRole('button', { name: 'Save record' }).click();
  await expect(encoder.locator('.record-popup').filter({ hasText: 'Saved through a field made on the website' })).toBeVisible({ timeout: 15_000 });
});

test('the deployed function lists people, invites by link, sets a role and deactivates', async ({ browser }) => {
  const accounts = readAccounts();
  const admin = await open(browser, accounts.admin, '/admin/users');
  const everyone = admin.getByRole('list', { name: 'Everyone' });
  await expect(everyone).toBeVisible({ timeout: 30_000 });
  await expect(row(admin, accounts.viewer.email)).toContainText('Test viewer');
  await expect(row(admin, accounts.admin.email)).toContainText('(you)');

  const email = `e2e-test-page-${Date.now()}@example.com`;
  const invite = admin.getByRole('form', { name: 'Invite someone' });
  await invite.getByRole('textbox', { name: /^Email/ }).fill(email);
  await invite.getByLabel('Full name').fill('Test Page Invite');
  await invite.getByRole('radio', { name: /link to send them myself/ }).check();
  await invite.getByRole('button', { name: 'Invite' }).click();
  await expect(admin.getByLabel('Sign-in link')).toHaveValue(/auth\/v1\/verify/, { timeout: 15_000 });
  await admin.getByRole('button', { name: 'Done' }).click();
  await expect(row(admin, email)).toContainText('Invited');

  await row(admin, email).getByLabel(/^Role of/).selectOption('viewer');
  await expect(admin.locator('.admin-notice')).toContainText('is now Viewer', { timeout: 15_000 });

  admin.once('dialog', (dialog) => void dialog.accept());
  await row(admin, email).getByRole('button', { name: /Deactivate/ }).click();
  await expect(row(admin, email)).toContainText('Deactivated', { timeout: 15_000 });
});

test('anyone else is refused by the deployed function, whatever the screens do', async ({ browser }) => {
  const accounts = readAccounts();
  const viewer = await open(browser, accounts.viewer);
  await expect(viewer.locator('.barangay-shape')).toHaveCount(218, { timeout: 30_000 });
  await expect((await sidebar(viewer)).getByRole('link', { name: 'Users' })).toHaveCount(0);
  await viewer.goto('/admin/users');
  await expect(viewer.getByRole('alert')).toContainText('This page is for Admins');
});
