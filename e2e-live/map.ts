import { expect, type Page } from '@playwright/test';

// Since Phase 16c the Map opens map first: on a computer the layers card and the dashboard panel start
// put away, each with a button to bring it out. On a phone the layers are a sheet and the dashboard a tab.
// These bring each out when a test needs it, as e2e/dashboard.spec.ts does.

export const layersCard = (page: Page) => page.getByRole('complementary', { name: 'Layers and filters' });
export const dashboardPanel = (page: Page) => page.getByRole('complementary', { name: 'Dashboard and records' });

export async function openLayers(page: Page) {
  if (await layersCard(page).isVisible()) return;
  await page.getByRole('button', { name: 'Layers and filters' }).click();
  await expect(layersCard(page)).toBeVisible();
}

export async function openDashboard(page: Page) {
  const tab = page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Dashboard' });
  if (await tab.isVisible()) {
    await tab.click();
  } else {
    const open = page.locator('.map-toolbar').getByRole('button', { name: 'Dashboard', exact: true });
    if (await open.isVisible()) await open.click();
  }
  await expect(dashboardPanel(page)).toBeVisible({ timeout: 30_000 });
}
