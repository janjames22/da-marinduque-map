// The QA and import pages in local mode, at desktop and phone sizes: who is offered them, the QA queue's
// quick fixes, the condition check, and the import wizard from a file to undoing it. tests/import.test.ts
// covers the rules against the real database, and e2e/auth.spec.ts the calls under the real security headers.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { sidebar } from './helpers/shell';

interface SeedRecord {
  id: string;
  source_id: string;
  beneficiary: string;
  municipality_id: number;
  barangay_id: number | null;
  plotted_barangay_id: number | null;
  status_id: number | null;
  quantity: number;
  qa_flags: string[];
  geojson: { type: string; coordinates: number[] } | null;
  deleted_at: string | null;
}
const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as {
  interventions: SeedRecord[];
  barangays: { id: number; name: string; municipality_id: number }[];
  municipalities: { id: number; name: string }[];
  lookups: { statuses: { id: number; name: string; counts_as_assessed: boolean }[] };
};

const FLAG_ORDER = ['out_of_province', 'no_coords', 'barangay_unmatched', 'no_barangay', 'muni_mismatch', 'barangay_mismatch', 'beneficiary_name_check', 'duplicate_point'];
const live = seed.interventions.filter((record) => record.deleted_at === null);
const flagCount = (flag: string, municipalityId?: number) => live.filter((record) => record.qa_flags.includes(flag) && (municipalityId === undefined || record.municipality_id === municipalityId)).length;
const totalFlags = live.reduce((sum, record) => sum + record.qa_flags.length, 0);

const boac = seed.municipalities.find((municipality) => municipality.name === 'Boac')!;
const turnedOver = seed.lookups.statuses.find((status) => status.name === 'Turned-over')!;
const waitingIn = (municipalityId?: number) => live.filter((record) => record.status_id === turnedOver.id && (municipalityId === undefined || record.municipality_id === municipalityId));

const mismatches = live.filter((record) => record.qa_flags.join() === 'barangay_mismatch' && record.plotted_barangay_id !== null);
const unlocated = live.find((record) => record.qa_flags.join() === 'no_coords' && record.status_id === turnedOver.id)!;
const clean = live.find((record) => record.qa_flags.length === 0 && record.geojson?.type === 'Point' && record.barangay_id !== null)!;
const cleanBarangay = seed.barangays.find((barangay) => barangay.id === clean.barangay_id)!;
const cleanMunicipality = seed.municipalities.find((municipality) => municipality.id === cleanBarangay.municipality_id)!;
// Near a record that isn't flagged, so in the same barangay, without sharing its point.
const [cleanLng, cleanLat] = clean.geojson!.coordinates;
const nearby = { lat: (cleanLat + 0.00003).toFixed(7), lng: (cleanLng + 0.00003).toFixed(7) };
const boacBarangay = seed.barangays.find((barangay) => barangay.municipality_id === boac.id)!;

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

const form = (page: Page, name: string | RegExp) => page.getByRole('form', { name });
const queueItem = (page: Page, id: string, flag: string) => page.locator(`.queue-item[data-record="${id}"][data-flag="${flag}"]`);
const group = (page: Page, flag: string) => page.locator(`.queue-group[data-flag="${flag}"]`);
const notice = (page: Page) => page.locator('.admin-notice');
// A select inside its label is named with its choice too, such as "Flag All flags (100)".
const filter = (page: Page, of: 'queue' | 'units', name: string) => form(page, `Filter the ${of}`).getByRole('combobox', { name: new RegExp(`^${name}`) });

async function open(page: Page, path: string, role?: string) {
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
  if (role) await page.addInitScript((value) => localStorage.setItem('da-local-role', value), role);
  await page.goto(path);
}

async function openQueue(page: Page) {
  await open(page, '/qa');
  await expect(page.getByRole('region', { name: 'QA queue' })).toBeVisible();
}

async function filterQueue(page: Page, search: string) {
  await page.getByRole('form', { name: 'Filter the queue' }).getByRole('searchbox').fill(search);
}

async function chooseFile(page: Page, name: string, contents: string | Buffer, type = 'Farm Machinery', source = 'E2E export') {
  const step = form(page, 'Choose a file');
  await step.getByLabel(/^What the file lists/).selectOption({ label: type });
  await step.getByLabel(/^Where it came from/).fill(source);
  await step.getByLabel(/^File/).setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.isBuffer(contents) ? contents : Buffer.from(contents) });
  await expect(step.getByRole('status')).toContainText(/read/);
  await step.getByRole('button', { name: 'Next: columns' }).click();
  await expect(form(page, 'Match the columns')).toBeVisible();
}

const fieldFor = (page: Page, column: string) => page.getByRole('combobox', { name: `Field for ${column}` });

async function importIt(page: Page, records: number) {
  await page.getByRole('button', { name: `Import ${records} record${records === 1 ? '' : 's'}` }).click();
  await expect(page.getByRole('heading', { name: `Imported ${records} record${records === 1 ? '' : 's'}` })).toBeVisible();
}

const csv = (rows: string[][]) => rows.map((row) => row.map((cell) => (/[",]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(',')).join('\n') + '\n';
const HEADER = ['Ref No', 'Recipient Group', 'Equipment', 'Program', 'Year', 'Municipality', 'Barangay', 'Latitude', 'Longitude'];

test.describe('who is offered it', () => {
  for (const role of ['admin', 'encoder']) {
    test(`an ${role === 'admin' ? 'Admin' : 'Encoder'} gets a link there and back`, async ({ page }) => {
      await open(page, '/', role);
      await expect(page.locator('.barangay-shape')).toHaveCount(218);
      const nav = await sidebar(page);
      await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(role === 'admin' ? 1 : 0);
      await nav.getByRole('link', { name: 'QA queue' }).click();
      await expect(page).toHaveURL(/\/qa$/);
      const sections = page.getByRole('navigation', { name: 'QA and import' });
      await expect(sections.getByRole('link')).toHaveText(['QA queue', 'Condition check', 'Import']);
      await sections.getByRole('link', { name: 'Import' }).click();
      await expect(page.getByRole('region', { name: 'Import', exact: true })).toBeVisible();
      // The RAED file was loaded by script, so it can't be undone here.
      await expect(page.getByRole('region', { name: 'Earlier imports' })).toContainText('Loaded by script');
      await expect(page.getByRole('button', { name: 'Undo this import' })).toHaveCount(0);
      await (await sidebar(page)).getByRole('link', { name: 'Map', exact: true }).click();
      await expect(page.locator('.barangay-shape')).toHaveCount(218);
    });
  }

  test('a Viewer isn\'t, even by going straight to the address', async ({ page }) => {
    await open(page, '/', 'viewer');
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await expect((await sidebar(page)).getByRole('link', { name: 'QA queue' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    for (const path of ['/qa', '/qa/condition', '/import']) {
      await page.goto(path);
      await expect(page.getByRole('alert')).toContainText('This page is for Encoders and Admins');
      await expect(page.getByRole('navigation', { name: 'QA and import' })).toHaveCount(0);
    }
  });
});

test.describe('the QA queue', () => {
  test('lists what the checks flagged, worst first, by flag and municipality', async ({ page }) => {
    await openQueue(page);
    const present = FLAG_ORDER.filter((flag) => flagCount(flag) > 0);
    await expect(page.locator('.queue-group')).toHaveCount(present.length);
    expect(await page.locator('.queue-group').evaluateAll((groups) => groups.map((element) => element.getAttribute('data-flag')))).toEqual(present);
    for (const flag of present) await expect(group(page, flag).locator('h3 .count')).toHaveText(String(flagCount(flag)));
    await expect(filter(page, 'queue', 'Flag')).toContainText(`All flags (${totalFlags})`);

    await filter(page, 'queue', 'Municipality').selectOption({ label: 'Boac' });
    for (const flag of FLAG_ORDER.filter((candidate) => flagCount(candidate, boac.id) > 0)) {
      await expect(group(page, flag).locator('h3 .count')).toHaveText(String(flagCount(flag, boac.id)));
      await expect(group(page, flag).locator('.queue-place h4')).toHaveCount(1);
    }
    await filter(page, 'queue', 'Municipality').selectOption({ label: 'All' });
    await filter(page, 'queue', 'Flag').selectOption('barangay_mismatch');
    await expect(page.locator('.queue-group')).toHaveCount(1);
    await expect(page.locator('.queue-item')).toHaveCount(flagCount('barangay_mismatch'));

    await filterQueue(page, mismatches[0].source_id);
    await expect(page.locator('.queue-item')).toHaveCount(1);
    await expect(queueItem(page, mismatches[0].id, 'barangay_mismatch')).toContainText(/Plotted in .*; encoded as/);
  });

  test('dismissing needs a reason, takes the flag out of the queue, and can be undone', async ({ page }) => {
    await openQueue(page);
    const record = mismatches[0];
    const item = queueItem(page, record.id, 'barangay_mismatch');
    await item.getByRole('button', { name: 'Dismiss' }).click();
    const dismiss = form(page, /^Dismiss: /);
    await dismiss.getByRole('button', { name: 'Dismiss' }).click();
    await expect(dismiss).toContainText('Give a reason. It goes in the audit log.');
    await dismiss.getByLabel(/^Reason/).fill('The unit is kept at the FCA office');
    await dismiss.getByRole('button', { name: 'Dismiss' }).click();
    await expect(notice(page)).toContainText('Flag dismissed for');
    await expect(item).toHaveCount(0);
    await expect(group(page, 'barangay_mismatch').locator('h3 .count')).toHaveText(String(flagCount('barangay_mismatch') - 1));
    await expect(filter(page, 'queue', 'Flag')).toContainText(`All flags (${totalFlags - 1})`);

    await page.getByLabel('Show dismissed').check();
    await expect(item).toContainText(`Dismissed by Local user on ${today}: The unit is kept at the FCA office`);
    await expect(item.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
    await item.getByRole('button', { name: 'Put back in the queue' }).click();
    await expect(notice(page)).toContainText('Back in the queue.');
    await expect(item).not.toContainText('Dismissed by');
    await page.getByLabel('Show dismissed').uncheck();
    await expect(item).toBeVisible();
    await expect(group(page, 'barangay_mismatch').locator('h3 .count')).toHaveText(String(flagCount('barangay_mismatch')));
  });

  test('setting the barangay to where the point is clears the flag', async ({ page }) => {
    await openQueue(page);
    const record = mismatches[0];
    const item = queueItem(page, record.id, 'barangay_mismatch');
    await item.getByRole('button', { name: 'Set barangay' }).click();
    const set = form(page, /^Set barangay: /);
    await set.getByRole('button', { name: /^Use where it's plotted: / }).click();
    await expect(set.getByLabel(/^Barangay/)).toHaveValue(String(record.plotted_barangay_id));
    await set.getByRole('button', { name: 'Set barangay' }).click();
    await expect(set).toContainText('Give a reason.');
    await set.getByLabel(/^Reason/).fill('Confirmed by the MAO');
    await set.getByRole('button', { name: 'Set barangay' }).click();
    await expect(notice(page)).toContainText('Barangay set for');
    await expect(page.locator(`.queue-item[data-record="${record.id}"]`)).toHaveCount(0);
    await expect(group(page, 'barangay_mismatch').locator('h3 .count')).toHaveText(String(flagCount('barangay_mismatch') - 1));
  });

  test('setting a location basis dismisses the mismatch with the same reason', async ({ page }) => {
    await openQueue(page);
    const record = mismatches[1];
    const item = queueItem(page, record.id, 'barangay_mismatch');
    await item.getByRole('button', { name: 'Set location basis' }).click();
    const set = form(page, /^Set location basis: /);
    await set.getByLabel(/^Location basis/).selectOption({ label: 'FCA office/storage' });
    await set.getByLabel(/^Reason/).fill('The point is the FCA office in the next barangay');
    await set.getByRole('button', { name: 'Set location basis' }).click();
    await expect(notice(page)).toContainText('and the flag dismissed');
    await expect(item).toHaveCount(0);
    await page.getByLabel('Show dismissed').check();
    await expect(item).toContainText('The point is the FCA office in the next barangay');
  });

  test('a status set from the queue is saved, and the flag stays until the location is fixed', async ({ page }) => {
    await openQueue(page);
    const item = queueItem(page, unlocated.id, 'no_coords');
    await item.getByRole('button', { name: 'Update status' }).click();
    const update = form(page, /^Update status: /);
    await update.getByLabel(/^Status$|^Status \*/).selectOption({ label: 'Serviceable' });
    await expect(update.getByLabel(/^Status date/)).toHaveValue(today);
    await update.getByRole('button', { name: 'Update status' }).click();
    await expect(notice(page)).toContainText('Status updated for');
    await expect(item).toBeVisible();

    // Its condition is known now, so it isn't waiting for a check.
    await page.getByRole('navigation', { name: 'QA and import' }).getByRole('link', { name: 'Condition check' }).click();
    await page.getByRole('form', { name: 'Filter the units' }).getByRole('searchbox').fill(unlocated.source_id);
    await expect(page.getByRole('region', { name: 'Condition check' }).getByRole('status')).toContainText('Nothing waiting here.');
  });

  test('a location is fixed on the map, with the record open to resolve', async ({ page }) => {
    await openQueue(page);
    const record = mismatches[0];
    await queueItem(page, record.id, 'barangay_mismatch').getByRole('link', { name: 'Fix on the map' }).click();
    await expect(page).toHaveURL(new RegExp(`/records/${record.id}`));
    await expect(form(page, 'Resolve flag')).toBeVisible();
    await expect(form(page, 'Resolve flag').getByLabel('Current flags')).toContainText('Point is outside the encoded barangay');
  });
});

test.describe('the condition check', () => {
  test('lists Turned-over units by municipality, and a status set there takes the unit off the list', async ({ page }) => {
    await open(page, '/qa/condition');
    const check = page.getByRole('region', { name: 'Condition check' });
    const units = (records: SeedRecord[]) => records.reduce((sum, record) => sum + record.quantity, 0);
    await expect(filter(page, 'units', 'Status')).toHaveValue(String(turnedOver.id));
    await expect(check.getByRole('status')).toHaveText(`${waitingIn().length} records waiting, ${units(waitingIn())} units.`);
    const waitingAll = live.filter((record) => seed.lookups.statuses.some((status) => status.id === record.status_id && !status.counts_as_assessed)).length;
    await expect(filter(page, 'units', 'Status')).toContainText(`All not yet assessed (${waitingAll})`);
    await filter(page, 'units', 'Status').selectOption('');
    await expect(check.getByRole('status')).toContainText(`${waitingAll} records waiting`);
    await filter(page, 'units', 'Status').selectOption(String(turnedOver.id));

    await filter(page, 'units', 'Municipality').selectOption({ label: 'Boac' });
    await expect(check.getByRole('status')).toHaveText(`${waitingIn(boac.id).length} records waiting, ${units(waitingIn(boac.id))} units.`);
    const first = check.locator('.queue-item').first();
    const id = await first.getAttribute('data-record');
    await expect(first).toContainText(`Turned-over since`);
    await first.getByRole('button', { name: 'Serviceable', exact: true }).click();
    const set = form(page, /^Set Serviceable: /);
    await expect(set.getByLabel(/^Checked on/)).toHaveValue(today);
    await set.getByLabel(/^What was found/).fill('Running, seen on a visit');
    await set.getByRole('button', { name: 'Save as Serviceable' }).click();
    await expect(check.getByRole('status')).toContainText(`${waitingIn(boac.id).length - 1} records waiting`);
    await expect(check.getByRole('status')).toContainText('set to Serviceable.');
    await expect(check.locator(`.queue-item[data-record="${id}"]`)).toHaveCount(0);
  });
});

test.describe('importing', () => {
  test('a CSV goes from columns and values to a checked preview, comes in as one batch, and can be undone', async ({ page }) => {
    await open(page, '/import');
    await chooseFile(
      page,
      'e2e.csv',
      csv([
        HEADER,
        ['E2E-1', 'E2E Test FCA One', 'Hand Tractor (Walking-type)', 'Rice Program', '2025', cleanMunicipality.name, cleanBarangay.name, nearby.lat, nearby.lng],
        ['E2E-2', 'E2E Test FCA Two', 'Rice Thresher', 'RICE PROG', '2024', 'Boac', 'Nowhere Brgy', '', ''],
        ['E2E-3', 'E2E Test FCA Three', 'Seeder', 'Rice Program', 'twenty', 'Boac', boacBarangay.name, '', ''],
      ]),
    );

    // Its own names for the usual columns are found; one the app can't guess is chosen by hand.
    await expect(fieldFor(page, 'Ref No')).toHaveValue('source_id');
    await expect(fieldFor(page, 'Equipment')).toHaveValue('category');
    await expect(fieldFor(page, 'Latitude')).toHaveValue('latitude');
    await expect(fieldFor(page, 'Recipient Group')).toHaveValue('');
    await page.getByRole('button', { name: 'Next: values' }).click();
    await expect(form(page, 'Match the columns').getByRole('alert')).toContainText('Choose a column for Beneficiary');
    await fieldFor(page, 'Recipient Group').selectOption('beneficiary');
    await expect(page.getByLabel(/^Status for rows without one/)).toHaveValue(String(turnedOver.id));
    await page.getByRole('button', { name: 'Next: values' }).click();

    const values = form(page, 'Match the values');
    const program = values.getByRole('combobox', { name: /Banner program: "RICE PROG"/ });
    await expect(program).toBeVisible();
    await values.getByRole('button', { name: 'Next: check' }).click();
    await expect(values.getByRole('alert')).toContainText('Choose for 1 value still.');
    await program.selectOption({ label: 'Rice Program' });
    await values.getByRole('button', { name: 'Next: check' }).click();

    await expect(page.locator('.import-summary')).toHaveText('3 rows: 2 ready, 1 to fix, 0 with warnings.');
    const flags = page.getByRole('list', { name: 'What will be flagged' });
    await expect(flags).toContainText('No coordinates: 1');
    await expect(flags).toContainText('Barangay name isn\'t on the official list: 1');
    await expect(page.locator('tr[data-row="3"]')).toContainText('not on the list');
    await expect(page.locator('tr[data-row="4"]')).toContainText('Year funded "twenty" isn\'t a whole number of 1900 or more.');
    await page.getByLabel('Show').selectOption('fix');
    await expect(page.locator('.import-preview tbody tr')).toHaveCount(1);

    const importButton = page.getByRole('button', { name: 'Import 2 records' });
    await expect(importButton).toBeDisabled();
    await page.getByLabel(/Leave out the 1 row to fix/).check();
    await importIt(page, 2);
    await expect(page.locator('.import-done')).toContainText('1 of them need a look in the QA queue.');
    await expect(page.locator('.import-done')).toContainText('Left out: row 4.');
    // A wrong file can be undone from here, straight away.
    await expect(page.getByRole('region', { name: 'Earlier imports' }).locator('.queue-item').filter({ hasText: 'e2e.csv' }).getByRole('button', { name: 'Undo this import' })).toBeVisible();

    await page.getByRole('link', { name: 'Open the QA queue' }).click();
    await filterQueue(page, 'E2E Test FCA');
    await expect(group(page, 'barangay_unmatched')).toContainText('The source names "Nowhere Brgy".');
    await expect(page.locator('.queue-item')).toHaveCount(2);

    await page.getByRole('navigation', { name: 'QA and import' }).getByRole('link', { name: 'Import' }).click();
    const batch = page.locator('.import-batches .queue-item').filter({ hasText: 'e2e.csv' });
    await expect(batch).toContainText('E2E export · Farm Machinery · 2 records, 1 flagged');
    await expect(batch).toContainText('By Local user on');
    await batch.getByRole('button', { name: 'Undo this import' }).click();
    const undo = form(page, 'Undo e2e.csv');
    await undo.getByRole('button', { name: 'Undo the import' }).click();
    await expect(undo).toContainText('Give a reason.');
    await undo.getByLabel(/^Reason/).fill('Imported the wrong file');
    await undo.getByRole('button', { name: 'Undo the import' }).click();
    await expect(notice(page)).toContainText('e2e.csv was undone.');
    await expect(batch).toContainText(/Undone by Local user on .*: Imported the wrong file/);
    await expect(batch.getByRole('button', { name: 'Undo this import' })).toHaveCount(0);

    await page.getByRole('navigation', { name: 'QA and import' }).getByRole('link', { name: 'QA queue' }).click();
    await filterQueue(page, 'E2E Test FCA');
    await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
  });

  test('the next file from a source starts with its columns and values, leaves out rows already in, and work on a record keeps a batch from being undone', async ({ page }) => {
    await open(page, '/import');
    const row = (id: string, name: string) => [id, name, 'Hand Tractor (Walking-type)', 'RICE PROG', '2025', 'Boac', boacBarangay.name, '', ''];
    await chooseFile(page, 'first.csv', csv([HEADER, row('E2E-10', 'E2E Test FCA Ten')]));
    await fieldFor(page, 'Recipient Group').selectOption('beneficiary');
    await page.getByRole('button', { name: 'Next: values' }).click();
    await form(page, 'Match the values').getByRole('combobox').selectOption({ label: 'Rice Program' });
    await page.getByRole('button', { name: 'Next: check' }).click();
    await importIt(page, 1);

    await page.getByRole('button', { name: 'Import another file' }).click();
    await chooseFile(page, 'second.csv', csv([HEADER, row('E2E-10', 'E2E Test FCA Ten'), row('E2E-11', 'E2E Test FCA Eleven')]), 'Farm Machinery', 'e2e EXPORT');
    await expect(fieldFor(page, 'Recipient Group')).toHaveValue('beneficiary');
    await page.getByRole('button', { name: 'Next: values' }).click();
    await expect(form(page, 'Match the values').getByRole('combobox')).toHaveValue(/^\d+$/);
    await page.getByRole('button', { name: 'Next: check' }).click();
    await expect(page.locator('.import-summary')).toHaveText('2 rows: 2 ready, 0 to fix, 1 with warnings.');
    await expect(page.locator('tr[data-row="2"]')).toContainText('Already imported from e2e EXPORT with this ID.');
    await expect(page.getByLabel(/Leave out the 1 row already imported/)).toBeChecked();
    await importIt(page, 1);

    // A status set on one of its records is work that undoing would lose.
    await page.getByRole('navigation', { name: 'QA and import' }).getByRole('link', { name: 'Condition check' }).click();
    const check = page.getByRole('region', { name: 'Condition check' });
    await page.getByRole('form', { name: 'Filter the units' }).getByRole('searchbox').fill('E2E Test FCA Eleven');
    await check.locator('.queue-item').getByRole('button', { name: 'Serviceable', exact: true }).click();
    await form(page, /^Set Serviceable: /).getByRole('button', { name: 'Save as Serviceable' }).click();
    await expect(check.getByRole('status')).toContainText('Nothing waiting here.');

    await page.getByRole('navigation', { name: 'QA and import' }).getByRole('link', { name: 'Import' }).click();
    const batch = page.locator('.import-batches .queue-item').filter({ hasText: 'second.csv' });
    await batch.getByRole('button', { name: 'Undo this import' }).click();
    await form(page, 'Undo second.csv').getByLabel(/^Reason/).fill('Wrong file');
    await form(page, 'Undo second.csv').getByRole('button', { name: 'Undo the import' }).click();
    await expect(page.getByRole('region', { name: 'Earlier imports' }).getByRole('alert')).toContainText('1 of its records has been worked on since');
    await expect(batch).not.toContainText('Undone by');
  });

  test('an Excel sheet with a title above its header, and dates as dates', async ({ page }) => {
    await open(page, '/import');
    const sheet = XLSX.utils.aoa_to_sheet(
      [
        ['Marinduque machinery, for checking'],
        [],
        ['Beneficiary', 'Category', 'Program', 'Year', 'Municipality', 'Barangay', 'Coordinates', 'Date Turned Over'],
        ['E2E Sheet FCA', 'Rice Thresher', 'Rice Program', 2023, cleanMunicipality.name, cleanBarangay.name, `${nearby.lat}, ${nearby.lng}`, new Date(Date.UTC(2024, 2, 5))],
      ],
      { cellDates: true },
    );
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Machinery');
    await chooseFile(page, 'machinery.xlsx', XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    await expect(fieldFor(page, 'Coordinates')).toHaveValue('coordinates');
    await expect(fieldFor(page, 'Date Turned Over')).toHaveValue('attr:date_turned_over');
    await expect(page.getByRole('row', { name: /Date Turned Over/ })).toContainText('2024-03-05');
    await page.getByRole('button', { name: 'Next: check' }).click();
    await expect(page.locator('.import-summary')).toHaveText('1 row: 1 ready, 0 to fix, 0 with warnings.');
    await expect(page.locator('tr[data-row="4"]')).toContainText('E2E Sheet FCA');
    await importIt(page, 1);
    await expect(page.locator('.import-done')).toContainText('None of them were flagged.');
  });

  test('a Google Earth file, with each placemark\'s point as its coordinates', async ({ page }) => {
    await open(page, '/import');
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Pin</name><ExtendedData>
<Data name="Beneficiary"><value>E2E Pin FCA</value></Data><Data name="Category"><value>Rice Thresher</value></Data>
<Data name="Program"><value>Rice Program</value></Data><Data name="Year"><value>2022</value></Data>
<Data name="Municipality"><value>${cleanMunicipality.name}</value></Data><Data name="Barangay"><value>${cleanBarangay.name}</value></Data>
</ExtendedData><Point><coordinates>${nearby.lng},${nearby.lat},0</coordinates></Point></Placemark>
</Document></kml>`;
    await chooseFile(page, 'pins.kml', kml);
    await expect(fieldFor(page, 'Latitude (from the map file)')).toHaveValue('latitude');
    await expect(fieldFor(page, 'Longitude (from the map file)')).toHaveValue('longitude');
    await page.getByRole('button', { name: 'Next: check' }).click();
    await expect(page.locator('.import-summary')).toHaveText('1 row: 1 ready, 0 to fix, 0 with warnings.');
    await expect(page.locator('tr[data-row="1"]')).toContainText(cleanBarangay.name);
    await importIt(page, 1);
    await expect(page.locator('.import-done')).toContainText('None of them were flagged.');
  });

  test('a file that isn\'t one it reads is refused before any step', async ({ page }) => {
    await open(page, '/import');
    const step = form(page, 'Choose a file');
    await step.getByLabel(/^File/).setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect(step.getByRole('alert')).toContainText('Choose a CSV, Excel (XLSX), KML or KMZ file.');
    await step.getByRole('button', { name: 'Next: columns' }).click();
    await expect(form(page, 'Match the columns')).toHaveCount(0);
    await expect(step).toContainText('Say where the file came from');
  });
});

