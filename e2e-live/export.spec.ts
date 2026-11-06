// A real export on the real service, under the real site's security rules. Nothing from the file is
// written down or printed, as it holds beneficiary names.
import { expect, test, type Browser, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { connectDb, loadEnv } from '../scripts/lib/env';
import type { TestAccount } from '../scripts/lib/test-accounts';
import { readAccounts } from './accounts';

const toolbarExport = (page: Page) => page.getByRole('button', { name: 'Export', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: /^Export/ });

async function open(browser: Browser, account: TestAccount) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.abort());
  await page.goto('/');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.barangay-shape')).toHaveCount(218, { timeout: 30_000 });
  return page;
}

test('Export sits beside "+ Add intervention", and stands out', async ({ browser }, testInfo) => {
  const page = await open(browser, readAccounts().encoder);
  const add = await page.locator('.add-record-button').boundingBox();
  const button = await toolbarExport(page).boundingBox();
  expect(Math.abs(add!.y - button!.y)).toBeLessThan(1);
  expect(button!.x - (add!.x + add!.width)).toBeLessThanOrEqual(8);
  expect(button!.height).toBeCloseTo(add!.height, 0);
  await expect(toolbarExport(page)).toHaveCSS('color', 'rgb(20, 83, 45)');
  await page.screenshot({ path: testInfo.outputPath('toolbar.png') });
});

test('a Viewer downloads a KMZ, and the export goes in the audit log', async ({ browser }) => {
  const accounts = readAccounts();
  const page = await open(browser, accounts.viewer);

  await toolbarExport(page).click();
  await dialog(page).getByLabel('Municipal boundaries').check();
  await dialog(page).getByLabel('Barangay gap map').check();
  const counted = await dialog(page).locator('.export-count').innerText();
  const total = Number.parseInt(counted, 10);
  expect(total).toBeGreaterThanOrEqual(199);

  const [download] = await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Marinduque_Province_\d{4}-\d{2}-\d{2}\.kmz$/);
  await expect(dialog(page)).toHaveCount(0);

  const zip = await JSZip.loadAsync(await readBytes(download));
  expect(Object.keys(zip.files)[0]).toBe('doc.kml');
  expect(zip.files['icons/read-me.png']).toBeTruthy();
  const kml = await zip.files['doc.kml'].async('string');
  const placemarks = kml.match(/<Data name="RecordId">/g)?.length ?? 0;
  expect(kml).toContain(`<description>${total} records: ${placemarks} on the map, ${total - placemarks} without coordinates.`);
  expect(kml).toContain('<Folder><name>Read me – legend and unlocated records</name>');
  expect(kml).toContain('<Folder><name>Barangay gap map</name><visibility>0</visibility>');

  loadEnv();
  const db = await connectDb();
  try {
    const { rows } = await db.query<{ table_name: string; context: Record<string, unknown> }>(
      `select table_name, context from public.audit_log where actor_id = $1 and action = 'export'`,
      [accounts.viewer.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].table_name).toBe('exports');
    expect(rows[0].context).toMatchObject({ format: 'kmz', file_name: download.suggestedFilename(), record_count: total });
    expect(rows[0].context.filters).toMatchObject({ allTypes: true, municipality: null, layers: { municipalBoundaries: true, barangayBoundaries: false, gapMap: true } });
  } finally {
    await db.end();
  }
});

async function readBytes(download: { createReadStream(): Promise<NodeJS.ReadableStream> }) {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
