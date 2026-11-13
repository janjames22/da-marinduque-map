// Phase 17b: what a page shows while it loads, when it can't load, when it breaks, and when there's
// nothing to show. In local mode. e2e/auth.spec.ts checks the same with logins, on a production build.
import { expect, test, type Page } from '@playwright/test';
import { sidebar } from './helpers/shell';

async function open(page: Page, path: string) {
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
  await page.goto(path);
}

// The search for a beneficiary that nobody has, which leaves every list empty.
async function filterToNothing(page: Page) {
  const filters = page.getByRole('form', { name: 'Filters' });
  await filters.getByRole('button', { name: 'More filters' }).click();
  await filters.getByLabel('Filter by another field').selectOption({ label: 'Beneficiary' });
  await filters.getByLabel('Beneficiary contains').fill('zz no such name zz');
}

test.describe('loading', () => {
  test('says the page is loading, as a status, once the wait is long enough to notice', async ({ page }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/boundaries/barangays.geojson', async (route) => {
      await held;
      await route.continue();
    });
    await open(page, '/dashboard');
    const loading = page.getByRole('status').filter({ hasText: 'Loading…' });
    await expect(loading).toBeVisible();
    release();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(loading).toHaveCount(0);
  });
});

test.describe('could not load', () => {
  test('says what happened in plain words, keeps the details, and tries again', async ({ page }) => {
    await page.route('**/boundaries/barangays.geojson', (route) => route.fulfill({ status: 503, body: 'down' }));
    await open(page, '/dashboard');

    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', { name: 'This page could not load' })).toBeVisible();
    await expect(alert).toContainText('Something went wrong. Try again');
    await alert.getByText('Details').click();
    await expect(alert).toContainText('Could not load the barangays boundaries (503)');
    // The frame around the page is still there, with its menu, to go elsewhere.
    await expect(page.getByRole('banner')).toBeVisible();

    await page.unroute('**/boundaries/barangays.geojson');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('calls a dropped connection a dropped connection', async ({ page }) => {
    await page.route('**/boundaries/municipalities.geojson', (route) => route.abort('internetdisconnected'));
    await open(page, '/map');
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', { name: 'The map could not load' })).toBeVisible();
    await expect(alert).toContainText('No connection. Check your internet, then try again.');
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

test.describe('a page that breaks', () => {
  test("says so in place of the page, reloading once for a page's code that's gone, and the menu still works", async ({ page }) => {
    // As after a deploy, while the tab was open: the Dashboard's code isn't there any more.
    await page.route(/\/overview\/DashboardPage\.tsx/, (route) => route.fulfill({ status: 404, body: '' }));
    await open(page, '/');
    await expect(page.getByRole('heading', { level: 1, name: /^Welcome/ })).toBeVisible();

    let loads = 0;
    page.on('load', () => loads++);
    await (await sidebar(page)).getByRole('link', { name: 'Dashboard' }).click();

    // It reloads once by itself. When that doesn't bring the code, it stops and says so.
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', { name: 'Something went wrong on this page' })).toBeVisible();
    await expect(alert).toContainText('A newer version of the map is out. Reload the page to get it.');
    expect(loads).toBe(1);
    await expect(alert.getByRole('button', { name: 'Reload the page' })).toBeVisible();

    // Another page opens as normal, and the error is gone.
    await alert.getByRole('link', { name: 'Back to Home' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /^Welcome/ })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);

    await page.unroute(/\/overview\/DashboardPage\.tsx/);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });
});

test.describe('nothing to show', () => {
  test('the Dashboard says no records match, not a page of zeroes, and shows them all again', async ({ page }) => {
    await open(page, '/dashboard');
    await expect(page.locator('[data-tile="records"]')).toBeVisible();
    await filterToNothing(page);

    await expect(page.getByText('No records match these filters')).toBeVisible();
    await expect(page.locator('[data-tile="records"]')).toHaveCount(0);
    await expect(page.getByRole('figure')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show all records' }).click();
    await expect(page.locator('[data-tile="records"]')).toBeVisible();
    await expect(page.getByText('No records match these filters')).toHaveCount(0);
  });

  test('the Interventions list tells filters from a search that finds nothing', async ({ page }) => {
    await open(page, '/records');
    const table = page.getByRole('region', { name: 'Records table' });
    await expect(table.locator('tbody tr').first()).toBeVisible();

    await table.getByRole('searchbox', { name: 'Search these records' }).fill('zz nothing zz');
    await expect(table).toContainText('Nothing here matches "zz nothing zz"');
    await table.getByRole('button', { name: 'Clear the search' }).click();
    await expect(table.getByRole('searchbox', { name: 'Search these records' })).toHaveValue('');
    await expect(table.locator('tbody tr').first()).toBeVisible();

    await filterToNothing(page);
    await expect(table).toContainText('No records match these filters');
    await table.getByRole('button', { name: 'Show all records' }).click();
    await expect(table.locator('tbody tr').first()).toBeVisible();
  });

  test('the map says when its filters leave nothing on it', async ({ page, isMobile }) => {
    await open(page, '/map');
    const markers = page.locator('.leaflet-marker-icon');
    await expect(markers.first()).toBeVisible();

    await page.getByRole('button', { name: 'Layers and filters' }).click();
    const layers = page.getByRole('complementary', { name: 'Layers and filters' });
    await expect(layers).toBeVisible();
    await layers.getByLabel('Filter by another field').selectOption({ label: 'Beneficiary' });
    await layers.getByLabel('Beneficiary contains').fill('zz no such name zz');
    if (isMobile) await page.getByRole('button', { name: 'Close layers' }).click();

    const empty = page.locator('.map-empty');
    await expect(empty).toContainText('No records on the map match these filters');
    await expect(markers).toHaveCount(0);
    await empty.getByRole('button', { name: 'Show all records' }).click();
    await expect(empty).toHaveCount(0);
    await expect(markers.first()).toBeVisible();
  });
});
