// The /admin screens in local mode, at desktop and phone sizes: an Admin changes the lists and forms,
// and the map and its forms follow with no code change. tests/admin.test.ts covers the rules against
// the real database, and e2e/auth.spec.ts covers the Users page under the site's real security headers.
import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

const BUTTON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>';

const select = (scope: Page | Locator, name: string) => scope.getByRole('combobox', { name: new RegExp(`^${name}`) });
const form = (page: Page, name: string) => page.getByRole('form', { name });
const row = (scope: Page | Locator, name: string) => scope.locator(`[data-row="${name}"]`);
const fieldNamed = (scope: Page | Locator, name: string) => scope.getByRole('group', { name: `Field: ${name}` });
const notice = (page: Page) => page.locator('.admin-notice');

async function tilesOff(page: Page) {
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
}

async function openAdmin(page: Page, path = '/admin/types') {
  await tilesOff(page);
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
}

async function goToMap(page: Page) {
  await page.getByRole('link', { name: 'Back to the map' }).click();
  await expect(page.locator('.barangay-shape')).toHaveCount(218);
}

async function goToSection(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name, exact: true }).click();
}

// On a phone, the filters are in a drawer.
async function withLayerPanel(page: Page, look: (panel: Locator) => Promise<unknown>) {
  const toggle = page.getByRole('button', { name: 'Layers and filters' });
  const drawer = await toggle.isVisible();
  if (drawer) await toggle.click();
  await look(page.getByRole('complementary', { name: 'Layers and filters' }));
  if (drawer) await page.getByRole('button', { name: 'Close layers' }).click();
}

async function addFieldTo(scope: Locator, label: string, kind?: string) {
  await scope.getByRole('button', { name: '+ Add a field' }).click();
  const added = scope.getByRole('group', { name: 'Field: new field' });
  if (kind) await added.getByLabel('Kind').selectOption({ label: kind });
  await added.getByLabel('Label').fill(label);
  return fieldNamed(scope, label);
}

// A screen scrolls inside its own area, so the page around it never should.
const fitsTheScreen = (page: Page) =>
  page.evaluate(() => {
    const { scrollWidth, scrollHeight } = document.documentElement;
    return scrollWidth <= window.innerWidth && scrollHeight <= window.innerHeight;
  });

test.describe('who is offered it', () => {
  test('an Admin gets a link there and back', async ({ page }) => {
    await tilesOff(page);
    await page.goto('/');
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await page.getByRole('link', { name: 'Admin' }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByRole('region', { name: 'Users' })).toContainText('Local mode has no accounts');
    await goToMap(page);
  });

  for (const role of ['encoder', 'viewer']) {
    test(`a ${role} isn't, even by going straight to the address`, async ({ page }) => {
      await tilesOff(page);
      await page.addInitScript((value) => localStorage.setItem('da-local-role', value), role);
      await page.goto('/');
      await expect(page.locator('.barangay-shape')).toHaveCount(218);
      await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);

      await page.goto('/admin/types');
      await expect(page.getByRole('alert')).toContainText('This page is for Admins');
      await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0);
      await page.getByRole('link', { name: 'Back to the map' }).click();
      await expect(page.locator('.barangay-shape')).toHaveCount(218);
    });
  }
});

test.describe('a new type', () => {
  test('is created with its own form, and used with no code change', async ({ page }) => {
    await openAdmin(page);
    await page.getByRole('link', { name: '+ Add type' }).click();
    const editor = form(page, 'Type');
    await editor.getByLabel('Name').fill('Nursery');
    await select(editor, 'Icon').selectOption({ label: 'Building' });
    await select(editor, 'Title').selectOption('required');
    await select(editor, 'Unit cost').selectOption('hidden');

    const capacity = await addFieldTo(editor, 'Seedling capacity', 'Number');
    await capacity.getByLabel('Unit').fill('pcs');

    const species = await addFieldTo(editor, 'Species', 'Dropdown');
    await species.getByLabel('Option 1 of Species').fill('Mango');
    await species.getByRole('button', { name: '+ Add an option' }).click();
    await species.getByLabel('Option 2 of Species').fill('Cacao');
    await species.getByLabel('Required').check();

    await addFieldTo(editor, 'Has shade net', 'Yes or no');
    await addFieldTo(editor, 'Date started', 'Date');
    await addFieldTo(editor, 'Site photo', 'Photo');

    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(page).toHaveURL(/\/admin\/types$/);
    await expect(row(page, 'Nursery')).toContainText('Point · 0 records · Active');

    await goToMap(page);
    await withLayerPanel(page, (panel) => expect(panel.getByLabel(/Nursery/)).toBeChecked());

    await page.getByRole('button', { name: '+ Add intervention' }).click();
    const add = form(page, 'Add intervention');
    await select(add, 'Type').selectOption({ label: 'Nursery' });
    await expect(add.getByLabel('Unit cost')).toHaveCount(0);
    await add.getByRole('button', { name: 'Save record' }).click();
    await expect(add.getByText('Species is required.')).toBeVisible();
    await expect(add.getByText('Title is required for Nursery.')).toBeVisible();

    await add.getByLabel('Title').fill('Provincial Nursery');
    await add.getByLabel(/Seedling capacity/).fill('500');
    await select(add, 'Species').selectOption({ label: 'Mango' });
    await select(add, 'Has shade net').selectOption('yes');
    await add.getByLabel('Date started').fill('2024-06-01');
    await add.getByLabel('Site photo').setInputFiles({ name: 'site.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
    await expect(add.getByText('site.jpg will be saved with the record.')).toBeVisible();
    await page.getByLabel('Type or paste coordinates').fill('13.4500, 121.8500');
    await page.getByRole('button', { name: 'Use', exact: true }).click();
    await select(add, 'Municipality').selectOption({ label: 'Boac' });
    await add.getByRole('button', { name: 'Save record' }).click();

    const popup = page.locator('.record-popup').filter({ hasText: 'Provincial Nursery' });
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('500 pcs');
    await expect(popup).toContainText('Mango');
    await expect(popup).toContainText('Has shade net');
    await expect(popup).toContainText('Yes');
    await popup.getByRole('button', { name: 'View photo' }).click();
    await expect(page.getByRole('dialog').locator('img')).toBeVisible();
  });

  test('gets a stable code from its name, and a starting status list', async ({ page }) => {
    await openAdmin(page, '/admin/types/new');
    const editor = form(page, 'Type');
    await expect(row(editor, 'Proposed').getByRole('radio')).toBeChecked();
    await expect(row(editor, 'Operational').getByRole('checkbox')).toBeChecked();

    await editor.getByLabel('Name').fill('Coco Coir Plant');
    await editor.getByRole('button', { name: 'Save type' }).click();
    await row(page, 'Coco Coir Plant').getByRole('link', { name: /Edit/ }).click();
    await expect(page.getByText('Code: coco-coir-plant.')).toBeVisible();

    await form(page, 'Type').getByLabel('Name').fill('Coir Plant');
    await form(page, 'Type').getByRole('button', { name: 'Save type' }).click();
    await row(page, 'Coir Plant').getByRole('link', { name: /Edit/ }).click();
    await expect(page.getByText('Code: coco-coir-plant.')).toBeVisible();
  });

  test('needs a name no other type has, and says what\'s wrong', async ({ page }) => {
    await openAdmin(page, '/admin/types/new');
    const editor = form(page, 'Type');
    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(editor.getByText('Enter a name.')).toBeVisible();
    await editor.getByLabel('Name').fill('SSIP');
    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(editor.getByText('That name is already used.')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/types\/new$/);
  });

  test('won\'t save with both ways of naming a record hidden', async ({ page }) => {
    await openAdmin(page, '/admin/types/new');
    const editor = form(page, 'Type');
    await editor.getByLabel('Name').fill('Nameless');
    await select(editor, 'Category').selectOption('hidden');
    await select(editor, 'Title').selectOption('hidden');
    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(editor.getByRole('alert').first()).toContainText('can\'t both be hidden');
  });
});

test.describe('a type with records', () => {
  test('keeps its geometry, and a status its records are at', async ({ page }) => {
    await openAdmin(page);
    await row(page, 'Farm Machinery').getByRole('link', { name: /Edit/ }).click();
    const editor = form(page, 'Type');
    await expect(select(editor, 'Geometry')).toBeDisabled();

    await row(editor, 'Turned-over').getByRole('button', { name: /Remove/ }).click();
    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(editor.getByText(/stays on the list until they move on/)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/types\/\d+$/);
  });

  test('taking away the default status passes the default on', async ({ page }) => {
    await openAdmin(page);
    await row(page, 'Other').getByRole('link', { name: /Edit/ }).click();
    const editor = form(page, 'Type');
    await expect(row(editor, 'Proposed').getByRole('radio')).toBeChecked();
    await row(editor, 'Proposed').getByRole('button', { name: /Remove/ }).click();
    await expect(row(editor, 'On-going').getByRole('radio')).toBeChecked();
  });

  test('warns before leaving the map, and comes back', async ({ page }) => {
    await openAdmin(page);
    let question = '';
    page.once('dialog', (dialog) => {
      question = dialog.message();
      void dialog.accept();
    });
    await row(page, 'SSIP').getByRole('button', { name: /Deactivate/ }).click();
    await expect(row(page, 'SSIP')).toContainText('Inactive');
    expect(question).toContain('4 records');

    await goToMap(page);
    await withLayerPanel(page, (panel) => expect(panel.getByLabel(/SSIP/)).toHaveCount(0));

    await page.getByRole('link', { name: 'Admin' }).click();
    await goToSection(page, 'Intervention types');
    await row(page, 'SSIP').getByRole('button', { name: /Activate/ }).click();
    await expect(row(page, 'SSIP')).toContainText('Active');
    await goToMap(page);
    await withLayerPanel(page, (panel) => expect(panel.getByLabel(/SSIP/)).toBeVisible());
  });

  test('changes order on the map too', async ({ page }) => {
    await openAdmin(page);
    await row(page, 'SSIP').getByRole('button', { name: 'Move SSIP up' }).click();
    await expect(page.locator('.admin-list [data-row]').first()).toHaveAttribute('data-row', 'SSIP');
    await goToMap(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    await expect(select(form(page, 'Add intervention'), 'Type').locator('option').first()).toHaveText('SSIP');
  });
});

test.describe('a line or polygon type', () => {
  const NOTE = 'Needs drawing tools (not yet built)';

  test('can\'t be activated from the list or its own page, and is never offered for a record', async ({ page }) => {
    await openAdmin(page);
    for (const name of ['Farm-to-Market Road', 'Irrigation Canal', 'Service Area']) {
      await expect(row(page, name)).toContainText(NOTE);
      await expect(row(page, name).getByRole('button', { name: /Activate/ })).toBeDisabled();
    }
    await expect(row(page, 'Postharvest Facility')).not.toContainText(NOTE);
    await expect(row(page, 'Postharvest Facility').getByRole('button', { name: /Activate/ })).toBeEnabled();

    await row(page, 'Service Area').getByRole('link', { name: /Edit/ }).click();
    const editor = form(page, 'Type');
    const active = editor.getByLabel(/^Active/);
    await expect(active).toBeDisabled();
    await expect(active).not.toBeChecked();
    await expect(active).toHaveAccessibleDescription(NOTE);

    // Everything else about it can still be set up.
    await editor.getByLabel('Name').fill('Service Areas');
    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(row(page, 'Service Areas')).toContainText('Inactive');

    await goToMap(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    const choices = select(form(page, 'Add intervention'), 'Type').locator('option');
    await expect(choices.filter({ hasText: 'Farm Machinery' })).toHaveCount(1);
    await expect(choices.filter({ hasText: /Farm-to-Market Road|Irrigation Canal|Service Area/ })).toHaveCount(0);
  });

  test('a new one saves as inactive, and going back to Point gives the switch back', async ({ page }) => {
    await openAdmin(page, '/admin/types/new');
    const editor = form(page, 'Type');
    const active = editor.getByLabel(/^Active/);
    await expect(active).toBeChecked();
    await expect(editor.getByText(NOTE)).toHaveCount(0);

    await select(editor, 'Geometry').selectOption('line');
    await expect(active).toBeDisabled();
    await expect(active).not.toBeChecked();
    await expect(editor.getByText(NOTE)).toBeVisible();

    await select(editor, 'Geometry').selectOption('point');
    await expect(active).toBeEnabled();
    await expect(active).toBeChecked();
    await expect(editor.getByText(NOTE)).toHaveCount(0);

    await select(editor, 'Geometry').selectOption('polygon');
    await editor.getByLabel('Name').fill('Greenhouse');
    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(row(page, 'Greenhouse')).toContainText('Polygon');
    await expect(row(page, 'Greenhouse')).toContainText('Inactive');
    await expect(row(page, 'Greenhouse')).toContainText(NOTE);
    await expect(row(page, 'Greenhouse').getByRole('button', { name: /Activate/ })).toBeDisabled();
  });
});

test.describe('the form builder', () => {
  async function editMachinery(page: Page) {
    await openAdmin(page);
    await row(page, 'Farm Machinery').getByRole('link', { name: /Edit/ }).click();
    return form(page, 'Type');
  }

  async function addFormFields(page: Page) {
    await goToMap(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    return form(page, 'Add intervention');
  }

  test('reorders fields, and the form follows', async ({ page }) => {
    const editor = await editMachinery(page);
    await editor.getByRole('button', { name: 'Move Engine No. up' }).click();
    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(page).toHaveURL(/\/admin\/types$/);

    const add = await addFormFields(page);
    const labels = await add.locator('.form-field label').allInnerTexts();
    expect(labels.indexOf('Engine No.')).toBeLessThan(labels.indexOf('Serial No.'));
  });

  test('archives a field, which leaves the form but can come back', async ({ page }) => {
    const editor = await editMachinery(page);
    await expect(fieldNamed(editor, 'Variant').getByLabel('Kind')).toBeDisabled();
    await fieldNamed(editor, 'Variant').getByRole('button', { name: /Archive/ }).click();
    await expect(fieldNamed(editor, 'Variant').getByLabel('Label')).toBeDisabled();
    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(page).toHaveURL(/\/admin\/types$/);

    const add = await addFormFields(page);
    await expect(add.getByLabel('Variant')).toHaveCount(0);
    await add.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByRole('link', { name: 'Admin' }).click();
    await goToSection(page, 'Intervention types');
    await row(page, 'Farm Machinery').getByRole('link', { name: /Edit/ }).click();
    await fieldNamed(form(page, 'Type'), 'Variant').getByRole('button', { name: /Restore/ }).click();
    await form(page, 'Type').getByRole('button', { name: 'Save type' }).click();
    await expect(page).toHaveURL(/\/admin\/types$/);

    await expect((await addFormFields(page)).getByLabel('Variant')).toBeVisible();
  });

  test('a new field that\'s only been typed can simply be removed', async ({ page }) => {
    const editor = await editMachinery(page);
    const added = await addFieldTo(editor, 'Mistake');
    await added.getByRole('button', { name: /Remove/ }).click();
    await expect(fieldNamed(editor, 'Mistake')).toHaveCount(0);
  });

  test('says what to fix: a blank label, a repeated label, and a dropdown without options', async ({ page }) => {
    const editor = await editMachinery(page);
    await editor.getByRole('button', { name: '+ Add a field' }).click();
    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(editor.getByText('Enter a label.')).toBeVisible();

    const repeated = editor.getByRole('group', { name: 'Field: new field' });
    await repeated.getByLabel('Label').fill('Variant');
    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(editor.getByText('Another field already has this label.')).toBeVisible();

    const dropdown = await addFieldTo(editor, 'Drive', 'Dropdown');
    await dropdown.getByRole('button', { name: 'Remove', exact: true }).first().click();
    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(dropdown.getByText('Add at least one option.')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/types\/\d+$/);
  });

  test('archives a dropdown option, which leaves the list but stays for a record that has it', async ({ page }) => {
    await openAdmin(page, '/admin/types/new');
    const editor = form(page, 'Type');
    await editor.getByLabel('Name').fill('Pump');
    const drive = await addFieldTo(editor, 'Drive', 'Dropdown');
    await drive.getByLabel('Option 1 of Drive').fill('Solar');
    await drive.getByRole('button', { name: '+ Add an option' }).click();
    await drive.getByLabel('Option 2 of Drive').fill('Diesel');
    await editor.getByRole('button', { name: 'Save type' }).click();

    await row(page, 'Pump').getByRole('link', { name: /Edit/ }).click();
    const saved = fieldNamed(form(page, 'Type'), 'Drive');
    await saved.locator('.admin-option').filter({ has: page.getByLabel('Option 2 of Drive') }).getByRole('button', { name: 'Archive' }).click();
    await form(page, 'Type').getByRole('button', { name: 'Save type' }).click();
    await expect(page).toHaveURL(/\/admin\/types$/);

    await goToMap(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    const add = form(page, 'Add intervention');
    await select(add, 'Type').selectOption({ label: 'Pump' });
    await expect(select(add, 'Drive').locator('option')).toHaveText(['Not set', 'Solar']);
  });
});

test.describe('the lists', () => {
  test('a new program reaches the filters and the form, in its own color and place', async ({ page }) => {
    await openAdmin(page, '/admin/programs');
    await page.getByRole('button', { name: '+ Add program' }).click();
    const add = form(page, 'Add program');
    await add.getByLabel('Name').fill('Coconut Program');
    await add.getByLabel('Color').fill('#123456');
    await add.getByRole('button', { name: 'Save' }).click();
    await expect(notice(page)).toContainText('Saved Coconut Program.');
    await expect(row(page, 'Coconut Program')).toContainText('0 records');

    await row(page, 'Coconut Program').getByRole('button', { name: 'Move Coconut Program up' }).click();
    await expect(page.locator('.admin-list [data-row]').nth(5)).toHaveAttribute('data-row', 'Coconut Program');

    await goToMap(page);
    await withLayerPanel(page, (panel) => expect(select(panel, 'Program').locator('option', { hasText: 'Coconut Program' })).toHaveCount(1));
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    await expect(select(form(page, 'Add intervention'), 'Banner program').locator('option', { hasText: 'Coconut Program' })).toHaveCount(1);
  });

  test('won\'t take a name that\'s used', async ({ page }) => {
    await openAdmin(page, '/admin/programs');
    await page.getByRole('button', { name: '+ Add program' }).click();
    const add = form(page, 'Add program');
    await add.getByRole('button', { name: 'Save' }).click();
    await expect(add.getByText('Enter a name.')).toBeVisible();
    await add.getByLabel('Name').fill('Rice Program');
    await add.getByRole('button', { name: 'Save' }).click();
    await expect(add.getByText('That name is already used.')).toBeVisible();
  });

  test('an archived program leaves new records\' choices, stays on records that have it, and can come back', async ({ page }) => {
    await openAdmin(page, '/admin/programs');
    await expect(row(page, 'Rice Program')).toContainText('62 records');
    await row(page, 'Rice Program').getByRole('button', { name: /Archive/ }).click();
    await expect(notice(page)).toContainText('Existing records keep it');
    await expect(row(page, 'Rice Program')).toContainText('Archived');

    await goToMap(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    await expect(select(form(page, 'Add intervention'), 'Banner program').locator('option', { hasText: 'Rice Program' })).toHaveCount(0);
    await form(page, 'Add intervention').getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByRole('link', { name: 'Admin' }).click();
    await goToSection(page, 'Programs');
    await expect(row(page, 'Rice Program')).toContainText('62 records');
    await row(page, 'Rice Program').getByRole('button', { name: /Restore/ }).click();
    await expect(row(page, 'Rice Program')).not.toContainText('Archived');
  });

  test('a new category is offered for its type only, with its group\'s icon', async ({ page }) => {
    await openAdmin(page, '/admin/categories');
    await page.getByRole('button', { name: '+ Add category' }).click();
    const add = form(page, 'Add category');
    await add.getByLabel('Name').fill('Coconut Dehusker');
    await select(add, 'Intervention type').selectOption({ label: 'Farm Machinery' });
    await select(add, 'Group').selectOption({ label: 'Processing' });
    await add.getByRole('button', { name: 'Save' }).click();
    await expect(row(page, 'Coconut Dehusker')).toContainText('Farm Machinery · Processing · 0 records');
    await expect(row(page, 'Coconut Dehusker').locator('img')).toBeVisible();

    await goToMap(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    const record = form(page, 'Add intervention');
    await expect(select(record, 'Category').locator('option', { hasText: 'Coconut Dehusker' })).toHaveCount(1);
    await select(record, 'Type').selectOption({ label: 'SSIP' });
    await expect(select(record, 'Category').locator('option', { hasText: 'Coconut Dehusker' })).toHaveCount(0);
  });

  test('a new status goes on a type\'s list, and an archived one stops being offered', async ({ page }) => {
    await openAdmin(page, '/admin/statuses');
    await page.getByRole('button', { name: '+ Add status' }).click();
    const add = form(page, 'Add status');
    await add.getByLabel('Name').fill('For Inspection');
    await add.getByRole('button', { name: 'Save' }).click();
    await expect(row(page, 'For Inspection')).toBeVisible();

    await goToSection(page, 'Intervention types');
    await row(page, 'Farm Machinery').getByRole('link', { name: /Edit/ }).click();
    const editor = form(page, 'Type');
    await select(editor, 'Add a status').selectOption({ label: 'For Inspection' });
    await row(editor, 'For Inspection').getByRole('radio').check();
    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(page).toHaveURL(/\/admin\/types$/);

    await goToMap(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    const status = select(form(page, 'Add intervention'), 'Status');
    await expect(status.locator('option:checked')).toHaveText('For Inspection');
    await form(page, 'Add intervention').getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByRole('link', { name: 'Admin' }).click();
    await goToSection(page, 'Statuses');
    await row(page, 'For Inspection').getByRole('button', { name: /Archive/ }).click();
    await expect(row(page, 'For Inspection')).toContainText('Archived');

    await goToMap(page);
    await page.getByRole('button', { name: '+ Add intervention' }).click();
    const after = select(form(page, 'Add intervention'), 'Status');
    await expect(after.locator('option', { hasText: 'For Inspection' })).toHaveCount(0);
    await expect(after.locator('option:checked')).toHaveText('Turned-over');
  });

  test('a status can be set to count as assessed or not, and % operational follows', async ({ page, isMobile }) => {
    await openAdmin(page, '/admin/statuses');
    await expect(row(page, 'Turned-over')).toContainText('Not counted as assessed');
    await expect(row(page, 'Serviceable')).not.toContainText('Not counted as assessed');

    // Count Turned-over as assessed, and it joins the figure: all 195 machines work, out of 195.
    await row(page, 'Turned-over').getByRole('button', { name: /^Edit/ }).click();
    const edit = form(page, 'Edit Turned-over');
    await expect(edit.getByLabel('Counts as assessed')).not.toBeChecked();
    await edit.getByLabel('Counts as assessed').check();
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(row(page, 'Turned-over')).not.toContainText('Not counted as assessed');

    await goToMap(page);
    if (isMobile) await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Dashboard' }).click();
    const notes = page.locator('[data-kpi="operational"] .kpi-note');
    await expect(page.locator('[data-kpi="operational"] .kpi-value')).toHaveText('100%', { timeout: 30_000 });
    await expect(notes.first()).toHaveText('Operational: 195 of 195 assessed');
    await expect(notes.nth(1)).toHaveText('2 inventory, 2 completed, not yet assessed');
  });

  test('a beneficiary type, location basis and category group can be added or renamed', async ({ page }) => {
    await openAdmin(page, '/admin/lists');
    await page.getByRole('button', { name: '+ Add beneficiary type' }).click();
    await form(page, 'Add beneficiary type').getByLabel('Name').fill('School');
    await form(page, 'Add beneficiary type').getByRole('button', { name: 'Save' }).click();
    await expect(row(page, 'School')).toBeVisible();

    await page.getByRole('button', { name: '+ Add location basis' }).click();
    await form(page, 'Add location basis').getByLabel('Name').fill('Survey point');
    await form(page, 'Add location basis').getByRole('button', { name: 'Save' }).click();
    await expect(row(page, 'Survey point')).toBeVisible();

    await row(page, 'Planting').getByRole('button', { name: /Edit/ }).click();
    await form(page, 'Edit Planting').getByLabel('Name').fill('Planting and seeding');
    await form(page, 'Edit Planting').getByRole('button', { name: 'Save' }).click();
    await expect(row(page, 'Planting and seeding')).toBeVisible();
    await expect(row(page, 'Planting and seeding').getByRole('button', { name: /Archive/ })).toHaveCount(0);
  });

  test('an icon file must be a plain drawing', async ({ page }) => {
    await openAdmin(page, '/admin/lists');
    await page.getByRole('button', { name: '+ Add icon' }).click();
    const add = form(page, 'Add icon');

    await add.getByLabel('SVG file').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>') });
    await expect(add.getByText('An icon can only hold shapes')).toBeVisible();
    await add.getByRole('button', { name: 'Save' }).click();
    await expect(add).toBeVisible();

    await add.getByLabel('SVG file').setInputFiles({ name: 'Round.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(BUTTON_SVG) });
    await expect(add.getByRole('img', { name: 'Preview' })).toBeVisible();
    await expect(add.getByLabel('Name')).toHaveValue('Round');
    await add.getByRole('button', { name: 'Save' }).click();
    await expect(row(page, 'Round')).toBeVisible();

    await goToSection(page, 'Intervention types');
    await row(page, 'SSIP').getByRole('link', { name: /Edit/ }).click();
    await select(form(page, 'Type'), 'Icon').selectOption({ label: 'Round' });
  });
});

test.describe('the barangay form', () => {
  test('gets a new field, which shows on every profile, with no photo option', async ({ page }) => {
    await openAdmin(page, '/admin/barangay-fields');
    const builder = form(page, 'Barangay fields');
    await builder.getByRole('button', { name: '+ Add a field' }).click();
    const added = builder.getByRole('group', { name: 'Field: new field' });
    await expect(added.getByLabel('Kind').locator('option', { hasText: 'Photo' })).toHaveCount(0);
    await added.getByLabel('Kind').selectOption({ label: 'Number' });
    await added.getByLabel('Label').fill('Rainfall');
    await fieldNamed(builder, 'Rainfall').getByLabel('Unit').fill('mm');
    await builder.getByRole('button', { name: 'Save barangay fields' }).click();
    await expect(notice(page)).toContainText('Saved the barangay fields.');

    // Saving twice mustn't give the new field a second key.
    await fieldNamed(builder, 'Rainfall').getByLabel('Label').fill('Annual rainfall');
    await builder.getByRole('button', { name: 'Save barangay fields' }).click();
    await expect(page.locator('.field-error')).toHaveCount(0);
    await expect(fieldNamed(builder, 'Annual rainfall').getByLabel('Kind')).toBeDisabled();

    await page.goto('/barangays/1');
    const profile = page.getByLabel(/^Profile of barangay/);
    await profile.getByRole('button', { name: 'Edit baseline' }).click();
    await expect(profile.getByLabel(/Annual rainfall/)).toBeVisible();
    await expect(profile.getByLabel(/rainfall/i)).toHaveCount(1);
  });
});

test.describe('another Admin at the same time', () => {
  async function secondTab(context: BrowserContext, path: string) {
    const page = await context.newPage();
    await tilesOff(page);
    await page.goto(path);
    return page;
  }

  test('an open map follows a change to a list, with no reload', async ({ page, context }) => {
    const map = await secondTab(context, '/');
    await expect(map.locator('.barangay-shape')).toHaveCount(218);
    let reloads = 0;
    map.on('framenavigated', () => {
      reloads += 1;
    });

    await openAdmin(page, '/admin/programs');
    await page.getByRole('button', { name: '+ Add program' }).click();
    await form(page, 'Add program').getByLabel('Name').fill('Coconut Program');
    await form(page, 'Add program').getByRole('button', { name: 'Save' }).click();
    await expect(notice(page)).toBeVisible();

    await withLayerPanel(map, (panel) => expect(select(panel, 'Program').locator('option', { hasText: 'Coconut Program' })).toHaveCount(1));
    expect(reloads).toBe(0);
  });

  test('a stale form is told, and can load the newer version instead of overwriting it', async ({ page, context }) => {
    await openAdmin(page);
    await row(page, 'SSIP').getByRole('link', { name: /Edit/ }).click();
    await form(page, 'Type').getByLabel('Name').fill('My edit');

    const other = await secondTab(context, '/admin/types');
    await row(other, 'SSIP').getByRole('link', { name: /Edit/ }).click();
    await form(other, 'Type').getByLabel('Name').fill('Their edit');
    await form(other, 'Type').getByRole('button', { name: 'Save type' }).click();
    await expect(row(other, 'Their edit')).toBeVisible();

    await expect(page.getByRole('alert')).toContainText('Someone else saved a change to this type');
    await expect(form(page, 'Type').getByRole('button', { name: 'Save type' })).toBeDisabled();
    await page.getByRole('button', { name: 'Load their version' }).click();
    await expect(form(page, 'Type').getByLabel('Name')).toHaveValue('Their edit');
    await expect(form(page, 'Type').getByRole('button', { name: 'Save type' })).toBeEnabled();
  });
});

test.describe('on any screen', () => {
  for (const path of ['/admin/users', '/admin/types', '/admin/types/1', '/admin/categories', '/admin/programs', '/admin/statuses', '/admin/lists', '/admin/barangay-fields', '/admin/audit']) {
    test(`${path} fits the screen, with no stray scrolling of the page`, async ({ page }) => {
      await openAdmin(page, path);
      await expect(page.locator('.admin-section').first()).toBeVisible();
      expect(await fitsTheScreen(page)).toBe(true);
    });
  }

  test('every section can be reached from the menu', async ({ page }) => {
    await openAdmin(page, '/admin');
    for (const [name, heading] of [
      ['Intervention types', 'Intervention types'],
      ['Categories', 'Categories'],
      ['Programs', 'Programs'],
      ['Statuses', 'Statuses'],
      ['Other lists', 'Category groups'],
      ['Barangay fields', 'Barangay fields'],
      ['Audit log', 'Audit log'],
      ['Users', 'Users'],
    ]) {
      await goToSection(page, name);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
  });
});

test.describe('the audit log', () => {
  const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as {
    interventions: { id: string; source_id: string; beneficiary: string; municipality_id: number; barangay_id: number | null; geojson: unknown; qa_flags: string[] }[];
    barangays: { id: number; name: string }[];
    municipalities: { id: number; name: string }[];
    lookups: { statuses: { id: number; name: string }[] };
  };
  const counted = new Map<string, number>();
  for (const r of seed.interventions) counted.set(r.beneficiary, (counted.get(r.beneficiary) ?? 0) + 1);
  const [first, second] = seed.interventions.filter((r) => r.geojson && r.barangay_id !== null && r.qa_flags.length === 0 && counted.get(r.beneficiary) === 1);
  const barangay = seed.barangays[0];
  const turnedOver = seed.lookups.statuses.find((status) => status.name === 'Turned-over')!;

  const log = (page: Page) => page.getByRole('region', { name: 'Audit log' });
  const filters = (page: Page) => log(page).getByRole('form', { name: 'Filter the audit log' });
  const lines = (page: Page) => log(page).locator('.audit-table tbody tr');
  const count = (page: Page) => log(page).locator('.records-count');
  const line = (page: Page, id: number) => log(page).locator(`tr[data-audit-entry="${id}"]`);
  const cell = (page: Page, id: number, column: number) => line(page, id).locator('td').nth(column);

  interface Entry {
    id: number;
    table_name: string;
    record_id: string | null;
    action: string;
    old_row?: Record<string, unknown> | null;
    new_row?: Record<string, unknown> | null;
    actor_id?: string | null;
    context?: Record<string, unknown> | null;
    at: string;
  }

  // Lines of every kind, on days of the test's choosing, straight into the browser's stored data.
  async function withLog(page: Page, entries: Entry[]) {
    await openAdmin(page, '/admin/audit');
    await expect(log(page)).toBeVisible();
    await page.evaluate(
      async (rows) => {
        const database = await new Promise<IDBDatabase>((resolve) => {
          const open = indexedDB.open('da-intervention-map-local');
          open.onsuccess = () => resolve(open.result);
        });
        const store = database.transaction('state', 'readwrite').objectStore('state');
        const state = await new Promise<{ rows: { auditLog: unknown[] } }>((resolve) => {
          const get = store.get('current');
          get.onsuccess = () => resolve(get.result);
        });
        state.rows.auditLog = rows;
        await new Promise((resolve) => {
          const put = store.put(state, 'current');
          put.onsuccess = resolve;
        });
      },
      entries.map((entry) => ({ old_row: null, new_row: null, actor_id: null, context: null, ...entry })),
    );
    await page.reload();
    await expect(log(page)).toBeVisible();
  }

  const ENTRIES: Entry[] = [
    { id: 1, table_name: 'interventions', record_id: first.id, action: 'update', old_row: { remarks: 'Old note' }, new_row: { remarks: 'New note' }, context: { kind: 'edit', reason: 'Asked by the MAO' }, at: '2026-01-15T00:30:00Z' },
    { id: 2, table_name: 'interventions', record_id: second.id, action: 'soft_delete', old_row: {}, new_row: {}, at: '2026-03-10T02:00:00Z' },
    // 1:30 in the morning of March 11 in Manila, though the stored time still says March 10.
    { id: 3, table_name: 'status_history', record_id: '900', action: 'insert', new_row: { intervention_id: first.id, status_id: turnedOver.id }, at: '2026-03-10T17:30:00Z' },
    { id: 4, table_name: 'exports', record_id: null, action: 'export', context: { format: 'csv', record_count: 5, file_name: 'Marinduque_Province.csv' }, at: '2026-04-01T03:00:00Z' },
    { id: 5, table_name: 'programs', record_id: '1', action: 'update', old_row: { id: 1, name: 'Old name' }, new_row: { id: 1, name: 'New name' }, at: '2026-04-02T03:00:00Z' },
    { id: 6, table_name: 'barangays', record_id: String(barangay.id), action: 'update', old_row: {}, new_row: {}, at: '2026-04-03T03:00:00Z' },
    { id: 7, table_name: 'interventions', record_id: first.id, action: 'update', old_row: {}, new_row: {}, actor_id: 'f0000000-0000-4000-8000-000000000009', at: '2026-04-04T03:00:00Z' },
  ];

  test('is for an Admin only, even by going straight to the address', async ({ page }) => {
    await tilesOff(page);
    await page.addInitScript(() => localStorage.setItem('da-local-role', 'encoder'));
    await page.goto('/admin/audit');
    await expect(page.getByRole('alert')).toContainText('This page is for Admins');
    await expect(log(page)).toHaveCount(0);
  });

  test('says who did what and when, newest first', async ({ page }) => {
    await withLog(page, ENTRIES);
    await expect(lines(page)).toHaveCount(ENTRIES.length);
    await expect(count(page)).toHaveText(`1–${ENTRIES.length} of ${ENTRIES.length}`);
    expect(await lines(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-audit-entry')))).toEqual(['7', '6', '5', '4', '3', '2', '1']);

    // In Philippine time, eight hours ahead of the stored one.
    await expect(cell(page, 1, 0)).toContainText('8:30');
    await expect(cell(page, 1, 1)).toHaveText('This browser');
    await expect(cell(page, 1, 2)).toHaveText('Edited');
    await expect(cell(page, 1, 4)).toContainText('Reason: Asked by the MAO');
    await expect(cell(page, 1, 4)).toContainText('Remarks: Old note → New note');

    await expect(cell(page, 2, 2)).toHaveText('Deleted');
    await expect(cell(page, 3, 4)).toContainText('Status set to Turned-over');
    await expect(cell(page, 4, 2)).toHaveText('Exported');
    await expect(cell(page, 4, 3)).toContainText('Export: Marinduque_Province.csv');
    await expect(cell(page, 4, 4)).toContainText('CSV, 5 records');
    await expect(cell(page, 5, 3)).toContainText('Program: New name');
    await expect(cell(page, 5, 4)).toContainText('name: Old name → New name');
    await expect(cell(page, 6, 3)).toContainText(`Barangay ${barangay.name}`);
    await expect(cell(page, 7, 1)).toHaveText('An account since removed');

    // Readable on any screen: the details aren't squeezed, and nothing sits off to the side.
    const details = (await cell(page, 1, 4).boundingBox())!;
    expect(details.width).toBeGreaterThanOrEqual(240);
    expect(details.x + details.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(await fitsTheScreen(page)).toBe(true);

    // The filters' labels line up, as their boxes are the same height.
    const heights = await filters(page).locator('input, select').evaluateAll((controls) => controls.map((control) => control.getBoundingClientRect().height));
    expect(new Set(heights).size).toBe(1);
  });

  test('filters by record, including its status changes', async ({ page }) => {
    await withLog(page, ENTRIES);
    const search = filters(page).getByLabel('Record');

    await search.fill(first.source_id);
    await expect(lines(page)).toHaveCount(3);
    await expect(line(page, 3)).toBeVisible();
    await expect(line(page, 2)).toHaveCount(0);
    await expect(count(page)).toHaveText('1–3 of 3');

    await search.fill(second.beneficiary.toUpperCase());
    await expect(lines(page)).toHaveCount(1);
    await expect(line(page, 2)).toBeVisible();

    await search.fill('zz nothing like this zz');
    await expect(log(page)).toContainText('Nothing in the log matches these filters.');
    await expect(lines(page)).toHaveCount(0);
    await expect(count(page)).toHaveText('0–0 of 0');
  });

  test('filters by action and by person', async ({ page }) => {
    await withLog(page, ENTRIES);
    await filters(page).getByLabel('Action').selectOption({ label: 'Exported' });
    await expect(lines(page)).toHaveCount(1);
    await expect(line(page, 4)).toBeVisible();
    await filters(page).getByRole('button', { name: 'Clear filters' }).click();
    await expect(lines(page)).toHaveCount(ENTRIES.length);

    await filters(page).getByLabel('Action').selectOption({ label: 'Edited' });
    await expect(lines(page)).toHaveCount(4);

    // The removed account isn't "this browser".
    await filters(page).getByLabel('Person').selectOption({ label: 'This browser' });
    await expect(lines(page)).toHaveCount(3);
    await expect(line(page, 7)).toHaveCount(0);
  });

  test('filters by date, by the day in Philippine time', async ({ page }) => {
    await withLog(page, ENTRIES);
    const from = filters(page).getByLabel('From', { exact: true });
    const to = filters(page).getByLabel('To', { exact: true });

    await from.fill('2026-03-01');
    await to.fill('2026-03-31');
    await expect(lines(page)).toHaveCount(2);

    await from.fill('2026-03-11');
    await to.fill('2026-03-11');
    await expect(lines(page)).toHaveCount(1);
    await expect(line(page, 3)).toBeVisible();

    await from.fill('2026-03-10');
    await to.fill('2026-03-10');
    await expect(lines(page)).toHaveCount(1);
    await expect(line(page, 2)).toBeVisible();
  });

  test('links to what each line is about', async ({ page }) => {
    await withLog(page, ENTRIES);
    await expect(line(page, 5).getByRole('link')).toHaveAttribute('href', '/admin/programs');
    await expect(line(page, 6).getByRole('link')).toHaveAttribute('href', `/barangays/${barangay.id}`);
    await expect(line(page, 4).getByRole('link')).toHaveCount(0);
    await expect(line(page, 3).getByRole('link')).toHaveAttribute('href', `/records/${first.id}`);

    await line(page, 1).getByRole('link').click();
    await expect(page.locator('.barangay-shape')).toHaveCount(218);
    await expect(page.locator('.record-popup').filter({ hasText: first.beneficiary })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/$/);
  });

  test('a link shows its record, even if the map\'s filters were hiding it', async ({ page }) => {
    await withLog(page, ENTRIES);
    await goToMap(page);
    const elsewhere = seed.municipalities.find((municipality) => municipality.id !== first.municipality_id)!;
    await withLayerPanel(page, (panel) => select(panel, 'Municipality').selectOption(String(elsewhere.id)));
    await expect(page.locator(`.intervention-marker[title="${first.beneficiary}"]`)).toHaveCount(0);

    await page.getByRole('link', { name: 'Admin' }).click();
    await goToSection(page, 'Audit log');
    await line(page, 1).getByRole('link').click();
    await expect(page.locator('.record-popup').filter({ hasText: first.beneficiary })).toBeVisible({ timeout: 15_000 });
    await withLayerPanel(page, (panel) => expect(select(panel, 'Municipality')).toHaveValue(''));
  });

  test('a link to a deleted record shows its history, reason and all', async ({ page }) => {
    await tilesOff(page);
    await page.goto(`/barangays/${second.barangay_id}`);
    const row = page.getByLabel(/^Profile of barangay/).locator('.record-row').filter({ hasText: second.beneficiary });
    await row.locator('.record-name').click();
    await page.locator('.leaflet-popup-content').getByRole('button', { name: 'Delete', exact: true }).click();
    const deleting = form(page, 'Delete record');
    await deleting.getByLabel('Reason (optional)').fill('Entered twice');
    await deleting.getByRole('button', { name: 'Delete record' }).click();
    await expect(page.getByText(/Record deleted/)).toBeVisible();

    await page.goto('/admin/audit');
    const deleted = lines(page).filter({ hasText: 'Deleted' }).first();
    await expect(deleted).toContainText('Reason: Entered twice');
    await expect(deleted).toContainText('This browser');
    await deleted.getByRole('link').click();

    await expect(page.getByLabel('Change history')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Change history')).toContainText('Reason: Entered twice');
    await expect(page.getByText(/This record was deleted/)).toBeVisible();
  });

  test('goes a page at a time, and a new filter starts again from the first', async ({ page }) => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      id: index + 1,
      table_name: 'interventions',
      record_id: index % 2 === 0 ? first.id : second.id,
      action: 'update',
      old_row: {},
      new_row: {},
      at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }));
    await withLog(page, many);
    const newer = log(page).getByRole('button', { name: 'Newer' });
    const older = log(page).getByRole('button', { name: 'Older' });

    await expect(lines(page)).toHaveCount(50);
    await expect(count(page)).toHaveText('1–50 of 120');
    await expect(lines(page).first()).toHaveAttribute('data-audit-entry', '120');
    await expect(newer).toBeDisabled();

    await older.click();
    await expect(count(page)).toHaveText('51–100 of 120');
    await expect(lines(page).first()).toHaveAttribute('data-audit-entry', '70');

    await older.click();
    await expect(count(page)).toHaveText('101–120 of 120');
    await expect(lines(page)).toHaveCount(20);
    await expect(older).toBeDisabled();
    expect(await fitsTheScreen(page)).toBe(true);

    await filters(page).getByLabel('Record').fill(first.source_id);
    await expect(count(page)).toHaveText('1–50 of 60');

    await filters(page).getByRole('button', { name: 'Clear filters' }).click();
    await expect(count(page)).toHaveText('1–50 of 120');
    await older.click();
    await newer.click();
    await expect(count(page)).toHaveText('1–50 of 120');
  });
});
