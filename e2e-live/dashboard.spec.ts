// The dashboard, records table, saved views and audit log on the real service, under the real site's
// security rules. Anything it makes belongs to the temporary accounts, and is removed at the end. Nothing
// from a record is written down or printed, as they hold beneficiary names.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { connectDb, loadEnv } from '../scripts/lib/env';
import type { TestAccount } from '../scripts/lib/test-accounts';
import { readAccounts } from './accounts';

const LIVE_LIMIT_MS = 2500; // "about 2 s" in the spec

const panel = (page: Page) => page.getByRole('complementary', { name: 'Dashboard and records' });
const kpi = (page: Page, id: string) => page.locator(`[data-kpi="${id}"] .kpi-value`);
const savedView = (page: Page, name: string) => page.getByRole('complementary', { name: 'Layers and filters' }).locator(`[data-view="${name}"]`);

// Every window a test opens is closed after it, as an open map reloads on every change and would
// slow the timing tests that come later.
const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

async function open(browser: Browser, account: TestAccount, path = '/') {
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

async function openMap(browser: Browser, account: TestAccount) {
  const page = await open(browser, account);
  await expect(page.locator('.barangay-shape')).toHaveCount(218, { timeout: 30_000 });
  return page;
}

async function saveSharedView(page: Page, name: string) {
  const layers = page.getByRole('complementary', { name: 'Layers and filters' });
  await layers.getByRole('button', { name: 'Save this view' }).click();
  const form = layers.getByRole('form', { name: 'Save this view' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Share with everyone').check();
  await form.getByRole('button', { name: 'Save view' }).click();
  await expect(savedView(page, name)).toContainText('Shared by you', { timeout: 15_000 });
}

test('the charts load and draw under the real security rules, and agree with an export', async ({ browser }) => {
  const page = await openMap(browser, readAccounts().viewer);
  const blocked: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/.test(message.text())) blocked.push(message.text());
  });

  await expect(kpi(page, 'records')).toBeVisible({ timeout: 30_000 });
  for (const name of ['Units by municipality', 'Units by program', 'Units by year funded', 'Status by municipality']) {
    await expect(page.getByRole('figure', { name }).locator('.recharts-bar-rectangle').first()).toBeVisible();
  }
  await expect(page.getByRole('figure', { name: /^Units by category/ }).locator('.recharts-bar-rectangle').first()).toBeVisible();

  const total = Number(await kpi(page, 'records').innerText());
  expect(total).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.export-count')).toHaveText(`${total} record${total === 1 ? '' : 's'}`);
  expect(blocked).toEqual([]);
});

test('the table finds a record, and a row goes to it', async ({ browser }) => {
  const page = await openMap(browser, readAccounts().viewer);
  await panel(page).getByRole('button', { name: 'Records', exact: true }).click();
  const rows = page.locator('.records-table tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.records-count')).toHaveText(/^1–25 of \d+$/);

  await page.getByRole('searchbox', { name: 'Search these records' }).fill('RAED-2026-10-21');
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  await expect(page.locator('.record-popup').or(page.getByText(/This record has no usable coordinates/)).first()).toBeVisible({ timeout: 15_000 });
});

test('a shared view reaches someone else\'s open map with no reload, and brings back its filter', async ({ browser }) => {
  const accounts = readAccounts();
  const watcher = await openMap(browser, accounts.viewer);
  let reloads = 0;
  watcher.on('framenavigated', () => {
    reloads += 1;
  });

  const owner = await openMap(browser, accounts.encoder);
  const municipality = owner.getByRole('complementary', { name: 'Layers and filters' }).getByRole('combobox', { name: /^Municipality/ });
  await municipality.selectOption({ label: 'Gasan' });
  const chosen = await municipality.inputValue();

  const name = `E2E test view ${Date.now()}`;
  await saveSharedView(owner, name);
  const started = Date.now();
  await expect(savedView(watcher, name)).toContainText('Shared by Test encoder', { timeout: 10_000 });
  const elapsed = Date.now() - started;
  console.log(`A shared view reached the other person's map in ${elapsed} ms`);
  expect(elapsed).toBeLessThan(LIVE_LIMIT_MS);
  expect(reloads).toBe(0);

  await savedView(watcher, name).getByRole('button', { name, exact: true }).click();
  await expect(watcher.getByRole('complementary', { name: 'Layers and filters' }).getByRole('combobox', { name: /^Municipality/ })).toHaveValue(chosen);
});

test('the default view opens for everyone, once an Admin chooses it', async ({ browser }) => {
  // A real default is someone's decision, and isn't for a test to change.
  loadEnv();
  const db = await connectDb();
  const { rows } = await db.query<{ n: number }>('select count(*)::int as n from public.saved_views where is_default').finally(() => db.end());
  test.skip(rows[0].n > 0, 'A real default view is set.');

  const accounts = readAccounts();
  const admin = await openMap(browser, accounts.admin);
  const name = `E2E test default ${Date.now()}`;
  await saveSharedView(admin, name);
  await savedView(admin, name).getByRole('button', { name: /Open on this/ }).click();
  await expect(savedView(admin, name)).toContainText('Opens by default', { timeout: 15_000 });

  const viewer = await openMap(browser, accounts.viewer);
  await expect(viewer.getByText(`Opened on the shared view "${name}".`)).toBeVisible();
  // Nobody but an Admin is offered the choice.
  await expect(savedView(viewer, name).getByRole('button', { name: /Stop opening on this/ })).toHaveCount(0);

  await savedView(admin, name).getByRole('button', { name: /Stop opening on this/ }).click();
  await expect(savedView(admin, name)).not.toContainText('Opens by default', { timeout: 15_000 });
});

test('a new barangay in the Edit form asks for a reason, which reaches the Admin\'s audit log', async ({ browser }) => {
  const accounts = readAccounts();
  const encoder = await openMap(browser, accounts.encoder);
  await encoder.getByRole('button', { name: '+ Add intervention' }).click();
  const add = encoder.getByRole('form', { name: 'Add intervention' });
  await encoder.getByLabel('Type or paste coordinates').fill('13.4500, 121.8500');
  await encoder.getByRole('button', { name: 'Use', exact: true }).click();
  await add.getByRole('combobox', { name: /^Municipality/ }).selectOption({ label: 'Boac' });
  await add.getByRole('combobox', { name: /^Category/ }).selectOption({ index: 1 });
  await add.getByRole('combobox', { name: /^Banner program/ }).selectOption({ label: 'Rice Program' });
  await add.getByLabel('Year funded').fill('2025');
  const beneficiary = `Live test reason ${Date.now()}`;
  await add.getByLabel('Beneficiary', { exact: false }).first().fill(beneficiary);
  await add.getByRole('button', { name: 'Save record' }).click();
  const popup = encoder.locator('.record-popup').filter({ hasText: beneficiary });
  await expect(popup).toBeVisible({ timeout: 15_000 });

  await encoder.locator('.leaflet-popup-content').getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = encoder.getByRole('form', { name: 'Edit record' });
  const barangay = edit.getByRole('combobox', { name: /^Barangay/ });
  const current = await barangay.inputValue();
  const other = await barangay.locator('option').evaluateAll((options, skip) => options.map((option) => (option as HTMLOptionElement).value).find((value) => value !== '' && value !== skip), current);
  await barangay.selectOption(other!);
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit.getByText('Give a reason. It goes in the audit log.')).toBeVisible();
  await edit.getByLabel(/^Reason for changing the barangay/).fill('Live test reason');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0, { timeout: 15_000 });

  const admin = await open(browser, accounts.admin, '/admin/audit');
  const log = admin.getByRole('region', { name: 'Audit log' });
  await expect(log.locator('.audit-table tbody tr').first()).toBeVisible({ timeout: 30_000 });
  await log.getByRole('form', { name: 'Filter the audit log' }).getByLabel('Record').fill(beneficiary);
  await expect(log.locator('.audit-table tbody tr')).toHaveCount(3, { timeout: 15_000 });
  await expect(log.locator('.audit-table tbody tr').first()).toContainText('Test encoder');
  await expect(log.locator('.audit-table tbody tr').first()).toContainText('Reason: Live test reason');

  await log.locator('.audit-table tbody tr').first().getByRole('link').click();
  await expect(admin.locator('.record-popup').filter({ hasText: beneficiary })).toBeVisible({ timeout: 30_000 });
});

test('the audit log filters by person and action on the real service', async ({ browser }) => {
  const accounts = readAccounts();
  const admin = await open(browser, accounts.admin, '/admin/audit');
  const log = admin.getByRole('region', { name: 'Audit log' });
  const lines = log.locator('.audit-table tbody tr');
  await expect(lines.first()).toBeVisible({ timeout: 30_000 });

  // The newest lines may already be the encoder's, so wait for the whole page to be theirs.
  const column = (n: number) => lines.locator(`td:nth-child(${n})`).evaluateAll((cells) => [...new Set(cells.map((cell) => cell.textContent))]);
  const filters = log.getByRole('form', { name: 'Filter the audit log' });
  await filters.getByLabel('Person').selectOption({ label: 'Test encoder' });
  await expect.poll(() => column(2), { timeout: 15_000 }).toEqual(['Test encoder']);

  await filters.getByRole('button', { name: 'Clear filters' }).click();
  await filters.getByLabel('Action').selectOption({ label: 'Created' });
  await expect.poll(() => column(3), { timeout: 15_000 }).toEqual(['Created']);
  await expect(log.locator('.records-count')).toHaveText(/^1–50 of [\d,]+$/);
});

test('the audit log turns away anyone but an Admin', async ({ browser }) => {
  const encoder = await open(browser, readAccounts().encoder, '/admin/audit');
  await expect(encoder.getByRole('alert')).toContainText('This page is for Admins', { timeout: 30_000 });
});
