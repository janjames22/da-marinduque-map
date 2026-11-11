// Reports in local mode, at desktop and phone sizes: who is offered them, each report on screen and as
// its file, read back as a person's viewer would, the print map, the signature blocks an Admin edits, and
// every download in the export log. tests/reports.test.ts covers the rules against the real database.
import { readFileSync } from 'node:fs';
import { expect, test, type Download, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { sidebar } from './helpers/shell';

interface SeedRecord {
  id: string;
  beneficiary: string;
  municipality_id: number;
  banner_program_id: number | null;
  year_funded: number | null;
  barangay_id: number | null;
  geojson: unknown;
  deleted_at: string | null;
}
const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as {
  interventions: SeedRecord[];
  municipalities: { id: number; name: string }[];
  lookups: { programs: { id: number; code: string }[] };
};
const boac = seed.municipalities.find((municipality) => municipality.name === 'Boac')!;
const inBoac = seed.interventions.filter((record) => record.deleted_at === null && record.municipality_id === boac.id).length;
const counts = new Map<string, number>();
for (const record of seed.interventions) counts.set(record.beneficiary, (counts.get(record.beneficiary) ?? 0) + 1);
// Someone with more than one intervention, on the map, so its popup can be opened from a barangay.
const repeat = seed.interventions.find((record) => record.geojson && record.barangay_id !== null && (counts.get(record.beneficiary) ?? 0) >= 2)!;

// A year some record has, but no rice record in Boac.
const rice = seed.lookups.programs.find((program) => program.code === 'rice')!;
const boacRiceYears = new Set(seed.interventions.filter((record) => record.municipality_id === boac.id && record.banner_program_id === rice.id).map((record) => record.year_funded));
const emptyYear = [...new Set(seed.interventions.map((record) => record.year_funded))].find((year) => year !== null && !boacRiceYears.has(year))!;

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

async function open(page: Page, path: string, role?: string) {
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
  if (role) await page.addInitScript((value) => localStorage.setItem('da-local-role', value), role);
  await page.goto(path);
}

async function pdfText(download: Download): Promise<{ pages: string[]; size: { width: number; height: number } }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(readFileSync((await download.path())!));
  const pdf = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  const pages: string[] = [];
  const view = (await pdf.getPage(1)).getViewport({ scale: 1 });
  for (let number = 1; number <= pdf.numPages; number++) {
    const content = await (await pdf.getPage(number)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' '));
  }
  return { pages, size: { width: Math.round(view.width), height: Math.round(view.height) } };
}

async function downloading(page: Page, click: () => Promise<void>): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  return download;
}

const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test.describe('who is offered them', () => {
  const WHO: Record<string, string> = { admin: 'an Admin', encoder: 'an Encoder', viewer: 'a Viewer' };
  for (const role of ['admin', 'encoder', 'viewer']) {
    test(`${WHO[role]} gets Reports, with the signature blocks that print`, async ({ page }) => {
      await open(page, '/map', role);
      await expect(page.locator('.barangay-shape')).toHaveCount(218);
      await (await sidebar(page)).getByRole('link', { name: 'Reports' }).click();
      await expect(page).toHaveURL(/\/reports$/);
      const overview = section(page, 'Reports');
      await expect(overview.getByRole('link')).toContainText(['Municipal profile', 'Beneficiary profile', 'Inventory report']);
      await expect(overview.locator('.signature-list li')).toHaveText(['Prepared by: Engr. Jan James P. Graza, Agricultural and Biosystems Engineer', 'Noted by: Susana Arellano-Uy, RAgr., MPA, OIC Provincial Agriculturist']);
      await expect(overview.getByRole('link', { name: /Change them in Admin/ })).toHaveCount(role === 'admin' ? 1 : 0);
      const nav = await sidebar(page);
      await expect(nav.getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
      await nav.getByRole('link', { name: 'Map', exact: true }).click();
      await expect(page.locator('.barangay-shape')).toHaveCount(218);
    });
  }
});

test.describe('the reports', () => {
  test('a municipal profile is shown, and downloads as one A4 page with its signatures, logged as an export', async ({ page }) => {
    await open(page, '/reports/municipality');
    const report = section(page, 'Municipal profile');
    await report.getByLabel('Municipality').selectOption({ label: 'Boac' });
    await expect(page).toHaveURL(new RegExp(`/reports/municipality/${boac.id}$`));
    await expect(report.getByRole('img', { name: /Map of Boac/ })).toBeVisible();
    await expect(report.getByRole('list', { name: 'Map legend' })).toContainText('Barangay with an intervention');
    await expect(report.locator('.report-figures div').first()).toHaveText(`Interventions${inBoac}`);
    await expect(report.getByRole('table', { name: 'By program' })).toBeVisible();
    await expect(report.getByRole('region', { name: 'Barangays with no intervention yet' })).toContainText(/\d/);

    const download = await downloading(page, () => report.getByRole('button', { name: 'Download PDF' }).click());
    expect(download.suggestedFilename()).toBe(`Profile_Boac_${today}.pdf`);
    const { pages, size } = await pdfText(download);
    expect(size).toEqual({ width: 595, height: 842 });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('MUNICIPAL PROFILE: BOAC');
    expect(pages[0]).toContain(`${inBoac} interventions`);
    expect(pages[0]).toContain('Prepared by: Engr. Jan James P. Graza');

    await (await sidebar(page)).getByRole('link', { name: 'Users' }).click();
    await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Audit log' }).click();
    await expect(page.locator('tr[data-audit-entry]').first()).toContainText(`Profile_Boac_${today}.pdf`);
  });

  test('the inventory is chosen by municipality, program and year, and downloads as a PDF and a workbook', async ({ page }) => {
    await open(page, '/reports/inventory');
    const report = section(page, 'Inventory report');
    await expect(report.getByRole('status')).toHaveText('199 records, 199 units.');
    await report.getByLabel('Municipality').selectOption({ label: 'Boac' });
    await report.getByLabel('Banner program').selectOption({ label: 'Rice Program' });
    await expect(report.locator('.report-heading')).toContainText('Municipality of Boac, Province of Marinduque');
    await expect(report.locator('.report-heading')).toContainText('Banner program: Rice Program');
    const shown = Number((await report.getByRole('status').textContent())!.match(/^(\d+)/)![1]);
    expect(shown).toBeGreaterThan(0);
    await expect(report.locator('.report-table thead th').first()).toHaveText(/Machine Name|Project Type/);

    const pdf = await downloading(page, () => report.getByRole('button', { name: 'Download PDF' }).click());
    expect(pdf.suggestedFilename()).toBe(`Inventory_Boac_RiceProgram_${today}.pdf`);
    const { pages, size } = await pdfText(pdf);
    expect(size).toEqual({ width: 1008, height: 612 });
    expect(pages[0]).toContain('CONSOLIDATED INVENTORY REPORT');
    expect(pages[0]).toContain('Municipality of Boac, Province of Marinduque');
    expect(pages.join(' ').split('MIMAROPA').length - 1).toBe(shown);
    expect(pages.at(-1)).toContain('Noted by: Susana Arellano-Uy, RAgr., MPA');

    const workbook = await downloading(page, () => report.getByRole('button', { name: 'Download Excel' }).click());
    expect(workbook.suggestedFilename()).toBe(`Inventory_Boac_RiceProgram_${today}.xlsx`);
    const book = XLSX.read(readFileSync((await workbook.path())!), { type: 'buffer' });
    const grid = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Inventory, { header: 1, defval: null });
    expect(grid[0][0]).toBe('CONSOLIDATED INVENTORY REPORT');
    expect(grid.filter((row) => row[5] === 'MIMAROPA (Region IV-B)' || row[6] === 'MIMAROPA (Region IV-B)')).toHaveLength(shown);

    await report.getByLabel('Year funded').selectOption(String(emptyYear));
    await expect(report.getByRole('status')).toHaveText('No records match these choices.');
    await expect(report.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  });

  test('a beneficiary\'s profile opens from a record\'s popup, lists what they received, and downloads', async ({ page }) => {
    await open(page, `/barangays/${repeat.barangay_id}`, 'viewer');
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    const profile = page.getByLabel(/^Profile of barangay/);
    await profile.locator('.record-row').filter({ hasText: repeat.beneficiary }).first().locator('.record-name').click();
    const popup = page.locator('.leaflet-popup-content');
    await popup.getByRole('link', { name: 'All for this beneficiary' }).click();
    await expect(page).toHaveURL(/\/reports\/beneficiary\/[^/]+$/);
    const report = section(page, 'Beneficiary profile');
    await expect(report.locator('.report-heading strong')).toHaveText(repeat.beneficiary.trim());
    await expect(report.locator('.beneficiary-records > li')).toHaveCount(counts.get(repeat.beneficiary)!);
    await expect(report.locator('.status-timeline').first()).toContainText('(RAED report)');

    const download = await downloading(page, () => report.getByRole('button', { name: 'Download PDF' }).click());
    // The name stays out of the file name, as it can be a person's.
    expect(download.suggestedFilename()).toBe(`Beneficiary_profile_${today}.pdf`);
    const text = (await pdfText(download)).pages.join(' ');
    expect(text).toContain('BENEFICIARY PROFILE');
    expect(text).toContain('Status history');

    await report.getByRole('link', { name: 'Show on the map' }).first().click();
    await expect(page).toHaveURL(/\/records\//);
  });

  test('the beneficiary list finds one by part of a name or a municipality', async ({ page }) => {
    await open(page, '/reports/beneficiary');
    const report = section(page, 'Beneficiary profile');
    const all = Number((await report.getByRole('status').textContent())!.match(/^(\d+)/)![1]);
    expect(all).toBeGreaterThan(100);
    await report.getByLabel('Find a beneficiary').fill('Boac');
    const inBoacCount = Number((await report.getByRole('status').textContent())!.match(/^(\d+)/)![1]);
    expect(inBoacCount).toBeLessThan(all);
    await report.getByLabel('Find a beneficiary').fill('nothing like this at all');
    await expect(report.getByRole('status')).toHaveText('No beneficiary matches.');
    await page.goto('/reports/beneficiary/nobodyatall');
    await expect(report.getByRole('alert')).toContainText('No beneficiary on the map has that name any more.');
  });

  test('the map prints as it is, with its title, legend, scale, date, sources and signatures', async ({ page }) => {
    await open(page, '/map');
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await page.getByRole('button', { name: 'Print map' }).click();
    const dialog = page.getByRole('dialog', { name: 'Print map' });
    await expect(dialog.getByLabel('Title')).toHaveValue('DA Interventions in Marinduque');
    await dialog.getByLabel('Title').fill('Interventions for the PAO meeting');
    await dialog.getByLabel('Paper').selectOption('letter');
    const download = await downloading(page, () => dialog.getByRole('button', { name: 'Download PDF' }).click());
    await expect(dialog).toHaveCount(0);
    expect(download.suggestedFilename()).toBe(`Map_Marinduque_Province_${today}.pdf`);
    const { pages, size } = await pdfText(download);
    expect(size).toEqual({ width: 792, height: 612 });
    expect(pages[0]).toContain('Interventions for the PAO meeting');
    expect(pages[0]).toContain('Markers by program');
    expect(pages[0]).toMatch(/\d+ km/);
    expect(pages[0]).toContain('Date: ');
    expect(pages[0]).toContain('Data: Intervention Map records (RAED 2026-10-21)');
    // The tiles are blocked in tests, so the basemap is just not there, not refused.
    expect(pages[0]).toContain('Basemap: © OpenStreetMap contributors');
    expect(pages[0]).toContain('Noted by:');
  });
});

test.describe('signature blocks', () => {
  test('an Admin changes, adds, archives and reorders them, and the reports follow', async ({ page }) => {
    await open(page, '/admin/signatures');
    const list = page.getByRole('region', { name: 'Report signatures' });
    await expect(list.locator('.admin-row')).toHaveCount(2);

    await list.locator('.admin-row').filter({ hasText: 'Susana Arellano-Uy' }).getByRole('button', { name: /^Edit/ }).click();
    const editing = page.getByRole('form', { name: /^Edit Susana/ });
    await editing.getByLabel(/^Position/).fill('Provincial Agriculturist');
    await editing.getByRole('button', { name: 'Save' }).click();
    await expect(list.locator('.admin-row').filter({ hasText: 'Susana Arellano-Uy' })).toContainText('Noted by · Provincial Agriculturist');

    await list.getByRole('button', { name: '+ Add signature' }).click();
    const adding = page.getByRole('form', { name: 'Add signature' });
    await adding.getByRole('button', { name: 'Save' }).click();
    await expect(adding).toContainText('Enter a label, such as "Prepared by".');
    await adding.getByLabel(/^Label/).fill('Approved by');
    await adding.getByLabel(/^Name/).fill('Juan dela Cruz');
    await adding.getByRole('button', { name: 'Save' }).click();
    await expect(list.locator('.admin-row')).toHaveCount(3);

    // First in line now, then the Prepared by is archived.
    await list.getByRole('button', { name: 'Move Juan dela Cruz up' }).click();
    await list.getByRole('button', { name: 'Move Juan dela Cruz up' }).click();
    await list.locator('.admin-row').filter({ hasText: 'Engr. Jan James P. Graza' }).getByRole('button', { name: /^Archive/ }).click();
    await expect(page.locator('.admin-notice')).toContainText('is archived');
    await expect(list.locator('.admin-row-archived')).toHaveCount(1);

    await page.goto('/reports');
    await expect(section(page, 'Reports').locator('.signature-list li')).toHaveText(['Approved by: Juan dela Cruz', 'Noted by: Susana Arellano-Uy, RAgr., MPA, Provincial Agriculturist']);
    await page.goto('/reports/inventory');
    const download = await downloading(page, () => section(page, 'Inventory report').getByRole('button', { name: 'Download PDF' }).click());
    const last = (await pdfText(download)).pages.at(-1)!;
    expect(last).toContain('Approved by: Juan dela Cruz');
    expect(last).toContain('Noted by: Susana Arellano-Uy, RAgr., MPA Provincial Agriculturist');
    expect(last).not.toContain('Engr. Jan James P. Graza');
    expect(last.indexOf('Approved by')).toBeLessThan(last.indexOf('Noted by'));
  });

  test('nobody but an Admin is offered to change them', async ({ page }) => {
    await open(page, '/admin/signatures', 'encoder');
    await expect(page.getByRole('alert')).toContainText('This page is for Admins');
  });
});
