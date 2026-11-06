// Sign-in, roles, saving and live signals through the real Supabase client and app code, against a
// fake of the service's network protocol. The same tests also run on a production build, under the
// site's real security headers.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { jpegWithGps } from '../tests/helpers/exif-fixture';
import { FAKE_HOST, installFakeSupabase, inviteHash, PASSWORD, seedData, signIn, USERS, type FakeSupabase } from './helpers/fake-supabase';

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

async function signedIn(page: Page, user: (typeof USERS)[keyof typeof USERS], path = '/') {
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
    await page.goto('/');
    await signIn(page, USERS.encoder, 'wrong password');
    await expect(signInForm(page).getByRole('alert')).toHaveText('Wrong email or password.');
    await expect(shapes(page)).toHaveCount(0);
  });

  test('explains that accounts are by invitation, with no sign-up option', async ({ page }) => {
    await installFakeSupabase(page);
    await page.goto('/');
    await expect(signInForm(page)).toContainText('Accounts are by invitation');
    await expect(page.getByRole('button', { name: /sign up|register|create account/i })).toHaveCount(0);
  });
});

test.describe('accounts without access', () => {
  test('tells someone with no role, shows no data, and lets them sign out', async ({ page }) => {
    const fake = await installFakeSupabase(page);
    await page.goto('/');
    await signIn(page, USERS.stranger);
    await expect(page.getByRole('heading', { name: 'This account has no access yet' })).toBeVisible();
    expect(fake.restCalls.filter((name) => name !== 'profiles')).toEqual([]);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(signInForm(page)).toBeVisible();
  });

  test('tells a deactivated person', async ({ page }) => {
    const fake = await installFakeSupabase(page);
    await page.goto('/');
    await signIn(page, USERS.former);
    await expect(page.getByRole('heading', { name: 'This account has been deactivated' })).toBeVisible();
    expect(fake.restCalls.filter((name) => name !== 'profiles')).toEqual([]);
  });
});

test.describe('invite and reset links', () => {
  test('an invite asks for a password, checks it, then opens the map', async ({ page }) => {
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
    await expect(shapes(page)).toHaveCount(SHAPES);
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
    await expect(page.locator('.user-menu')).toContainText('Enzo Encoder · Encoder');
    await expect(page.getByText('Local mode')).toHaveCount(0);

    await page.reload();
    await expect(shapes(page)).toHaveCount(SHAPES);
    await expect(signInForm(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(signInForm(page)).toBeVisible();
    await expect(shapes(page)).toHaveCount(0);

    await page.reload();
    await expect(signInForm(page)).toBeVisible();
  });

  test('a person can change their password, or change their mind', async ({ page }) => {
    const fake = await signedIn(page, USERS.viewer);
    await page.getByRole('button', { name: 'Change password' }).click();
    const form = page.getByRole('form', { name: 'Set password' });
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(shapes(page)).toHaveCount(SHAPES);

    await page.getByRole('button', { name: 'Change password' }).click();
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
    await page.goto('/');
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
  await page.goto('/');
  await signIn(page, USERS.admin, `${PASSWORD}x`);
  await expect(signInForm(page).getByRole('alert')).toBeVisible();
});
