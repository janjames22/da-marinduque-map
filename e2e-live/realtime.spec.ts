// Two people at once on the real service: one edits on a computer, the other watches on a phone.
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { readAccounts } from './accounts';
import type { TestAccount } from '../scripts/lib/test-accounts';
import { openLayers } from './map';

const LIVE_LIMIT_MS = 2500; // "about 2 s" in the spec
const BARANGAY = 'Bantad';

const profile = (page: Page) => page.getByLabel(/^Profile of barangay/);
const row = (page: Page, beneficiary: string) => profile(page).locator('.record-row').filter({ hasText: beneficiary });

async function open(browser: Browser, account: TestAccount, options: Parameters<Browser['newContext']>[0] = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.abort());
  await page.goto('/map');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.barangay-shape')).toHaveCount(218, { timeout: 30_000 });
  return page;
}

async function openBarangay(page: Page) {
  await openLayers(page);
  const select = page.getByRole('combobox', { name: 'Go to barangay' });
  const value = await select.locator('option', { hasText: BARANGAY }).first().getAttribute('value');
  await select.selectOption(value!);
  await expect(profile(page)).toContainText(BARANGAY);
}

// How long until the other person's screen shows the change, with no reload.
async function timeUntil(check: () => Promise<void>) {
  const started = Date.now();
  await check();
  return Date.now() - started;
}

test('a change on one device shows on another without a reload', async ({ browser }) => {
  const accounts = readAccounts();
  const editor = await open(browser, accounts.encoder);
  const watcher = await open(browser, accounts.viewer, devices['Pixel 7']);
  const admin = await open(browser, accounts.admin);
  let watcherReloads = 0;
  watcher.on('framenavigated', () => {
    watcherReloads += 1;
  });

  await openBarangay(editor);
  await openBarangay(watcher);
  const navigationsBefore = watcherReloads;
  const name = `Live test FCA ${Date.now()}`;

  await test.step('a new record', async () => {
    await profile(editor).getByRole('button', { name: 'Add intervention here' }).click();
    const form = editor.getByRole('form', { name: 'Add intervention' });
    await form.getByRole('combobox', { name: /^Category/ }).selectOption({ index: 1 });
    await form.getByRole('combobox', { name: /^Banner program/ }).selectOption({ index: 1 });
    await form.getByLabel('Year funded').fill('2025');
    await form.getByLabel('Beneficiary', { exact: false }).first().fill(name);
    await editor.getByLabel('Type or paste coordinates').fill('13.4500, 121.8500');
    await editor.getByRole('button', { name: 'Use', exact: true }).click();
    await form.getByRole('button', { name: 'Save record' }).click();
    const elapsed = await timeUntil(() => expect(row(watcher, name)).toBeVisible({ timeout: 10_000 }));
    console.log(`New record reached the other device in ${elapsed} ms`);
    expect(elapsed).toBeLessThan(LIVE_LIMIT_MS);
  });

  await test.step('a status update, with the person named', async () => {
    await row(editor, name).getByRole('button', { name: 'Update status' }).click();
    const form = editor.getByRole('form', { name: 'Update status' });
    await form.getByRole('combobox', { name: /^New status/ }).selectOption({ label: 'Needs Repair' });
    await form.getByRole('button', { name: 'Save status' }).click();
    const elapsed = await timeUntil(() => expect(row(watcher, name)).toContainText('Needs Repair', { timeout: 10_000 }));
    console.log(`Status reached the other device in ${elapsed} ms`);
    expect(elapsed).toBeLessThan(LIVE_LIMIT_MS);
  });

  await test.step('a soft delete, which hides the record from the watcher', async () => {
    await row(editor, name).getByRole('button', { name: 'Delete' }).click();
    await editor.getByRole('form', { name: 'Delete record' }).getByRole('button', { name: 'Delete record' }).click();
    const elapsed = await timeUntil(() => expect(row(watcher, name)).toHaveCount(0, { timeout: 10_000 }));
    console.log(`Delete reached the other device in ${elapsed} ms`);
    expect(elapsed).toBeLessThan(LIVE_LIMIT_MS);
  });

  await test.step('a restore by an Admin brings it back', async () => {
    // Deleted records are at the foot of the layers card, put away when the map opens since Phase 16c.
    await openLayers(admin);
    await admin.getByRole('button', { name: /Deleted records/ }).click();
    await admin.locator('.record-row').filter({ hasText: name }).getByRole('button', { name: 'Restore' }).click();
    const elapsed = await timeUntil(() => expect(row(watcher, name)).toBeVisible({ timeout: 10_000 }));
    console.log(`Restore reached the other device in ${elapsed} ms`);
    expect(elapsed).toBeLessThan(LIVE_LIMIT_MS);
  });

  expect(watcherReloads - navigationsBefore).toBe(0);
});

test('each role is offered only what it can do, signed in for real', async ({ browser }) => {
  const accounts = readAccounts();

  const viewer = await open(browser, accounts.viewer);
  await expect(viewer.getByRole('button', { name: 'Account: Test viewer, Viewer' })).toBeVisible();
  await expect(viewer.locator('.add-record-button')).toHaveCount(0);

  const encoder = await open(browser, accounts.encoder);
  await expect(encoder.locator('.add-record-button')).toBeVisible();
  // In the layers card, so it's opened first: put away, the button would be missing for anyone.
  await openLayers(encoder);
  await expect(encoder.getByRole('button', { name: /Deleted records/ })).toHaveCount(0);

  const stranger = await browser.newPage();
  await stranger.goto('/map');
  await stranger.getByLabel('Email').fill(accounts.stranger.email);
  await stranger.getByLabel('Password', { exact: true }).fill(accounts.stranger.password);
  await stranger.getByRole('button', { name: 'Sign in' }).click();
  await expect(stranger.getByRole('heading', { name: 'This account has no access yet' })).toBeVisible();
});

test('a wrong password is refused', async ({ page }) => {
  const accounts = readAccounts();
  await page.goto('/map');
  await page.getByLabel('Email').fill(accounts.encoder.email);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong email or password.', { timeout: 30_000 });
});
