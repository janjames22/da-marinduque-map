import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

interface SeedRecord {
  id: string;
  source_id: string;
  barangay_id: number | null;
  qa_flags: string[];
}

const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as {
  barangays: { id: number; name: string; municipality_id: number }[];
  interventions: SeedRecord[];
  intervention_barangays: { barangay_id: number; intervention_id: string }[];
};

const linked = new Map<number, number>();
for (const { barangay_id } of seed.intervention_barangays) linked.set(barangay_id, (linked.get(barangay_id) ?? 0) + 1);

const emptyBarangay = seed.barangays.find((b) => !linked.has(b.id))!;
const barangayNamed = (name: string) => seed.barangays.find((b) => b.name === name)!;
const recordById = (n: string) => seed.interventions.find((r) => r.source_id === `RAED-2026-10-21-${n}`)!;

const legend = (page: Page) => page.getByLabel('Map legend');
const profile = (page: Page) => page.getByLabel(/^Profile of barangay/);

// A select inside its label adds its options to the label's text, so these go by accessible name.
const programSelect = (page: Page) => page.getByRole('combobox', { name: 'Program', exact: true });
const typeSelect = (page: Page) => page.getByRole('combobox', { name: 'Type', exact: true });

async function openPanel(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: 'Layers and filters' }).click();
}

// Clicking through Leaflet's own event handling, wherever the shape is on screen.
async function clickBarangay(page: Page, id: number) {
  await page.locator(`[data-barangay-id="${id}"]`).dispatchEvent('click');
}

test.beforeEach(async ({ page }) => {
  // The tests don't depend on basemap tiles being reachable.
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.abort());
});

test.describe('barangay base layer', () => {
  test('draws all 218 barangays', async ({ page }) => {
    await page.goto('/map');
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
  });

  test('shows the coverage and the unassigned count in the legend', async ({ page }) => {
    await page.goto('/map');
    await expect(legend(page)).toContainText('93 of 218 barangays have records');
    await expect(legend(page)).toContainText('Unassigned: 9 records');
  });

  test('a real click on the map opens that barangay', async ({ page }) => {
    await page.goto('/map');
    await expect(page.locator('.barangay-shape')).toHaveCount(218);

    const box = await page.locator('.map').boundingBox();
    // Find what's under a point near the map's center, then click exactly there.
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    const id = await page.evaluate(([px, py]) => {
      const shape = document
        .elementsFromPoint(px, py)
        .find((element) => element.hasAttribute('data-barangay-id'));
      return shape?.getAttribute('data-barangay-id') ?? null;
    }, [x, y]);
    expect(id).not.toBeNull();

    await page.mouse.click(x, y);
    await expect(page).toHaveURL(new RegExp(`/barangays/${id}$`));
    const name = seed.barangays.find((b) => String(b.id) === id)!.name;
    await expect(profile(page).getByRole('heading', { name, exact: true })).toBeVisible();
  });
});

test.describe('barangay profile', () => {
  test('opens for a barangay with no interventions', async ({ page }) => {
    await page.goto('/map');
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await clickBarangay(page, emptyBarangay.id);

    await expect(profile(page).getByRole('heading', { name: emptyBarangay.name, exact: true })).toBeVisible();
    await expect(profile(page)).toContainText('No intervention encoded yet in this barangay.');
    await expect(profile(page).getByRole('button', { name: 'Add intervention here' })).toBeVisible();
    await expect(profile(page)).toContainText('Number of farmers');
    await expect(profile(page)).toContainText('Not set');
  });

  test('lists every intervention, with counts by type and program', async ({ page }) => {
    const tumapon = barangayNamed('Tumapon');
    const expected = linked.get(tumapon.id) ?? 0;
    await page.goto(`/barangays/${tumapon.id}`);

    await expect(profile(page).getByRole('heading', { name: 'Tumapon', exact: true })).toBeVisible();
    await expect(profile(page).locator('.record-row')).toHaveCount(expected);
    await expect(profile(page).getByText('By type')).toBeVisible();
    await expect(profile(page).getByText('By program')).toBeVisible();
  });

  test('shows RAED statuses as "as of", not as a change date', async ({ page }) => {
    const barangayId = recordById('099').barangay_id!;
    await page.goto(`/barangays/${barangayId}`);
    await expect(profile(page).locator('.record-row').first()).toContainText('as of 2026-10-21 (RAED report)');
  });

  test('shows where a mismatched point is plotted, under its encoded barangay', async ({ page }) => {
    await page.goto(`/barangays/${recordById('099').barangay_id}`);
    await expect(profile(page)).toContainText('Plotted in Bognuyan, Gasan; encoded as Tabi, Boac');
  });

  test('marks a record that is not on the map', async ({ page }) => {
    await page.goto(`/barangays/${recordById('103').barangay_id}`);
    await expect(profile(page)).toContainText('Coordinates are outside Marinduque');
  });

  test('stays complete when map filters are on', async ({ page, isMobile }) => {
    const tumapon = barangayNamed('Tumapon');
    await page.goto(`/barangays/${tumapon.id}`);
    await expect(profile(page).locator('.record-row')).toHaveCount(linked.get(tumapon.id) ?? 0);

    await profile(page).getByRole('button', { name: 'Close profile' }).click();
    await openPanel(page, isMobile);
    await page.getByLabel('Year from').selectOption('2026');
    await programSelect(page).selectOption({ label: 'National Livestock Program' });
    await page.getByLabel('Go to barangay').selectOption({ label: 'Tumapon' });

    await expect(profile(page).locator('.record-row')).toHaveCount(linked.get(tumapon.id) ?? 0);
  });

  test('closes back to the map', async ({ page }) => {
    await page.goto(`/barangays/${emptyBarangay.id}`);
    await profile(page).getByRole('button', { name: 'Close profile' }).click();
    await expect(page).toHaveURL(/\/map$/);
    await expect(profile(page)).toHaveCount(0);
  });
});

test.describe('markers', () => {
  test('a record in a profile zooms to its marker and opens the popup with its status', async ({ page }) => {
    await page.goto(`/barangays/${barangayNamed('Tumapon').id}`);
    await profile(page).locator('.record-row button.record-name').first().click();

    const popup = page.locator('.leaflet-popup');
    await expect(popup).toBeVisible({ timeout: 15_000 });
    await expect(popup).toContainText('as of 2026-10-21 (RAED report)');
    await expect(popup).toContainText('Location basis');
    await expect(popup).toContainText('Unknown');
  });

  test('records sharing exact coordinates can each be reached', async ({ page }) => {
    const shared = seed.interventions.filter((r) => r.qa_flags.includes('duplicate_point') && r.barangay_id !== null);
    const target = shared.find((r) => shared.filter((other) => other.barangay_id === r.barangay_id).length > 1)!;
    await page.goto(`/barangays/${target.barangay_id}`);

    const rows = profile(page).locator('.record-row button.record-name');
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThan(1);
    for (let i = 0; i < count; i++) {
      const name = await rows.nth(i).innerText();
      await rows.nth(i).click();
      // The previous popup can linger while it fades out, so look for this record's.
      await expect(page.locator('.leaflet-popup', { hasText: name }).last()).toBeVisible({ timeout: 15_000 });
    }
  });
});

test.describe('choropleth modes', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    await page.goto('/map');
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await openPanel(page, isMobile);
  });

  const legendCount = async (page: Page, label: string) => {
    const rows = await legend(page).locator('li').evaluateAll((items) =>
      items.map((item) => ({
        label: item.querySelector('span:not(.swatch):not(.count)')?.textContent,
        count: Number(item.querySelector('.count')?.textContent),
      })),
    );
    return rows.find((row) => row.label === label)!.count;
  };
  const fillOf = (page: Page, id: number) => page.locator(`[data-barangay-id="${id}"]`).getAttribute('fill');

  test('number of interventions accounts for every barangay', async ({ page }) => {
    await expect(legend(page)).toContainText('Number of interventions');
    let total = 0;
    for (const label of ['0', '1', '2', '3–4', '5–9', '10+']) total += await legendCount(page, label);
    expect(total).toBe(218);
    expect(await legendCount(page, '0')).toBe(125);
  });

  test('the gap view shows the barangays with no records, and shades them', async ({ page }) => {
    await page.getByRole('radio', { name: 'No intervention yet' }).check();
    expect(await legendCount(page, 'None encoded yet')).toBe(125);
    expect(await legendCount(page, 'At least one')).toBe(93);
    await expect(legend(page)).toContainText('Shows what has been encoded, not what exists on the ground.');

    const someBarangay = seed.barangays.find((b) => linked.has(b.id))!;
    expect(await fillOf(page, emptyBarangay.id)).not.toBe(await fillOf(page, someBarangay.id));
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
  });

  test('the gap view respects filters', async ({ page }) => {
    await page.getByRole('radio', { name: 'No intervention yet' }).check();
    await programSelect(page).selectOption({ label: 'National Livestock Program' });
    expect(await legendCount(page, 'At least one')).toBeLessThan(93);
    expect(await legendCount(page, 'None encoded yet')).toBeGreaterThan(125);
    await expect(page.locator('.barangay-shape')).toHaveCount(218);

    await page.getByLabel('Layers and filters').getByRole('button', { name: 'Clear filters' }).click();
    expect(await legendCount(page, 'None encoded yet')).toBe(125);
  });

  test('by program shades by the picked program', async ({ page }) => {
    await page.getByRole('radio', { name: 'By program' }).check();
    await expect(legend(page)).toContainText('Rice Program');
    const riceZero = await legendCount(page, '0');
    expect(riceZero).toBeGreaterThan(125);

    await programSelect(page).selectOption({ label: 'Corn Program' });
    await expect(legend(page)).toContainText('Corn Program');
    expect(await legendCount(page, '0')).not.toBe(riceZero);
  });

  test('by type shades by the picked type', async ({ page }) => {
    await page.getByRole('radio', { name: 'By type' }).check();
    await expect(legend(page)).toContainText('Farm Machinery');

    await typeSelect(page).selectOption({ label: 'SSIP' });
    await expect(legend(page)).toContainText('SSIP');
    await expect(legend(page)).toContainText('of 218 barangays have records');
    expect(await legendCount(page, '0')).toBeGreaterThan(210);
  });

  test('off keeps the outlines clickable', async ({ page, isMobile }) => {
    await page.getByRole('radio', { name: 'Off (outlines only)' }).check();
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    expect(await page.locator(`[data-barangay-id="${emptyBarangay.id}"]`).getAttribute('fill-opacity')).toBe('0');

    if (isMobile) await page.getByRole('button', { name: 'Close layers' }).click();
    await clickBarangay(page, emptyBarangay.id);
    await expect(profile(page).getByRole('heading', { name: emptyBarangay.name, exact: true })).toBeVisible();
  });
});

test.describe('layer panel', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    await page.goto('/map');
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await openPanel(page, isMobile);
  });

  test('lists only the active types as layers', async ({ page }) => {
    const panel = page.getByLabel('Layers and filters');
    await expect(panel.getByLabel(/Farm Machinery/)).toBeChecked();
    await expect(panel.getByLabel(/SSIP/)).toBeChecked();
    // Only the switches: SSIP's own "Service area (ha)" field is rightly offered in the field filters.
    for (const hidden of ['Farm-to-Market Road', 'Postharvest Facility', 'Irrigation Canal', 'Service Area']) {
      await expect(panel.getByRole('checkbox', { name: hidden })).toHaveCount(0);
    }
  });

  test('switching a layer off updates the map and the shading', async ({ page }) => {
    await expect(legend(page)).toContainText('93 of 218');
    await page.getByLabel('Layers and filters').getByLabel(/Farm Machinery/).uncheck();
    await expect(legend(page)).not.toContainText('93 of 218');
    await expect(legend(page)).toContainText('4 of 218');
  });

  test('keeps barangays always on, and can hide the other boundaries', async ({ page }) => {
    const panel = page.getByLabel('Layers and filters');
    await expect(panel.getByLabel('Barangays (always on)')).toBeDisabled();
    await expect(page.locator('.municipality-label')).toHaveCount(6);
    await panel.getByRole('checkbox', { name: 'Municipalities' }).uncheck();
    await expect(page.locator('.municipality-label')).toHaveCount(0);
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
  });

  test('offers the four basemaps', async ({ page }) => {
    const panel = page.getByLabel('Layers and filters');
    for (const name of ['OpenStreetMap', 'Satellite', 'Topographic', 'Satellite with labels']) {
      await expect(panel.getByRole('radio', { name, exact: true })).toBeVisible();
    }
    await panel.getByRole('radio', { name: 'Satellite', exact: true }).check();
    await expect(page.locator('img.leaflet-tile[src*="World_Imagery"]').first()).toBeAttached();
  });
});

test.describe('unassigned records', () => {
  test('lists the 9 records with no linked barangay', async ({ page }) => {
    await page.goto('/map');
    await page.getByRole('button', { name: 'Unassigned: 9 records' }).click();
    const panel = page.getByLabel('Unassigned records');
    await expect(panel.locator('.record-row')).toHaveCount(9);
    await expect(panel).toContainText('Barangay 367');
  });
});

test.describe('phones', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout only');

  test('has no sideways scrolling, and the panel opens and closes', async ({ page }) => {
    await page.goto(`/barangays/${emptyBarangay.id}`);
    await expect(profile(page)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await profile(page).getByRole('button', { name: 'Close profile' }).click();
    const panel = page.getByLabel('Layers and filters');
    await expect(panel).toBeHidden();
    await page.getByRole('button', { name: 'Layers and filters' }).click();
    await expect(panel).toBeVisible();

    // The map's own controls must not show through on top of the open panel.
    const zoomOut = await page.locator('.leaflet-control-zoom-out').boundingBox();
    const onTop = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('.panel-left') !== null,
      [zoomOut!.x + zoomOut!.width / 2, zoomOut!.y + zoomOut!.height / 2],
    );
    expect(onTop).toBe(true);

    await page.getByRole('button', { name: 'Close layers' }).click();
    await expect(panel).toBeHidden();
  });
});

test('nothing logs an error while using the map', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // Blocked basemap tiles are expected in these tests.
    if (message.type() === 'error' && !message.text().includes('ERR_FAILED')) errors.push(message.text());
  });

  await page.goto(`/barangays/${barangayNamed('Tumapon').id}`);
  await expect(page.locator('.barangay-shape')).toHaveCount(218);
  expect(errors).toEqual([]);
});
