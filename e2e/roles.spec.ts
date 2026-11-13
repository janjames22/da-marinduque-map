// What each role is offered on the screen, in local mode, including dragging. The database enforces
// these rules; these tests check the screens don't offer what would be refused.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as {
  interventions: { beneficiary: string; barangay_id: number | null; qa_flags: string[]; geojson: unknown }[];
};

const counts = new Map<string, number>();
for (const r of seed.interventions) counts.set(r.beneficiary, (counts.get(r.beneficiary) ?? 0) + 1);
const record = seed.interventions.find((r) => r.geojson && r.barangay_id !== null && r.qa_flags.length === 0 && counts.get(r.beneficiary) === 1)!;
const flagged = seed.interventions.find((r) => r.geojson && r.barangay_id !== null && r.qa_flags.join() === 'barangay_mismatch')!;

const profile = (page: Page) => page.getByLabel(/^Profile of barangay/);
const popup = (page: Page) => page.locator('.leaflet-popup-content');

async function openAs(page: Page, role: string, barangayId: number) {
  await page.addInitScript((value) => localStorage.setItem('da-local-role', value), role);
  await page.goto(`/barangays/${barangayId}`);
  await expect(page.locator('.barangay-shape')).toHaveCount(218);
  await expect(profile(page)).toBeVisible();
}

async function openPopup(page: Page, beneficiary: string) {
  await profile(page).locator('.record-row').filter({ hasText: beneficiary }).first().locator('.record-name').click();
  await expect(popup(page).getByText(beneficiary).first()).toBeVisible();
}

test.describe('Viewer', () => {
  test('gets no way to change anything', async ({ page }) => {
    await openAs(page, 'viewer', flagged.barangay_id!);
    await expect(page.locator('.add-record-button')).toHaveCount(0);
    await expect(profile(page).getByRole('button', { name: 'Add intervention here' })).toHaveCount(0);
    await expect(profile(page).getByRole('button', { name: 'Edit baseline' })).toHaveCount(0);
    await expect(profile(page).locator('.record-actions')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Deleted records/ })).toHaveCount(0);

    await openPopup(page, flagged.beneficiary);
    for (const name of ['Edit', 'Update status', 'Resolve flag', 'History', 'Delete']) {
      await expect(popup(page).getByRole('button', { name, exact: true })).toHaveCount(0);
    }
  });

  test('still reads the status timeline, baseline and warnings', async ({ page }) => {
    await openAs(page, 'viewer', flagged.barangay_id!);
    await expect(profile(page).locator('.baseline')).toBeVisible();
    await openPopup(page, flagged.beneficiary);
    await expect(popup(page).locator('.status-timeline')).toContainText('as of 2026-10-21');
    await expect(popup(page).locator('.record-warning')).toBeVisible();
    await expect(popup(page).getByRole('button', { name: 'Copy coordinates' })).toBeVisible();
    await expect(popup(page).getByRole('link', { name: 'Open in Google Maps' })).toBeVisible();
  });

  test('can\'t drag a marker', async ({ page }) => {
    await openAs(page, 'viewer', record.barangay_id!);
    await openPopup(page, record.beneficiary);
    const marker = page.locator(`.intervention-marker[title="${record.beneficiary}"]`);
    await expect(marker).toBeVisible();
    await expect(marker).not.toHaveClass(/leaflet-marker-draggable/);
  });
});

test.describe('Encoder', () => {
  test('gets all the editing tools and History, but no deleted records', async ({ page }) => {
    await openAs(page, 'encoder', flagged.barangay_id!);
    await expect(page.locator('.add-record-button')).toBeVisible();
    await expect(profile(page).getByRole('button', { name: 'Add intervention here' })).toBeVisible();
    await expect(profile(page).getByRole('button', { name: 'Edit baseline' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Deleted records/ })).toHaveCount(0);

    await openPopup(page, flagged.beneficiary);
    for (const name of ['Edit', 'Update status', 'Resolve flag', 'History', 'Delete']) {
      await expect(popup(page).getByRole('button', { name, exact: true })).toBeVisible();
    }
    const marker = page.locator(`.intervention-marker[title="${flagged.beneficiary}"]`).first();
    await expect(marker).toHaveClass(/leaflet-marker-draggable/);
  });
});

test.describe('Admin', () => {
  test('also gets the deleted records', async ({ page }) => {
    await openAs(page, 'admin', record.barangay_id!);
    await page.getByRole('button', { name: 'Layers and filters' }).click();
    await expect(page.getByRole('button', { name: /Deleted records/ })).toBeVisible();
  });
});
