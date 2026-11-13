// Home and the Dashboard page (Phase 13), in local mode. tests/overview.test.ts covers their figures
// on small hand-made sets of records. These check the pages against the RAED seed.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import Papa from 'papaparse';
import { sidebar } from './helpers/shell';

interface SeedRecord {
  id: string;
  intervention_type_id: number;
  municipality_id: number;
  quantity: number;
  qa_flags: string[];
  geojson: unknown | null;
  deleted_at?: string | null;
}

const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as {
  municipalities: { id: number; name: string }[];
  interventions: SeedRecord[];
  lookups: { intervention_types: { id: number; is_active: boolean }[] };
};

const active = new Set(seed.lookups.intervention_types.filter((type) => type.is_active).map((type) => type.id));
const live = seed.interventions.filter((record) => !record.deleted_at && active.has(record.intervention_type_id));
const offMap = live.filter((record) => record.geojson === null || record.qa_flags.includes('out_of_province'));
const gasan = seed.municipalities.find((municipality) => municipality.name === 'Gasan')!;
const inGasan = live.filter((record) => record.municipality_id === gasan.id);

const tile = (page: Page, id: string) => page.locator(`[data-tile="${id}"] .overview-tile-value`);
const awaiting = (page: Page) => page.getByRole('region', { name: 'Awaiting coordinate verification' });

async function open(page: Page, path: string, role?: string) {
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
  if (role) await page.addInitScript((value) => localStorage.setItem('da-local-role', value), role);
  await page.goto(path);
}

test.describe('Home', () => {
  test('counts every record, and shows an Encoder what is waiting', async ({ page }) => {
    await open(page, '/', 'encoder');
    await expect(page.getByRole('heading', { level: 1, name: /^Welcome/ })).toBeVisible();
    await expect(tile(page, 'records')).toHaveText(String(live.length));

    const work = page.getByRole('region', { name: 'Work waiting' });
    const coordinates = work.getByRole('link', { name: new RegExp(`^${offMap.length} records are waiting for verified coordinates`) });
    await expect(coordinates).toBeVisible();
    await expect(work.getByRole('link', { name: /need QA/ })).toBeVisible();
    await coordinates.click();
    await expect(page).toHaveURL(/\/dashboard#awaiting$/);
    await expect(awaiting(page).locator('tbody tr')).toHaveCount(offMap.length);
  });

  test('gives a Viewer the figures and a note, but no work list and no Add button', async ({ page }) => {
    await open(page, '/', 'viewer');
    await expect(tile(page, 'records')).toHaveText(String(live.length));
    await expect(page.getByRole('region', { name: 'Work waiting' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Add intervention' })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: `${offMap.length} records are waiting for verified coordinates` })).toBeVisible();
  });

  test("Add intervention opens the map, ready to place the point", async ({ page }) => {
    await open(page, '/');
    await page.getByRole('link', { name: 'Add intervention' }).click();
    await expect(page).toHaveURL(/\/map$/);
    await expect(page.getByText('Click the map to set the location.').first()).toBeVisible();
  });

  test('is where an unknown address goes, and its sidebar link is marked', async ({ page }) => {
    await open(page, '/nowhere');
    await expect(page).toHaveURL(/\/$/);
    await expect((await sidebar(page)).getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('the frame', () => {
  // A hidden label or a chart's tooltip deep in a scrolling panel once stretched the window itself, so
  // a short window scrolled past the frame onto blank space.
  test('only the panels scroll, never the window, even when it is short', async ({ page, isMobile }) => {
    if (!isMobile) await page.setViewportSize({ width: 1290, height: 610 });
    for (const path of ['/', '/dashboard', '/map', '/reports', '/admin/types', '/qa']) {
      await open(page, path);
      await expect(page.getByRole('banner')).toBeVisible();
      if (path === '/map') {
        await expect(page.locator('.barangay-shape')).toHaveCount(218);
        // With the dashboard beside the map, as its charts are what once stretched the window.
        const dashboard = page.locator('.map-toolbar').getByRole('button', { name: 'Dashboard', exact: true });
        if (await dashboard.isVisible()) await dashboard.click();
      }
      if (path === '/dashboard') await expect(tile(page, 'records')).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight), { message: path }).toBeLessThanOrEqual(0);
      // Nor the frame's own box: anything taller than it lets a focused field scroll the page out of
      // the frame, as the phone's closed layers sheet once did to the map.
      await expect
        .poll(() => page.evaluate(() => { const frame = document.querySelector('.shell-content')!; return frame.scrollHeight - frame.clientHeight; }), { message: `${path}, the frame` })
        .toBeLessThanOrEqual(0);
    }
  });
});

test.describe('the Dashboard page', () => {
  test('shares its filters with the map, and the totals follow them', async ({ page }) => {
    await open(page, '/dashboard');
    await expect(tile(page, 'records')).toHaveText(String(live.length));
    await expect(tile(page, 'awaiting')).toHaveText(String(offMap.length));

    const filters = page.getByRole('form', { name: 'Filters' });
    await filters.getByLabel('Municipality').selectOption(String(gasan.id));
    await expect(tile(page, 'records')).toHaveText(String(inGasan.length));
    await expect(page.getByText(`Municipality: ${gasan.name}`)).toBeVisible();

    await (await sidebar(page)).getByRole('link', { name: 'Map', exact: true }).click();
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await page.getByRole('button', { name: 'Layers and filters' }).click();
    // The map's select is inside its label, so it goes by its accessible name.
    await expect(page.locator('.panel-left').getByRole('combobox', { name: 'Municipality', exact: true })).toHaveValue(String(gasan.id));
  });

  test('the verification sheet has the region\'s columns, and goes in the audit log', async ({ page }) => {
    await open(page, '/dashboard');
    await expect(awaiting(page).locator('tbody tr')).toHaveCount(offMap.length);
    const [download] = await Promise.all([page.waitForEvent('download'), awaiting(page).getByRole('button', { name: 'Download verification sheet' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^For_field_verification_\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await readFile(await download.path());
    const parsed = Papa.parse<Record<string, string>>(text.toString('utf8').replace(/^﻿/, ''), { header: true, skipEmptyLines: true });
    expect(parsed.meta.fields).toEqual(['ID', 'Type', 'Machine / project', 'Beneficiary', 'Municipality (encoded)', 'Barangay (encoded)', 'Issue', 'Suggested value', 'Verified barangay', 'Verified latitude', 'Verified longitude', 'Location basis']);
    expect(parsed.data).toHaveLength(offMap.length);

    await (await sidebar(page)).getByRole('link', { name: 'Audit log' }).click();
    await expect(page.locator('tr[data-audit-entry]').first()).toContainText(download.suggestedFilename());
  });

  test("a chart's table downloads as CSV, with the same units", async ({ page }) => {
    await open(page, '/dashboard');
    const chart = page.getByRole('figure', { name: 'Units by municipality' });
    const [download] = await Promise.all([page.waitForEvent('download'), chart.getByRole('button', { name: 'CSV of Units by municipality' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^Dashboard_Municipalities_\d{4}-\d{2}-\d{2}\.csv$/);
    const parsed = Papa.parse<Record<string, string>>((await readFile(await download.path())).toString('utf8').replace(/^﻿/, ''), { header: true, skipEmptyLines: true });
    const units = parsed.data.reduce((sum, row) => sum + Number(row.Units), 0);
    expect(units).toBe(live.reduce((sum, record) => sum + record.quantity, 0));
  });
});
