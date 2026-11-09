// Reports on the real service, under the real site's security rules: a Viewer downloads each report and
// prints the map. What it logs belongs to the temporary accounts, and is removed at the end. Nothing from
// a record is printed.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readAccounts } from './accounts';
import { skipNetlifyBadge } from './netlify';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

const downloadOf = async (page: Page, click: () => Promise<void>) => {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  return download;
};

test('a Viewer downloads each report and prints the map, with nothing blocked', async ({ browser }) => {
  const account = readAccounts().viewer;
  const context = await browser.newContext({ acceptDownloads: true });
  contexts.push(context);
  await skipNetlifyBadge(context);
  const page = await context.newPage();
  const blocked: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/.test(message.text())) blocked.push(message.text());
  });
  // The real basemap loads here, so the printed map is the one on screen.
  await page.goto('/');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.barangay-shape')).toHaveCount(218, { timeout: 30_000 });

  await page.getByRole('button', { name: 'Print map' }).click();
  const map = await downloadOf(page, () => page.getByRole('dialog', { name: 'Print map' }).getByRole('button', { name: 'Download PDF' }).click());
  expect(map.suggestedFilename()).toMatch(/^Map_Marinduque_Province_\d{4}-\d{2}-\d{2}\.pdf$/);

  await page.getByRole('link', { name: 'Reports' }).click();
  await page.getByRole('navigation', { name: 'Reports' }).getByRole('link', { name: 'Inventory report' }).click();
  const inventory = page.getByRole('region', { name: 'Inventory report', exact: true });
  await expect(inventory.getByRole('status')).toContainText('records', { timeout: 30_000 });
  const pdf = await downloadOf(page, () => inventory.getByRole('button', { name: 'Download PDF' }).click());
  expect(pdf.suggestedFilename()).toMatch(/^Inventory_Marinduque_.*\.pdf$/);
  const xlsx = await downloadOf(page, () => inventory.getByRole('button', { name: 'Download Excel' }).click());
  expect(xlsx.suggestedFilename()).toMatch(/^Inventory_Marinduque_.*\.xlsx$/);

  await page.getByRole('navigation', { name: 'Reports' }).getByRole('link', { name: 'Municipal profile' }).click();
  await page.getByRole('region', { name: 'Municipal profile' }).getByLabel('Municipality').selectOption({ label: 'Boac' });
  const profile = await downloadOf(page, () => page.getByRole('region', { name: 'Municipal profile' }).getByRole('button', { name: 'Download PDF' }).click());
  expect(profile.suggestedFilename()).toMatch(/^Profile_Boac_/);

  for (const download of [map, pdf, xlsx, profile]) expect((await download.failure()) ?? null).toBeNull();
  expect(blocked).toEqual([]);
});
