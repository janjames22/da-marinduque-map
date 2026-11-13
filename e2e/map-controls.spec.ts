// The map's room on a computer, asked for at Phase 16c's Gate 1: the Map opens map first, with the menu,
// the layers card and the dashboard put away and a button for each, the panel on the right can be put
// away and back, the legend keeps clear of the map's buttons, and the map can fill the screen alone.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { sidebar } from './helpers/shell';

const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as { barangays: { id: number; name: string }[] };
const bantad = seed.barangays.find((barangay) => barangay.name === 'Bantad')!;

async function open(page: Page, path = '/map') {
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
  await page.goto(path);
  await expect(page.locator('.barangay-shape')).toHaveCount(218);
}

const mapWidth = async (page: Page) => (await page.locator('.leaflet-container').boundingBox())!.width;
const layers = (page: Page) => page.getByRole('complementary', { name: 'Layers and filters' });
const dashboard = (page: Page) => page.getByRole('complementary', { name: 'Dashboard and records' });
const menu = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const legend = (page: Page) => page.getByLabel('Map legend');
const fullscreen = (page: Page) =>
  page.evaluate(() => (document.fullscreenElement?.classList.contains('map-area') ? 'screen' : document.querySelector('.map-area.is-window-fullscreen') ? 'window' : null));
const controlsBottom = (page: Page) => page.locator('.leaflet-top.leaflet-left').evaluate((element) => element.getBoundingClientRect().bottom);

test.describe('on a computer', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'a phone has its own drawer, sheet and tabs, and takes the panels in turns');
  });

  test('the Map opens map first, with a button for the menu, the layers and the dashboard', async ({ page }) => {
    await open(page);
    await expect(menu(page)).toBeHidden();
    await expect(layers(page)).toBeHidden();
    await expect(dashboard(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show the menu' })).toHaveText('Menu');

    const before = await mapWidth(page);
    await page.getByRole('button', { name: 'Layers and filters' }).click();
    await expect(layers(page)).toBeVisible();
    await expect.poll(() => mapWidth(page)).toBeLessThan(before - 200);
    await page.getByRole('button', { name: 'Close layers' }).click();
    await expect(layers(page)).toBeHidden();
    await expect.poll(() => mapWidth(page)).toBe(before);

    await page.locator('.map-toolbar').getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(dashboard(page)).toBeVisible();
  });

  test('what is brought out stays for the visit, and the next visit starts map first again', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Layers and filters' }).click();
    await page.getByRole('button', { name: 'Show the menu' }).click();
    await expect(menu(page)).toBeVisible();
    // A barangay is part of the visit.
    await layers(page).getByLabel('Go to barangay').selectOption({ label: bantad.name });
    await expect(page.getByRole('complementary', { name: `Profile of barangay ${bantad.name}` })).toBeVisible();
    await expect(layers(page)).toBeVisible();
    await expect(menu(page)).toBeVisible();

    // Another page keeps its menu. Back on the Map, it's map first again.
    await menu(page).getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(menu(page)).toBeVisible();
    await (await sidebar(page)).getByRole('link', { name: 'Map', exact: true }).click();
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await expect(menu(page)).toBeHidden();
    await expect(layers(page)).toBeHidden();
  });

  test('the menu put away on another page stays away there, and next time', async ({ page }) => {
    await page.goto('/');
    await expect(menu(page)).toBeVisible();
    await page.getByRole('button', { name: 'Hide the menu' }).click();
    await expect(menu(page)).toBeHidden();
    await page.reload();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(menu(page)).toBeHidden();
    await page.getByRole('button', { name: 'Show the menu' }).click();
    await expect(menu(page)).toBeVisible();
  });

  test('the panel on the right is put away without closing it, and shows again when another takes its place', async ({ page }) => {
    await open(page, `/map/barangays/${bantad.id}`);
    const profile = page.getByRole('complementary', { name: `Profile of barangay ${bantad.name}` });
    await expect(profile).toBeVisible();
    const before = await mapWidth(page);
    await page.getByRole('button', { name: 'Hide the side panel' }).click();
    await expect(profile).toBeHidden();
    await expect.poll(() => mapWidth(page)).toBeGreaterThan(before + 200);
    await expect(page.getByRole('button', { name: 'Show the side panel' })).toHaveText('Barangay profile');
    await page.getByRole('button', { name: 'Show the side panel' }).click();
    await expect(profile).toBeVisible();

    // Put away again, then another panel takes its place: that one shows.
    await page.getByRole('button', { name: 'Hide the side panel' }).click();
    await expect(profile).toBeHidden();
    await legend(page).getByRole('button', { name: /^Unassigned: \d+ records?$/ }).click();
    await expect(page.getByRole('complementary', { name: 'Unassigned records' })).toBeVisible();
  });

  test('the dashboard beside the map is put away and back the same way', async ({ page }) => {
    await open(page);
    await page.locator('.map-toolbar').getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(dashboard(page)).toBeVisible();
    await page.getByRole('button', { name: 'Hide the side panel' }).click();
    await expect(dashboard(page)).toBeHidden();
    await page.getByRole('button', { name: 'Show the side panel' }).click();
    await expect(dashboard(page)).toBeVisible();
  });

  test('the legend keeps clear of the buttons above it, and starts folded on a short map', async ({ page }) => {
    await open(page);
    await expect(legend(page)).toContainText('Number of interventions');
    await expect.poll(async () => (await legend(page).boundingBox())!.y).toBeGreaterThanOrEqual(await controlsBottom(page));

    await page.setViewportSize({ width: 1440, height: 560 });
    await open(page);
    const toggle = legend(page).getByRole('button', { name: 'Legend', exact: true });
    await expect(toggle).toBeVisible();
    await expect(legend(page).getByText('Number of interventions')).toBeHidden();
    await toggle.click();
    await expect(legend(page).getByText('Number of interventions')).toBeVisible();
    // Open, it scrolls inside rather than running under the buttons.
    await expect.poll(async () => (await legend(page).boundingBox())!.y).toBeGreaterThanOrEqual(await controlsBottom(page));
    await legend(page).getByRole('button', { name: 'Hide legend' }).click();
    await expect(legend(page).getByText('Number of interventions')).toBeHidden();
  });
});

test('the map fills the screen alone, and leaves it for a profile, or by its button', async ({ page, isMobile }) => {
  await open(page);
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => fullscreen(page)).not.toBeNull();
  const viewport = page.viewportSize()!;
  await expect.poll(async () => (await page.locator('.leaflet-container').boundingBox())!.width).toBe(viewport.width);
  // Only the map's own buttons: nothing that would open a panel outside it.
  await expect(page.getByRole('button', { name: 'Layers and filters' })).toBeHidden();

  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect.poll(() => fullscreen(page)).toBeNull();

  // A barangay's profile needs the page, so the map leaves full screen for it.
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => fullscreen(page)).not.toBeNull();
  await page.locator('.barangay-shape').first().dispatchEvent('click');
  await expect(page.getByRole('complementary', { name: /^Profile of barangay / })).toBeVisible();
  await expect.poll(() => fullscreen(page)).toBeNull();
  if (!isMobile) await expect(page.getByRole('button', { name: 'Hide the side panel' })).toBeVisible();
});
