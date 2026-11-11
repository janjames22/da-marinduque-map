// The Interventions list and one intervention's page (Phase 15a), in local mode, against the RAED seed.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { sidebar } from './helpers/shell';

interface SeedRecord {
  id: string;
  source_id: string | null;
  intervention_type_id: number;
  municipality_id: number;
  beneficiary: string | null;
  qa_flags: string[];
  geojson: unknown | null;
  deleted_at?: string | null;
}

const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as {
  municipalities: { id: number; name: string }[];
  interventions: SeedRecord[];
  lookups: { intervention_types: { id: number; name: string; is_active: boolean }[] };
};

const active = new Set(seed.lookups.intervention_types.filter((type) => type.is_active).map((type) => type.id));
const live = seed.interventions.filter((record) => !record.deleted_at && active.has(record.intervention_type_id));
const onMapRecord = live.find((record) => record.source_id === 'RAED-2026-10-21-004')!;
const offMapRecord = live.find((record) => record.geojson === null)!;
const gasan = seed.municipalities.find((municipality) => municipality.name === 'Gasan')!;
const inGasan = live.filter((record) => record.municipality_id === gasan.id);

const rows = (page: Page) => page.getByRole('region', { name: 'Records table' }).locator('tbody tr');
const summary = (page: Page) => page.locator('.records-page .page-header p').first();

async function open(page: Page, path: string, role?: string) {
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
  if (role) await page.addInitScript((value) => localStorage.setItem('da-local-role', value), role);
  await page.goto(path);
}

test.describe('the Interventions list', () => {
  test('lists every record, a page at a time, and marks the ones not on the map', async ({ page }) => {
    await open(page, '/records');
    await expect(page.getByRole('heading', { level: 1, name: 'Interventions' })).toBeVisible();
    await expect(summary(page)).toContainText(`${live.length} records`);
    await expect(rows(page)).toHaveCount(25);

    await page.getByLabel('Search these records').fill(offMapRecord.source_id!);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator('.unplotted-badge')).toHaveText('No coordinates yet');

    await page.getByLabel('Search these records').fill(onMapRecord.source_id!);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator('.unplotted-badge')).toHaveCount(0);
  });

  test('keeps to the filters the map and the Dashboard use', async ({ page }) => {
    await open(page, '/records');
    await page.locator('#dash-municipality').selectOption({ label: 'Gasan' });
    await expect(summary(page)).toContainText(`${inGasan.length} records`);

    // The same filters are still on at the Dashboard.
    await (await sidebar(page)).getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.locator('#dash-municipality')).toHaveValue(String(gasan.id));
  });

  test('opens a record from its row', async ({ page }) => {
    await open(page, '/records');
    await page.getByLabel('Search these records').fill(onMapRecord.source_id!);
    await rows(page).first().click();
    await expect(page).toHaveURL(new RegExp(`/records/${onMapRecord.id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.back-link')).toBeVisible();
  });

  test('gives a Viewer the list but no Add button', async ({ page }) => {
    await open(page, '/records', 'viewer');
    await expect(summary(page)).toContainText(`${live.length} records`);
    await expect(page.getByRole('link', { name: 'Add intervention' })).toHaveCount(0);
    const nav = await sidebar(page);
    await expect(nav.getByRole('link', { name: 'Interventions' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'QA queue' })).toHaveCount(0);
  });

  test('sends Add intervention to the map', async ({ page }) => {
    await open(page, '/records', 'encoder');
    await page.getByRole('link', { name: 'Add intervention' }).click();
    await expect(page).toHaveURL(/\/map/);
  });
});

test.describe("one intervention's page", () => {
  test('shows its details, location and status history, and opens it on the map', async ({ page }) => {
    await open(page, `/records/${onMapRecord.id}`, 'viewer');
    await expect(page.getByRole('heading', { level: 2, name: 'Details' })).toBeVisible();
    await expect(page.getByText(onMapRecord.beneficiary!)).toBeVisible();
    const location = page.getByRole('region', { name: 'Location' });
    await expect(location.getByText(/^13\.\d+, 12[12]\.\d+$/)).toBeVisible();
    await expect(location.getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', /google\.com\/maps/);
    await expect(page.getByRole('region', { name: 'Status history' }).locator('li')).not.toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open on the map to edit' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Open on the map', exact: true }).first().click();
    await expect(page.locator('.leaflet-popup-content').filter({ hasText: onMapRecord.beneficiary! })).toBeVisible({ timeout: 15_000 });
  });

  test("says a record without coordinates isn't on the map, and offers an editor the fix", async ({ page }) => {
    await open(page, `/records/${offMapRecord.id}`, 'encoder');
    await expect(page.locator('.record-title-row .unplotted-badge')).toHaveText('No coordinates yet');
    const location = page.getByRole('region', { name: 'Location' });
    await expect(location).toContainText("so this record is not on the map. It's still counted on the dashboard");
    await expect(location.getByRole('link', { name: 'list for the region to verify' })).toHaveAttribute('href', '/dashboard#awaiting');
    await expect(location.getByRole('link', { name: 'Enter verified coordinates' })).toHaveAttribute('href', `/map/records/${offMapRecord.id}?fix=resolve`);
    await expect(page.getByRole('link', { name: /^Open on the map/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'QA' })).toContainText('No coordinates');
  });

  test("doesn't offer a Viewer the fix", async ({ page }) => {
    await open(page, `/records/${offMapRecord.id}`, 'viewer');
    await expect(page.getByRole('region', { name: 'Location' })).toContainText('not on the map');
    await expect(page.getByRole('link', { name: 'Enter verified coordinates' })).toHaveCount(0);
  });

  test("says so when there's no such record", async ({ page }) => {
    await open(page, '/records/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('alert')).toContainText("That record wasn't found");
    await page.locator('.back-link').click();
    await expect(page).toHaveURL(/\/records$/);
  });
});
