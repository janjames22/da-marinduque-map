// The dashboard, records table, coloring and filtering by any field, and saved views, in local mode at
// desktop and phone sizes. tests/dashboard.test.ts and tests/view-fields.test.ts cover the arithmetic and
// the rules. e2e/auth.spec.ts covers these on a production build, under the site's real security headers.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import Papa from 'papaparse';

interface SeedRecord {
  id: string;
  source_id: string;
  beneficiary: string | null;
  title: string | null;
  remarks: string | null;
  barangay_id: number | null;
  municipality_id: number;
  banner_program_id: number | null;
  intervention_type_id: number;
  status_id: number | null;
  year_funded: number | null;
  quantity: number;
  qa_flags: string[];
  geojson: { coordinates: [number, number] } | null;
}

const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as {
  barangays: { id: number; name: string; municipality_id: number }[];
  municipalities: { id: number; name: string }[];
  interventions: SeedRecord[];
  intervention_barangays: { barangay_id: number; intervention_id: string }[];
  lookups: {
    programs: { id: number; name: string }[];
    statuses: { id: number; name: string; color: string }[];
    intervention_types: { id: number; code: string; name: string; is_active: boolean }[];
    intervention_type_statuses: { intervention_type_id: number; status_id: number; counts_as_operational: boolean }[];
  };
};

const records = seed.interventions;
const machinery = seed.lookups.intervention_types.find((t) => t.code === 'farm-machinery')!;
const ssip = seed.lookups.intervention_types.find((t) => t.code === 'ssip')!;
const gasan = seed.municipalities.find((m) => m.name === 'Gasan')!;
const inGasan = records.filter((r) => r.municipality_id === gasan.id);
const barangaysInGasan = seed.barangays.filter((b) => b.municipality_id === gasan.id);
const rice = seed.lookups.programs.find((p) => p.name === 'Rice Program')!;

const counts = new Map<string, number>();
for (const r of records) counts.set(r.beneficiary ?? '', (counts.get(r.beneficiary ?? '') ?? 0) + 1);
const onMapRecord = records.find((r) => r.geojson && r.qa_flags.length === 0 && counts.get(r.beneficiary ?? '') === 1)!;
const unlocatedRecord = records.find((r) => r.qa_flags.includes('no_coords') && r.barangay_id !== null)!;
const customRecords = records.filter((r) => r.intervention_type_id === machinery.id && r.geojson && r.qa_flags.length === 0 && counts.get(r.beneficiary ?? '') === 1).slice(0, 3);

// The one record with a mark in its text, such as a ñ.
const textsOf = (r: SeedRecord) => [r.beneficiary, r.title, r.remarks].filter((text): text is string => Boolean(text));
const hasMark = (text: string) => /\p{M}/u.test(text.normalize('NFD'));
const markedRecord = records.find((r) => textsOf(r).some(hasMark))!;
const markedText = textsOf(markedRecord).find(hasMark)!;

const panel = (page: Page) => page.getByRole('complementary', { name: 'Dashboard and records' });
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Views' });
const layers = (page: Page) => page.getByRole('complementary', { name: 'Layers and filters' });
const legend = (page: Page) => page.getByLabel('Map legend');
const kpi = (page: Page, id: string) => page.locator(`[data-kpi="${id}"] .kpi-value`);
const chart = (page: Page, name: string) => page.getByRole('figure', { name });
const rows = (page: Page) => page.locator('.records-table tbody tr');
const count = (page: Page) => page.locator('.records-count');
const popup = (page: Page) => page.locator('.record-popup');

async function ready(page: Page, path = '/') {
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
  await page.goto(path);
  await expect(page.locator('.barangay-shape')).toHaveCount(218);
}

async function showDashboard(page: Page, isMobile: boolean) {
  if (isMobile) await tabs(page).getByRole('button', { name: 'Dashboard' }).click();
  else await panel(page).getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(kpi(page, 'records')).toBeVisible({ timeout: 30_000 });
}

async function showRecords(page: Page, isMobile: boolean) {
  if (isMobile) await tabs(page).getByRole('button', { name: 'List' }).click();
  else await panel(page).getByRole('button', { name: 'Records', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Records table' })).toBeVisible({ timeout: 30_000 });
}

async function showMap(page: Page, isMobile: boolean) {
  if (isMobile) await tabs(page).getByRole('button', { name: 'Map' }).click();
}

// On a phone, the filters are in a drawer, reached from the map.
async function withLayers(page: Page, isMobile: boolean, change: () => Promise<unknown>) {
  if (isMobile) {
    await showMap(page, true);
    await page.getByRole('button', { name: 'Layers and filters' }).click();
  }
  await change();
  if (isMobile) await page.getByRole('button', { name: 'Close layers' }).click();
}

// Going to a barangay opens its profile, which closes the drawer on a phone.
async function goToBarangayAndCloseIt(page: Page, isMobile: boolean, name: string) {
  if (isMobile) {
    await showMap(page, true);
    await page.getByRole('button', { name: 'Layers and filters' }).click();
  }
  await layers(page).getByLabel('Go to barangay').selectOption({ label: name });
  await page.getByRole('button', { name: 'Close profile' }).click();
}

const filterToGasan = (page: Page, isMobile: boolean) => withLayers(page, isMobile, () => layers(page).getByRole('combobox', { name: /^Municipality/ }).selectOption(String(gasan.id)));

test.describe('where it sits', () => {
  test('beside the map on a computer, and it can be closed and reopened', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the computer layout');
    await ready(page);
    await expect(panel(page)).toBeVisible();
    await expect(kpi(page, 'records')).toBeVisible({ timeout: 30_000 });

    const map = page.locator('.leaflet-container');
    const beside = (await map.boundingBox())!;
    const box = (await panel(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(beside.x + beside.width - 1);

    await panel(page).getByRole('button', { name: 'Close the dashboard' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(async () => (await map.boundingBox())!.width).toBeGreaterThan(beside.width);

    // Closing it is remembered, for someone who wants the whole map.
    await page.reload();
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await expect(panel(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(kpi(page, 'records')).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(panel(page)).toBeVisible();
  });

  test('it can be made wider, for the table', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the computer layout');
    await ready(page);
    const narrow = (await panel(page).boundingBox())!.width;
    await panel(page).getByRole('button', { name: 'Wider' }).click();
    await expect.poll(async () => (await panel(page).boundingBox())!.width).toBeGreaterThan(narrow);

    // The map keeps enough room that its zoom buttons stay clear of the ones beside them.
    const zoom = (await page.locator('.leaflet-control-zoom').boundingBox())!;
    const toolbar = (await page.locator('.map-toolbar').boundingBox())!;
    expect(zoom.x + zoom.width).toBeLessThanOrEqual(toolbar.x);
    expect((await page.locator('.leaflet-container').boundingBox())!.width).toBeGreaterThanOrEqual(320);

    await panel(page).getByRole('button', { name: 'Narrower' }).click();
    await expect.poll(async () => (await panel(page).boundingBox())!.width).toBe(narrow);
  });

  test('a profile or form takes its place for a while, and it comes back as it was', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the computer layout');
    await ready(page);
    await showRecords(page, false);
    await page.getByRole('searchbox', { name: 'Search these records' }).fill(onMapRecord.source_id);
    await expect(rows(page)).toHaveCount(1);

    await page.locator('.barangay-shape').first().click({ force: true });
    await expect(page.getByLabel(/^Profile of barangay/)).toBeVisible();
    await expect(panel(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Close profile' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search these records' })).toHaveValue(onMapRecord.source_id);
    await expect(rows(page)).toHaveCount(1);
  });

  test('on a phone, the map, dashboard and list take turns on the whole screen', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the phone layout');
    await ready(page);
    const map = tabs(page).getByRole('button', { name: 'Map' });
    const dashboard = tabs(page).getByRole('button', { name: 'Dashboard' });
    const list = tabs(page).getByRole('button', { name: 'List' });

    await expect(map).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page)).toHaveCount(0);

    await dashboard.click();
    await expect(kpi(page, 'records')).toBeVisible({ timeout: 30_000 });
    await expect(dashboard).toHaveAttribute('aria-pressed', 'true');
    const box = (await panel(page).boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.width).toBe(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The zoom buttons don't show through.
    const covered = await page.evaluate(() => {
      const button = document.querySelector('.leaflet-control-zoom-in')!.getBoundingClientRect();
      return document.elementFromPoint(button.x + 2, button.y + 2)?.closest('.insights-panel') !== null;
    });
    expect(covered).toBe(true);

    await list.click();
    await expect(rows(page).first()).toBeVisible();
    await expect(list).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await map.click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('.leaflet-container')).toBeVisible();
  });

  test('on a phone, the tabs give way to a profile, so the map beside it keeps its room', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the phone layout');
    await ready(page);
    const withTabs = (await page.locator('.leaflet-container').boundingBox())!;
    await expect(tabs(page)).toBeVisible();

    await page.getByRole('button', { name: 'Layers and filters' }).click();
    await layers(page).getByLabel('Go to barangay').selectOption({ label: 'Bantad' });
    await expect(page.getByLabel(/^Profile of barangay/)).toBeVisible();
    await expect(tabs(page)).toBeHidden();
    // It starts at the top of the working area, where the tabs were.
    await expect.poll(async () => (await page.locator('.leaflet-container').boundingBox())!.y).toBeLessThan(withTabs.y);

    await page.getByRole('button', { name: 'Close profile' }).click();
    await expect(tabs(page)).toBeVisible();
    await expect(tabs(page).getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('on a phone, the filters can be reached from the dashboard', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the phone layout');
    await ready(page);
    await showDashboard(page, true);
    await page.getByRole('button', { name: 'Change filters' }).click();
    await layers(page).getByRole('combobox', { name: /^Municipality/ }).selectOption(String(gasan.id));
    await page.getByRole('button', { name: 'Close layers' }).click();
    await expect(kpi(page, 'records')).toHaveText(String(inGasan.length));
  });
});

test.describe('the key figures', () => {
  test('match the data', async ({ page, isMobile }) => {
    await ready(page);
    await showDashboard(page, isMobile);

    const units = (typeId: number) => records.filter((r) => r.intervention_type_id === typeId).reduce((sum, r) => sum + r.quantity, 0);
    const beneficiaries = new Set(records.map((r) => (r.beneficiary ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean));
    const linked = new Set(seed.intervention_barangays.map((link) => link.barangay_id));
    const needingQa = records.filter((r) => r.qa_flags.some((flag) => flag !== 'duplicate_point')).length;
    const unknown = seed.lookups.statuses.find((s) => s.name === 'Unknown')!.id;
    const known = records.filter((r) => r.status_id !== null && r.status_id !== unknown);
    const operational = known.filter((r) => seed.lookups.intervention_type_statuses.some((s) => s.intervention_type_id === r.intervention_type_id && s.status_id === r.status_id && s.counts_as_operational));

    await expect(kpi(page, 'records')).toHaveText(String(records.length));
    await expect(kpi(page, `type-${machinery.id}`)).toHaveText(String(units(machinery.id)));
    await expect(page.locator(`[data-kpi="type-${machinery.id}"] dt`)).toHaveText('Machinery units');
    await expect(kpi(page, `type-${ssip.id}`)).toHaveText(String(units(ssip.id)));
    await expect(page.locator(`[data-kpi="type-${ssip.id}"] dt`)).toHaveText('SSIPs');
    await expect(kpi(page, 'beneficiaries')).toHaveText(String(beneficiaries.size));
    await expect(kpi(page, 'operational')).toHaveText(`${Math.round((operational.length / known.length) * 100)}%`);
    await expect(kpi(page, 'barangays-without')).toHaveText(String(seed.barangays.length - linked.size));
    await expect(page.locator('[data-kpi="barangays-without"] .kpi-note')).toHaveText('of 218 barangays');
    await expect(kpi(page, 'needing-qa')).toHaveText(String(needingQa));
  });
});

test.describe('everything follows the map\'s filters', () => {
  test('a place filter changes the figures, charts and table, in step with the legend and Export', async ({ page, isMobile }) => {
    await ready(page);
    await filterToGasan(page, isMobile);

    await showMap(page, isMobile);
    const summary = await legend(page).locator('.legend-summary').textContent();

    await showDashboard(page, isMobile);
    await expect(kpi(page, 'records')).toHaveText(String(inGasan.length));
    await expect(page.locator('[data-kpi="barangays-without"] .kpi-note')).toHaveText(`of ${barangaysInGasan.length} barangays`);
    const without = Number(await kpi(page, 'barangays-without').textContent());
    expect(summary).toBe(`${barangaysInGasan.length - without} of ${barangaysInGasan.length} barangays have records`);
    await expect(page.getByLabel('Filters in force')).toContainText('Municipality: Gasan');

    const municipalities = chart(page, 'Units by municipality');
    await municipalities.getByRole('button', { name: /Show table/ }).click();
    await expect(municipalities.locator('tbody tr')).toHaveCount(1);
    await expect(municipalities.locator('tbody tr')).toContainText('Gasan');

    await showRecords(page, isMobile);
    await expect(count(page)).toHaveText(`1–25 of ${inGasan.length}`);

    await showMap(page, isMobile);
    if (isMobile) await expect(panel(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('dialog').locator('.export-count')).toHaveText(`${inGasan.length} records`);
  });

  test('hiding a layer takes its records out too', async ({ page, isMobile }) => {
    await ready(page);
    await withLayers(page, isMobile, () => layers(page).getByLabel(/SSIP/).uncheck());
    await showDashboard(page, isMobile);
    const left = records.filter((r) => r.intervention_type_id !== ssip.id);
    await expect(kpi(page, 'records')).toHaveText(String(left.length));
    await expect(kpi(page, `type-${ssip.id}`)).toHaveText('0');
  });

  test('clearing the filters from the dashboard puts everything back', async ({ page, isMobile }) => {
    await ready(page);
    await withLayers(page, isMobile, () => layers(page).getByRole('combobox', { name: /^Program/ }).selectOption(String(rice.id)));
    await showDashboard(page, isMobile);
    const inRice = records.filter((r) => r.banner_program_id === rice.id);
    await expect(kpi(page, 'records')).toHaveText(String(inRice.length));
    await panel(page).getByRole('button', { name: 'Clear filters' }).click();
    await expect(kpi(page, 'records')).toHaveText(String(records.length));
    await expect(panel(page)).toContainText('No filters are on');
  });

  test('"limit to map view" counts only what\'s on screen, and leaves out records with no coordinates', async ({ page, isMobile }) => {
    await ready(page);
    await goToBarangayAndCloseIt(page, isMobile, 'Bantad');
    await showDashboard(page, isMobile);
    const all = Number(await kpi(page, 'records').textContent());

    await panel(page).getByLabel('Limit to map view').check();
    await expect(panel(page)).toContainText('Records without coordinates aren\'t counted');
    await expect.poll(async () => Number(await kpi(page, 'records').textContent())).toBeLessThan(all);
    await expect.poll(async () => Number(await kpi(page, 'records').textContent())).toBeGreaterThan(0);
    const without = Number(await kpi(page, 'barangays-without').textContent());
    await expect(page.locator('[data-kpi="barangays-without"] .kpi-note')).not.toHaveText('of 218 barangays');
    expect(without).toBeLessThan(218);

    await panel(page).getByLabel('Limit to map view').uncheck();
    await expect(kpi(page, 'records')).toHaveText(String(all));
  });

  test('nothing matching leaves a plain message, not broken charts', async ({ page, isMobile }) => {
    await ready(page);
    await withLayers(page, isMobile, async () => {
      await layers(page).getByLabel('Filter by another field').selectOption({ label: 'Beneficiary' });
      await layers(page).getByLabel('Beneficiary contains').fill('zz no such name zz');
    });
    await showDashboard(page, isMobile);
    await expect(kpi(page, 'records')).toHaveText('0');
    await expect(panel(page)).toContainText('No records match these filters');
    await expect(kpi(page, 'operational')).toHaveText('–');
    await expect(page.getByRole('figure')).toHaveCount(0);
  });
});

test.describe('the charts', () => {
  test('all five are there, with bars, and each has a table with the same numbers', async ({ page, isMobile }) => {
    await ready(page);
    await showDashboard(page, isMobile);
    const totalUnits = records.reduce((sum, r) => sum + r.quantity, 0);

    const sumOfTable = async (name: string) => {
      const card = chart(page, name);
      await expect(card.locator('.recharts-bar-rectangle').first()).toBeVisible();
      await card.getByRole('button', { name: /Show table/ }).click();
      const values = await card.locator('tbody td').allTextContents();
      await card.getByRole('button', { name: /Show chart/ }).click();
      return values.reduce((sum, value) => sum + Number(value.replace(/,/g, '')), 0);
    };

    expect(await sumOfTable('Units by municipality')).toBe(totalUnits);
    expect(await sumOfTable('Units by program')).toBe(totalUnits);
    expect(await sumOfTable('Units by year funded')).toBe(totalUnits);

    const categories = chart(page, 'Units by category (top 15)');
    await expect(categories).toContainText(/Not shown: \d+ smaller categories/);
    await expect(categories.locator('.recharts-bar-rectangle')).toHaveCount(15);

    const status = chart(page, 'Status by municipality');
    await expect(status.getByRole('list', { name: 'Status colors' })).toContainText('Turned-over');
    await status.getByRole('button', { name: /Show table/ }).click();
    await expect(status.locator('tbody tr')).toHaveCount(seed.municipalities.length);
    const totals = await status.locator('tbody tr td:last-child').allTextContents();
    expect(totals.reduce((sum, value) => sum + Number(value), 0)).toBe(totalUnits);
  });

  test('a bar shows its value on hover', async ({ page, isMobile }) => {
    test.skip(isMobile, 'hovering needs a pointer');
    await ready(page);
    await showDashboard(page, false);
    const card = chart(page, 'Units by municipality');
    await card.locator('.recharts-bar-rectangle').first().hover();
    await expect(card.locator('.chart-tooltip')).toContainText('units');
  });

  test('a program keeps its own color', async ({ page, isMobile }) => {
    await ready(page);
    await showDashboard(page, isMobile);
    const fills = await chart(page, 'Units by program').locator('.recharts-bar-rectangle path').evaluateAll((paths) => paths.map((path) => path.getAttribute('fill')));
    expect(fills).toContain('#2e7d32');
    expect(fills).toContain('#f59e0b');
  });

  test('a change shows at once, with no reload', async ({ page, isMobile }) => {
    await ready(page);
    await showRecords(page, isMobile);
    await page.getByRole('searchbox', { name: 'Search these records' }).fill(onMapRecord.source_id);
    await rows(page).first().click();
    await expect(popup(page)).toBeVisible();
    await page.locator('.leaflet-popup-content').getByRole('button', { name: 'Delete', exact: true }).click();
    const deleting = page.getByRole('form', { name: 'Delete record' });
    await deleting.getByRole('button', { name: 'Delete record' }).click();
    await expect(page.getByText(/Record deleted/)).toBeVisible();

    await showDashboard(page, isMobile);
    await expect(kpi(page, 'records')).toHaveText(String(records.length - 1));
  });
});

test.describe('the records table', () => {
  test('goes a page at a time', async ({ page, isMobile }) => {
    await ready(page);
    await showRecords(page, isMobile);
    await expect(rows(page)).toHaveCount(25);
    await expect(count(page)).toHaveText(`1–25 of ${records.length}`);

    const previous = page.getByRole('button', { name: 'Previous' });
    const next = page.getByRole('button', { name: 'Next' });
    await expect(previous).toBeDisabled();

    // The pager is in plain sight, with the rows scrolling above it. The footer doesn't cover it.
    const onTop = await next.evaluate((button) => {
      const { x, y, width, height } = button.getBoundingClientRect();
      return document.elementFromPoint(x + width / 2, y + height / 2)?.closest('button') === button;
    });
    expect(onTop).toBe(true);

    const firstRow = await rows(page).first().getAttribute('data-record');
    await next.click();
    await expect(count(page)).toHaveText(`26–50 of ${records.length}`);
    await expect(rows(page).first()).not.toHaveAttribute('data-record', firstRow!);
    await previous.click();
    await expect(rows(page).first()).toHaveAttribute('data-record', firstRow!);

    await page.getByRole('combobox', { name: 'Show' }).selectOption('100');
    await expect(rows(page)).toHaveCount(100);
    await expect(count(page)).toHaveText(`1–100 of ${records.length}`);
    await next.click();
    await expect(count(page)).toHaveText(`101–${records.length} of ${records.length}`);
    await expect(next).toBeDisabled();
  });

  test('sorts by any column, both ways, and says so', async ({ page, isMobile }) => {
    await ready(page);
    await showRecords(page, isMobile);
    const yearHeader = page.getByRole('columnheader', { name: /Year/ });
    const years = async () => (await page.locator('.records-table tbody td:nth-child(5)').allTextContents()).map(Number);

    await expect(yearHeader).toHaveAttribute('aria-sort', 'none');
    await yearHeader.getByRole('button').click();
    await expect(yearHeader).toHaveAttribute('aria-sort', 'ascending');
    const up = await years();
    expect(up).toEqual([...up].sort((a, b) => a - b));

    await yearHeader.getByRole('button').click();
    await expect(yearHeader).toHaveAttribute('aria-sort', 'descending');
    const down = await years();
    expect(down).toEqual([...down].sort((a, b) => b - a));
    expect(down[0]).toBeGreaterThan(up[0]);

    const nameHeader = page.getByRole('columnheader', { name: /Record/ });
    await nameHeader.getByRole('button').click();
    await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    await expect(yearHeader).toHaveAttribute('aria-sort', 'none');
    const names = await page.locator('.records-table tbody td:first-child').allTextContents();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
  });

  test('finds records by what they say, ignoring case and marks, and back to page one', async ({ page, isMobile }) => {
    await ready(page);
    await showRecords(page, isMobile);
    await page.getByRole('button', { name: 'Next' }).click();
    const search = page.getByRole('searchbox', { name: 'Search these records' });

    await search.fill(onMapRecord.source_id);
    await expect(rows(page)).toHaveCount(1);
    await expect(count(page)).toHaveText('1–1 of 1');

    await search.fill((onMapRecord.beneficiary ?? '').toUpperCase());
    await expect(rows(page)).toHaveCount(1);

    // Typed plainly, as most people would, and found all the same.
    await search.fill(markedText.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());
    await expect(page.locator(`tr[data-record="${markedRecord.id}"]`)).toBeVisible();

    await search.fill('zz no such thing zz');
    await expect(page.getByRole('region', { name: 'Records table' })).toContainText('No records match.');
    await expect(page.getByRole('button', { name: 'Export this table' })).toBeDisabled();
    await expect(count(page)).toHaveText('0–0 of 0');

    await search.fill('');
    await expect(rows(page)).toHaveCount(25);
    await expect(count(page)).toHaveText(`1–25 of ${records.length}`);

    // A new search starts again from the first page, even when it finds plenty.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(count(page)).toHaveText(`26–50 of ${records.length}`);
    await search.fill('RAED-2026');
    await expect(count(page)).toHaveText(`1–25 of ${records.length}`);
  });

  test('a filter on the map narrows it too, and a search adds to that', async ({ page, isMobile }) => {
    await ready(page);
    await filterToGasan(page, isMobile);
    await showRecords(page, isMobile);
    await expect(count(page)).toHaveText(`1–25 of ${inGasan.length}`);
    const search = page.getByRole('searchbox', { name: 'Search these records' });
    await search.fill(inGasan[0].source_id);
    await expect(rows(page)).toHaveCount(1);
    await search.fill(records.find((r) => r.municipality_id !== gasan.id)!.source_id);
    await expect(rows(page)).toHaveCount(0);
  });

  test('clicking a row zooms to the record and opens it', async ({ page, isMobile }) => {
    await ready(page);
    await showRecords(page, isMobile);
    await page.getByRole('searchbox', { name: 'Search these records' }).fill(onMapRecord.source_id);
    await rows(page).first().click();

    await expect(popup(page).filter({ hasText: onMapRecord.beneficiary! })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`.intervention-marker[title="${onMapRecord.beneficiary}"]`)).toBeInViewport();
    if (isMobile) await expect(tabs(page).getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');

    // The list is still as it was left.
    if (isMobile) {
      await showRecords(page, true);
      await expect(page.getByRole('searchbox', { name: 'Search these records' })).toHaveValue(onMapRecord.source_id);
    }
  });

  test('its record\'s name works from the keyboard too', async ({ page, isMobile }) => {
    test.skip(isMobile, 'a keyboard');
    await ready(page);
    await showRecords(page, false);
    await page.getByRole('searchbox', { name: 'Search these records' }).fill(onMapRecord.source_id);
    await rows(page).first().getByRole('button').focus();
    await page.keyboard.press('Enter');
    await expect(popup(page).filter({ hasText: onMapRecord.beneficiary! })).toBeVisible({ timeout: 15_000 });
  });

  test('a record with no coordinates says so, and goes to its barangay', async ({ page, isMobile }) => {
    await ready(page);
    await showRecords(page, isMobile);
    await page.getByRole('searchbox', { name: 'Search these records' }).fill(unlocatedRecord.source_id);
    await rows(page).first().click();
    await expect(page.getByText(/This record has no usable coordinates/)).toBeVisible();
    await expect(popup(page)).toHaveCount(0);
  });

  test('exports what it shows, in its order, the same way as the Export button', async ({ page, isMobile }) => {
    await ready(page);
    await filterToGasan(page, isMobile);
    await showRecords(page, isMobile);
    await page.getByRole('columnheader', { name: /Year/ }).getByRole('button').click();
    await page.getByRole('combobox', { name: 'Show' }).selectOption('100');

    const search = 'Tractor';
    await page.getByRole('searchbox', { name: 'Search these records' }).fill(search);
    await expect.poll(async () => rows(page).count()).toBeGreaterThan(0);
    const shown = await rows(page).evaluateAll((elements) => elements.map((element) => element.getAttribute('data-record')));

    await page.getByRole('button', { name: 'Export this table' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Export the records table' })).toBeVisible();
    await expect(dialog.locator('.export-count')).toHaveText(`${shown.length} record${shown.length === 1 ? '' : 's'}`);
    await expect(dialog.getByLabel('Filters in force')).toContainText('Municipality: Gasan');
    await expect(dialog.getByLabel('Filters in force')).toContainText(`Search: "${search}"`);
    // The file name doesn't carry the search, as it can be someone's name.
    await expect(dialog.locator('.export-file-name')).toContainText('Filtered');
    await expect(dialog.locator('.export-file-name')).not.toContainText(search);

    await dialog.getByRole('radio', { name: /^CSV/ }).check();
    const started = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download' }).click();
    const download = await started;
    const text = (await readFile(await download.path())).toString('utf8').replace(/^﻿/, '');
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    expect(parsed.data.map((row) => row['Record ID'])).toEqual(shown);
  });

  test('what "limit to map view" leaves out isn\'t exported from it either', async ({ page, isMobile }) => {
    await ready(page);
    await goToBarangayAndCloseIt(page, isMobile, 'Bantad');
    await showRecords(page, isMobile);
    await panel(page).getByLabel('Limit to map view').check();
    await expect.poll(async () => rows(page).count()).toBeGreaterThan(0);
    const label = (await count(page).textContent())!;
    const total = Number(label.split(' of ')[1]);
    expect(total).toBeLessThan(records.length);

    await page.getByRole('button', { name: 'Export this table' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.export-count')).toHaveText(`${total} record${total === 1 ? '' : 's'}`);
    await expect(dialog.getByLabel('Filters in force')).toContainText('Only the current map view');
    await expect(dialog.getByLabel(/Only what's in the current map view/)).toHaveCount(0);
  });
});

// Custom fields of every kind, set on a few records straight in the browser's stored data, as the
// admin screens have their own tests.
async function addCustomFields(page: Page) {
  await page.evaluate(
    async ({ typeId, ids }) => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const open = indexedDB.open('da-intervention-map-local');
        open.onsuccess = () => resolve(open.result);
      });
      const store = database.transaction('state', 'readwrite').objectStore('state');
      const state = await new Promise<{ fixed: { types: { id: number; field_schema: { fields: unknown[] } }[] }; rows: { interventions: { id: string; attributes: Record<string, unknown> }[] } }>((resolve) => {
        const get = store.get('current');
        get.onsuccess = () => resolve(get.result);
      });
      state.fixed.types
        .find((type) => type.id === typeId)!
        .field_schema.fields.push(
          { key: 'drive', label: 'Drive', input: 'dropdown', options: [{ value: 'solar', label: 'Solar' }, { value: 'diesel', label: 'Diesel' }] },
          { key: 'insured', label: 'Insured', input: 'yes_no' },
          { key: 'power', label: 'Power', input: 'number', unit: 'hp' },
          { key: 'checked_on', label: 'Checked on', input: 'date' },
        );
      const values = [
        { drive: 'solar', insured: true, power: 5, checked_on: '2025-01-10' },
        { drive: 'solar', insured: false, power: 10, checked_on: '2025-06-01' },
        { drive: 'diesel', insured: true, power: 20, checked_on: '2026-02-02' },
      ];
      ids.forEach((id, index) => {
        state.rows.interventions.find((record) => record.id === id)!.attributes = values[index];
      });
      await new Promise((resolve) => {
        const put = store.put(state, 'current');
        put.onsuccess = resolve;
      });
    },
    { typeId: machinery.id, ids: customRecords.map((record) => record.id) },
  );
  await page.reload();
  await expect(page.locator('.barangay-shape')).toHaveCount(218);
}

test.describe('filtering by any field', () => {
  const addFilter = (page: Page, label: string) => layers(page).getByLabel('Filter by another field').selectOption({ label });

  test('a custom dropdown, yes/no, number range and date range, alone and together', async ({ page, isMobile }) => {
    test.slow();
    await ready(page);
    await addCustomFields(page);
    const total = async () => {
      await showDashboard(page, isMobile);
      return kpi(page, 'records').textContent();
    };
    const inDrawer = (change: () => Promise<unknown>) => withLayers(page, isMobile, change);

    await inDrawer(async () => {
      await addFilter(page, 'Drive');
      await layers(page).getByRole('group', { name: 'Drive' }).getByLabel('Solar').check();
    });
    expect(await total()).toBe('2');
    await expect(page.getByLabel('Filters in force')).toContainText('Drive: Solar');

    await inDrawer(async () => {
      await addFilter(page, 'Insured');
      await layers(page).getByRole('group', { name: 'Insured' }).getByLabel('Yes').check();
    });
    expect(await total()).toBe('1');

    await inDrawer(async () => {
      await layers(page).getByRole('button', { name: /Remove.*Insured/ }).click();
      await layers(page).getByRole('button', { name: /Remove.*Drive/ }).click();
      await addFilter(page, 'Power (hp)');
      await layers(page).getByLabel('Power (hp) from').fill('10');
    });
    expect(await total()).toBe('2');
    await inDrawer(() => layers(page).getByLabel('Power (hp) to').fill('15'));
    expect(await total()).toBe('1');
    await expect(page.getByLabel('Filters in force')).toContainText('Power (hp): 10 to 15');

    await inDrawer(async () => {
      await layers(page).getByRole('button', { name: /Remove.*Power/ }).click();
      await addFilter(page, 'Checked on');
      await layers(page).getByLabel('Checked on from').fill('2025-06-01');
    });
    expect(await total()).toBe('2');
    await inDrawer(() => layers(page).getByLabel('Checked on to').fill('2025-12-31'));
    expect(await total()).toBe('1');

    await inDrawer(() => layers(page).getByRole('button', { name: 'Clear filters' }).click());
    expect(await total()).toBe(String(records.length));
  });

  test('"Not set" finds the records with no value', async ({ page, isMobile }) => {
    await ready(page);
    await addCustomFields(page);
    await withLayers(page, isMobile, async () => {
      await addFilter(page, 'Drive');
      await layers(page).getByRole('group', { name: 'Drive' }).getByLabel('Not set').check();
    });
    await showDashboard(page, isMobile);
    await expect(kpi(page, 'records')).toHaveText(String(records.length - 3));
  });

  test('a filter applies to the map, the legend and an export, which lists it', async ({ page, isMobile }) => {
    await ready(page);
    await addCustomFields(page);
    await withLayers(page, isMobile, async () => {
      await addFilter(page, 'Drive');
      await layers(page).getByRole('group', { name: 'Drive' }).getByLabel('Diesel').check();
    });
    await showMap(page, isMobile);
    await expect(legend(page).locator('.legend-summary')).toHaveText('1 of 218 barangays have records');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.export-count')).toHaveText('1 record');
    await expect(dialog.getByLabel('Filters in force')).toContainText('Drive: Diesel');
  });

  test('the record\'s own fields work the same way', async ({ page, isMobile }) => {
    await ready(page);
    await withLayers(page, isMobile, async () => {
      await addFilter(page, 'Status');
      await layers(page).getByRole('group', { name: 'Status' }).getByLabel('Turned-over').check();
    });
    await showDashboard(page, isMobile);
    const turnedOver = seed.lookups.statuses.find((status) => status.name === 'Turned-over')!;
    await expect(kpi(page, 'records')).toHaveText(String(records.filter((r) => r.status_id === turnedOver.id).length));
  });

  test('a field already in use isn\'t offered again', async ({ page, isMobile }) => {
    await ready(page);
    await withLayers(page, isMobile, async () => {
      await addFilter(page, 'Status');
      await expect(layers(page).getByLabel('Filter by another field').locator('option', { hasText: /^Status$/ })).toHaveCount(0);
    });
  });
});

test.describe('coloring markers by any field', () => {
  const colorBy = (page: Page, label: string, isMobile: boolean) => withLayers(page, isMobile, () => layers(page).getByLabel('Color markers by').selectOption({ label }));

  const markerColors = (page: Page) =>
    page.locator('.intervention-marker span').evaluateAll((elements) => [...new Set(elements.map((element) => (element as HTMLElement).style.background))]);
  const legendColors = (page: Page) =>
    legend(page)
      .locator('.legend-markers .swatch')
      .evaluateAll((elements) => elements.map((element) => (element as HTMLElement).style.background));

  test('recolors the markers and explains them, with how many of each', async ({ page, isMobile }) => {
    await ready(page);
    await expect(legend(page).getByText('Markers by program')).toBeVisible();

    await colorBy(page, 'Status', isMobile);
    await showMap(page, isMobile);
    const markers = legend(page).getByRole('list', { name: 'Marker colors by Status' });
    await expect(markers).toBeVisible();
    for (const status of seed.lookups.statuses) {
      const how = records.filter((r) => r.status_id === status.id).length;
      if (how > 0) await expect(markers.locator('li').filter({ hasText: status.name })).toContainText(String(how));
    }
    // Every marker on screen has a color from the legend.
    const allowed = await legendColors(page);
    await expect.poll(async () => (await markerColors(page)).length).toBeGreaterThan(0);
    for (const color of await markerColors(page)) expect(allowed).toContain(color);
  });

  test('a number goes in ranges, and a filter doesn\'t repaint what\'s left', async ({ page, isMobile }) => {
    await ready(page);
    await colorBy(page, 'Year funded', isMobile);
    await showMap(page, isMobile);
    const markers = legend(page).getByRole('list', { name: 'Marker colors by Year funded' });
    await expect(markers.locator('li')).toHaveCount(5);
    const before = await markers.locator('li').evaluateAll((items) => items.map((item) => [item.children[1].textContent, (item.children[0] as HTMLElement).style.background]));

    await withLayers(page, isMobile, () => layers(page).getByRole('combobox', { name: /^Year from/ }).selectOption('2025'));
    await showMap(page, isMobile);
    await expect(markers.locator('li')).toHaveCount(2);
    const after = await markers.locator('li').evaluateAll((items) => items.map((item) => [item.children[1].textContent, (item.children[0] as HTMLElement).style.background]));
    for (const row of after) expect(before).toContainEqual(row);
  });

  test('custom fields can be used, and going back to the program restores the usual colors', async ({ page, isMobile }) => {
    await ready(page);
    await addCustomFields(page);
    await colorBy(page, 'Drive', isMobile);
    await showMap(page, isMobile);
    const markers = legend(page).getByRole('list', { name: 'Marker colors by Drive' });
    await expect(markers.locator('li').filter({ hasText: 'Solar' })).toContainText('2');
    await expect(markers.locator('li').filter({ hasText: 'Diesel' })).toContainText('1');
    await expect(markers.locator('li').filter({ hasText: 'Not set' })).toContainText(String(records.length - 3));

    await colorBy(page, 'Program', isMobile);
    await showMap(page, isMobile);
    await expect(legend(page).getByText('Markers by program')).toBeVisible();
    await expect(legend(page).getByRole('list', { name: 'Marker colors by Program' })).toBeHidden();
  });

  test('free text isn\'t offered, but custom text is', async ({ page, isMobile }) => {
    await ready(page);
    await withLayers(page, isMobile, async () => {
      const options = layers(page).getByLabel('Color markers by').locator('option');
      await expect(options.filter({ hasText: /^Beneficiary$/ })).toHaveCount(0);
      await expect(options.filter({ hasText: /^Remarks$/ })).toHaveCount(0);
      await expect(options.filter({ hasText: /^Status$/ })).toHaveCount(1);
    });
  });
});

test.describe('saved views', () => {
  const proxyTransform = (page: Page) => page.locator('.leaflet-proxy').evaluate((element) => (element as HTMLElement).style.transform);
  const savedView = (page: Page, name: string) => layers(page).locator(`[data-view="${name}"]`);

  async function saveView(page: Page, name: string, shared = false) {
    await layers(page).getByRole('button', { name: 'Save this view' }).click();
    const form = layers(page).getByRole('form', { name: 'Save this view' });
    await form.getByLabel('Name').fill(name);
    if (shared) await form.getByLabel('Share with everyone').check();
    await form.getByRole('button', { name: 'Save view' }).click();
    await expect(savedView(page, name)).toBeVisible();
  }

  test('keeps layers, filters, style, basemap and map position, and brings them all back', async ({ page, isMobile }) => {
    test.slow();
    await ready(page);
    await page.locator('.leaflet-control-zoom-in').click();
    await page.waitForTimeout(500);
    const extent = await proxyTransform(page);

    await withLayers(page, isMobile, async () => {
      await layers(page).getByLabel(/SSIP/).uncheck();
      await layers(page).getByRole('combobox', { name: /^Program/ }).selectOption(String(rice.id));
      await layers(page).getByRole('combobox', { name: /^Year from/ }).selectOption('2020');
      await layers(page).getByLabel('Filter by another field').selectOption({ label: 'Status' });
      await layers(page).getByRole('group', { name: 'Status' }).getByLabel('Turned-over').check();
      await layers(page).getByLabel('No intervention yet').check();
      await layers(page).getByLabel('Color markers by').selectOption({ label: 'Status' });
      await layers(page).getByRole('checkbox', { name: 'Municipalities' }).uncheck();
      await layers(page).getByLabel('Satellite', { exact: true }).check();
      await saveView(page, 'Rice since 2020');
      await expect(savedView(page, 'Rice since 2020')).toContainText('Personal');
    });

    // Start from a fresh page, with everything back to normal.
    await page.reload();
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    expect(await proxyTransform(page)).not.toBe(extent);

    await withLayers(page, isMobile, async () => {
      await expect(layers(page).getByLabel(/SSIP/)).toBeChecked();
      await savedView(page, 'Rice since 2020').getByRole('button', { name: 'Rice since 2020', exact: true }).click();

      await expect(layers(page).getByLabel(/SSIP/)).not.toBeChecked();
      await expect(layers(page).getByRole('combobox', { name: /^Program/ })).toHaveValue(String(rice.id));
      await expect(layers(page).getByRole('combobox', { name: /^Year from/ })).toHaveValue('2020');
      await expect(layers(page).getByRole('group', { name: 'Status' }).getByLabel('Turned-over')).toBeChecked();
      await expect(layers(page).getByLabel('No intervention yet')).toBeChecked();
      await expect(layers(page).getByLabel('Color markers by')).toHaveValue('status');
      await expect(layers(page).getByRole('checkbox', { name: 'Municipalities' })).not.toBeChecked();
      await expect(layers(page).getByLabel('Satellite', { exact: true })).toBeChecked();
    });
    await expect.poll(() => proxyTransform(page)).toBe(extent);
  });

  test('can be updated, shared, made personal again, and deleted', async ({ page, isMobile }) => {
    await ready(page);
    await withLayers(page, isMobile, async () => {
      await saveView(page, 'Working view');
      const view = savedView(page, 'Working view');

      await view.getByRole('button', { name: /^Share/ }).click();
      await expect(view).toContainText('Shared by you');
      await view.getByRole('button', { name: /Make personal/ }).click();
      await expect(view).toContainText('Personal');

      await layers(page).getByRole('combobox', { name: /^Program/ }).selectOption(String(rice.id));
      await view.getByRole('button', { name: /^Update/ }).click();
      await expect(layers(page).getByRole('status').filter({ hasText: 'Updated' })).toBeVisible();

      await layers(page).getByRole('combobox', { name: /^Program/ }).selectOption('');
      await view.getByRole('button', { name: 'Working view', exact: true }).click();
      await expect(layers(page).getByRole('combobox', { name: /^Program/ })).toHaveValue(String(rice.id));

      page.once('dialog', (dialog) => void dialog.accept());
      await view.getByRole('button', { name: /^Delete/ }).click();
      await expect(view).toHaveCount(0);
    });
  });

  test('deleting asks first', async ({ page, isMobile }) => {
    await ready(page);
    await withLayers(page, isMobile, async () => {
      await saveView(page, 'Keep me');
      page.once('dialog', (dialog) => void dialog.dismiss());
      await savedView(page, 'Keep me').getByRole('button', { name: /^Delete/ }).click();
      await expect(savedView(page, 'Keep me')).toBeVisible();
    });
  });

  test('needs a name, and can\'t repeat one of yours', async ({ page, isMobile }) => {
    await ready(page);
    await withLayers(page, isMobile, async () => {
      await layers(page).getByRole('button', { name: 'Save this view' }).click();
      const form = layers(page).getByRole('form', { name: 'Save this view' });
      await form.getByRole('button', { name: 'Save view' }).click();
      await expect(layers(page).getByRole('alert')).toContainText('Give the view a name');
      await form.getByRole('button', { name: 'Cancel' }).click();

      await saveView(page, 'Only once');
      await layers(page).getByRole('button', { name: 'Save this view' }).click();
      await form.getByLabel('Name').fill(' only ONCE ');
      await form.getByRole('button', { name: 'Save view' }).click();
      await expect(layers(page).getByRole('alert')).toContainText('You already have a view with that name');
    });
  });

  test('one shared view can open for everyone, and that can be undone', async ({ page, isMobile }) => {
    test.slow();
    await ready(page);
    await withLayers(page, isMobile, async () => {
      await layers(page).getByRole('combobox', { name: /^Municipality/ }).selectOption(String(gasan.id));
      await saveView(page, 'Gasan first', true);
      await expect(savedView(page, 'Gasan first').getByRole('button', { name: /Open on this/ })).toBeVisible();
      await savedView(page, 'Gasan first').getByRole('button', { name: /Open on this/ }).click();
      await expect(savedView(page, 'Gasan first')).toContainText('Opens by default');
    });

    await page.reload();
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await expect(page.getByText('Opened on the shared view "Gasan first".')).toBeVisible();
    await showDashboard(page, isMobile);
    await expect(kpi(page, 'records')).toHaveText(String(inGasan.length));

    // A link to one place is asking for that instead.
    const barangay = seed.barangays.find((candidate) => candidate.municipality_id !== gasan.id)!;
    await page.goto(`/barangays/${barangay.id}`);
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await expect(page.getByText('Opened on the shared view')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close profile' }).click();

    await page.goto('/');
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await withLayers(page, isMobile, async () => {
      // It has to stay shared while it's the default.
      await savedView(page, 'Gasan first').getByRole('button', { name: /Make personal/ }).click();
      await expect(layers(page).getByRole('alert')).toContainText('has to stay shared');
      await savedView(page, 'Gasan first').getByRole('button', { name: /Stop opening on this/ }).click();
      await expect(savedView(page, 'Gasan first')).not.toContainText('Opens by default');
    });

    await page.reload();
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await expect(page.getByText('Opened on the shared view')).toHaveCount(0);
    await showDashboard(page, isMobile);
    await expect(kpi(page, 'records')).toHaveText(String(records.length));
  });

  test('a personal view can\'t open for everyone', async ({ page, isMobile }) => {
    await ready(page);
    await withLayers(page, isMobile, async () => {
      await saveView(page, 'Just mine');
      await expect(savedView(page, 'Just mine').getByRole('button', { name: /Open on this/ })).toHaveCount(0);
    });
  });

  test('only an Admin is offered the default, but a Viewer can keep and share views', async ({ page, isMobile }) => {
    await page.addInitScript(() => localStorage.setItem('da-local-role', 'viewer'));
    await ready(page);
    await withLayers(page, isMobile, async () => {
      await saveView(page, 'Viewer view', true);
      await expect(savedView(page, 'Viewer view')).toContainText('Shared by you');
      await expect(savedView(page, 'Viewer view').getByRole('button', { name: /Open on this/ })).toHaveCount(0);
    });
  });

  test('a view pointing at something that\'s gone still opens, ignoring it', async ({ page, isMobile }) => {
    await ready(page);
    await withLayers(page, isMobile, () => saveView(page, 'Outlived'));
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const open = indexedDB.open('da-intervention-map-local');
        open.onsuccess = () => resolve(open.result);
      });
      const store = database.transaction('state', 'readwrite').objectStore('state');
      const state = await new Promise<{ rows: { savedViews: { config: Record<string, Record<string, unknown>> }[] } }>((resolve) => {
        const get = store.get('current');
        get.onsuccess = () => resolve(get.result);
      });
      const { config } = state.rows.savedViews[0];
      config.filters.fieldFilters = [{ field: 'attr:999:gone', kind: 'number', min: 1, max: 2 }];
      config.style.colorBy = 'attr:999:gone';
      config.filters.programId = 999;
      await new Promise((resolve) => {
        const put = store.put(state, 'current');
        put.onsuccess = resolve;
      });
    });
    await page.reload();
    await expect(page.locator('.barangay-shape')).toHaveCount(218);

    await withLayers(page, isMobile, async () => {
      await savedView(page, 'Outlived').getByRole('button', { name: 'Outlived', exact: true }).click();
      await expect(layers(page).getByLabel('Color markers by')).toHaveValue('program');
      await expect(layers(page).getByRole('combobox', { name: /^Program/ })).toHaveValue('');
    });
    await showDashboard(page, isMobile);
    await expect(kpi(page, 'records')).toHaveText(String(records.length));
  });
});

test.describe('a link to one record', () => {
  test('shows it, whatever filters were on', async ({ page, isMobile }) => {
    await ready(page, `/records/${onMapRecord.id}`);
    await expect(popup(page).filter({ hasText: onMapRecord.beneficiary! })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/$/);
    if (isMobile) await expect(panel(page)).toHaveCount(0);
  });

  test('one that isn\'t on the map opens its history', async ({ page }) => {
    await ready(page, `/records/${unlocatedRecord.id}`);
    await expect(page.getByLabel('Change history')).toBeVisible();
    await expect(page.getByText(/This record isn't on the map/)).toBeVisible();
  });

  test('one that doesn\'t exist says so', async ({ page }) => {
    await ready(page, '/records/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText(/That record wasn't found/)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});
