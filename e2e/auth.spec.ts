// Sign-in, roles, saving and live signals through the real Supabase client and app code, against a
// fake of the service's network protocol. The same tests also run on a production build, under the
// site's real security headers.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { jpegWithGps } from '../tests/helpers/exif-fixture';
import { FAKE_HOST, installFakeSupabase, inviteHash, PASSWORD, seedData, signIn, USERS, type FakeSupabase } from './helpers/fake-supabase';
import { fromAccountMenu, sidebar } from './helpers/shell';

const CSP = /Content-Security-Policy = "([^"]+)"/.exec(readFileSync('netlify.toml', 'utf8'))![1];

const SHAPES = 218;
const shapes = (page: Page) => page.locator('.barangay-shape');
const signInForm = (page: Page) => page.getByRole('form', { name: 'Sign in' });
const profile = (page: Page) => page.getByLabel(/^Profile of barangay/);

const countByBeneficiary = new Map<string, number>();
for (const r of seedData.interventions) countByBeneficiary.set(r.beneficiary, (countByBeneficiary.get(r.beneficiary) ?? 0) + 1);
const record = seedData.interventions.find(
  (r) => r.geojson && r.barangay_id !== null && r.qa_flags.length === 0 && countByBeneficiary.get(r.beneficiary) === 1,
)!;
const barangay = seedData.barangays.find((b) => b.id === record.barangay_id)!;

let violations: string[];

// On the production project the page gets the headers it will have once deployed, and anything
// they block fails the test.
test.beforeEach(async ({ page }, testInfo) => {
  violations = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text());
  });
  if (testInfo.project.name.startsWith('production')) {
    await page.route('http://localhost:5176/**', async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': CSP } });
    });
  }
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
});

test.afterEach(() => {
  expect(violations).toEqual([]);
});

async function signedIn(page: Page, user: (typeof USERS)[keyof typeof USERS], path = '/map') {
  const fake = await installFakeSupabase(page);
  await page.goto(path);
  await signIn(page, user);
  await expect(shapes(page)).toHaveCount(SHAPES);
  return fake;
}

const openRecordPopup = async (page: Page) => {
  await expect(profile(page)).toBeVisible();
  await profile(page).locator('.record-row').filter({ hasText: record.beneficiary }).locator('.record-name').click();
  await expect(page.locator('.record-popup').filter({ hasText: record.beneficiary })).toBeVisible();
};
const popupAction = (page: Page, name: string) => page.locator('.leaflet-popup-content').getByRole('button', { name, exact: true });

test.describe('before signing in', () => {
  test('shows only the sign-in form, and asks the service for no data', async ({ page }) => {
    const fake = await installFakeSupabase(page);
    await page.goto(`/barangays/${barangay.id}`);
    await expect(signInForm(page)).toBeVisible();
    await expect(shapes(page)).toHaveCount(0);
    await expect(page.getByText(record.beneficiary)).toHaveCount(0);
    expect(fake.restCalls).toEqual([]);
    await expect(page.getByText('Local mode')).toHaveCount(0);
  });

  test('says when the email or password is wrong, and stays on the form', async ({ page }) => {
    await installFakeSupabase(page);
    await page.goto('/map');
    await signIn(page, USERS.encoder, 'wrong password');
    await expect(signInForm(page).getByRole('alert')).toHaveText('Wrong email or password.');
    await expect(shapes(page)).toHaveCount(0);
  });

  test('explains that accounts are by invitation, with no sign-up option', async ({ page }) => {
    await installFakeSupabase(page);
    await page.goto('/map');
    await expect(signInForm(page)).toContainText('Accounts are by invitation');
    await expect(page.getByRole('button', { name: /sign up|register|create account/i })).toHaveCount(0);
  });
});

test.describe('accounts without access', () => {
  test('tells someone with no role, shows no data, and lets them sign out', async ({ page }) => {
    const fake = await installFakeSupabase(page);
    await page.goto('/map');
    await signIn(page, USERS.stranger);
    await expect(page.getByRole('heading', { name: 'This account has no access yet' })).toBeVisible();
    expect(fake.restCalls.filter((name) => name !== 'profiles')).toEqual([]);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(signInForm(page)).toBeVisible();
  });

  test('tells a deactivated person', async ({ page }) => {
    const fake = await installFakeSupabase(page);
    await page.goto('/map');
    await signIn(page, USERS.former);
    await expect(page.getByRole('heading', { name: 'This account has been deactivated' })).toBeVisible();
    expect(fake.restCalls.filter((name) => name !== 'profiles')).toEqual([]);
  });
});

test.describe('invite and reset links', () => {
  test('an invite asks for a password, checks it, then opens Home', async ({ page }) => {
    const fake = await installFakeSupabase(page);
    await page.goto(`/${inviteHash(USERS.encoder, 'invite')}`);
    const form = page.getByRole('form', { name: 'Set password' });
    await expect(form.getByRole('heading', { name: 'Welcome. Choose a password' })).toBeVisible();
    await expect(page).not.toHaveURL(/access_token/);

    // They must not reach the map, or they'd be left with no password to come back with.
    await page.waitForTimeout(500);
    await expect(form).toBeVisible();
    await expect(shapes(page)).toHaveCount(0);

    await form.getByLabel('New password').fill('short');
    await form.getByLabel('Repeat it').fill('short');
    await form.getByRole('button', { name: 'Save password' }).click();
    await expect(form.getByRole('alert')).toContainText('at least 8');

    await form.getByLabel('New password').fill('a good long password');
    await form.getByLabel('Repeat it').fill('a different password');
    await form.getByRole('button', { name: 'Save password' }).click();
    await expect(form.getByRole('alert')).toContainText('don\'t match');
    expect(fake.passwordUpdates).toEqual([]);

    await form.getByLabel('Repeat it').fill('a good long password');
    await form.getByRole('button', { name: 'Save password' }).click();
    // The invite link goes to the site's address, which is Home.
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Enzo' })).toBeVisible();
    expect(fake.passwordUpdates).toEqual(['a good long password']);
  });

  test('a reset link asks for a new password', async ({ page }) => {
    await installFakeSupabase(page);
    await page.goto(`/${inviteHash(USERS.viewer, 'recovery')}`);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  });

  test('a used or expired link says so and offers the sign-in form', async ({ page }) => {
    await installFakeSupabase(page);
    await page.goto('/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    await expect(signInForm(page).getByRole('alert')).toContainText('expired or was already used');
  });
});

test.describe('signed in', () => {
  test('shows the person\'s name and role, keeps them signed in, and signs out', async ({ page }) => {
    await signedIn(page, USERS.encoder);
    await expect(page.getByRole('button', { name: 'Account: Enzo Encoder, Encoder' })).toBeVisible();
    await expect(page.getByText('Local mode')).toHaveCount(0);

    await page.reload();
    await expect(shapes(page)).toHaveCount(SHAPES);
    await expect(signInForm(page)).toHaveCount(0);

    await fromAccountMenu(page, 'Sign out');
    await expect(signInForm(page)).toBeVisible();
    await expect(shapes(page)).toHaveCount(0);

    await page.reload();
    await expect(signInForm(page)).toBeVisible();
  });

  test('a person can change their password, or change their mind', async ({ page }) => {
    const fake = await signedIn(page, USERS.viewer);
    await fromAccountMenu(page, 'Change password');
    const form = page.getByRole('form', { name: 'Set password' });
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(shapes(page)).toHaveCount(SHAPES);

    await fromAccountMenu(page, 'Change password');
    await form.getByLabel('New password').fill('another long password');
    await form.getByLabel('Repeat it').fill('another long password');
    await form.getByRole('button', { name: 'Save password' }).click();
    await expect(shapes(page)).toHaveCount(SHAPES);
    expect(fake.passwordUpdates).toEqual(['another long password']);
  });

  test('a link straight to a barangay still opens it after signing in', async ({ page }) => {
    await signedIn(page, USERS.viewer, `/barangays/${barangay.id}`);
    await expect(profile(page)).toContainText(barangay.name);
  });

  test('says so if the data can\'t load', async ({ page }) => {
    const fake = await installFakeSupabase(page);
    fake.failReads(true);
    await page.goto('/map');
    await signIn(page, USERS.viewer);
    await expect(page.getByRole('heading', { name: 'The map could not load' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Database unavailable');
  });
});

test.describe('what each role is offered', () => {
  test('a Viewer sees everything but can change nothing', async ({ page }) => {
    await signedIn(page, USERS.viewer, `/barangays/${barangay.id}`);
    await expect(page.locator('.add-record-button')).toHaveCount(0);
    await expect(profile(page).getByRole('button', { name: 'Add intervention here' })).toHaveCount(0);
    await expect(profile(page).getByRole('button', { name: 'Edit baseline' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Deleted records/ })).toHaveCount(0);

    await openRecordPopup(page);
    const row = profile(page).locator('.record-row').filter({ hasText: record.beneficiary });
    await expect(row.locator('.record-actions')).toHaveCount(0);
    for (const name of ['Edit', 'Update status', 'History', 'Delete']) await expect(popupAction(page, name)).toHaveCount(0);

    // The status timeline stays, as do the tools for reading a location.
    await expect(page.locator('.status-timeline')).toBeVisible();
    await expect(popupAction(page, 'Copy coordinates')).toBeVisible();
  });

  test('an Encoder can edit and see History, but not the deleted records', async ({ page }) => {
    await signedIn(page, USERS.encoder, `/barangays/${barangay.id}`);
    await expect(page.locator('.add-record-button')).toBeVisible();
    await expect(page.getByRole('button', { name: /Deleted records/ })).toHaveCount(0);
    await openRecordPopup(page);
    for (const name of ['Edit', 'Update status', 'History', 'Delete']) await expect(popupAction(page, name)).toBeVisible();
  });

  test('an Admin also gets the deleted records', async ({ page, isMobile }) => {
    await signedIn(page, USERS.admin);
    if (isMobile) await page.getByRole('button', { name: 'Layers and filters' }).click();
    await expect(page.getByRole('button', { name: /Deleted records/ })).toBeVisible();
  });
});

test.describe('saving', () => {
  test('sends only what changed, with the version and the kind of change', async ({ page }) => {
    const fake = await signedIn(page, USERS.encoder, `/barangays/${barangay.id}`);
    fake.onRpc(({ name, args }) => (name === 'update_intervention' ? { status: 200, body: { ...record, version: (args.p_expected_version as number) + 1, remarks: 'Checked on site' } } : undefined));

    await openRecordPopup(page);
    await popupAction(page, 'Edit').click();
    const form = page.getByRole('form', { name: /record/i }).first();
    await form.getByLabel('Remarks').fill('Checked on site');
    await form.getByRole('button', { name: /^Save/ }).first().click();

    await expect.poll(() => fake.rpcCalls.find((call) => call.name === 'update_intervention')?.args).toEqual({
      p_id: record.id,
      p_expected_version: record.version,
      p_patch: { remarks: 'Checked on site' },
      p_note: { kind: 'edit' },
    });
  });

  test('a new barangay goes with its reason', async ({ page }) => {
    const other = seedData.barangays.find((b) => b.municipality_id === record.municipality_id && b.id !== record.barangay_id)!;
    const fake = await signedIn(page, USERS.encoder, `/barangays/${barangay.id}`);
    fake.onRpc(({ name, args }) => (name === 'update_intervention' ? { status: 200, body: { ...record, version: (args.p_expected_version as number) + 1, barangay_id: other.id } } : undefined));

    await openRecordPopup(page);
    await popupAction(page, 'Edit').click();
    const form = page.getByRole('form', { name: 'Edit record' });
    await form.getByRole('combobox', { name: /^Barangay/ }).selectOption(String(other.id));
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(form.getByText('Give a reason. It goes in the audit log.')).toBeVisible();
    expect(fake.rpcCalls.find((call) => call.name === 'update_intervention')).toBeUndefined();

    await form.getByLabel(/^Reason for changing the barangay/).fill('Checked with the MAO');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => fake.rpcCalls.find((call) => call.name === 'update_intervention')?.args).toEqual({
      p_id: record.id,
      p_expected_version: record.version,
      p_patch: { barangay_id: other.id },
      p_note: { kind: 'edit', reason: 'Checked with the MAO' },
    });
  });

  test('a version conflict tells the person, and keeps what they typed', async ({ page }) => {
    const fake = await signedIn(page, USERS.encoder, `/barangays/${barangay.id}`);
    fake.onRpc(({ name }) => (name === 'update_intervention' ? { status: 400, body: { code: 'DA409', message: 'This record was changed by someone else.' } } : undefined));

    await openRecordPopup(page);
    await popupAction(page, 'Edit').click();
    const form = page.getByRole('form', { name: /record/i }).first();
    await form.getByLabel('Remarks').fill('My typed note');
    await form.getByRole('button', { name: /^Save/ }).first().click();
    await expect(form.getByRole('alert').first()).toContainText('just changed');
    await expect(form.getByLabel('Remarks')).toHaveValue('My typed note');
  });

  test('a refusal from the database is explained in plain words', async ({ page }) => {
    const fake = await signedIn(page, USERS.encoder, `/barangays/${barangay.id}`);
    fake.onRpc(({ name }) => (name === 'update_barangay_baseline' ? { status: 403, body: { code: '42501', message: 'permission denied for table barangays' } } : undefined));

    await profile(page).getByRole('button', { name: 'Edit baseline' }).click();
    const form = page.getByRole('form', { name: 'Edit baseline' });
    await form.getByLabel(/Main crops/).fill('Rice');
    await form.getByRole('button', { name: 'Save baseline' }).click();
    await expect(form.getByRole('alert')).toContainText('doesn\'t have permission');
  });

  test('a lost connection says nothing was saved', async ({ page }) => {
    await signedIn(page, USERS.encoder, `/barangays/${barangay.id}`);
    await page.route(`${FAKE_HOST}/rest/v1/rpc/update_barangay_baseline`, (route) => route.abort('internetdisconnected'));

    await profile(page).getByRole('button', { name: 'Edit baseline' }).click();
    const form = page.getByRole('form', { name: 'Edit baseline' });
    await form.getByLabel(/Main crops/).fill('Rice');
    await form.getByRole('button', { name: 'Save baseline' }).click();
    await expect(form.getByRole('alert')).toContainText('No connection, so nothing was saved');
    await expect(form.getByLabel(/Main crops/)).toHaveValue('Rice');
  });

  test('uploads a status photo under its record, and links it in one save', async ({ page }) => {
    const fake = await signedIn(page, USERS.encoder, `/barangays/${barangay.id}`);
    const entry = seedData.status_history.find((e) => e.intervention_id === record.id)!;
    fake.onRpc(({ name }) => (name === 'add_status' ? { status: 200, body: { ...entry, id: 'new-entry' } } : undefined));

    await openRecordPopup(page);
    await popupAction(page, 'Update status').click();
    const form = page.getByRole('form', { name: /status/i }).first();
    await form.getByRole('combobox', { name: /^New status/ }).selectOption({ index: 1 });
    await form.locator('input[type="file"]').setInputFiles({ name: 'field.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpegWithGps(13.45, 121.85)) });
    await form.getByRole('button', { name: /^Save/ }).first().click();

    await expect.poll(() => fake.rpcCalls.some((call) => call.name === 'add_status')).toBe(true);
    const call = fake.rpcCalls.find((c) => c.name === 'add_status')!;
    const photo = call.args.p_photo as { id: string; storage_path: string; exif_location: { lat: number; lng: number } };
    expect(fake.uploads.map((upload) => upload.path)).toEqual([photo.storage_path]);
    expect(photo.storage_path).toMatch(new RegExp(`^${record.id}/${photo.id}\\.jpg$`));
    expect(photo.exif_location.lat).toBeCloseTo(13.45, 4);
  });

  test('opens a stored photo through a signed link', async ({ page }) => {
    const fake = await installFakeSupabase(page);
    const photoId = 'c0000000-0000-4000-8000-000000000001';
    const storagePath = `${record.id}/${photoId}.jpg`;
    fake.tables.intervention_photos = [{ id: photoId, intervention_id: record.id, storage_path: storagePath, caption: null, taken_at: null, exif_location: null, created_at: '2026-01-01T00:00:00Z' }];
    fake.tables.status_history = (fake.tables.status_history as { intervention_id: string }[]).map((entry) => (entry.intervention_id === record.id ? { ...entry, photo_id: photoId } : entry));

    await page.goto(`/barangays/${barangay.id}`);
    await signIn(page, USERS.viewer);
    await expect(shapes(page)).toHaveCount(SHAPES);
    await openRecordPopup(page);
    await popupAction(page, 'View photo').click();
    const image = page.getByRole('dialog', { name: 'Status photo' }).locator('img');
    await expect(image).toHaveAttribute('src', /fake\.supabase\.co\/storage\/v1\/object\/sign\/intervention-photos\/.+token=signed-token/);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  });

  test('History shows who made each change', async ({ page }) => {
    const fake = await signedIn(page, USERS.encoder, `/barangays/${barangay.id}`);
    fake.onRpc(({ name }) =>
      name === 'audit_for_intervention'
        ? {
            status: 200,
            body: [
              {
                id: 1,
                table_name: 'interventions',
                record_id: record.id,
                action: 'update',
                old_row: { remarks: null, geojson: { type: 'Point', coordinates: [121.8, 13.4] } },
                new_row: { remarks: 'Checked', geojson: { type: 'Point', coordinates: [121.9, 13.5] } },
                actor_id: USERS.admin.id,
                actor_name: 'Ana Admin',
                context: { kind: 'move', reason: 'GPS was off' },
                at: '2026-11-05T01:00:00Z',
              },
            ],
          }
        : undefined,
    );
    await openRecordPopup(page);
    await popupAction(page, 'History').click();
    const list = page.locator('.audit-list');
    await expect(list).toContainText('By Ana Admin');
    await expect(list).toContainText('Reason: GPS was off');
    await expect(list).toContainText('Remarks');
    await expect(list).toContainText('Location');
  });
});

test.describe('exporting', () => {
  const download = async (page: Page) => {
    const started = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: 'Download' }).click();
    return started;
  };

  test('a Viewer can export, the login is what names them, and the log gets the details', async ({ page }) => {
    const fake = await signedIn(page, USERS.viewer);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Barangay gap map').check();

    const file = await download(page);
    expect(file.suggestedFilename()).toMatch(/^Marinduque_Province_\d{4}-\d{2}-\d{2}\.kmz$/);

    const zip = await JSZip.loadAsync(await readFile((await file.path())!));
    expect(Object.keys(zip.files)[0]).toBe('doc.kml');
    const icons = Object.keys(zip.files).filter((name) => name.endsWith('.png'));
    expect(icons.length).toBeGreaterThan(1);
    const png = await zip.files[icons[0]].async('uint8array');
    expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const call = fake.rpcCalls.find(({ name }) => name === 'log_export')!;
    expect(call.args).toMatchObject({
      p_format: 'kmz',
      p_file_name: file.suggestedFilename(),
      p_record_count: seedData.interventions.length,
      p_filters: { municipality: null, program: null, layers: { gapMap: true, barangayBoundaries: false } },
    });
    expect(JSON.stringify(call.args)).not.toContain(USERS.viewer.id);
  });

  test('if the log can\'t be written, nothing is downloaded, and the person is told', async ({ page }) => {
    const fake = await signedIn(page, USERS.encoder);
    fake.onRpc(({ name }) => (name === 'log_export' ? { status: 403, body: { code: '42501', message: 'Only members can export' } } : undefined));
    let downloads = 0;
    page.on('download', () => {
      downloads += 1;
    });

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Download' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Nothing was exported.');
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('permission');
    expect(downloads).toBe(0);
  });
});

test.describe('the admin screens', () => {
  const peopleList = (page: Page) => page.getByRole('list', { name: 'Everyone' });
  const person = (page: Page, email: string) => peopleList(page).locator(`[data-row="${email}"]`);
  const inviteForm = (page: Page) => page.getByRole('form', { name: 'Invite someone' });

  async function openUsers(page: Page) {
    const fake = await signedIn(page, USERS.admin);
    await (await sidebar(page)).getByRole('link', { name: 'Users' }).click();
    await expect(peopleList(page)).toBeVisible();
    return fake;
  }

  test('only an Admin is offered them, and nobody else\'s browser calls the service', async ({ page }) => {
    const fake = await signedIn(page, USERS.encoder);
    await expect((await sidebar(page)).getByRole('link', { name: 'Users' })).toHaveCount(0);
    await page.goto('/admin/users');
    await expect(page.getByRole('alert')).toContainText('This page is for Admins');
    expect(fake.functionCalls).toEqual([]);
  });

  test('the Users page lists people, with their login on the request', async ({ page }) => {
    const fake = await openUsers(page);
    await expect(person(page, USERS.viewer.email)).toContainText('Vera Viewer');
    await expect(person(page, USERS.viewer.email)).toContainText('Active');
    await expect(person(page, USERS.former.email)).toContainText('Deactivated');
    await expect(person(page, USERS.stranger.email)).toContainText('No role yet');
    expect(fake.functionCalls[0]).toMatchObject({ name: 'admin-users', hasLogin: true, body: { action: 'list' } });
  });

  test('a long list scrolls inside its own area, not the whole page', async ({ page }) => {
    await openUsers(page);
    await expect(person(page, USERS.stranger.email)).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  });

  test('inviting by email needs no script, and the person appears as invited', async ({ page }) => {
    const fake = await openUsers(page);
    await inviteForm(page).getByRole('textbox', { name: /^Email/ }).fill('mao.gasan@example.test');
    await inviteForm(page).getByLabel('Full name').fill('Maria Santos');
    await inviteForm(page).getByLabel('Role').selectOption('encoder');
    await inviteForm(page).getByRole('button', { name: 'Invite' }).click();

    await expect(page.locator('.admin-notice')).toContainText('Invited mao.gasan@example.test');
    await expect(person(page, 'mao.gasan@example.test')).toContainText('Invited, hasn\'t set a password yet');
    const call = fake.functionCalls.find(({ body }) => body.action === 'invite')!;
    expect(call.body).toMatchObject({ email: 'mao.gasan@example.test', full_name: 'Maria Santos', role: 'encoder', delivery: 'email' });
    expect(call.body.redirect_to).toMatch(/^http:\/\/localhost/);
  });

  test('inviting by link shows it to the Admin, and only then', async ({ page, context }, testInfo) => {
    await openUsers(page);
    await inviteForm(page).getByRole('textbox', { name: /^Email/ }).fill('mao.boac@example.test');
    await inviteForm(page).getByLabel('Full name').fill('Jose Reyes');
    await inviteForm(page).getByRole('radio', { name: /link to send them myself/ }).check();
    await inviteForm(page).getByRole('button', { name: 'Invite' }).click();

    const box = page.getByLabel('Sign-in link');
    await expect(box).toHaveValue(/token=invite-token/);
    if (testInfo.project.name !== 'auth-mobile') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: /^Copy/ }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(box).toHaveCount(0);
  });

  test('a failed invitation keeps what was typed, and says why', async ({ page }) => {
    const fake = await openUsers(page);
    fake.onFunction(({ body }) => (body.action === 'invite' ? { status: 502, body: { message: 'The email could not be sent. Choose to get a link instead.' } } : undefined));
    await inviteForm(page).getByRole('textbox', { name: /^Email/ }).fill('mao.mogpog@example.test');
    await inviteForm(page).getByLabel('Full name').fill('Ana Cruz');
    await inviteForm(page).getByRole('button', { name: 'Invite' }).click();
    await expect(inviteForm(page).getByRole('alert')).toContainText('The email could not be sent');
    await expect(inviteForm(page).getByRole('textbox', { name: /^Email/ })).toHaveValue('mao.mogpog@example.test');
  });

  test('an Admin can set a role, send a new link, and deactivate and reactivate someone', async ({ page }) => {
    const fake = await openUsers(page);
    const viewer = person(page, USERS.viewer.email);

    await viewer.getByLabel(/^Role of/).selectOption('encoder');
    await expect(page.locator('.admin-notice')).toContainText('Vera Viewer is now Encoder');
    expect(fake.functionCalls.find(({ body }) => body.action === 'update')?.body).toMatchObject({ id: USERS.viewer.id, role: 'encoder' });

    await viewer.getByRole('button', { name: /Email a new link/ }).click();
    await expect(page.locator('.admin-notice')).toContainText(`A new link was emailed to ${USERS.viewer.email}`);

    await viewer.getByRole('button', { name: /Get a new link/ }).click();
    await expect(page.getByLabel('Sign-in link')).toHaveValue(/token=reset-token/);
    await page.getByRole('button', { name: 'Done' }).click();

    await viewer.getByRole('button', { name: /Edit name/ }).click();
    await viewer.getByLabel('Full name').fill('Vera V. Viewer');
    await viewer.getByRole('button', { name: 'Save' }).click();
    await expect(viewer).toContainText('Vera V. Viewer');

    page.once('dialog', (dialog) => void dialog.accept());
    await viewer.getByRole('button', { name: /Deactivate/ }).click();
    await expect(viewer).toContainText('Deactivated');
    await expect(viewer.getByLabel(/^Role of/)).toBeDisabled();

    await viewer.getByRole('button', { name: /Reactivate/ }).click();
    await expect(viewer).toContainText('Active');
  });

  test('cancelling the deactivate question changes nothing', async ({ page }) => {
    const fake = await openUsers(page);
    page.once('dialog', (dialog) => void dialog.dismiss());
    await person(page, USERS.viewer.email).getByRole('button', { name: /Deactivate/ }).click();
    expect(fake.functionCalls.some(({ body }) => body.action === 'deactivate')).toBe(false);
  });

  test('an Admin can\'t lock themselves out from their own row', async ({ page }) => {
    await openUsers(page);
    const me = person(page, USERS.admin.email);
    await expect(me).toContainText('(you)');
    await expect(me.getByLabel(/^Role of/)).toBeDisabled();
    await expect(me.getByRole('button', { name: /Deactivate/ })).toHaveCount(0);
  });

  test('says what to do if the function isn\'t deployed yet', async ({ page }) => {
    const fake = await installFakeSupabase(page);
    fake.onFunction(() => ({ status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } }));
    await page.goto('/admin/users');
    await signIn(page, USERS.admin);
    await expect(page.getByRole('alert')).toContainText('isn\'t set up on this project yet');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('a list saves through the real client, and a signal brings it to an open map', async ({ page }) => {
    const fake = await signedIn(page, USERS.admin);
    await page.goto('/admin/programs');
    await page.getByRole('button', { name: '+ Add program' }).click();
    const add = page.getByRole('form', { name: 'Add program' });
    await add.getByLabel('Name').fill('Coconut Program');
    await add.getByLabel('Color').fill('#123456');
    await add.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[data-row="Coconut Program"]')).toBeVisible();
    expect(fake.restWrites.find(({ table }) => table === 'programs')).toMatchObject({ method: 'POST', values: { code: 'coconut-program', name: 'Coconut Program', color: '#123456' } });

    await page.locator('[data-row="Rice Program"]').getByRole('button', { name: /Archive/ }).click();
    await expect(page.locator('[data-row="Rice Program"]')).toContainText('Archived');
    expect(fake.restWrites.at(-1)).toMatchObject({ method: 'PATCH', table: 'programs', values: { is_active: false } });
  });

  test('a type saves through its database function, with its status list and the version it started from', async ({ page }) => {
    const fake = await signedIn(page, USERS.admin);
    await page.goto('/admin/types');
    await page.locator('[data-row="SSIP"]').getByRole('link', { name: /Edit/ }).click();
    const editor = page.getByRole('form', { name: 'Type' });
    await editor.getByLabel('Name').fill('SSIP (renamed)');
    await editor.getByRole('button', { name: 'Save type' }).click();
    await expect(page.locator('[data-row="SSIP (renamed)"]')).toBeVisible();

    const { args } = fake.rpcCalls.find(({ name }) => name === 'save_intervention_type')!;
    expect(args).toMatchObject({ p_expected_version: 1, p_values: { code: 'ssip', name: 'SSIP (renamed)' } });
    expect((args.p_statuses as unknown[]).length).toBeGreaterThan(0);
  });

  test('an uploaded icon previews under the site\'s real security rules', async ({ page }) => {
    await signedIn(page, USERS.admin);
    await page.goto('/admin/lists');
    await page.getByRole('button', { name: '+ Add icon' }).click();
    const add = page.getByRole('form', { name: 'Add icon' });
    await add.getByLabel('SVG file').setInputFiles({
      name: 'Round.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>'),
    });
    await expect.poll(() => add.getByRole('img', { name: 'Preview' }).evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  });
});

test.describe('the dashboard and records table', () => {
  const panel = (page: Page) => page.getByRole('complementary', { name: 'Dashboard and records' });
  const tabs = (page: Page) => page.getByRole('navigation', { name: 'Views' });

  // The panel beside the map starts closed on a computer, and opens from the map's Dashboard button.
  async function showDashboard(page: Page, isMobile: boolean) {
    if (isMobile) await tabs(page).getByRole('button', { name: 'Dashboard' }).click();
    else await page.locator('.map-toolbar').getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page.locator('[data-kpi="records"] .kpi-value')).toBeVisible({ timeout: 30_000 });
  }

  async function showRecords(page: Page, isMobile: boolean) {
    if (isMobile) await tabs(page).getByRole('button', { name: 'List' }).click();
    else {
      await page.locator('.map-toolbar').getByRole('button', { name: 'Dashboard', exact: true }).click();
      await panel(page).getByRole('button', { name: 'Records', exact: true }).click();
    }
    await expect(page.getByRole('region', { name: 'Records table' })).toBeVisible({ timeout: 30_000 });
  }

  test('the chart library loads and draws under the site\'s real security rules', async ({ page, isMobile }) => {
    await signedIn(page, USERS.viewer);
    await showDashboard(page, isMobile);
    await expect(page.locator('[data-kpi="records"] .kpi-value')).toHaveText(String(seedData.interventions.length));
    for (const name of ['Units by municipality', 'Units by program', 'Units by year funded', 'Units by category (top 15)', 'Status by municipality']) {
      await expect(page.getByRole('figure', { name }).locator('.recharts-bar-rectangle').first()).toBeVisible();
    }
    await page.getByRole('figure', { name: 'Units by municipality' }).getByRole('button', { name: /Show table/ }).click();
    await expect(page.getByRole('figure', { name: 'Units by municipality' }).locator('tbody tr')).toHaveCount(seedData.municipalities.length);
  });

  test('a row opens its record, whatever the login', async ({ page, isMobile }) => {
    await signedIn(page, USERS.viewer);
    await showRecords(page, isMobile);
    await page.getByRole('searchbox', { name: 'Search these records' }).fill(record.source_id);
    await page.locator(`tr[data-record="${record.id}"]`).click();
    await expect(page.locator('.record-popup').filter({ hasText: record.beneficiary })).toBeVisible({ timeout: 15_000 });
  });

  test('exporting the table logs what it was: the count, the filters and the search', async ({ page, isMobile }) => {
    const fake = await signedIn(page, USERS.viewer);
    await showRecords(page, isMobile);
    await page.getByRole('searchbox', { name: 'Search these records' }).fill(record.source_id);
    await expect(page.locator('.records-table tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: 'Export this table' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /^CSV/ }).check();
    const started = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download' }).click();
    const file = await started;

    const call = fake.rpcCalls.find(({ name }) => name === 'log_export')!;
    expect(call.args).toMatchObject({ p_format: 'csv', p_file_name: file.suggestedFilename(), p_record_count: 1, p_filters: { search: record.source_id } });
    expect(file.suggestedFilename()).not.toContain(record.source_id);
  });

  test('a link straight to a record still opens it after signing in', async ({ page }) => {
    await signedIn(page, USERS.viewer, `/map/records/${record.id}`);
    await expect(page.locator('.record-popup').filter({ hasText: record.beneficiary })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/map$/);
  });
});

test.describe('saved views', () => {
  const layers = (page: Page) => page.getByRole('complementary', { name: 'Layers and filters' });
  const savedView = (page: Page, name: string) => layers(page).locator(`[data-view="${name}"]`);
  const viewWrites = (fake: FakeSupabase) => fake.restWrites.filter(({ table }) => table === 'saved_views');
  const gasan = seedData.municipalities.find((m) => m.name === 'Gasan')!;
  const inGasan = seedData.barangays.filter((b) => b.municipality_id === gasan.id).length;

  async function openLayers(page: Page, isMobile: boolean) {
    if (isMobile) await page.getByRole('button', { name: 'Layers and filters' }).click();
    await expect(layers(page)).toBeVisible();
  }

  const sharedView = (changes: Record<string, unknown> = {}) => ({
    id: 'b0000000-0000-4000-8000-000000000099',
    name: 'Gasan first',
    owner_id: USERS.encoder.id,
    is_shared: true,
    is_default: false,
    config: { layers: {}, filters: { municipalityId: gasan.id }, style: {}, basemap: 'osm', extent: null },
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    ...changes,
  });

  test('saving sends only the name, settings and sharing, and the login makes it theirs', async ({ page, isMobile }) => {
    const fake = await signedIn(page, USERS.viewer);
    await openLayers(page, isMobile);
    await layers(page).getByRole('button', { name: 'Save this view' }).click();
    const form = layers(page).getByRole('form', { name: 'Save this view' });
    await form.getByLabel('Name').fill('My view');
    await form.getByRole('button', { name: 'Save view' }).click();
    await expect(savedView(page, 'My view')).toContainText('Personal');

    const [added] = viewWrites(fake);
    expect(added.method).toBe('POST');
    expect(Object.keys(added.values).sort()).toEqual(['config', 'is_shared', 'name']);
    expect(added.values).toMatchObject({ name: 'My view', is_shared: false });
    expect(JSON.stringify(added.values)).not.toContain(USERS.viewer.id);

    // Each change sends just what changed, and a Viewer can do all of it to their own view.
    await savedView(page, 'My view').getByRole('button', { name: /^Share/ }).click();
    await expect(savedView(page, 'My view')).toContainText('Shared by you');
    expect(viewWrites(fake).at(-1)).toMatchObject({ method: 'PATCH', values: { is_shared: true } });
    expect(Object.keys(viewWrites(fake).at(-1)!.values)).toEqual(['is_shared']);

    await savedView(page, 'My view').getByRole('button', { name: /^Update/ }).click();
    await expect.poll(() => Object.keys(viewWrites(fake).at(-1)!.values)).toEqual(['config']);

    // Choosing what everyone opens on is an Admin's job.
    await expect(savedView(page, 'My view').getByRole('button', { name: /Open on this/ })).toHaveCount(0);

    page.once('dialog', (dialog) => void dialog.accept());
    await savedView(page, 'My view').getByRole('button', { name: /^Delete/ }).click();
    await expect(savedView(page, 'My view')).toHaveCount(0);
    expect(viewWrites(fake).at(-1)).toMatchObject({ method: 'DELETE' });
  });

  test('a view someone else shares arrives on an open map, with no reload', async ({ page, isMobile }) => {
    const fake = await signedIn(page, USERS.viewer);
    await expect.poll(() => fake.channelJoins.length).toBeGreaterThan(0);
    await openLayers(page, isMobile);
    fake.tables.saved_views.push(sharedView());
    fake.sendSignal();
    await expect(savedView(page, 'Gasan first')).toContainText('Shared by Enzo Encoder', { timeout: 15_000 });
    // It's not theirs, so there's nothing to change.
    await expect(savedView(page, 'Gasan first').getByRole('button')).toHaveCount(1);
  });

  test('an Admin makes one the default, through the database function', async ({ page, isMobile }) => {
    const fake = await signedIn(page, USERS.admin);
    fake.tables.saved_views.push(sharedView());
    await page.reload();
    await expect(shapes(page)).toHaveCount(SHAPES);
    await openLayers(page, isMobile);

    await savedView(page, 'Gasan first').getByRole('button', { name: /Open on this/ }).click();
    await expect(savedView(page, 'Gasan first')).toContainText('Opens by default');
    expect(fake.rpcCalls.find(({ name }) => name === 'set_default_view')?.args).toEqual({ p_id: sharedView().id });
    expect(viewWrites(fake).filter(({ values }) => 'is_default' in values)).toEqual([]);

    await savedView(page, 'Gasan first').getByRole('button', { name: /Stop opening on this/ }).click();
    await expect(savedView(page, 'Gasan first')).not.toContainText('Opens by default');
    expect(fake.rpcCalls.filter(({ name }) => name === 'set_default_view').at(-1)?.args).toEqual({ p_id: null });
  });

  test('everyone opens on the default, after signing in too', async ({ page }) => {
    const fake = await installFakeSupabase(page);
    fake.tables.saved_views.push(sharedView({ is_default: true }));
    await page.goto('/map');
    await signIn(page, USERS.viewer);
    await expect(shapes(page)).toHaveCount(SHAPES);
    await expect(page.getByText('Opened on the shared view "Gasan first".')).toBeVisible();
    await expect(page.getByLabel('Map legend').locator('.legend-summary')).toContainText(`of ${inGasan} barangays`);
  });

  test('a refusal from the database is explained', async ({ page, isMobile }) => {
    const fake = await signedIn(page, USERS.admin);
    fake.tables.saved_views.push(sharedView());
    await page.reload();
    await expect(shapes(page)).toHaveCount(SHAPES);
    fake.onRpc(({ name }) => (name === 'set_default_view' ? { status: 400, body: { code: '23514', message: 'only a shared view can be the default' } } : undefined));
    await openLayers(page, isMobile);
    await savedView(page, 'Gasan first').getByRole('button', { name: /Open on this/ }).click();
    await expect(layers(page).getByRole('alert')).toContainText('only a shared view can be the default');
    await expect(savedView(page, 'Gasan first')).not.toContainText('Opens by default');
  });
});

test.describe('the audit log page', () => {
  const log = (page: Page) => page.getByRole('region', { name: 'Audit log' });
  const pageCalls = (fake: FakeSupabase) => fake.rpcCalls.filter(({ name }) => name === 'audit_log_page').map(({ args }) => args);
  const filters = (page: Page) => log(page).getByRole('form', { name: 'Filter the audit log' });

  async function openLog(page: Page) {
    const fake = await signedIn(page, USERS.admin);
    fake.tables.audit_log.push(
      { id: 1, table_name: 'interventions', record_id: record.id, action: 'update', old_row: { remarks: 'Old note' }, new_row: { remarks: 'New note' }, actor_id: USERS.encoder.id, actor_name: 'Enzo Encoder', context: { kind: 'edit', reason: 'Asked by the MAO' }, at: '2026-11-01T01:00:00Z' },
      { id: 2, table_name: 'exports', record_id: null, action: 'export', old_row: null, new_row: null, actor_id: USERS.viewer.id, actor_name: 'Vera Viewer', context: { format: 'kmz', record_count: 199, file_name: 'Marinduque.kmz' }, at: '2026-11-02T01:00:00Z' },
      { id: 3, table_name: 'interventions', record_id: record.id, action: 'update', old_row: {}, new_row: {}, actor_id: null, actor_name: null, context: null, at: '2026-11-03T01:00:00Z' },
    );
    await page.goto('/admin/audit');
    await expect(log(page)).toBeVisible();
    return fake;
  }

  test('asks the database for a page at a time, and names people', async ({ page }) => {
    const fake = await openLog(page);
    await expect(log(page).locator('tr[data-audit-entry]')).toHaveCount(3);
    expect(pageCalls(fake)[0]).toEqual({ p_actor: null, p_no_actor: false, p_records: null, p_action: null, p_from: null, p_to: null, p_limit: 50, p_offset: 0 });
    await expect(log(page).locator('tr[data-audit-entry="1"]')).toContainText('Enzo Encoder');
    await expect(log(page).locator('tr[data-audit-entry="1"]')).toContainText('Reason: Asked by the MAO');
    await expect(log(page).locator('tr[data-audit-entry="2"]')).toContainText('Vera Viewer');
    await expect(log(page).locator('tr[data-audit-entry="3"]')).toContainText('No login (a script or Supabase\'s dashboard)');
  });

  test('sends each filter to the database', async ({ page }) => {
    const fake = await openLog(page);
    await expect(log(page).locator('tr[data-audit-entry]')).toHaveCount(3);

    await filters(page).getByLabel('Person').selectOption({ label: 'Enzo Encoder' });
    await expect.poll(() => pageCalls(fake).at(-1)?.p_actor).toBe(USERS.encoder.id);
    await expect(log(page).locator('tr[data-audit-entry]')).toHaveCount(1);

    await filters(page).getByLabel('Person').selectOption({ label: 'No login (a script or Supabase\'s dashboard)' });
    await expect.poll(() => pageCalls(fake).at(-1)).toMatchObject({ p_actor: null, p_no_actor: true });

    await filters(page).getByRole('button', { name: 'Clear filters' }).click();
    await filters(page).getByLabel('Action').selectOption({ label: 'Exported' });
    await expect.poll(() => pageCalls(fake).at(-1)?.p_action).toBe('export');

    await filters(page).getByRole('button', { name: 'Clear filters' }).click();
    await filters(page).getByLabel('Record').fill(record.source_id);
    await expect.poll(() => pageCalls(fake).at(-1)?.p_records).toEqual([record.id]);

    // The whole of each day, in Philippine time.
    await filters(page).getByRole('button', { name: 'Clear filters' }).click();
    await filters(page).getByLabel('From', { exact: true }).fill('2026-11-01');
    await filters(page).getByLabel('To', { exact: true }).fill('2026-11-02');
    await expect.poll(() => pageCalls(fake).at(-1)).toMatchObject({ p_from: '2026-11-01T00:00:00.000+08:00', p_to: '2026-11-02T23:59:59.999+08:00' });

    // A record that matches nothing needs no question at all.
    const asked = pageCalls(fake).length;
    await filters(page).getByRole('button', { name: 'Clear filters' }).click();
    await expect.poll(() => pageCalls(fake).length).toBe(asked + 1);
    await filters(page).getByLabel('Record').fill('zz nothing like this zz');
    await expect(log(page)).toContainText('Nothing in the log matches these filters.');
    expect(pageCalls(fake).length).toBe(asked + 1);
  });

  test('a line links to its record', async ({ page }) => {
    await openLog(page);
    await log(page).locator('tr[data-audit-entry="1"]').getByRole('link').click();
    await expect(page.locator('.record-popup').filter({ hasText: record.beneficiary })).toBeVisible({ timeout: 15_000 });
  });

  test('says so if the log can\'t be read', async ({ page }) => {
    const fake = await signedIn(page, USERS.admin);
    fake.onRpc(({ name }) => (name === 'audit_log_page' ? { status: 403, body: { code: '42501', message: 'Only Admins can do this.' } } : undefined));
    await page.goto('/admin/audit');
    await expect(log(page).getByRole('alert')).toContainText('The log could not be read.');
  });

  for (const role of ['encoder', 'viewer'] as const) {
    test(`a ${role} is refused, and their browser never asks`, async ({ page }) => {
      const fake = await signedIn(page, USERS[role]);
      await page.goto('/admin/audit');
      await expect(page.getByRole('alert')).toContainText('This page is for Admins');
      expect(pageCalls(fake)).toEqual([]);
    });
  }
});

test.describe('live updates', () => {
  async function whenJoined(fake: FakeSupabase) {
    await expect.poll(() => fake.channelJoins.length).toBeGreaterThan(0);
  }

  test('joins the private channel with the login token', async ({ page }) => {
    const fake = await signedIn(page, USERS.viewer);
    await whenJoined(fake);
    expect(fake.channelJoins[0]).toEqual({ topic: 'realtime:map-changes', isPrivate: true, hasToken: true });
  });

  test('a signal brings another person\'s change onto the map, without a reload', async ({ page }) => {
    const fake = await signedIn(page, USERS.viewer, `/barangays/${barangay.id}`);
    await whenJoined(fake);
    const row = profile(page).locator('.record-row').filter({ hasText: record.beneficiary });
    await expect(row).toBeVisible();

    const addedName = 'Added elsewhere FCA';
    const added = { ...record, id: 'd0000000-0000-4000-8000-000000000001', beneficiary: addedName, version: 1 };
    fake.tables.interventions_v = [...fake.tables.interventions_v, added];
    fake.tables.intervention_barangays = [...fake.tables.intervention_barangays, { intervention_id: added.id, barangay_id: barangay.id, link_source: 'encoded' }];
    fake.sendSignal();
    await expect(profile(page).locator('.record-row').filter({ hasText: addedName })).toBeVisible({ timeout: 2000 });

    // A delete elsewhere reaches a Viewer the same way, though the row is hidden from them.
    fake.tables.interventions_v = (fake.tables.interventions_v as { id: string }[]).filter((r) => r.id !== record.id);
    fake.sendSignal();
    await expect(row).toHaveCount(0, { timeout: 2000 });
  });

  test('several signals at once cause one reload', async ({ page }) => {
    const fake = await signedIn(page, USERS.viewer);
    await whenJoined(fake);
    const before = fake.restCalls.filter((name) => name === 'interventions_v').length;
    for (let i = 0; i < 5; i++) fake.sendSignal();
    await expect.poll(() => fake.restCalls.filter((name) => name === 'interventions_v').length).toBe(before + 1);
    await page.waitForTimeout(600);
    expect(fake.restCalls.filter((name) => name === 'interventions_v').length).toBe(before + 1);
  });

  test('says when updates stop, and catches up when they return', async ({ page }) => {
    const fake = await signedIn(page, USERS.viewer, `/barangays/${barangay.id}`);
    await whenJoined(fake);
    const notice = page.locator('.connection-notice');
    await expect(notice).toHaveCount(0);

    fake.refuseSockets(true);
    fake.dropSockets();
    await expect(notice).toContainText('Live updates paused', { timeout: 30_000 });

    // A change made while disconnected, which no signal will ever announce.
    const addedName = 'Added while away FCA';
    const added = { ...record, id: 'd0000000-0000-4000-8000-000000000002', beneficiary: addedName, version: 1 };
    fake.tables.interventions_v = [...fake.tables.interventions_v, added];
    fake.tables.intervention_barangays = [...fake.tables.intervention_barangays, { intervention_id: added.id, barangay_id: barangay.id, link_source: 'encoded' }];

    fake.refuseSockets(false);
    await expect(notice).toHaveCount(0, { timeout: 45_000 });
    await expect(profile(page).locator('.record-row').filter({ hasText: addedName })).toBeVisible({ timeout: 5000 });
  });

  test('catches up when a phone comes back to the page', async ({ page }) => {
    const fake = await signedIn(page, USERS.viewer);
    await whenJoined(fake);
    const before = fake.restCalls.filter((name) => name === 'interventions_v').length;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => fake.restCalls.filter((name) => name === 'interventions_v').length).toBe(before + 1);
  });
});

test('stays signed out for a person who was never given the password', async ({ page }) => {
  await installFakeSupabase(page);
  await page.goto('/map');
  await signIn(page, USERS.admin, `${PASSWORD}x`);
  await expect(signInForm(page).getByRole('alert')).toBeVisible();
});

test.describe('QA and import', () => {
  const flagged = seedData.interventions.filter((r) => r.qa_flags.join() === 'barangay_mismatch');
  const item = (page: Page, id: string) => page.locator(`.queue-item[data-record="${id}"][data-flag="barangay_mismatch"]`);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

  test('a Viewer isn\'t offered it, and their browser asks the service for nothing there', async ({ page }) => {
    const fake = await signedIn(page, USERS.viewer);
    await expect((await sidebar(page)).getByRole('link', { name: 'QA queue' })).toHaveCount(0);
    await page.goto('/qa');
    await expect(page.getByRole('alert')).toContainText('This page is for Encoders and Admins');
    expect(fake.rpcCalls.map(({ name }) => name).filter((name) => /import|flag/.test(name))).toEqual([]);
  });

  test('a dismissal goes to its database function with the reason, and a refusal is explained', async ({ page }) => {
    const fake = await signedIn(page, USERS.encoder);
    fake.onRpc((call) => {
      if (call.name !== 'dismiss_flag') return undefined;
      return call.args.p_id === flagged[0].id ? { status: 200, body: null } : { status: 400, body: { code: '23514', message: 'That flag is no longer on this record.' } };
    });
    await (await sidebar(page)).getByRole('link', { name: 'QA queue' }).click();
    await expect(page.getByRole('main', { name: 'QA queue' })).toBeVisible();

    await item(page, flagged[0].id).getByRole('button', { name: 'Dismiss' }).click();
    await page.getByRole('form', { name: /^Dismiss: / }).getByLabel(/^Reason/).fill('At the FCA office');
    await page.getByRole('form', { name: /^Dismiss: / }).getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('.admin-notice')).toContainText('Flag dismissed for');
    expect(fake.rpcCalls.filter(({ name }) => name === 'dismiss_flag').map(({ args }) => args)).toEqual([{ p_id: flagged[0].id, p_flag: 'barangay_mismatch', p_reason: 'At the FCA office' }]);

    await item(page, flagged[1].id).getByRole('button', { name: 'Dismiss' }).click();
    await page.getByRole('form', { name: /^Dismiss: / }).getByLabel(/^Reason/).fill('Checked');
    await page.getByRole('form', { name: /^Dismiss: / }).getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByRole('form', { name: /^Dismiss: / }).getByRole('alert')).toHaveText('That flag is no longer on this record.');
  });

  test('a workbook is read under the site\'s security rules, and its rows go to the database in one call', async ({ page }) => {
    const fake = await signedIn(page, USERS.encoder);
    fake.onRpc((call) => (call.name === 'import_records' ? { status: 200, body: { id: 'c0000000-0000-4000-8000-000000000001', records: 1 } } : undefined));
    const municipality = seedData.municipalities.find((m) => m.id === barangay.municipality_id)!;
    const [lng, lat] = (record.geojson as { coordinates: number[] }).coordinates;
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Beneficiary', 'Category', 'Program', 'Year', 'Municipality', 'Barangay', 'Latitude', 'Longitude'],
      ['E2E Sheet FCA', 'Rice Thresher', 'Rice Program', 2023, municipality.name, barangay.name, lat + 0.00003, lng + 0.00003],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Machinery');

    await page.goto('/import');
    const step = page.getByRole('form', { name: 'Choose a file' });
    await step.getByLabel(/^What the file lists/).selectOption({ label: 'Farm Machinery' });
    await step.getByLabel(/^Where it came from/).fill('ABEMIS export');
    await step.getByLabel(/^File/).setInputFiles({ name: 'machinery.xlsx', mimeType: 'application/octet-stream', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer });
    await expect(step.getByRole('status')).toHaveText('1 row and 8 columns read from the sheet "Machinery".');
    await step.getByRole('button', { name: 'Next: columns' }).click();
    await page.getByRole('button', { name: 'Next: check' }).click();
    await expect(page.locator('.import-summary')).toHaveText('1 row: 1 ready, 0 to fix, 0 with warnings.');
    await page.getByRole('button', { name: 'Import 1 record' }).click();
    await expect(page.getByRole('heading', { name: 'Imported 1 record' })).toBeVisible();

    const calls = fake.rpcCalls.filter(({ name }) => name === 'import_records');
    expect(calls).toHaveLength(1);
    const { p_batch: batch, p_rows: rows } = calls[0].args as { p_batch: Record<string, unknown>; p_rows: Record<string, unknown>[] };
    expect(batch).toMatchObject({ file_name: 'machinery.xlsx', data_source: 'ABEMIS export', intervention_type_id: 1, column_mapping: { columns: { Beneficiary: 'beneficiary', Latitude: 'latitude' }, values: {}, sheet: 'Machinery' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      row: 2,
      source_id: null,
      source_raw: { Beneficiary: 'E2E Sheet FCA', Year: '2023' },
      values: { beneficiary: 'E2E Sheet FCA', year_funded: 2023, municipality_id: municipality.id, barangay_id: barangay.id, barangay_raw: barangay.name, quantity: 1 },
      status: { status_date: today, date_basis: 'as_of', remarks: null },
    });
    expect((rows[0].values as { point: { lat: number } }).point.lat).toBeCloseTo(lat + 0.00003, 6);
  });

  test('a person can undo their own import through its database function, not someone else\'s, and a refusal is explained', async ({ page }) => {
    const fake = await installFakeSupabase(page);
    const batch = (id: string, file: string, by: string) => ({
      id,
      file_name: file,
      data_source: 'ABEMIS export',
      intervention_type_id: 1,
      column_mapping: {},
      counts: { records: 3, flagged: 1 },
      imported_by: by,
      imported_at: '2026-11-08T01:00:00Z',
      undone_at: null,
      undone_by: null,
      undo_reason: null,
    });
    fake.tables.import_batches.push(batch('c0000000-0000-4000-8000-000000000002', 'mine.csv', USERS.encoder.id), batch('c0000000-0000-4000-8000-000000000003', 'theirs.csv', USERS.admin.id));
    let refuse = true;
    fake.onRpc((call) => {
      if (call.name !== 'undo_import') return undefined;
      if (refuse) return { status: 400, body: { code: '23514', message: '1 of its records has been worked on since, so undoing the import would lose that. Change or delete them one at a time instead.' } };
      return { status: 200, body: { records: 3 } };
    });
    await page.goto('/import');
    await signIn(page, USERS.encoder);
    const earlier = page.getByRole('region', { name: 'Earlier imports' });
    const mine = earlier.locator('.queue-item').filter({ hasText: 'mine.csv' });
    const theirs = earlier.locator('.queue-item').filter({ hasText: 'theirs.csv' });
    await expect(mine).toContainText('By Enzo Encoder');
    await expect(theirs).toContainText('By Ana Admin');
    await expect(theirs.getByRole('button', { name: 'Undo this import' })).toHaveCount(0);

    await mine.getByRole('button', { name: 'Undo this import' }).click();
    const undo = page.getByRole('form', { name: 'Undo mine.csv' });
    await undo.getByLabel(/^Reason/).fill('Wrong file');
    await undo.getByRole('button', { name: 'Undo the import' }).click();
    await expect(earlier.getByRole('alert')).toContainText('1 of its records has been worked on since');
    refuse = false;
    await undo.getByRole('button', { name: 'Undo the import' }).click();
    await expect(earlier.locator('.admin-notice')).toContainText('mine.csv was undone.');
    expect(fake.rpcCalls.filter(({ name }) => name === 'undo_import').map(({ args }) => args)).toEqual([
      { p_id: 'c0000000-0000-4000-8000-000000000002', p_reason: 'Wrong file' },
      { p_id: 'c0000000-0000-4000-8000-000000000002', p_reason: 'Wrong file' },
    ]);
  });
});

test.describe('reports', () => {
  // The inventory covers every type that's on, so it takes the local seed's sample roads too.
  const inventoryCount = (() => {
    const local = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as { interventions: { intervention_type_id: number; deleted_at: string | null }[]; lookups: { intervention_types: { id: number; is_active: boolean }[] } };
    const active = new Set(local.lookups.intervention_types.filter((type) => type.is_active).map((type) => type.id));
    return local.interventions.filter((record) => record.deleted_at === null && active.has(record.intervention_type_id)).length;
  })();
  const downloadOf = async (page: Page, click: () => Promise<void>) => {
    const [download] = await Promise.all([page.waitForEvent('download'), click()]);
    return download;
  };
  const exportCalls = (fake: FakeSupabase) => fake.rpcCalls.filter(({ name }) => name === 'log_export').map(({ args }) => args);

  test('a Viewer downloads each report under the site\'s security rules, each logged before it leaves', async ({ page }) => {
    const fake = await signedIn(page, USERS.viewer);
    await (await sidebar(page)).getByRole('link', { name: 'Reports' }).click();
    await page.getByRole('navigation', { name: 'Reports' }).getByRole('link', { name: 'Inventory report' }).click();
    const inventory = page.getByRole('region', { name: 'Inventory report', exact: true });
    await expect(inventory.getByRole('status')).toContainText('records');
    const pdf = await downloadOf(page, () => inventory.getByRole('button', { name: 'Download PDF' }).click());
    expect(pdf.suggestedFilename()).toMatch(/^Inventory_Marinduque_\d{4}-\d{2}-\d{2}\.pdf$/);
    const xlsx = await downloadOf(page, () => inventory.getByRole('button', { name: 'Download Excel' }).click());
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);

    await page.getByRole('navigation', { name: 'Reports' }).getByRole('link', { name: 'Municipal profile' }).click();
    await page.getByRole('region', { name: 'Municipal profile' }).getByLabel('Municipality').selectOption({ label: 'Boac' });
    const profile = await downloadOf(page, () => page.getByRole('region', { name: 'Municipal profile' }).getByRole('button', { name: 'Download PDF' }).click());
    expect(profile.suggestedFilename()).toMatch(/^Profile_Boac_/);

    expect(exportCalls(fake)).toEqual([
      expect.objectContaining({ p_format: 'pdf', p_file_name: pdf.suggestedFilename(), p_record_count: inventoryCount, p_filters: expect.objectContaining({ report: 'inventory' }) }),
      expect.objectContaining({ p_format: 'xlsx', p_file_name: xlsx.suggestedFilename(), p_record_count: inventoryCount }),
      expect.objectContaining({ p_format: 'pdf', p_file_name: profile.suggestedFilename(), p_filters: { report: 'municipal profile', municipality: 'Boac' } }),
    ]);
  });

  test('if the log can\'t be written, the report isn\'t downloaded, and the person is told', async ({ page }) => {
    const fake = await signedIn(page, USERS.viewer);
    fake.onRpc((call) => (call.name === 'log_export' ? { status: 500, body: { code: 'XX000', message: 'Database unavailable' } } : undefined));
    let downloaded = false;
    page.on('download', () => (downloaded = true));
    await page.goto('/reports/inventory');
    const inventory = page.getByRole('region', { name: 'Inventory report', exact: true });
    await inventory.getByRole('button', { name: 'Download PDF' }).click();
    await expect(inventory.getByRole('alert')).toBeVisible();
    expect(downloaded).toBe(false);
  });

  test('the map prints under the site\'s security rules, and the print is logged', async ({ page, isMobile }) => {
    test.skip(isMobile, 'The toolbar is the same on a phone; once is enough here.');
    const fake = await signedIn(page, USERS.encoder);
    await page.getByRole('button', { name: 'Print map' }).click();
    const dialog = page.getByRole('dialog', { name: 'Print map' });
    const download = await downloadOf(page, () => dialog.getByRole('button', { name: 'Download PDF' }).click());
    expect(download.suggestedFilename()).toMatch(/^Map_Marinduque_Province_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(exportCalls(fake)).toEqual([expect.objectContaining({ p_format: 'pdf', p_file_name: download.suggestedFilename(), p_filters: expect.objectContaining({ report: 'map' }) })]);
  });

  test('an Admin\'s change to a signature block goes to its table, by its id', async ({ page }) => {
    const fake = await signedIn(page, USERS.admin);
    await page.goto('/admin/signatures');
    const list = page.getByRole('region', { name: 'Signature blocks' });
    await list.locator('.admin-row').filter({ hasText: 'Engr. Jan James P. Graza' }).getByRole('button', { name: /^Edit/ }).click();
    const form = page.getByRole('form', { name: /^Edit Engr/ });
    await form.getByLabel(/^Position/).fill('Engineer II');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.admin-notice')).toContainText('Saved');
    const id = (fake.tables.report_signatories as { id: number; name: string }[]).find((row) => row.name === 'Engr. Jan James P. Graza')!.id;
    expect(fake.restWrites.filter((write) => write.table === 'report_signatories')).toEqual([
      { table: 'report_signatories', method: 'PATCH', id, values: { name: 'Engr. Jan James P. Graza', label: 'Prepared by', position: 'Engineer II' } },
    ]);
  });
});
