// The demo site, built as it's deployed (`--mode demo`): its sign-in screen with one account per role,
// made-up data in the browser, and no database. See "The demo site" in docs/OPERATIONS.md.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_ACCOUNTS } from '../src/app/auth/demo-accounts';
import { fromAccountMenu, sidebar } from './helpers/shell';

// The real beneficiary names, which the demo must never show.
const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as {
  interventions: { beneficiary: string | null }[];
  municipalities: { name: string }[];
  barangays: { name: string }[];
};
const places = new Set([...seed.municipalities, ...seed.barangays].map((place) => place.name));
const realNames = [...new Set(seed.interventions.map((record) => record.beneficiary?.trim() ?? ''))].filter((name) => name.length >= 6 && !places.has(name));

const account = (role: string) => DEMO_ACCOUNTS.find((candidate) => candidate.role === role)!;

async function open(page: Page, path = '/') {
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Demo accounts' })).toBeVisible();
}

async function signInAs(page: Page, role: string) {
  await page.getByRole('button', { name: `Use the ${account(role).label} account` }).click();
  await page.getByRole('form', { name: 'Sign in' }).getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Welcome/ })).toBeVisible();
}

// Everything the page holds, hidden parts and marker titles included.
const pageText = (page: Page) =>
  page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[title],[aria-label]')].map((el) => `${el.getAttribute('title')} ${el.getAttribute('aria-label')}`).join(' '));

test.describe('signing in', () => {
  test('lists one account per role, and Use fills the form in', async ({ page }) => {
    await open(page);
    for (const { label, email, password } of DEMO_ACCOUNTS) {
      const card = page.locator('.demo-account').filter({ hasText: email });
      await expect(card).toContainText(label);
      await expect(card).toContainText(password);
    }
    await page.getByRole('button', { name: 'Use the Viewer account' }).click();
    await expect(page.getByLabel('Email')).toHaveValue('viewer@demo.test');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue(account('viewer').password);

    await page.getByRole('button', { name: 'Hide all' }).click();
    await expect(page.locator('.demo-account')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show all' }).click();
    await expect(page.locator('.demo-account')).toHaveCount(3);
  });

  test('refuses a wrong password', async ({ page }) => {
    await open(page);
    await page.getByLabel('Email').fill('admin@demo.test');
    await page.getByLabel('Password', { exact: true }).fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Wrong email or password.');
  });

  test('stays signed in through a reload, and Sign out goes back to the accounts', async ({ page }) => {
    await open(page);
    await signInAs(page, 'encoder');
    await expect(page.getByRole('contentinfo')).toContainText('Demo: made-up data. Changes stay in this browser.');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /^Welcome/ })).toBeVisible();

    await page.getByRole('button', { name: /^Account:/ }).click();
    // The demo's accounts are the same for everyone, so there's no password to change.
    await expect(page.getByRole('button', { name: 'Change password' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await fromAccountMenu(page, 'Sign out');
    await expect(page.getByRole('heading', { name: 'Demo accounts' })).toBeVisible();
  });
});

test.describe('each role', () => {
  test('an Admin gets the Admin pages, where Users says the demo has nobody to manage', async ({ page }) => {
    await open(page);
    await signInAs(page, 'admin');
    await (await sidebar(page)).getByRole('link', { name: 'Users' }).click();
    await expect(page.getByText('No accounts to manage in the demo')).toBeVisible();
  });

  test('an Encoder can add records, but has no Admin pages', async ({ page }) => {
    await open(page);
    await signInAs(page, 'encoder');
    await expect(page.getByRole('link', { name: 'Add intervention' }).first()).toBeVisible();
    await expect((await sidebar(page)).getByRole('link', { name: 'Users' })).toHaveCount(0);
  });

  test('a Viewer can look, but not change anything', async ({ page }) => {
    await open(page);
    await signInAs(page, 'viewer');
    await expect(page.getByRole('link', { name: 'Add intervention' })).toHaveCount(0);
    await expect((await sidebar(page)).getByRole('link', { name: 'QA queue' })).toHaveCount(0);
  });
});

test.describe('the data', () => {
  test('shows no real beneficiary name, on Home, the map, the Interventions list, a record or the Dashboard', async ({ page }) => {
    await open(page);
    await signInAs(page, 'admin');
    expect(realNames.length).toBeGreaterThan(50);

    for (const path of ['/', '/map', '/records', '/dashboard']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main')).toBeVisible();
      const text = await pageText(page);
      expect(realNames.filter((name) => text.includes(name)), path).toEqual([]);
    }
    await page.goto('/records');
    await page.locator('.records-table tbody tr').first().click();
    await expect(page.getByRole('heading', { level: 2, name: 'Details' })).toBeVisible();
    const text = await pageText(page);
    expect(realNames.filter((name) => text.includes(name)), 'a record').toEqual([]);
    await expect(page.locator('main')).toContainText(/Sample (Farmers|Irrigators) (Association|Cooperative) \d+/);
  });

  test('keeps a change in this browser through a reload, and Discard my changes goes back to the start', async ({ page }) => {
    await open(page);
    await signInAs(page, 'encoder');
    await page.goto('/records');
    await page.locator('.records-table tbody tr').filter({ hasNot: page.locator('.unplotted-badge') }).first().click();
    await page.getByRole('link', { name: 'Open on the map to edit' }).click();
    const popup = page.locator('.leaflet-popup-content');
    await popup.getByRole('button', { name: 'Update status' }).click();
    const form = page.getByRole('form', { name: 'Update status' });
    await form.getByRole('combobox', { name: /^New status/ }).selectOption({ index: 1 });
    await form.getByRole('button', { name: 'Save status' }).click();
    await expect(form).toHaveCount(0);

    // The layers card, brought out if it's put away.
    const changes = async () => {
      const layers = page.getByRole('complementary', { name: 'Layers and filters' });
      await expect(page.locator('.barangay-shape').first()).toBeVisible();
      if (!(await layers.isVisible())) {
        await page.getByRole('button', { name: 'Layers and filters' }).click();
        await expect(layers).toBeVisible();
      }
      await expect(layers.getByRole('heading', { name: 'Demo data' })).toBeVisible();
      return layers;
    };
    await expect((await changes()).getByTestId('local-changes')).toHaveText('1 change saved in this browser only.');
    await page.reload();
    await expect((await changes()).getByTestId('local-changes')).toHaveText('1 change saved in this browser only.');

    page.once('dialog', (dialog) => void dialog.accept());
    await (await changes()).getByRole('button', { name: 'Discard my changes' }).click();
    await expect((await changes()).getByTestId('local-changes')).toHaveText('No changes yet.');
  });
});
