// Farm-to-Market Roads (Phase 16a), in local mode, on the made-up sample roads in the local seed
// (scripts/sample-roads.ts): the lines on the map, their legend and popups, the road figures on Home and
// the Dashboard, a road's own page, an edit that keeps the line, and the lines in a KMZ.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import type { Intervention } from '../src/modules/intervention-map/data/types';
import { formatKm, isUnfinished, lineLength, roadTotals } from '../src/modules/intervention-map/lib/roads';

const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as {
  interventions: Intervention[];
  barangays: { id: number; name: string }[];
  intervention_barangays: { intervention_id: string; barangay_id: number; link_source: string }[];
  lookups: { intervention_types: { id: number; code: string; name: string; is_active: boolean; geometry_kind: string }[]; statuses: { id: number; name: string }[] };
};

const types = seed.lookups.intervention_types as unknown as Parameters<typeof roadTotals>[1]['types'];
const statuses = seed.lookups.statuses as Parameters<typeof isUnfinished>[1]['statuses'];
const roadType = seed.lookups.intervention_types.find((type) => type.code === 'fmr')!;
const roads = seed.interventions.filter((record) => record.intervention_type_id === roadType.id && !record.deleted_at);
const traced = roads.filter((record) => record.geojson !== null);
const unfinished = traced.filter((record) => isUnfinished(record, { statuses }));
const waiting = roads.find((record) => record.geojson === null)!;
// A finished road with a reported length, so its label and its page can both be checked.
const reported = traced.find((record) => lineLength(record).basis === 'reported' && !isUnfinished(record, { statuses }))!;
const totals = roadTotals(seed.interventions, { types });

const popup = (page: Page) => page.locator('.record-popup');
const legend = (page: Page) => page.getByLabel('Map legend');

async function open(page: Page, path: string, role?: string) {
  if (role) await page.addInitScript((value) => localStorage.setItem('da-local-role', value), role);
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
  await page.goto(path);
}

test.describe('roads on the map', () => {
  test('draws every traced road, dashed while unfinished, and leaves out the ones still waiting for a line', async ({ page }) => {
    expect(roadType.is_active).toBe(true);
    expect(waiting).toBeDefined();
    await open(page, '/map');
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await expect(page.locator('path.road-hit')).toHaveCount(traced.length);
    await expect(page.locator('path.road-line.is-unfinished')).toHaveCount(unfinished.length);
    // Each line has a white casing under it.
    await expect(page.locator('.leaflet-roads-pane path[stroke="#ffffff"]')).toHaveCount(traced.length);

    // The legend says what the dashes mean, and how many of each are drawn.
    const toggle = legend(page).getByRole('button', { name: 'Legend', exact: true });
    if (await toggle.isVisible()) await toggle.click();
    const lines = legend(page).getByRole('list', { name: 'Road lines' });
    await expect(lines.locator('li').filter({ hasText: 'Completed or in use' })).toContainText(String(traced.length - unfinished.length));
    await expect(lines.locator('li').filter({ hasText: 'Proposed or on-going' })).toContainText(String(unfinished.length));
  });

  test('opens a road from its link, with its length on the line and in the popup', async ({ page }) => {
    await open(page, `/map/records/${reported.id}`);
    await expect(popup(page)).toContainText(reported.title!);
    await expect(popup(page)).toContainText(`Traced line${formatKm(lineLength(reported).tracedKm!)}`);
    // Close enough in for the lengths, which stay hidden from further out.
    await expect(page.locator('.road-label').filter({ hasText: formatKm(lineLength(reported).km!) }).first()).toBeVisible();
  });

  test('keeps the lengths off the map at province zoom', async ({ page }) => {
    await open(page, '/map');
    await expect(page.locator('path.road-hit')).toHaveCount(traced.length);
    await expect(page.locator('.road-label').first()).toBeHidden();
  });
});

test.describe('road figures', () => {
  test('Home shows the roads in km in place of "Data to follow"', async ({ page }) => {
    await open(page, '/');
    const card = page.locator('.type-card').filter({ has: page.getByRole('heading', { name: roadType.name }) });
    await expect(card.locator('.overview-big-number')).toHaveText(formatKm(totals.km));
    await expect(card).toContainText(`${totals.roads} roads · ${totals.waiting} not yet traced`);
    await expect(page.getByText('Data to follow')).toHaveCount(0);
  });

  test('the Dashboard counts the roads and their km, and follows the filters', async ({ page }) => {
    await open(page, '/dashboard');
    const tile = page.locator('[data-tile="fmr"]');
    await expect(tile.locator('.overview-tile-value')).toHaveText(formatKm(totals.km));
    await expect(tile).toContainText(`${totals.roads} roads`);
    await expect(page.locator('.overview-tile.is-placeholder')).toHaveCount(0);

    // Only the roads of one municipality, with that municipality's km.
    const municipalityId = reported.municipality_id;
    const own = roadTotals(seed.interventions.filter((record) => record.municipality_id === municipalityId), { types });
    await page.locator('#dash-municipality').selectOption(String(municipalityId));
    await expect(tile.locator('.overview-tile-value')).toHaveText(formatKm(own.km));
  });
});

test.describe("a road's own page", () => {
  test('gives its length, its traced line and the barangays it runs through', async ({ page }) => {
    await open(page, `/records/${reported.id}`);
    const location = page.getByRole('region', { name: 'Location' });
    await expect(location).toContainText(`Length${formatKm(lineLength(reported).km!)}`);
    await expect(location).toContainText(`Traced line${formatKm(lineLength(reported).tracedKm!)}`);
    const crossed = seed.intervention_barangays
      .filter((link) => link.intervention_id === reported.id && link.link_source === 'spatial')
      .map((link) => seed.barangays.find((barangay) => barangay.id === link.barangay_id)!.name);
    for (const name of crossed) await expect(location).toContainText(name);
    // The form's own Length field reads once, with its unit once.
    await expect(page.getByRole('region', { name: 'Details' })).toContainText(`Length${reported.attributes.length_km} km`);
    await expect(page.getByRole('region', { name: 'Details' })).not.toContainText('km km');
  });

  test('says a road without a line is waiting for one, with nothing to enter yet', async ({ page }) => {
    await open(page, `/records/${waiting.id}`);
    await expect(page.locator('.unplotted-badge')).toHaveText('No traced line yet');
    await expect(page.getByRole('region', { name: 'Location' })).toContainText('No traced line yet, so this road is not on the map.');
    await expect(page.getByRole('link', { name: 'Enter verified coordinates' })).toHaveCount(0);
  });
});

test('an edit to a road keeps its line', async ({ page }) => {
  await open(page, `/map/records/${reported.id}`);
  await popup(page).getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('form', { name: 'Edit record' });
  await expect(edit.getByTestId('location-readout')).toHaveText(`Traced line, ${formatKm(lineLength(reported).tracedKm!)}`);
  await edit.getByLabel(/^Title/).fill('Sample FMR: renamed');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.locator('path.road-hit')).toHaveCount(traced.length);

  await page.goto(`/records/${reported.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample FMR: renamed');
  await expect(page.getByRole('region', { name: 'Location' })).toContainText(`Traced line${formatKm(lineLength(reported).tracedKm!)}`);
});

test('a KMZ carries the traced roads as lines', async ({ page }) => {
  await open(page, '/map');
  await expect(page.locator('.barangay-shape')).toHaveCount(218);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const started = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Download' }).click();
  const file = await started;
  const zip = await JSZip.loadAsync(await readFile((await file.path())!));
  const kml = await zip.files['doc.kml'].async('string');
  expect(kml.match(/<LineString>/g)?.length).toBe(traced.length);
  for (const road of traced) expect(kml).toContain(road.title!);
});
