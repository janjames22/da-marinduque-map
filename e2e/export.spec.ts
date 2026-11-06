// The Export button and dialog, downloading real files in local mode, at desktop and phone sizes.
// tests/export.test.ts covers the file formats in depth. This covers what a person sees and gets.
// e2e/auth.spec.ts does it on a production build, under the site's real security headers.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { read as readShapefile } from 'shapefile';

const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as {
  lookups: {
    icons: { id: number; name: string; image: string }[];
    categories: { id: number; name: string; icon_id: number }[];
  };
  municipalities: { id: number; name: string }[];
  barangays: { id: number; name: string; municipality_id: number }[];
  intervention_barangays: { intervention_id: string; barangay_id: number }[];
  interventions: { id: string; beneficiary: string; category_id: number; municipality_id: number; barangay_id: number | null; geojson: GeoJSON.Point | null; year_funded: number }[];
};

const TOTAL = seed.interventions.length;
const LOCATED = seed.interventions.filter((r) => r.geojson).length;
const gasan = seed.municipalities.find((m) => m.name === 'Gasan')!;
const inGasan = seed.interventions.filter((r) => r.municipality_id === gasan.id);
const busiest = (() => {
  const counts = new Map<number, number>();
  for (const link of seed.intervention_barangays) counts.set(link.barangay_id, (counts.get(link.barangay_id) ?? 0) + 1);
  const [id, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return { barangay: seed.barangays.find((b) => b.id === id)!, count };
})();

const dialog = (page: Page) => page.getByRole('dialog');
const toolbarExport = (page: Page) => page.getByRole('button', { name: 'Export', exact: true });
const summary = (page: Page) => dialog(page).locator('.export-count');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function open(page: Page, path = '/', role?: string) {
  if (role) await page.addInitScript((value) => localStorage.setItem('da-local-role', value), role);
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
  await page.goto(path);
  await expect(page.locator('.barangay-shape')).toHaveCount(218);
}

// On a phone, the filters are in a drawer.
async function withFilters(page: Page, change: () => Promise<unknown>) {
  const toggle = page.getByRole('button', { name: 'Layers and filters' });
  const drawer = await toggle.isVisible();
  if (drawer) await toggle.click();
  await change();
  if (drawer) await page.getByRole('button', { name: 'Close layers' }).click();
}

const filterToGasan = (page: Page) => withFilters(page, () => page.getByRole('combobox', { name: /^Municipality/ }).selectOption(String(gasan.id)));

async function download(page: Page): Promise<Download> {
  const started = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Download' }).click();
  const file = await started;
  await expect(dialog(page)).toHaveCount(0);
  return file;
}

const bytesOf = async (file: Download) => readFile((await file.path())!);
const auditEntries = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ action: string; table_name: string; context: Record<string, unknown> }[]>((resolve, reject) => {
        const opening = indexedDB.open('da-intervention-map-local');
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const reading = opening.result.transaction('state').objectStore('state').get('current');
          reading.onerror = () => reject(reading.error);
          reading.onsuccess = () => resolve(reading.result.rows.auditLog);
        };
      }),
  );

test('offers Export on the toolbar, and shows the count before anything downloads', async ({ page }) => {
  await open(page);
  await toolbarExport(page).click();
  await expect(dialog(page).getByRole('heading', { name: 'Export' })).toBeVisible();
  await expect(summary(page)).toHaveText(`${TOTAL} records`);
  await expect(dialog(page)).toContainText('The whole province');
  await expect(dialog(page)).toContainText(`${LOCATED} on the map`);
  await expect(dialog(page)).toContainText(`${TOTAL - LOCATED} records without coordinates`);
  await expect(dialog(page).locator('.export-file-name')).toHaveText(`Marinduque_Province_${today}.kmz`);

  await dialog(page).getByRole('button', { name: 'Close export' }).click();
  await expect(dialog(page)).toHaveCount(0);
});

test('Export stands out, right beside "+ Add intervention"', async ({ page }) => {
  await open(page);
  const add = (await page.locator('.add-record-button').boundingBox())!;
  const button = (await toolbarExport(page).boundingBox())!;
  if (await page.getByRole('button', { name: 'Layers and filters' }).isVisible()) {
    // Stacked on a phone, at the same width.
    expect(button.y - (add.y + add.height)).toBeLessThanOrEqual(8);
    expect(button.width).toBeCloseTo(add.width, 0);
  } else {
    expect(Math.abs(button.y - add.y)).toBeLessThan(1);
    expect(button.x - (add.x + add.width)).toBeLessThanOrEqual(8);
  }
  expect(button.height).toBeCloseTo(add.height, 0);
  await expect(toolbarExport(page)).toHaveCSS('color', 'rgb(20, 83, 45)');
  await expect(toolbarExport(page)).toHaveCSS('border-top-color', 'rgb(20, 83, 45)');
  await expect(toolbarExport(page)).toHaveCSS('border-top-width', '2px');
  await expect(toolbarExport(page).locator('svg')).toBeVisible();
});

test('the toolbar buttons all fit, without covering each other', async ({ page }) => {
  await open(page);
  const boxes = await Promise.all([toolbarExport(page), page.locator('.add-record-button')].map((button) => button.boundingBox()));
  const toggle = page.getByRole('button', { name: 'Layers and filters' });
  if (await toggle.isVisible()) boxes.push(await toggle.boundingBox());
  const viewport = page.viewportSize()!;
  for (const box of boxes) {
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i]!, boxes[j]!];
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      expect(apart, `buttons ${i} and ${j}`).toBe(true);
    }
  }
});

test('the dialog fits a phone, and can reach its Download button', async ({ page }) => {
  await open(page);
  await toolbarExport(page).click();
  await dialog(page).getByLabel('KMZ').check();
  const button = dialog(page).getByRole('button', { name: 'Download' });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
  const box = (await dialog(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('a filter on the map narrows the map, the count and the file together', async ({ page }) => {
  await open(page);
  await filterToGasan(page);

  await expect(page.locator('.legend-summary')).toContainText(`of ${seed.barangays.filter((b) => b.municipality_id === gasan.id).length} barangays`);

  await toolbarExport(page).click();
  await expect(summary(page)).toHaveText(`${inGasan.length} records`);
  await expect(dialog(page)).toContainText('Municipality: Gasan');
  await dialog(page).getByLabel('CSV').check();
  await expect(dialog(page)).not.toContainText('without coordinates can\'t be plotted');

  const file = await download(page);
  expect(file.suggestedFilename()).toBe(`Marinduque_Gasan_${today}.csv`);
  const bytes = await bytesOf(file);
  expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  const rows = Papa.parse<Record<string, string>>(bytes.toString('utf8').replace(/^﻿/, ''), { header: true, skipEmptyLines: true }).data;
  expect(rows).toHaveLength(inGasan.length);
  expect(new Set(rows.map((row) => row.Municipality))).toEqual(new Set(['Gasan']));
  expect(rows.map((row) => row['Record ID']).sort()).toEqual(inGasan.map((r) => r.id).sort());
});

test('clearing the filters brings the rest back', async ({ page }) => {
  await open(page);
  await filterToGasan(page);
  await withFilters(page, () => page.getByRole('button', { name: 'Clear filters' }).click());
  await toolbarExport(page).click();
  await expect(summary(page)).toHaveText(`${TOTAL} records`);
});

test('a KMZ made in the browser has its folders, icons, layers and left-out list', async ({ page }) => {
  await open(page);
  await filterToGasan(page);
  await toolbarExport(page).click();
  await dialog(page).getByLabel('Municipal boundaries').check();
  await dialog(page).getByLabel('Barangay boundaries').check();
  await dialog(page).getByLabel('Barangay gap map').check();

  const file = await download(page);
  expect(file.suggestedFilename()).toBe(`Marinduque_Gasan_${today}.kmz`);
  const zip = await JSZip.loadAsync(await bytesOf(file));
  expect(Object.keys(zip.files)[0]).toBe('doc.kml');

  const kml = await zip.files['doc.kml'].async('string');
  for (const [, href] of kml.matchAll(/<href>([^<]+)<\/href>/g)) {
    const icon = await zip.files[href].async('uint8array');
    expect(Array.from(icon.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(icon.length).toBeGreaterThan(500); // really drawn, not a blank square
  }

  const located = inGasan.filter((r) => r.geojson);
  const features = kmlToGeoJson(new DOMParser().parseFromString(kml, 'text/xml') as unknown as Document).features;
  const recordFeatures = features.filter((f) => f.properties?.RecordId);
  expect(recordFeatures.map((f) => f.properties?.RecordId).sort()).toEqual(located.map((r) => r.id).sort());
  expect(kml).toContain('<name>Municipal boundaries</name>');
  expect(kml).toContain('<Folder><name>Barangay gap map</name><visibility>0</visibility>');
  expect(kml).toContain('<Folder><name>Read me – legend and unlocated records</name>');
  expect(Object.keys(zip.files)).toContain('icons/read-me.png');
  expect(kml).toContain(`Left out, as they have no coordinates (${inGasan.length - located.length})`);
  expect(kml).toContain('DA Interventions – Gasan, Marinduque');
});

test('points out a record outside Marinduque, and files it in the QA folder', async ({ page }) => {
  await open(page);
  await toolbarExport(page).click();
  await expect(dialog(page)).toContainText('1 record with coordinates outside Marinduque goes in the folder "QA – needs location check"');
  const zip = await JSZip.loadAsync(await bytesOf(await download(page)));
  expect(await zip.files['doc.kml'].async('string')).toContain('<Folder><name>QA – needs location check</name>');

  await toolbarExport(page).click();
  await dialog(page).getByLabel('CSV').check();
  await expect(dialog(page)).toContainText('marked in the first column');
  const rows = Papa.parse<Record<string, string>>((await bytesOf(await download(page))).toString('utf8').replace(/^\ufeff/, ''), { header: true, skipEmptyLines: true });
  expect(rows.meta.fields?.[0]).toBe('QA – needs location check');
  expect(rows.data.filter((row) => row['QA – needs location check'])).toHaveLength(1);
  expect(rows.data).toHaveLength(TOTAL);
});

test('a Shapefile and GeoJSON download whole', async ({ page }) => {
  await open(page);
  await toolbarExport(page).click();
  await dialog(page).getByLabel('Shapefile').check();
  await expect(dialog(page)).toContainText('in a text file in the .zip');
  const shapefile = await download(page);
  expect(shapefile.suggestedFilename()).toBe(`Marinduque_Province_${today}.zip`);
  const zip = await JSZip.loadAsync(await bytesOf(shapefile));
  const stem = `Marinduque_Province_${today}`;
  for (const extension of ['shp', 'shx', 'dbf', 'prj', 'cpg']) expect(zip.files[`${stem}.${extension}`], extension).toBeTruthy();
  expect(zip.files['fields.txt']).toBeTruthy();
  const collection = await readShapefile(await zip.files[`${stem}.shp`].async('uint8array'), await zip.files[`${stem}.dbf`].async('uint8array'), { encoding: 'utf-8' });
  expect(collection.features).toHaveLength(LOCATED);

  await toolbarExport(page).click();
  await dialog(page).getByLabel('GeoJSON').check();
  const geojson = await download(page);
  expect(geojson.suggestedFilename()).toBe(`Marinduque_Province_${today}.geojson`);
  const parsed = JSON.parse((await bytesOf(geojson)).toString('utf8')) as GeoJSON.FeatureCollection;
  expect(parsed.features).toHaveLength(TOTAL);
});

test('Export this barangay takes what its profile lists', async ({ page }) => {
  await open(page, `/barangays/${busiest.barangay.id}`);
  const profile = page.getByLabel(/^Profile of barangay/);
  await profile.getByRole('button', { name: 'Export this barangay' }).click();
  await expect(dialog(page).getByRole('heading', { name: `Export ${busiest.barangay.name}` })).toBeVisible();
  await expect(summary(page)).toHaveText(`${busiest.count} record${busiest.count === 1 ? '' : 's'}`);
  await dialog(page).getByLabel('GeoJSON').check();

  const municipality = seed.municipalities.find((m) => m.id === busiest.barangay.municipality_id)!.name;
  const file = await download(page);
  expect(file.suggestedFilename()).toContain(`Marinduque_${municipality.replace(/ /g, '')}_${busiest.barangay.name.replace(/[^A-Za-z0-9]/g, '')}_`);
  const parsed = JSON.parse((await bytesOf(file)).toString('utf8')) as GeoJSON.FeatureCollection;
  const linked = seed.intervention_barangays.filter((l) => l.barangay_id === busiest.barangay.id).map((l) => l.intervention_id);
  expect(parsed.features.map((f) => f.id).sort()).toEqual(linked.sort());
});

test('a barangay export still follows the other filters, and says which', async ({ page }) => {
  await open(page, `/barangays/${busiest.barangay.id}`);
  const years = seed.interventions.map((r) => r.year_funded).sort((a, b) => a - b);
  const latest = years.at(-1)!;
  await withFilters(page, () => page.getByRole('combobox', { name: /^Year from/ }).selectOption(String(latest)));
  const profile = page.getByLabel(/^Profile of barangay/);
  await profile.getByRole('button', { name: 'Export this barangay' }).click();
  await expect(dialog(page)).toContainText(`Year funded: From ${latest}`);
  const linked = new Set(seed.intervention_barangays.filter((l) => l.barangay_id === busiest.barangay.id).map((l) => l.intervention_id));
  const expected = seed.interventions.filter((r) => linked.has(r.id) && r.year_funded >= latest).length;
  await expect(summary(page)).toHaveText(`${expected} record${expected === 1 ? '' : 's'}`);
});

test('can limit to the map view, which leaves out what has no coordinates', async ({ page }) => {
  await open(page, `/barangays/${busiest.barangay.id}`);
  await page.getByRole('button', { name: 'Close profile' }).click();
  await toolbarExport(page).click();
  await expect(summary(page)).toHaveText(`${TOTAL} records`);
  await dialog(page).getByLabel('Only what\'s in the current map view').check();

  const shown = Number((await summary(page).innerText()).split(' ')[0]);
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(TOTAL);
  await expect(dialog(page).locator('.export-file-name')).toContainText('_MapView_');
  await expect(dialog(page)).not.toContainText('without coordinates can\'t be plotted');

  await dialog(page).getByLabel('GeoJSON').check();
  const parsed = JSON.parse((await bytesOf(await download(page))).toString('utf8')) as GeoJSON.FeatureCollection;
  expect(parsed.features).toHaveLength(shown);
  expect(parsed.features.every((f) => f.geometry !== null)).toBe(true);
});

test('says when there is nothing to export, and won\'t download', async ({ page }) => {
  const noCoordinates = seed.interventions.find((r) => !r.geojson && r.barangay_id !== null);
  test.skip(!noCoordinates, 'needs an unlocated record in a barangay');
  await open(page, `/barangays/${noCoordinates!.barangay_id}`);
  const located = seed.interventions.filter((r) => r.barangay_id === noCoordinates!.barangay_id && r.geojson);
  test.skip(located.length > 0, 'needs a barangay whose records are all unlocated');
  await page.getByLabel(/^Profile of barangay/).getByRole('button', { name: 'Export this barangay' }).click();
  await expect(dialog(page)).toContainText('None of these have coordinates');
  await expect(dialog(page).getByRole('button', { name: 'Download' })).toBeDisabled();
  await dialog(page).getByLabel('CSV').check();
  await expect(dialog(page).getByRole('button', { name: 'Download' })).toBeEnabled();
});

test('every role can export, and each export goes in the log', async ({ page }) => {
  for (const [role, format, extension] of [['viewer', 'CSV', 'csv'], ['encoder', 'GeoJSON', 'geojson'], ['admin', 'KML', 'kml']] as const) {
    await page.addInitScript((value) => localStorage.setItem('da-local-role', value), role);
    await open(page);
    const before = (await auditEntries(page)).filter((entry) => entry.action === 'export').length;
    await filterToGasan(page);
    await toolbarExport(page).click();
    await dialog(page).getByLabel(format, { exact: false }).first().check();
    const file = await download(page);

    const exports = (await auditEntries(page)).filter((entry) => entry.action === 'export');
    expect(exports).toHaveLength(before + 1);
    expect(exports.at(-1)).toMatchObject({
      table_name: 'exports',
      context: {
        format: extension,
        file_name: file.suggestedFilename(),
        record_count: inGasan.length,
        filters: { municipality: 'Gasan' },
      },
    });
  }
});

test('an export doesn\'t count as a local change', async ({ page }) => {
  await open(page);
  await toolbarExport(page).click();
  await dialog(page).getByLabel('CSV').check();
  await download(page);
  const changes = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const opening = indexedDB.open('da-intervention-map-local');
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const reading = opening.result.transaction('state').objectStore('state').get('current');
          reading.onerror = () => reject(reading.error);
          reading.onsuccess = () => resolve(reading.result.rows.changeCount);
        };
      }),
  );
  expect(changes).toBe(0);
});

test('a marker on the map draws its category\'s icon', async ({ page }) => {
  const category = seed.lookups.categories.find((c) => c.name === 'Hand Tractor (Walking-type)')!;
  const icon = seed.lookups.icons.find((i) => i.id === category.icon_id)!;
  expect(icon.name).toBe('Tractor');
  const beneficiaries = new Map<string, number>();
  for (const r of seed.interventions) beneficiaries.set(r.beneficiary, (beneficiaries.get(r.beneficiary) ?? 0) + 1);
  const record = seed.interventions.find((r) => r.category_id === category.id && r.geojson && r.barangay_id !== null && beneficiaries.get(r.beneficiary) === 1)!;

  await open(page, `/barangays/${record.barangay_id}`);
  await page.getByLabel(/^Profile of barangay/).locator('.record-row').filter({ hasText: record.beneficiary }).locator('.record-name').click();
  await expect(page.locator('.record-popup').filter({ hasText: record.beneficiary })).toBeVisible();

  const drawing = icon.image.match(/<path d="([^"]+)"/)![1];
  const sources = await page.locator('.intervention-marker img').evaluateAll((images) => images.map((image) => decodeURIComponent((image as HTMLImageElement).src)));
  expect(sources.some((source) => source.includes(drawing))).toBe(true);
});
