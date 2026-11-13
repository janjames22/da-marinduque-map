// The map's room on a computer, asked for at Phase 16c's Gate 1: the menu, the layers card and the panel
// on the right can each be put away and back, and the map can fill the screen alone.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as { barangays: { id: number; name: string }[] };
const bantad = seed.barangays.find((barangay) => barangay.name === 'Bantad')!;

async function open(page: Page, path = '/map') {
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
  await page.goto(path);
  await expect(page.locator('.barangay-shape')).toHaveCount(218);
}

const mapWidth = async (page: Page) => (await page.locator('.leaflet-container').boundingBox())!.width;
const layers = (page: Page) => page.getByRole('complementary', { name: 'Layers and filters' });
const menu = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const fullscreen = (page: Page) =>
  page.evaluate(() => (document.fullscreenElement?.classList.contains('map-area') ? 'screen' : document.querySelector('.map-area.is-window-fullscreen') ? 'window' : null));

test.describe('on a computer', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'a phone has its own sheet and drawer, and takes the panels in turns');
  });

  test('the layers card is put away for a wider map, and stays away next time', async ({ page }) => {
    await open(page);
    const before = await mapWidth(page);
    await page.getByRole('button', { name: 'Hide layers' }).click();
    await expect(layers(page)).toBeHidden();
    await expect.poll(() => mapWidth(page)).toBeGreaterThan(before + 200);
    // Remembered, as the dashboard panel is.
    await page.reload();
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await expect(layers(page)).toBeHidden();
    await page.getByRole('button', { name: 'Show layers' }).click();
    await expect(layers(page)).toBeVisible();
    await expect.poll(() => mapWidth(page)).toBe(before);
  });

  test('the menu is put away on every page, and stays away next time', async ({ page }) => {
    await open(page);
    const before = await mapWidth(page);
    await page.getByRole('button', { name: 'Hide the menu' }).click();
    await expect(menu(page)).toBeHidden();
    await expect.poll(() => mapWidth(page)).toBeGreaterThan(before + 200);
    await page.goto('/');
    await expect(menu(page)).toBeHidden();
    await page.getByRole('button', { name: 'Show the menu' }).click();
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('link', { name: 'Map', exact: true })).toBeVisible();
  });

  test('the panel on the right is put away without closing it, and shows again when another takes its place', async ({ page }) => {
    await open(page, `/barangays/${bantad.id}`);
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
    await page.getByRole('button', { name: /^Unassigned: \d+ records?$/ }).click();
    await expect(page.getByRole('complementary', { name: 'Unassigned records' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide the side panel' })).toBeVisible();
  });

  test('the dashboard beside the map is put away and back the same way', async ({ page }) => {
    await open(page);
    const dashboard = page.getByRole('complementary', { name: 'Dashboard and records' });
    await page.locator('.map-toolbar').getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(dashboard).toBeVisible();
    await page.getByRole('button', { name: 'Hide the side panel' }).click();
    await expect(dashboard).toBeHidden();
    await page.getByRole('button', { name: 'Show the side panel' }).click();
    await expect(dashboard).toBeVisible();
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
  await expect(page.getByRole('button', { name: /^(Hide|Show) layers$/ })).toBeHidden();

  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect.poll(() => fullscreen(page)).toBeNull();

  // A barangay's profile needs the page, so the map leaves full screen for it.
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => fullscreen(page)).not.toBeNull();
  await page.locator('.barangay-shape').first().dispatchEvent('click');
  await expect(page.getByRole('complementary', { name: /^Profile of barangay / })).toBeVisible();
  await expect.poll(() => fullscreen(page)).toBeNull();
  if (!isMobile) await expect(layers(page)).toBeVisible();
});
