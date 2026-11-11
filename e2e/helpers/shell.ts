// The frame around every page since Phase 12: the sidebar and the account menu in the top bar.
import { expect, type Locator, type Page } from '@playwright/test';

// The sidebar's links. On a phone the sidebar is a drawer behind the menu button, so this opens it.
export async function sidebar(page: Page): Promise<Locator> {
  await expect(page.getByRole('banner')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  const menu = page.getByRole('button', { name: 'Open the menu' });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(nav).toBeVisible();
  }
  return nav;
}

// Change password and Sign out are in the menu under the person's name.
export async function fromAccountMenu(page: Page, choice: 'Change password' | 'Sign out') {
  await page.getByRole('button', { name: /^Account:/ }).click();
  await page.getByRole('button', { name: choice }).click();
}
