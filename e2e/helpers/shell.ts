// The frame around every page since Phase 12: the sidebar and the account menu in the top bar.
import { expect, type Locator, type Page } from '@playwright/test';

// The sidebar's links. On a phone the sidebar is a drawer behind the menu button, so this opens it. On a
// computer the Map opens with the menu put away (Phase 16c, Gate 1), so this brings it out.
export async function sidebar(page: Page): Promise<Locator> {
  await expect(page.getByRole('banner')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const name of ['Open the menu', 'Show the menu']) {
    const menu = page.getByRole('button', { name });
    if (await menu.isVisible()) {
      await menu.click();
      await expect(nav).toBeVisible();
    }
  }
  return nav;
}

// Change password and Sign out are in the menu under the person's name.
export async function fromAccountMenu(page: Page, choice: 'Change password' | 'Sign out') {
  await page.getByRole('button', { name: /^Account:/ }).click();
  await page.getByRole('button', { name: choice }).click();
}
