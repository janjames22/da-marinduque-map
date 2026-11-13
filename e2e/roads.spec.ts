// Farm-to-Market Roads (Phase 16a), in local mode, on the made-up sample roads in the local seed
// (scripts/sample-roads.ts): the lines on the map, their legend and popups, the road figures on Home and
// the Dashboard, a road's own page, an edit that keeps the line, and the lines in a KMZ.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import type { Intervention } from '../src/modules/intervention-map/data/types';
import { formatKm, isUnfinished, lineLength, lineLengthKm, roadTotals } from '../src/modules/intervention-map/lib/roads';

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

  test('says a road without a line is waiting for one, and offers an editor to draw it', async ({ page }) => {
    await open(page, `/records/${waiting.id}`);
    await expect(page.locator('.unplotted-badge')).toHaveText('No traced line yet');
    await expect(page.getByRole('region', { name: 'Location' })).toContainText('No traced line yet, so this road is not on the map.');
    await expect(page.getByRole('link', { name: 'Enter verified coordinates' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Draw its line on the map' })).toBeVisible();
  });

  test("doesn't offer a Viewer the drawing", async ({ page }) => {
    await open(page, `/records/${waiting.id}`, 'viewer');
    await expect(page.locator('.unplotted-badge')).toHaveText('No traced line yet');
    await expect(page.getByRole('link', { name: 'Draw its line on the map' })).toHaveCount(0);
    await page.goto(`/records/${reported.id}`);
    await expect(page.getByRole('region', { name: 'Location' })).toContainText('Traced line');
    await expect(page.getByRole('link', { name: 'Reshape on the map' })).toHaveCount(0);
  });
});

test('an edit to a road keeps its line', async ({ page }) => {
  await open(page, `/map/records/${reported.id}`);
  await popup(page).getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('form', { name: 'Edit record' });
  const points = (reported.geojson as GeoJSON.LineString).coordinates.length;
  await expect(edit.getByTestId('location-readout')).toHaveText(`Traced line, ${formatKm(lineLength(reported).tracedKm!)}, ${points} points`);
  await edit.getByLabel(/^Title/).fill('Sample FMR: renamed');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.locator('path.road-hit')).toHaveCount(traced.length);

  await page.goto(`/records/${reported.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample FMR: renamed');
  await expect(page.getByRole('region', { name: 'Location' })).toContainText(`Traced line${formatKm(lineLength(reported).tracedKm!)}`);
});

// Phase 16b: drawing and reshaping a road's line on the map.
test.describe('drawing a road', () => {
  const form = (page: Page, name: string) => page.getByRole('form', { name });
  const readout = (page: Page) => page.getByTestId('location-readout');
  const handles = (page: Page) => page.locator('.line-handle');
  const bends = (page: Page) => page.locator('.line-midpoint');

  // A point on the map, by its offset from the middle of what's on screen.
  async function tapMap(page: Page, dx: number, dy: number) {
    const box = (await page.locator('.leaflet-container').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  }

  // As a person would: once the popup has faded away and the map has stopped moving.
  async function drag(page: Page, handle: ReturnType<Page['locator']>, dx: number, dy: number) {
    await expect(page.locator('.leaflet-popup')).toHaveCount(0);
    let last = '';
    await expect
      .poll(async () => {
        const current = JSON.stringify(await handle.boundingBox());
        const settled = current === last;
        last = current;
        return settled;
      }, { intervals: [200] })
      .toBe(true);
    const box = (await handle.boundingBox())!;
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
    await page.mouse.move(x + dx, y + dy, { steps: 5 });
    await page.mouse.up();
  }

  test('a new road is drawn point by point, with its length as it goes, and saved on the map', async ({ page }) => {
    await open(page, '/map');
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    const add = form(page, 'Add intervention');
    await add.getByRole('combobox', { name: /^Type/ }).selectOption({ label: roadType.name });
    await expect(readout(page)).toHaveText('No traced line yet');

    await add.getByRole('button', { name: 'Draw the line' }).click();
    await tapMap(page, -30, -10);
    await expect(readout(page)).toHaveText('1 point. Add another to make a line.');
    await tapMap(page, 10, 5);
    await tapMap(page, 40, 20);
    await expect(readout(page)).toHaveText(/^Traced line, [\d.]+ km, 3 points$/);
    await expect(handles(page)).toHaveCount(3);

    // Undo takes the last point back.
    await add.getByRole('button', { name: 'Undo last point' }).click();
    await expect(readout(page)).toHaveText(/, 2 points$/);
    await tapMap(page, 40, 20);
    await add.getByRole('button', { name: 'Done' }).click();
    // Once done, a click on the map adds nothing, and a bend can be made between each two points.
    await tapMap(page, 0, 40);
    await expect(readout(page)).toHaveText(/, 3 points$/);
    await expect(bends(page)).toHaveCount(2);
    const drawn = (await readout(page).textContent())!.match(/Traced line, ([\d.]+ km)/)![1];

    await add.getByLabel(/^Title/).fill('Drawn test road');
    await add.getByRole('button', { name: 'Save record' }).click();
    await expect(add).toHaveCount(0);
    await expect(page.locator('path.road-hit')).toHaveCount(traced.length + 1);
    await expect(handles(page)).toHaveCount(0);

    await page.goto('/records');
    await page.getByLabel('Search these records').fill('Drawn test road');
    await page.locator('.records-table tbody tr').first().click();
    await expect(page.getByRole('region', { name: 'Location' })).toContainText(`Traced line${drawn}`);
  });

  test('a road is reshaped by dragging a point and adding a bend, and the change is saved', async ({ page }) => {
    await open(page, `/map/records/${reported.id}`);
    await popup(page).getByRole('button', { name: 'Edit' }).click();
    const edit = form(page, 'Edit record');
    const points = (reported.geojson as GeoJSON.LineString).coordinates.length;
    await expect(handles(page)).toHaveCount(points);
    await expect(bends(page)).toHaveCount(points - 1);
    // While its form is open, the road's own line gives way to the one being reshaped.
    await expect(page.locator('path.road-hit')).toHaveCount(traced.length - 1);
    const before = await readout(page).textContent();

    await drag(page, handles(page).last(), 60, 40);
    await expect(readout(page)).not.toHaveText(before!);
    await expect(readout(page)).toHaveText(new RegExp(`, ${points} points$`));
    await drag(page, bends(page).first(), -30, 30);
    await expect(readout(page)).toHaveText(new RegExp(`, ${points + 1} points$`));
    const reshaped = (await readout(page).textContent())!.match(/Traced line, ([\d.]+ km)/)![1];

    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toHaveCount(0);
    await expect(page.locator('path.road-hit')).toHaveCount(traced.length);
    await page.goto(`/records/${reported.id}`);
    await expect(page.getByRole('region', { name: 'Location' })).toContainText(`Traced line${reshaped}`);
  });

  test('a picked point can be removed, and a cleared line leaves the road waiting for one', async ({ page }) => {
    await open(page, `/records/${reported.id}`);
    await page.getByRole('link', { name: 'Reshape on the map' }).click();
    const edit = form(page, 'Edit record');
    const points = (reported.geojson as GeoJSON.LineString).coordinates.length;
    await expect(handles(page)).toHaveCount(points);

    await handles(page).nth(1).click();
    await expect(handles(page).nth(1)).toHaveClass(/is-selected/);
    await edit.getByRole('button', { name: 'Remove point 2' }).click();
    await expect(readout(page)).toHaveText(new RegExp(`, ${points - 1} points$`));

    await edit.getByRole('button', { name: 'Clear the line' }).click();
    await expect(readout(page)).toHaveText('No traced line yet');
    await expect(handles(page)).toHaveCount(0);
    await expect(edit.getByRole('button', { name: 'Draw the line' })).toBeVisible();
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toHaveCount(0);
    await expect(page.locator('path.road-hit')).toHaveCount(traced.length - 1);

    await page.goto(`/records/${reported.id}`);
    await expect(page.locator('.unplotted-badge')).toHaveText('No traced line yet');
  });

  test('a road waiting for its line gets one from its own page', async ({ page }) => {
    await open(page, `/records/${waiting.id}`);
    await page.getByRole('link', { name: 'Draw its line on the map' }).click();
    const edit = form(page, 'Edit record');
    // Straight into adding points.
    await expect(edit.getByRole('button', { name: 'Done' })).toBeVisible();
    await tapMap(page, -20, 0);
    await tapMap(page, 20, 10);
    await expect(readout(page)).toHaveText(/, 2 points$/);
    await edit.getByRole('button', { name: 'Done' }).click();
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toHaveCount(0);
    await expect(page.locator('path.road-hit')).toHaveCount(traced.length + 1);
  });

  test('a single point is refused as a line, and nothing is saved', async ({ page }) => {
    await open(page, `/records/${waiting.id}`);
    await page.getByRole('link', { name: 'Draw its line on the map' }).click();
    const edit = form(page, 'Edit record');
    await tapMap(page, 0, 0);
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit.getByText('A line needs at least two points.')).toBeVisible();
    await expect(edit).toBeVisible();
  });

  // The QA queue's "Fix on the map", for a road flagged No coordinates.
  test('a road waiting for its line gets one in the Resolve flag form, and its flag clears', async ({ page }) => {
    await open(page, `/map/records/${waiting.id}?fix=resolve`);
    const resolve = form(page, 'Resolve flag');
    await expect(resolve.getByRole('region', { name: 'Current flags' })).toContainText('No coordinates');
    // Straight into adding points, as from the road's own page.
    await expect(resolve.getByRole('button', { name: 'Done' })).toBeVisible();
    await tapMap(page, -20, 0);
    await expect(resolve.getByTestId('flags-after-saving')).toContainText('No coordinates');
    await tapMap(page, 20, 10);
    await expect(readout(page)).toHaveText(/, 2 points$/);
    await expect(resolve.getByTestId('flags-after-saving')).not.toContainText('No coordinates');
    await resolve.getByRole('button', { name: 'Done' }).click();
    await resolve.getByLabel(/^Reason for this change/).fill('Traced from the field sketch');
    await resolve.getByRole('button', { name: 'Save and log' }).click();
    await expect(resolve).toHaveCount(0);
    await expect(page.locator('path.road-hit')).toHaveCount(traced.length + 1);

    await page.goto(`/records/${waiting.id}`);
    await expect(page.locator('.unplotted-badge')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Location' })).toContainText('Traced line');
  });

  test("a traced road's Resolve flag form opens with its line ready to reshape", async ({ page }) => {
    await open(page, `/map/records/${reported.id}?fix=resolve`);
    const resolve = form(page, 'Resolve flag');
    const points = (reported.geojson as GeoJSON.LineString).coordinates.length;
    await expect(resolve.getByTestId('location-readout')).toHaveText(new RegExp(`, ${points} points$`));
    await expect(handles(page)).toHaveCount(points);
    await expect(page.locator('path.road-hit')).toHaveCount(traced.length - 1);
    // Nothing changed yet, so there's nothing to save.
    await resolve.getByLabel(/^Reason for this change/).fill('Checked');
    await resolve.getByRole('button', { name: 'Save and log' }).click();
    await expect(resolve.getByText('Nothing has changed yet.')).toBeVisible();
    await resolve.getByRole('button', { name: 'Cancel' }).click();
    await expect(handles(page)).toHaveCount(0);
    await expect(page.locator('path.road-hit')).toHaveCount(traced.length);
  });
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

// Phase 16c: roads from a map file, through the import wizard.
test('a GeoJSON file of roads comes in with their lines, in one part or two, and they show on the map', async ({ page }) => {
  await open(page, '/import');
  // Two made-up roads along sample roads' lines: one as it is, and one split in two.
  const first = (reported.geojson as GeoJSON.LineString).coordinates as [number, number][];
  const other = traced.find((record) => record.id !== reported.id && record.geojson?.type === 'LineString')!;
  const second = (other.geojson as GeoJSON.LineString).coordinates as [number, number][];
  const parts = [second.slice(0, 2), second.slice(2)];
  const geojson = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { Title: 'Imported FMR one', 'Length (km)': '1.4' }, geometry: { type: 'LineString', coordinates: first } },
      { type: 'Feature', properties: { Title: 'Imported FMR two' }, geometry: { type: 'MultiLineString', coordinates: parts } },
    ],
  };

  const step = page.getByRole('form', { name: 'Choose a file' });
  await step.getByLabel(/^What the file lists/).selectOption({ label: roadType.name });
  await step.getByLabel(/^Where it came from/).fill('E2E roads');
  await step.getByLabel(/^File/).setInputFiles({ name: 'roads.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(geojson)) });
  await expect(step.getByRole('status')).toContainText('2 rows and 2 columns read.');
  await expect(step).toContainText('2 features are lines.');
  await step.getByRole('button', { name: 'Next: columns' }).click();

  // A road has no point columns to match, and its fields are found by name.
  const title = page.getByRole('combobox', { name: 'Field for Title' });
  await expect(title).toHaveValue('title');
  await expect(title.locator('option[value="latitude"]')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Field for Length (km)' })).toHaveValue('attr:length_km');
  await page.getByRole('button', { name: 'Next: check' }).click();

  // With no municipality in the file, each takes its place from where its line is, and says so.
  await expect(page.locator('.import-summary')).toHaveText('2 rows: 2 ready, 0 to fix, 2 with warnings.');
  await expect(page.getByRole('columnheader', { name: 'Traced line' })).toBeVisible();
  await expect(page.locator('tr[data-row="1"]')).toContainText('Imported FMR one');
  await expect(page.locator('tr[data-row="1"]')).toContainText(formatKm(lineLengthKm([first])));
  await expect(page.locator('tr[data-row="2"]')).toContainText(`${formatKm(lineLengthKm(parts))}, in 2 parts`);
  await expect(page.locator('tr[data-row="2"]')).toContainText("No municipality in the file, so it's taken from where the line is");
  await page.getByRole('button', { name: 'Import 2 records' }).click();
  await expect(page.getByRole('heading', { name: 'Imported 2 records' })).toBeVisible();

  await page.goto('/map');
  await expect(page.locator('.barangay-shape')).toHaveCount(218);
  await expect(page.locator('path.road-hit')).toHaveCount(traced.length + 2);
  await page.goto('/records');
  await page.getByLabel('Search these records').fill('Imported FMR two');
  await page.locator('.records-table tbody tr').first().click();
  await expect(page.getByRole('region', { name: 'Location' })).toContainText(`Traced line${formatKm(lineLengthKm(parts))}`);
});

// The sample in docs/samples, for trying the import, has to keep coming in cleanly.
test('the sample roads file in docs/samples imports cleanly, with its programs, years and statuses', async ({ page }) => {
  const sample = JSON.parse(readFileSync('docs/samples/sample-fmr-roads.geojson', 'utf8')) as GeoJSON.FeatureCollection;
  await open(page, '/import');
  const step = page.getByRole('form', { name: 'Choose a file' });
  await step.getByLabel(/^What the file lists/).selectOption({ label: roadType.name });
  await step.getByLabel(/^Where it came from/).fill('Sample roads file');
  await step.getByLabel(/^File/).setInputFiles('docs/samples/sample-fmr-roads.geojson');
  await expect(step.getByRole('status')).toContainText(`${sample.features.length} rows`);
  await step.getByRole('button', { name: 'Next: columns' }).click();
  for (const [column, target] of [['Title', 'title'], ['Municipality', 'municipality'], ['Barangay', 'barangay'], ['Length (km)', 'attr:length_km'], ['Program', 'banner_program'], ['Year', 'year_funded'], ['Status', 'status']]) {
    await expect(page.getByRole('combobox', { name: `Field for ${column}` })).toHaveValue(target);
  }
  await page.getByRole('button', { name: 'Next: check' }).click();
  await expect(page.locator('.import-summary')).toHaveText(`${sample.features.length} rows: ${sample.features.length} ready, 0 to fix, 1 with warnings.`);
  await expect(page.locator('table.import-preview tbody tr td:nth-child(6)')).toHaveText(Array(sample.features.length).fill('—'));
  await page.getByRole('button', { name: `Import ${sample.features.length} records` }).click();
  await expect(page.locator('.import-done')).toContainText('None of them were flagged.');
});
