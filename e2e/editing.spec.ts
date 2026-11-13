import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { jpegWithGps, PLAIN_PNG } from '../tests/helpers/exif-fixture';

interface SeedRecord {
  id: string;
  source_id: string;
  beneficiary: string;
  barangay_id: number | null;
  municipality_id: number;
  category_id: number;
  intervention_type_id: number;
  year_funded: number;
  qa_flags: string[];
  plotted_barangay: string | null;
  plotted_municipality: string | null;
  geojson: { coordinates: [number, number] } | null;
}

const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as {
  barangays: { id: number; name: string; municipality_id: number }[];
  interventions: SeedRecord[];
  intervention_barangays: { barangay_id: number; intervention_id: string }[];
  lookups: {
    categories: { id: number; name: string; intervention_type_id: number | null }[];
    programs: { id: number; name: string; code: string }[];
    intervention_types: { id: number; code: string; name: string }[];
  };
};

const machinery = seed.lookups.intervention_types.find((t) => t.code === 'farm-machinery')!;
const ssip = seed.lookups.intervention_types.find((t) => t.code === 'ssip')!;
const handCategory = seed.lookups.categories.find((c) => c.intervention_type_id === machinery.id)!;
const riceProgram = seed.lookups.programs.find((p) => p.code === 'rice')!;

const linked = new Set(seed.intervention_barangays.map((l) => l.barangay_id));
const emptyBarangay = seed.barangays.find((b) => !linked.has(b.id))!;

const located = seed.interventions.filter((r) => r.geojson && r.barangay_id !== null);
const countByBeneficiary = new Map<string, number>();
for (const r of seed.interventions) countByBeneficiary.set(r.beneficiary, (countByBeneficiary.get(r.beneficiary) ?? 0) + 1);

// A record with nothing wrong and a name no other record shares, so its marker is easy to find.
const cleanRecord = located.find((r) => r.qa_flags.length === 0 && countByBeneficiary.get(r.beneficiary) === 1)!;
const mismatchRecord = located.find((r) => r.qa_flags.join() === 'barangay_mismatch' && r.plotted_barangay)!;
const sharedPointRecord = located.find(
  (r) => r.qa_flags.join() === 'duplicate_point' && countByBeneficiary.get(r.beneficiary) === 1,
)!;
const unlocatedRecord = seed.interventions.find((r) => r.qa_flags.join() === 'no_coords' && r.barangay_id !== null)!;
const nameCheckRecord = located.find((r) => r.qa_flags.includes('beneficiary_name_check'))!;

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

const profile = (page: Page) => page.getByLabel(/^Profile of barangay/);
const form = (page: Page, name: string) => page.getByRole('form', { name });
const popup = (page: Page) => page.locator('.record-popup');
const readout = (page: Page) => page.getByTestId('location-readout');
// Required fields carry a mark in their name, and "Type" shouldn't match "Beneficiary type".
const select = (scope: Page | Locator, name: string) => scope.getByRole('combobox', { name: new RegExp(`^${name}`) });
const warning = (page: Page, code: string) => page.locator(`[data-warning="${code}"]`);

async function ready(page: Page, path = '/map') {
  await page.goto(path);
  await expect(page.locator('.barangay-shape')).toHaveCount(218);
}

async function openProfile(page: Page, barangayId: number) {
  await ready(page, `/barangays/${barangayId}`);
  await expect(profile(page)).toBeVisible();
}

// Opens a record's popup the way a person does: from its row in the barangay profile.
async function openPopup(page: Page, record: SeedRecord) {
  await openProfile(page, record.barangay_id!);
  const row = profile(page).locator('.record-row').filter({ hasText: record.beneficiary });
  await row.locator('.record-name').click();
  await expect(popup(page).filter({ hasText: record.beneficiary })).toBeVisible();
}

const popupAction = (page: Page, name: string) => page.locator('.leaflet-popup-content').getByRole('button', { name, exact: true });

// Where a marker is once the map has stopped moving.
async function settledBox(marker: Locator) {
  await expect(marker).toBeVisible();
  let last = '';
  await expect
    .poll(async () => {
      const current = JSON.stringify(await marker.boundingBox());
      const settled = current === last;
      last = current;
      return settled;
    }, { intervals: [200] })
    .toBe(true);
  return (await marker.boundingBox())!;
}

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function dragMarker(page: Page, marker: Locator, dx: number, dy: number) {
  // A popup pans the map as it opens. A person waits for that before reaching for the marker.
  const box = await settledBox(marker);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

// What's actually stored, for effects that don't show on the screen being used.
function storedRecord(page: Page, id: string) {
  return page.evaluate(
    (recordId) =>
      new Promise<{ qa_flags: string[]; geojson: { coordinates: [number, number] } | null; version: number }>((resolve) => {
        const open = indexedDB.open('da-intervention-map-local');
        open.onsuccess = () => {
          const get = open.result.transaction('state').objectStore('state').get('current');
          get.onsuccess = () => resolve(get.result.rows.interventions.find((r: { id: string }) => r.id === recordId));
        };
      }),
    id,
  );
}

async function fillRequiredMachinery(scope: Locator, beneficiary: string) {
  await select(scope, 'Category').selectOption(String(handCategory.id));
  await select(scope, 'Banner program').selectOption(String(riceProgram.id));
  await scope.getByLabel('Year funded').fill('2025');
  await scope.getByLabel('Beneficiary', { exact: false }).first().fill(beneficiary);
}

async function typeCoordinates(page: Page, text: string) {
  await page.getByLabel('Type or paste coordinates').fill(text);
  await page.getByRole('button', { name: 'Use', exact: true }).click();
}

// The map starts fitted to the island, so its centre is on land.
async function centreOfMap(page: Page) {
  const box = (await page.locator('.leaflet-container').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.abort());
});

test.describe('adding', () => {
  test('by clicking the map: suggests the place, saves, and survives a reload', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    const add = form(page, 'Add intervention');
    await expect(add).toBeVisible();
    await expect(page.getByText('Click the map to set the location.').first()).toBeVisible();
    await expect(readout(page)).toContainText('Not set');

    const { x, y } = await centreOfMap(page);
    await page.mouse.click(x, y);

    await expect(readout(page)).not.toContainText('Not set');
    await expect(page.locator('.draft-marker')).toBeVisible();
    // The click placed a point. It must not have opened a barangay profile.
    await expect(page).toHaveURL(/\/map$/);
    await expect(select(add, 'Municipality')).not.toHaveValue('');
    const barangayId = await select(add, 'Barangay').inputValue();
    expect(barangayId).not.toBe('');

    await fillRequiredMachinery(add, 'E2E Farmers Association');
    await add.getByRole('button', { name: 'Save record' }).click();

    await expect(popup(page).filter({ hasText: 'E2E Farmers Association' })).toBeVisible();
    await expect(page.getByText('Record added.')).toBeVisible();

    await openProfile(page, Number(barangayId));
    await expect(profile(page)).toContainText('E2E Farmers Association');
  });

  test('blocks saving until required fields are filled, and names them', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    const add = form(page, 'Add intervention');
    await add.getByRole('button', { name: 'Save record' }).click();

    await expect(add.getByText('Choose a municipality.')).toBeVisible();
    await expect(add.getByText('Banner program is required for Farm Machinery.')).toBeVisible();
    await expect(add.getByText('Year funded is required for Farm Machinery.')).toBeVisible();
    await expect(add.getByText('Beneficiary is required for Farm Machinery.')).toBeVisible();
    await expect(add).toBeVisible();
    // The first problem is brought into view, so it's not hidden above the Save button.
    await expect(add.locator('[aria-invalid="true"]').first()).toBeFocused();
  });

  test('from a barangay profile: pre-fills the place, and needs no coordinates', async ({ page }) => {
    await openProfile(page, emptyBarangay.id);
    await profile(page).getByRole('button', { name: 'Add intervention here' }).click();
    const add = form(page, 'Add intervention');

    await expect(select(add, 'Municipality')).toHaveValue(String(emptyBarangay.municipality_id));
    await expect(select(add, 'Barangay')).toHaveValue(String(emptyBarangay.id));
    await expect(warning(page, 'no_coords')).toBeVisible();

    await fillRequiredMachinery(add, 'Profile FA');
    await add.getByRole('button', { name: 'Save record' }).click();

    await expect(page.getByText(/no usable coordinates/)).toBeVisible();
    await expect(profile(page)).toContainText('Profile FA');
    await expect(profile(page)).toContainText('No coordinates yet');
    await expect(profile(page).locator('.section-title').filter({ hasText: 'Interventions' })).toContainText('1');
  });

  test('the form follows the type: SSIP has its own fields and statuses, and no stage', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    const add = form(page, 'Add intervention');

    await expect(add.getByLabel('Engine No.')).toBeVisible();
    await select(add, 'Type').selectOption(String(ssip.id));

    await expect(add.getByLabel('Engine No.')).toHaveCount(0);
    await expect(add.getByLabel('Water source')).toBeVisible();
    await expect(add.getByLabel('Service area')).toBeVisible();
    await expect(add.getByLabel('Solar capacity')).toBeVisible();
    await expect(add.getByLabel('Stage', { exact: true })).toHaveCount(0);

    await expect(select(add, 'Status').locator('option')).toHaveText([
      'Inventory',
      'On-going',
      'Completed',
      'Operational',
      'Needs Repair',
      'Non-operational',
    ]);
    await expect(select(add, 'Category').locator('option')).toContainText(['Choose', /SPIS/]);
  });

  test('cancelling a form with changes asks first', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    const add = form(page, 'Add intervention');
    await add.getByLabel('Title').fill('Unsaved');

    let asked = false;
    page.once('dialog', (dialog) => {
      asked = true;
      void dialog.dismiss();
    });
    await add.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(asked).toBe(true);
    await expect(add).toBeVisible();
  });
});

test.describe('setting coordinates', () => {
  test.beforeEach(async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
  });

  test('typed decimal degrees', async ({ page }) => {
    await typeCoordinates(page, '13.4671, 121.9686');
    await expect(readout(page)).toContainText('13.4671, 121.9686');
    await expect(page.locator('.draft-marker')).toBeVisible();
  });

  test('typed degrees, minutes and seconds, with a preview before using it', async ({ page }) => {
    await page.getByLabel('Type or paste coordinates').fill(`13°28'01.6"N 121°58'07.0"E`);
    await expect(page.getByText('Reads as 13.4671111, 121.9686111')).toBeVisible();
    await page.getByRole('button', { name: 'Use', exact: true }).click();
    await expect(readout(page)).toContainText('13.4671111, 121.9686111');
  });

  test('pasted Google Maps coordinates and links, using Enter', async ({ page }) => {
    const input = page.getByLabel('Type or paste coordinates');
    await input.fill('13.4671, 121.9686');
    await input.press('Enter');
    await expect(readout(page)).toContainText('13.4671, 121.9686');
    await expect(form(page, 'Add intervention')).toBeVisible(); // Enter didn't submit the form

    await input.fill('https://www.google.com/maps/place/Test/@13.40,121.90,17z/data=!3m1!4b1!8m2!3d13.4123!4d121.9456');
    await input.press('Enter');
    await expect(readout(page)).toContainText('13.4123, 121.9456');
  });

  test('explains input it can\'t read, and keeps the location unchanged', async ({ page }) => {
    await typeCoordinates(page, 'somewhere in Boac');
    await expect(page.getByText(/Couldn't read that/)).toBeVisible();
    await expect(readout(page)).toContainText('Not set');
  });

  test('the GPS button uses the device location', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 13.4671, longitude: 121.9686, accuracy: 12 });
    await page.getByRole('button', { name: 'Use my location (GPS)' }).click();
    await expect(readout(page)).toContainText('13.4671, 121.9686');
    await expect(page.getByText('Accuracy about 12 m')).toBeVisible();
  });

  test('a refused GPS permission says so', async ({ page, context }) => {
    await context.clearPermissions();
    await page.getByRole('button', { name: 'Use my location (GPS)' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Location permission|too long|couldn't find/ })).toBeVisible();
    await expect(readout(page)).toContainText('Not set');
  });

  test('reads the location from a geotagged photo', async ({ page }) => {
    await page.getByLabel('Read the location from a photo').setInputFiles({
      name: 'site.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(jpegWithGps(13.4671, 121.9686)),
    });
    await expect(readout(page)).toContainText('13.4671');
    await expect(readout(page)).toContainText('121.9686');
    await expect(page.getByText(/The photo itself is not saved/)).toBeVisible();
  });

  test('says so when a photo has no location', async ({ page }) => {
    await page.getByLabel('Read the location from a photo').setInputFiles({
      name: 'plain.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PLAIN_PNG),
    });
    await expect(page.getByText(/This photo has no location/)).toBeVisible();
    await expect(readout(page)).toContainText('Not set');
  });

  test('the orange marker can be dragged to fine-tune', async ({ page }) => {
    await typeCoordinates(page, '13.4671, 121.9686');
    const marker = page.locator('.draft-marker');
    await expect(marker).toBeVisible();
    await page.waitForTimeout(600); // let the map finish moving to the point
    const before = await readout(page).textContent();
    await dragMarker(page, marker, 25, 15);
    await expect(readout(page)).not.toHaveText(before!);
  });

  test('clear removes the location', async ({ page }) => {
    await typeCoordinates(page, '13.4671, 121.9686');
    await readout(page).getByRole('button', { name: 'Clear' }).click();
    await expect(readout(page)).toContainText('Not set');
    await expect(page.locator('.draft-marker')).toHaveCount(0);
  });
});

test.describe('live warnings while editing', () => {
  test('outside Marinduque', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    const add = form(page, 'Add intervention');
    await select(add, 'Municipality').selectOption(String(emptyBarangay.municipality_id));
    await typeCoordinates(page, '14.5995, 120.9842');
    await expect(warning(page, 'out_of_province')).toBeVisible();

    await typeCoordinates(page, '13.3, 121.75');
    await expect(warning(page, 'out_of_province')).toBeVisible();
  });

  test('barangay mismatch, with a one-click fix that clears it', async ({ page }) => {
    await openProfile(page, cleanRecord.barangay_id!);
    await profile(page).getByRole('button', { name: 'Add intervention here' }).click();
    const add = form(page, 'Add intervention');

    // A point in another barangay: the plotted location of a known mismatched record.
    const [lng, lat] = mismatchRecord.geojson!.coordinates;
    await typeCoordinates(page, `${lat}, ${lng}`);

    const shown = warning(page, 'barangay_mismatch');
    await expect(shown).toBeVisible();
    await expect(shown).toContainText(`in ${mismatchRecord.plotted_barangay}`);

    await add.getByRole('button', { name: /^Set barangay to/ }).click();
    await expect(warning(page, 'barangay_mismatch')).toHaveCount(0);
    await expect(warning(page, 'muni_mismatch')).toHaveCount(0);
  });

  test('possible duplicate: same category, beneficiary, year and barangay', async ({ page }) => {
    const existing = cleanRecord;
    await openProfile(page, existing.barangay_id!);
    await profile(page).getByRole('button', { name: 'Add intervention here' }).click();
    const add = form(page, 'Add intervention');

    await select(add, 'Category').selectOption(String(existing.category_id));
    await add.getByLabel('Year funded').fill(String(existing.year_funded));
    await expect(warning(page, 'possible_duplicate')).toHaveCount(0);

    await add.getByLabel('Beneficiary', { exact: false }).first().fill(`  ${existing.beneficiary.toUpperCase()} `);
    await expect(warning(page, 'possible_duplicate')).toBeVisible();

    await add.getByLabel('Year funded').fill(String(existing.year_funded - 1));
    await expect(warning(page, 'possible_duplicate')).toHaveCount(0);
  });

  // The save is followed by a reload, which redraws the cluster on that spot just as the popup opens.
  test('a new record on the same spot as another opens after saving, and stays open', async ({ page }) => {
    await openProfile(page, sharedPointRecord.barangay_id!);
    await profile(page).getByRole('button', { name: 'Add intervention here' }).click();
    const add = form(page, 'Add intervention');
    const [lng, lat] = sharedPointRecord.geojson!.coordinates;
    await typeCoordinates(page, `${lat}, ${lng}`);
    await fillRequiredMachinery(add, 'Same spot FA');
    await add.getByRole('button', { name: 'Save record' }).click();
    await expect(popup(page).filter({ hasText: 'Same spot FA' })).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(popup(page).filter({ hasText: 'Same spot FA' })).toBeVisible();
  });

  test('warnings can be overridden, and the flag stays on the record', async ({ page }) => {
    await openProfile(page, cleanRecord.barangay_id!);
    await profile(page).getByRole('button', { name: 'Add intervention here' }).click();
    const add = form(page, 'Add intervention');
    const [lng, lat] = mismatchRecord.geojson!.coordinates;
    await typeCoordinates(page, `${lat + 0.00001}, ${lng}`);
    await fillRequiredMachinery(add, 'Overridden FA');
    await add.getByRole('button', { name: 'Save record' }).click();

    await expect(popup(page).filter({ hasText: 'Overridden FA' })).toContainText(/Plotted in .*; encoded as/);
    await expect(popupAction(page, 'Resolve flag')).toBeVisible();
  });
});

test.describe('moving a marker', () => {
  test('nothing moves until the move is confirmed, and cancel puts it back', async ({ page }) => {
    await openPopup(page, cleanRecord);
    const [lng, lat] = cleanRecord.geojson!.coordinates;
    const marker = page.locator(`.intervention-marker[title="${cleanRecord.beneficiary}"]`);

    await dragMarker(page, marker, 40, 25);
    const confirm = page.getByRole('dialog', { name: 'Confirm move' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('here?');
    await expect(popup(page)).toHaveCount(0);

    const dropped = (await marker.boundingBox())!;
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);

    await expect(marker).toBeVisible();
    await expect.poll(async () => (await marker.boundingBox())!.x).not.toBe(dropped.x);

    await marker.click();
    await expect(popup(page)).toContainText(`${lat}, ${lng}`);
    await popupAction(page, 'History').click();
    await expect(page.getByLabel('Change history')).not.toContainText('Location:');
  });

  test('a marker dropped right beside another stays in sight until the move is decided', async ({ page }) => {
    await openPopup(page, cleanRecord);
    const marker = page.locator(`.intervention-marker[title="${cleanRecord.beneficiary}"]`);
    await page.keyboard.press('Escape');

    // The nearest neighbour showing as its own marker, far enough away to start apart.
    const nearest = () =>
      page.locator('.intervention-marker').evaluateAll((elements, title) => {
        const box = (element: Element) => element.getBoundingClientRect();
        const self = elements.find((element) => element.getAttribute('title') === title);
        if (!self) return null;
        const others = elements
          .filter((element) => element !== self)
          .map((element) => ({ dx: box(element).x - box(self).x, dy: box(element).y - box(self).y }))
          .filter(({ dx, dy }) => Math.hypot(dx, dy) > 30)
          .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
        return others[0] ?? null;
      }, cleanRecord.beneficiary);
    await expect.poll(nearest).not.toBeNull();
    const { dx, dy } = (await nearest())!;

    await dragMarker(page, marker, dx + 4, dy + 4);
    const confirm = page.getByRole('dialog', { name: 'Confirm move' });
    await expect(confirm).toBeVisible();
    await expect(marker).toBeVisible();

    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
  });

  test('a confirmed move is saved, logged and kept after a reload', async ({ page }) => {
    await openPopup(page, cleanRecord);
    const [lng, lat] = cleanRecord.geojson!.coordinates;
    const marker = page.locator(`.intervention-marker[title="${cleanRecord.beneficiary}"]`);

    await dragMarker(page, marker, 40, 25);
    const confirm = page.getByRole('dialog', { name: 'Confirm move' });
    await confirm.getByRole('button', { name: 'Confirm move' }).click();
    await expect(page.getByText('Marker moved.')).toBeVisible();
    await expect(confirm).toHaveCount(0);

    await openPopup(page, cleanRecord);
    await expect(popup(page)).not.toContainText(`${lat}, ${lng}`);
    await popupAction(page, 'History').click();
    await expect(page.getByLabel('Change history')).toContainText(`Location: ${lat}, ${lng} →`);
  });

  test('setting the barangay from a move needs a reason, which goes in the log', async ({ page }) => {
    await openPopup(page, mismatchRecord);
    const marker = page.locator(`.intervention-marker[title="${mismatchRecord.beneficiary}"]`);
    await dragMarker(page, marker, 30, 20);
    const confirm = page.getByRole('dialog', { name: 'Confirm move' });
    const reason = confirm.getByLabel('Reason or note');
    const setBarangay = confirm.getByRole('button', { name: /^Move and set barangay to/ });
    const asked = confirm.getByText('Give a reason.', { exact: false });

    // Nothing is saved without one, and spaces don't count.
    await setBarangay.click();
    await expect(asked).toBeVisible();
    await reason.fill('   ');
    await expect(asked).toHaveCount(0);
    await setBarangay.click();
    await expect(asked).toBeVisible();
    await expect(page.getByText('Marker moved.')).toHaveCount(0);

    await reason.fill('Confirmed by the MAO on 2026-11-07');
    await setBarangay.click();
    await expect(page.getByText('Marker moved.')).toBeVisible();
    await expect(confirm).toHaveCount(0);
    expect((await storedRecord(page, mismatchRecord.id)).qa_flags).toEqual([]);

    await marker.click();
    await expect(popup(page)).not.toContainText('Plotted in');
    await popupAction(page, 'History').click();
    const history = page.getByLabel('Change history');
    await expect(history).toContainText('Reason: Confirmed by the MAO on 2026-11-07');
    await expect(history.getByText(/Barangay: .* → /)).toHaveCount(1);
  });

  test('a plain move needs no reason, takes a note if given, and leaves a flag in place', async ({ page }) => {
    await openPopup(page, mismatchRecord);
    const marker = page.locator(`.intervention-marker[title="${mismatchRecord.beneficiary}"]`);
    await dragMarker(page, marker, 30, 20);
    const confirm = page.getByRole('dialog', { name: 'Confirm move' });
    await confirm.getByLabel('Reason or note').fill('Nearer the shed');
    await confirm.getByRole('button', { name: 'Confirm move' }).click();
    await expect(page.getByText('Marker moved.')).toBeVisible();
    expect((await storedRecord(page, mismatchRecord.id)).qa_flags).toEqual(['barangay_mismatch']);

    await marker.click();
    await expect(popup(page)).toContainText('Plotted in');
    await popupAction(page, 'History').click();
    const history = page.getByLabel('Change history');
    await expect(history).toContainText('Reason: Nearer the shed');
    await expect(history).not.toContainText(/Barangay: .* → /);
  });

  // A popup can pan its marker to where the legend sits, hidden while the popup is open. The legend
  // stays away while the marker is moved, and once the move ends it's brought clear of the legend.
  test('a marker dropped where the legend sits is brought clear of it once the move is confirmed', async ({ page, isMobile }) => {
    test.skip(isMobile, 'on a phone the legend is folded into a small button, and the profile covers the map');
    await openProfile(page, cleanRecord.barangay_id!);
    const legend = page.getByLabel('Map legend');
    const area = (await legend.boundingBox())!;
    await profile(page).locator('.record-row').filter({ hasText: cleanRecord.beneficiary }).locator('.record-name').click();
    await expect(popup(page).filter({ hasText: cleanRecord.beneficiary })).toBeVisible();
    const marker = page.locator(`.intervention-marker[title="${cleanRecord.beneficiary}"]`);

    const box = await settledBox(marker);
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await dragMarker(page, marker, area.x + area.width / 2 - x, area.y + area.height / 2 - y);
    const confirm = page.getByRole('dialog', { name: 'Confirm move' });
    await expect(confirm).toBeVisible();
    // The dropped marker is in sight while the move waits to be confirmed.
    await expect(legend).toBeHidden();
    await expect(marker).toBeVisible();

    await confirm.getByRole('button', { name: 'Confirm move' }).click();
    await expect(page.getByText('Marker moved.')).toBeVisible();
    await expect(legend).toBeVisible();
    await expect.poll(async () => overlaps((await marker.boundingBox())!, (await legend.boundingBox())!)).toBe(false);
    await marker.click();
    await expect(popup(page)).toContainText(cleanRecord.beneficiary);
  });

  test('cancelling drops a note, and a move within the barangay offers no barangay change', async ({ page }) => {
    await openPopup(page, cleanRecord);
    const marker = page.locator(`.intervention-marker[title="${cleanRecord.beneficiary}"]`);
    await dragMarker(page, marker, 12, 8);
    const confirm = page.getByRole('dialog', { name: 'Confirm move' });
    const note = confirm.getByLabel('Note (optional)');
    await expect(confirm.getByRole('button', { name: /^Move and set barangay/ })).toHaveCount(0);
    await note.fill('Typed, then thought better of it');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);

    await dragMarker(page, marker, 12, 8);
    await expect(note).toHaveValue('');
    await confirm.getByRole('button', { name: 'Confirm move' }).click();
    await expect(page.getByText('Marker moved.')).toBeVisible();

    await marker.click();
    await popupAction(page, 'History').click();
    const history = page.getByLabel('Change history');
    await expect(history).toContainText('Location:');
    await expect(history).not.toContainText('Reason:');
  });

  test('a note stays with its record: dragging it again keeps the note, and dragging another starts afresh', async ({ page }) => {
    await openPopup(page, cleanRecord);
    const marker = page.locator(`.intervention-marker[title="${cleanRecord.beneficiary}"]`);
    await page.keyboard.press('Escape');
    await dragMarker(page, marker, 12, 8);
    const confirm = page.getByRole('dialog', { name: 'Confirm move' });
    const note = confirm.locator('textarea');
    await note.fill('Typed for this record');

    await dragMarker(page, marker, 12, 8);
    await expect(note).toHaveValue('Typed for this record');

    // Another marker the pointer can reach, with this dialog still open.
    const markers = page.locator('.intervention-marker');
    const reachable = () =>
      markers.evaluateAll(
        (elements, title) =>
          elements.findIndex((element) => {
            const box = element.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return element.getAttribute('title') !== title && hit !== null && element.contains(hit);
          }),
        cleanRecord.beneficiary,
      );
    await expect.poll(reachable).toBeGreaterThanOrEqual(0);
    await dragMarker(page, markers.nth(await reachable()), 12, 8);
    await expect(note).toHaveValue('');
    await expect(confirm).toBeVisible();
  });

  test('a record sharing a point can be dragged out of the spider, which clears its partner\'s flag', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await openPopup(page, sharedPointRecord);
    const marker = page.locator(`.intervention-marker[title="${sharedPointRecord.beneficiary}"]`);
    await dragMarker(page, marker, 60, 40);

    const confirm = page.getByRole('dialog', { name: 'Confirm move' });
    await expect(confirm).toBeVisible();
    await expect(warning(page, 'duplicate_point')).toHaveCount(0);
    await confirm.getByRole('button', { name: 'Confirm move' }).click();
    await expect(page.getByText('Marker moved.')).toBeVisible();

    const partner = seed.interventions.find(
      (r) => r.id !== sharedPointRecord.id && r.geojson?.coordinates.join() === sharedPointRecord.geojson!.coordinates.join(),
    )!;
    const moved = await storedRecord(page, sharedPointRecord.id);
    expect(moved.geojson!.coordinates).not.toEqual(sharedPointRecord.geojson!.coordinates);
    expect(moved.qa_flags).not.toContain('duplicate_point');

    // Laid out afresh, the moved record and its old partner can both still be reached.
    const rows = profile(page).locator('.record-row');
    await rows.filter({ hasText: sharedPointRecord.beneficiary }).locator('.record-name').click();
    await expect(popup(page).filter({ hasText: sharedPointRecord.beneficiary })).toBeVisible({ timeout: 15_000 });
    if (partner.barangay_id === sharedPointRecord.barangay_id) {
      await rows.filter({ hasText: partner.beneficiary }).locator('.record-name').first().click();
      await expect(popup(page).filter({ hasText: partner.beneficiary })).toBeVisible({ timeout: 15_000 });
    }
    expect(errors).toEqual([]);
  });
});

test.describe('nothing covers what is being worked on', () => {
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  test('the legend makes way for an open popup, and comes back', async ({ page, isMobile }) => {
    test.skip(isMobile, 'phones already hide the legend while a panel is open');
    await openPopup(page, cleanRecord);
    await expect(page.getByLabel('Map legend')).toBeHidden();
    await expect(popupAction(page, 'Delete')).toBeVisible();
    await page.locator('.leaflet-popup-close-button').click();
    await expect(page.getByLabel('Map legend')).toBeVisible();
  });

  test('the move confirmation leaves the dropped marker in view', async ({ page }) => {
    await openPopup(page, mismatchRecord);
    const marker = page.locator(`.intervention-marker[title="${mismatchRecord.beneficiary}"]`);
    await dragMarker(page, marker, 30, 20);
    const confirm = page.getByRole('dialog', { name: 'Confirm move' });
    await expect(confirm).toBeVisible();
    // Every button is usable, and the marker isn't under the card.
    await expect(confirm.getByLabel('Reason or note')).toBeInViewport();
    await expect(confirm.getByRole('button', { name: 'Confirm move' })).toBeInViewport();
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeInViewport();
    await expect(confirm.getByRole('button', { name: /^Move and set barangay/ })).toBeInViewport();
    expect(overlaps((await marker.boundingBox())!, (await confirm.boundingBox())!)).toBe(false);
  });

  // Focusing a field low in the form once scrolled the page, taking the map and the new marker off the
  // top of a phone's screen. It made "the orange marker can be dragged" fail about half the time.
  test('typing coordinates keeps the map and the new marker on screen', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    for (let i = 0; i < 3; i++) {
      await typeCoordinates(page, `13.4${671 + i}, 121.9686`);
      await expect(page.locator('.draft-marker')).toBeInViewport();
      await expect(page.locator('.leaflet-container')).toBeInViewport();
      expect(await page.evaluate(() => document.querySelector('.shell-content')!.scrollTop)).toBe(0);
    }
  });
});

test.describe('status updates', () => {
  test('adds an entry with date, remarks and photo, and keeps the RAED entry', async ({ page }) => {
    await openPopup(page, cleanRecord);
    await expect(popup(page)).toContainText('as of 2026-10-21 (RAED report)');
    await popupAction(page, 'Update status').click();

    const status = form(page, 'Update status');
    await select(status, 'New status').selectOption({ label: 'Needs Repair' });
    await status.getByLabel('Remarks').fill('Engine will not start');
    await status.getByLabel('Photo (optional)').setInputFiles({
      name: 'repair.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PLAIN_PNG),
    });
    await status.getByRole('button', { name: 'Save status' }).click();

    const timeline = popup(page).locator('.status-timeline');
    await expect(timeline.locator('li')).toHaveCount(2);
    await expect(timeline.locator('li').first()).toContainText('as of 2026-10-21 (RAED report)');
    await expect(timeline.locator('li').nth(1)).toContainText(`Needs Repair ${today}`);
    await expect(timeline.locator('li').nth(1)).not.toContainText('as of');
    await expect(timeline.locator('li').nth(1)).toContainText('Engine will not start');

    await timeline.getByRole('button', { name: 'View photo' }).click();
    const image = page.getByRole('dialog', { name: 'Status photo' }).locator('img');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    await page.keyboard.press('Escape');
    await expect(image).toHaveCount(0);

    // The current status shows in the profile too.
    await page.reload();
    await expect(profile(page).locator('.record-row').filter({ hasText: cleanRecord.beneficiary })).toContainText(`Needs Repair, ${today}`);
  });

  test('a backdated entry joins the timeline without replacing the current status', async ({ page }) => {
    await openPopup(page, cleanRecord);
    await popupAction(page, 'Update status').click();
    const status = form(page, 'Update status');
    await select(status, 'New status').selectOption({ label: 'Serviceable' });
    await status.getByLabel('Date of this status').fill('2024-05-01');
    await status.getByRole('button', { name: 'Save status' }).click();

    const timeline = popup(page).locator('.status-timeline li');
    await expect(timeline).toHaveCount(2);
    await expect(timeline.first()).toContainText('Serviceable 2024-05-01');
    const row = profile(page).locator('.record-row').filter({ hasText: cleanRecord.beneficiary });
    await expect(row).toContainText('as of 2026-10-21');
    await expect(row).not.toContainText('Serviceable, 2024-05-01');
  });

  test('refuses a future date', async ({ page }) => {
    await openPopup(page, cleanRecord);
    await popupAction(page, 'Update status').click();
    const status = form(page, 'Update status');
    await select(status, 'New status').selectOption({ label: 'Serviceable' });
    await status.getByLabel('Date of this status').fill('2099-01-01');
    await status.getByRole('button', { name: 'Save status' }).click();
    await expect(status.getByText('The date can\'t be in the future.')).toBeVisible();
  });
});

test.describe('barangay baseline', () => {
  test('can be edited, and stays after a reload', async ({ page }) => {
    await openProfile(page, emptyBarangay.id);
    await expect(profile(page).locator('.baseline')).toContainText('Not set');

    await profile(page).getByRole('button', { name: 'Edit baseline' }).click();
    const baseline = form(page, 'Edit baseline');
    await baseline.getByLabel('Number of farmers').fill('120');
    await baseline.getByLabel('Main crops').fill('Rice, coconut');
    await baseline.getByRole('button', { name: 'Save baseline' }).click();

    await expect(profile(page).locator('.baseline')).toContainText('120');
    await expect(profile(page).locator('.baseline')).toContainText('Rice, coconut');

    await page.reload();
    await expect(profile(page).locator('.baseline')).toContainText('120');
  });

  test('editing one barangay doesn\'t move the map', async ({ page }) => {
    await openProfile(page, emptyBarangay.id);
    await page.waitForTimeout(600);
    const before = await page.locator(`[data-barangay-id="${emptyBarangay.id}"]`).getAttribute('d');

    await profile(page).getByRole('button', { name: 'Edit baseline' }).click();
    await form(page, 'Edit baseline').getByLabel('Number of farmers').fill('5');
    await form(page, 'Edit baseline').getByRole('button', { name: 'Save baseline' }).click();
    await expect(profile(page).locator('.baseline')).toContainText('5');

    await page.waitForTimeout(600);
    expect(await page.locator(`[data-barangay-id="${emptyBarangay.id}"]`).getAttribute('d')).toBe(before);
  });
});

test.describe('popup tools', () => {
  test('copies the coordinates', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openPopup(page, cleanRecord);
    const [lng, lat] = cleanRecord.geojson!.coordinates;
    await popupAction(page, 'Copy coordinates').click();
    await expect(popupAction(page, 'Copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${lat}, ${lng}`);
  });

  test('links to Google Maps in a new tab', async ({ page }) => {
    await openPopup(page, cleanRecord);
    const [lng, lat] = cleanRecord.geojson!.coordinates;
    const link = page.locator('.leaflet-popup-content').getByRole('link', { name: 'Open in Google Maps' });
    await expect(link).toHaveAttribute('href', `https://www.google.com/maps?q=${lat}%2C${lng}`);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

test.describe('resolving a flagged record', () => {
  test('correcting the barangay needs a reason, clears the flag, and logs the reason', async ({ page }) => {
    await openPopup(page, mismatchRecord);
    await popupAction(page, 'Resolve flag').click();
    const resolve = form(page, 'Resolve flag');
    await expect(resolve.getByLabel('Current flags')).toContainText('Point is outside the encoded barangay');

    await resolve.getByRole('button', { name: /^Set barangay to/ }).click();
    await expect(page.getByTestId('flags-after-saving')).toContainText('No flags will remain');

    await resolve.getByRole('button', { name: 'Save and log' }).click();
    await expect(resolve.getByText('Give a reason.', { exact: false })).toBeVisible();

    await resolve.getByLabel('Reason for this change').fill('Confirmed by the MAO on 2026-11-05');
    await resolve.getByRole('button', { name: 'Save and log' }).click();
    await expect(page.getByText('Saved. No flags remain.')).toBeVisible();

    await expect(popup(page)).not.toContainText('Plotted in');
    await expect(popupAction(page, 'Resolve flag')).toHaveCount(0);
    await popupAction(page, 'History').click();
    const history = page.getByLabel('Change history');
    await expect(history).toContainText('Reason: Confirmed by the MAO on 2026-11-05');
    await expect(history).toContainText(/Barangay: .* → /);
  });

  test('setting the location basis alone is logged, but says the mismatch stays', async ({ page }) => {
    await openPopup(page, mismatchRecord);
    await popupAction(page, 'Resolve flag').click();
    const resolve = form(page, 'Resolve flag');
    await select(resolve, 'Location basis').selectOption({ label: 'FCA office/storage' });
    await expect(resolve.getByText(/A mismatch clears only when/)).toBeVisible();
    await resolve.getByLabel('Reason for this change').fill('Kept at the FCA office');
    await resolve.getByRole('button', { name: 'Save and log' }).click();
    await expect(page.getByText('Saved. Some flags remain.')).toBeVisible();
    await expect(popup(page)).toContainText('FCA office/storage');
    await expect(popup(page)).toContainText('Plotted in');
  });

  test('a record with no coordinates can be resolved from its row', async ({ page }) => {
    await openProfile(page, unlocatedRecord.barangay_id!);
    const row = profile(page).locator('.record-row').filter({ hasText: unlocatedRecord.beneficiary }).filter({ hasText: 'No coordinates' }).first();
    await row.getByRole('button', { name: 'Resolve flag' }).click();
    const resolve = form(page, 'Resolve flag');
    await resolve.getByRole('button', { name: 'Pick on map' }).click();
    await expect(page.getByRole('button', { name: 'Cancel map click' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel map click' }).click();

    await typeCoordinates(page, '13.4671, 121.9686');
    await expect(page.getByTestId('flags-after-saving')).not.toContainText('No coordinates');
    await resolve.getByLabel('Reason for this change').fill('Field GPS reading');
    await resolve.getByRole('button', { name: 'Save and log' }).click();
    await expect(page.getByText(/Saved\./)).toBeVisible();
  });

  test('the name check clears only when a person says so', async ({ page }) => {
    await openPopup(page, nameCheckRecord);
    await popupAction(page, 'Resolve flag').click();
    const resolve = form(page, 'Resolve flag');
    await expect(resolve.getByLabel('Current flags')).toContainText('Beneficiary name needs checking');
    await expect(page.getByTestId('flags-after-saving')).toContainText('Beneficiary name needs checking');

    await resolve.getByLabel('The name has been checked').check();
    await expect(page.getByTestId('flags-after-saving')).not.toContainText('Beneficiary name needs checking');
    await resolve.getByLabel('Reason for this change').fill('Checked against the FCA list');
    await resolve.getByRole('button', { name: 'Save and log' }).click();
    await expect(page.getByText(/Saved\./)).toBeVisible();

    await page.reload();
    await expect(profile(page)).toBeVisible();
  });

  test('saving with nothing changed is refused', async ({ page }) => {
    await openPopup(page, mismatchRecord);
    await popupAction(page, 'Resolve flag').click();
    const resolve = form(page, 'Resolve flag');
    await resolve.getByLabel('Reason for this change').fill('No change');
    await resolve.getByRole('button', { name: 'Save and log' }).click();
    await expect(resolve.getByText('Nothing has changed yet.')).toBeVisible();
  });
});

test.describe('editing a record', () => {
  test('saves changes to core and custom fields, and logs what changed', async ({ page }) => {
    await openPopup(page, cleanRecord);
    await popupAction(page, 'Edit').click();
    const edit = form(page, 'Edit record');
    await expect(select(edit, 'Type')).toBeDisabled();
    await expect(page.locator('.draft-marker')).toBeVisible();

    await edit.getByLabel('Serial No.').fill('SN-001');
    await edit.getByLabel('Remarks').fill('Checked on site');
    await edit.getByRole('button', { name: 'Save changes' }).click();

    await expect(popup(page)).toContainText('SN-001');
    await expect(popup(page)).toContainText('Checked on site');
    await popupAction(page, 'History').click();
    const history = page.getByLabel('Change history');
    await expect(history).toContainText('Serial No.: (none) → SN-001');
    await expect(history).toContainText('Remarks: (none) → Checked on site');
    // Only a change of barangay asks for a reason.
    await expect(history).not.toContainText('Reason:');
  });

  test('changing the barangay needs a reason, which goes in the log', async ({ page }) => {
    await openPopup(page, cleanRecord);
    const before = await storedRecord(page, cleanRecord.id);
    await popupAction(page, 'Edit').click();
    const edit = form(page, 'Edit record');
    const reason = edit.getByLabel(/^Reason for changing the barangay/);
    const asked = edit.getByText('Give a reason. It goes in the audit log.');
    const save = edit.getByRole('button', { name: 'Save changes' });
    await expect(reason).toHaveCount(0);

    const other = seed.barangays.find((b) => b.municipality_id === cleanRecord.municipality_id && b.id !== cleanRecord.barangay_id)!;
    await select(edit, 'Barangay').selectOption(String(other.id));
    await expect(reason).toBeVisible();

    // Nothing is saved without one, and spaces don't count.
    await save.click();
    await expect(asked).toBeVisible();
    await reason.fill('   ');
    await save.click();
    await expect(asked).toBeVisible();
    expect((await storedRecord(page, cleanRecord.id)).version).toBe(before.version);

    await reason.fill('  Checked with the MAO  ');
    await save.click();
    await expect(edit).toHaveCount(0);
    expect((await storedRecord(page, cleanRecord.id)).version).toBe(before.version + 1);

    await popupAction(page, 'History').click();
    const history = page.getByLabel('Change history');
    await expect(history).toContainText('Reason: Checked with the MAO');
    await expect(history).toContainText(`→ ${other.name}`);
  });

  test('putting the barangay back drops the question', async ({ page }) => {
    await openPopup(page, cleanRecord);
    await popupAction(page, 'Edit').click();
    const edit = form(page, 'Edit record');
    const barangay = select(edit, 'Barangay');
    const reason = edit.getByLabel(/^Reason for changing the barangay/);
    const other = seed.barangays.find((b) => b.municipality_id === cleanRecord.municipality_id && b.id !== cleanRecord.barangay_id)!;

    await barangay.selectOption(String(other.id));
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit.getByText('Give a reason. It goes in the audit log.')).toBeVisible();

    await barangay.selectOption(String(cleanRecord.barangay_id));
    await expect(reason).toHaveCount(0);
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('No changes to save.')).toBeVisible();
  });

  test('the one-click barangay fix asks too, as it clears a flag', async ({ page }) => {
    await openPopup(page, mismatchRecord);
    await popupAction(page, 'Edit').click();
    const edit = form(page, 'Edit record');
    await edit.getByRole('button', { name: /^Set barangay to/ }).click();
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit.getByText('Give a reason. It goes in the audit log.')).toBeVisible();
    expect((await storedRecord(page, mismatchRecord.id)).qa_flags).toEqual(['barangay_mismatch']);

    await edit.getByLabel(/^Reason for changing the barangay/).fill('Plotted spot is right');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toHaveCount(0);
    expect((await storedRecord(page, mismatchRecord.id)).qa_flags).toEqual([]);

    await popupAction(page, 'History').click();
    await expect(page.getByLabel('Change history')).toContainText('Reason: Plotted spot is right');
  });

  test('saving with no changes writes nothing', async ({ page }) => {
    await openPopup(page, cleanRecord);
    await popupAction(page, 'Edit').click();
    await form(page, 'Edit record').getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('No changes to save.')).toBeVisible();
    await expect(page.getByTestId('local-changes')).toHaveText('No changes yet.', { useInnerText: false });
  });
});

test.describe('delete and restore', () => {
  test('a deleted record leaves the map and counts, and can be restored', async ({ page }) => {
    await openPopup(page, cleanRecord);
    const countText = profile(page).locator('.section-title').filter({ hasText: 'Interventions' });
    const before = Number((await countText.locator('.count').textContent()) ?? '0');

    await popupAction(page, 'Delete').click();
    const deleting = form(page, 'Delete record');
    await deleting.getByLabel('Reason (optional)').fill('Entered twice');
    await deleting.getByRole('button', { name: 'Delete record' }).click();

    await expect(page.getByText(/Record deleted/)).toBeVisible();
    await expect(countText.locator('.count')).toHaveText(String(before - 1));
    await expect(profile(page)).not.toContainText(cleanRecord.beneficiary);
    await expect(page.locator(`.intervention-marker[title="${cleanRecord.beneficiary}"]`)).toHaveCount(0);

    await page.getByRole('button', { name: 'Layers and filters' }).click();
    await page.getByRole('button', { name: 'Deleted records (1)' }).click();
    const deleted = page.getByLabel('Deleted records');
    await expect(deleted).toContainText(cleanRecord.beneficiary);
    await deleted.getByRole('button', { name: 'Restore' }).click();

    await expect(popup(page).filter({ hasText: cleanRecord.beneficiary })).toBeVisible();
    await expect(deleted).toContainText('No deleted records.');
    await popupAction(page, 'History').click();
    const history = page.getByLabel('Change history');
    await expect(history).toContainText('Record restored');
    await expect(history).toContainText('Record deleted');
    await expect(history).toContainText('Reason: Entered twice');
  });

  test('deleting one of two records at a point clears the other\'s shared-point flag', async ({ page }) => {
    const partner = seed.interventions.find(
      (r) =>
        r.id !== sharedPointRecord.id &&
        r.geojson &&
        r.geojson.coordinates.join() === sharedPointRecord.geojson!.coordinates.join(),
    )!;
    const others = seed.interventions.filter((r) => r.geojson?.coordinates.join() === sharedPointRecord.geojson!.coordinates.join());
    test.skip(others.length !== 2, 'needs a point shared by exactly two records');
    expect(partner).toBeDefined();

    await openPopup(page, sharedPointRecord);
    await popupAction(page, 'Delete').click();
    await form(page, 'Delete record').getByRole('button', { name: 'Delete record' }).click();
    await expect(page.getByText(/Record deleted/)).toBeVisible();

    expect((await storedRecord(page, partner.id)).qa_flags).not.toContain('duplicate_point');
  });
});

test.describe('more than one tab', () => {
  test('a change in one tab appears in another without a reload', async ({ page, context }) => {
    const other = await context.newPage();
    await other.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.abort());
    await openProfile(other, emptyBarangay.id);
    await expect(profile(other)).toContainText('No intervention encoded yet');

    await openProfile(page, emptyBarangay.id);
    await profile(page).getByRole('button', { name: 'Add intervention here' }).click();
    const add = form(page, 'Add intervention');
    await fillRequiredMachinery(add, 'Other Tab FA');
    await add.getByRole('button', { name: 'Save record' }).click();

    await expect(profile(other)).toContainText('Other Tab FA');
    await other.close();
  });

  test('someone else\'s edit is shown, and saving only my fields keeps both', async ({ page, context }) => {
    const other = await context.newPage();
    await other.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.abort());

    await openPopup(page, cleanRecord);
    await popupAction(page, 'Edit').click();
    const mine = form(page, 'Edit record');
    await mine.getByLabel('Serial No.').fill('MINE-1');

    await openPopup(other, cleanRecord);
    await popupAction(other, 'Edit').click();
    const theirs = form(other, 'Edit record');
    await theirs.getByLabel('Remarks').fill('Their remark');
    await theirs.getByRole('button', { name: 'Save changes' }).click();
    await expect(popup(other)).toContainText('Their remark');

    const note = page.getByRole('alert').filter({ hasText: 'Someone else changed this record' });
    await expect(note).toBeVisible();
    await expect(note).toContainText('Remarks: now Their remark');

    await note.getByRole('button', { name: 'Save only the fields I changed' }).click();
    await expect(popup(page)).toContainText('MINE-1');
    await expect(popup(page)).toContainText('Their remark');
    await other.close();
  });

  test('saving straight over a newer version is refused', async ({ page, context }) => {
    const other = await context.newPage();
    await other.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.abort());

    await openPopup(page, cleanRecord);
    await popupAction(page, 'Edit').click();
    const mine = form(page, 'Edit record');
    await mine.getByLabel('Remarks').fill('Mine');

    await openPopup(other, cleanRecord);
    await popupAction(other, 'Edit').click();
    await form(other, 'Edit record').getByLabel('Remarks').fill('Theirs');
    await form(other, 'Edit record').getByRole('button', { name: 'Save changes' }).click();
    await expect(popup(other)).toContainText('Theirs');

    await mine.getByRole('button', { name: 'Save changes' }).click();
    await expect(mine.getByText('This record just changed.', { exact: false })).toBeVisible();
    await expect(mine.getByLabel('Remarks')).toHaveValue('Mine'); // nothing typed is lost

    const note = page.getByRole('alert').filter({ hasText: 'Someone else changed this record' });
    await note.getByRole('button', { name: 'Load their version' }).click();
    await expect(mine.getByLabel('Remarks')).toHaveValue('Theirs');
    await expect(note).toHaveCount(0);
    await other.close();
  });

  test('an open popup follows a status added in another tab', async ({ page, context }) => {
    const other = await context.newPage();
    await other.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.abort());

    await openPopup(page, cleanRecord);
    await expect(popup(page).locator('.status-timeline li')).toHaveCount(1);

    await openPopup(other, cleanRecord);
    await popupAction(other, 'Update status').click();
    const status = form(other, 'Update status');
    await select(status, 'New status').selectOption({ label: 'Needs Repair' });
    await status.getByRole('button', { name: 'Save status' }).click();
    await expect(popup(other).locator('.status-timeline li')).toHaveCount(2);

    await expect(popup(page).locator('.status-timeline li')).toHaveCount(2);
    await other.close();
  });
});

test.describe('local data', () => {
  test('counts changes, and can go back to the seed', async ({ page }) => {
    await openProfile(page, emptyBarangay.id);
    await profile(page).getByRole('button', { name: 'Edit baseline' }).click();
    await form(page, 'Edit baseline').getByLabel('Number of farmers').fill('9');
    await form(page, 'Edit baseline').getByRole('button', { name: 'Save baseline' }).click();
    await expect(profile(page).locator('.baseline')).toContainText('9');

    await page.getByRole('button', { name: 'Layers and filters' }).click();
    await expect(page.getByTestId('local-changes')).toContainText('1 change saved in this browser only.');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Discard local changes' }).click();

    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await openProfile(page, emptyBarangay.id);
    await expect(profile(page).locator('.baseline')).not.toContainText('9');
  });
});

test.describe('when the seed is rebuilt', () => {
  // The dev server serves the seed, so changing its bytes is what a rebuild looks like to the app.
  const serveRebuiltSeed = (page: Page) =>
    page.route('**/__local/seed.json', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()} ` });
    });

  test('an unchanged browser picks it up by itself', async ({ page }) => {
    await ready(page);
    await serveRebuiltSeed(page);
    await ready(page);
    await page.getByRole('button', { name: 'Layers and filters' }).click();
    await expect(page.getByTestId('local-changes')).toContainText('No changes yet.');
    await expect(page.getByText('The seed data was rebuilt.')).toHaveCount(0);
  });

  test('local changes are kept until the person chooses to discard them', async ({ page }) => {
    await openProfile(page, emptyBarangay.id);
    await profile(page).getByRole('button', { name: 'Edit baseline' }).click();
    await form(page, 'Edit baseline').getByLabel('Number of farmers').fill('77');
    await form(page, 'Edit baseline').getByRole('button', { name: 'Save baseline' }).click();
    await expect(profile(page).locator('.baseline')).toContainText('77');

    await serveRebuiltSeed(page);
    await openProfile(page, emptyBarangay.id);
    await expect(profile(page).locator('.baseline')).toContainText('77');
    await page.getByRole('button', { name: 'Layers and filters' }).click();
    await expect(page.getByText('The seed data was rebuilt.')).toBeVisible();

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Discard local changes' }).click();
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await openProfile(page, emptyBarangay.id);
    await expect(profile(page).locator('.baseline')).not.toContainText('77');
    await page.getByRole('button', { name: 'Layers and filters' }).click();
    await expect(page.getByText('The seed data was rebuilt.')).toHaveCount(0);
  });
});

test('editing logs no errors to the console', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('ERR_FAILED')) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await openPopup(page, cleanRecord);
  await popupAction(page, 'Edit').click();
  await form(page, 'Edit record').getByLabel('Remarks').fill('No errors');
  await form(page, 'Edit record').getByRole('button', { name: 'Save changes' }).click();
  await expect(popup(page)).toContainText('No errors');
  await popupAction(page, 'Update status').click();
  await select(form(page, 'Update status'), 'New status').selectOption({ label: 'Serviceable' });
  await form(page, 'Update status').getByRole('button', { name: 'Save status' }).click();
  await expect(popup(page).locator('.status-timeline li')).toHaveCount(2);

  expect(errors).toEqual([]);
});
