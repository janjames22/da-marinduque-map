// Phase 17a: every main page, and the map in its open states, passes axe-core's WCAG 2.1 A and AA rules,
// on a computer and a phone. On a phone, what a finger has to hit is at least 44 px (src/app/touch.css).
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const seed = JSON.parse(readFileSync('data/local/local-seed.json', 'utf8')) as {
  interventions: { id: string; deleted_at?: string | null; qa_flags: string[]; geojson: { type: string } | null; barangay_id: number | null }[];
};
const record = seed.interventions.find((r) => !r.deleted_at && r.qa_flags.length === 0 && r.geojson?.type === 'Point' && r.barangay_id !== null)!;

// Kept small on purpose: the skip link (seen only from a keyboard), links within text such as the map's
// credits, check boxes (their label is the target), and the map's markers, clusters and bend handles,
// which keep their size on the map and get a larger touch area around it instead.
const EXEMPT = ['.skip-link', '.leaflet-control-attribution a', '.app-footer a', 'p a', 'li a', 'td a', 'dd a', '.intervention-marker', '.marker-cluster-count', '.line-midpoint', 'input[type="checkbox"]', 'input[type="radio"]'];

const go = (path: string) => async (page: Page) => {
  await page.goto(path);
  await expect(page.getByRole('banner')).toBeVisible();
  await page.waitForTimeout(1000);
};

const STEPS: [string, (page: Page, isMobile: boolean) => Promise<unknown>][] = [
  ['Home', go('/')],
  ['Dashboard page', go('/dashboard')],
  ['Interventions', go('/records')],
  ['a record page', go(`/records/${record.id}`)],
  ['QA queue', go('/qa')],
  ['Condition check', go('/qa/condition')],
  ['Import', go('/import')],
  ['Reports', go('/reports')],
  ['Types and fields', go('/admin/types')],
  ['Lists', go('/admin/categories')],
  ['Users', go('/admin/users')],
  ['Signature blocks', go('/admin/signatures')],
  ['Audit log', go('/admin/audit')],
  ['the map', go('/map')],
  ['the layers card', (page) => page.getByRole('button', { name: 'Layers and filters' }).click()],
  ['the dashboard beside the map', async (page, isMobile) => {
    await go('/map')(page);
    if (isMobile) await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Dashboard' }).click();
    else await page.locator('.map-toolbar').getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Dashboard and records' })).toBeVisible();
  }],
  ['a barangay profile', go(`/map/barangays/${record.barangay_id}`)],
  ['a record popup', async (page) => {
    await page.getByLabel(/^Profile of barangay/).locator('.record-row button.record-name').first().click();
    await expect(page.locator('.record-popup')).toBeVisible();
  }],
  ['the Edit form', (page) => page.locator('.leaflet-popup-content').getByRole('button', { name: 'Edit', exact: true }).click()],
  ['the Export dialog', async (page) => {
    await go('/map')(page);
    await page.locator('.map-toolbar').getByRole('button', { name: 'Export' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }],
  ['the Print map dialog', async (page) => {
    await go('/map')(page);
    await page.locator('.map-toolbar').getByRole('button', { name: 'Print map' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }],
];

test('every page passes the accessibility checks, and a phone gets fingertip-sized targets', async ({ page, isMobile }) => {
  test.setTimeout(300_000);
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, (route) => route.fulfill({ status: 204 }));
  for (const [name, step] of STEPS) {
    await step(page, isMobile);
    await page.waitForTimeout(400);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`), name).toEqual([]);
    if (!isMobile) continue;
    const small = await page.evaluate((exempt) => {
      const selector = 'button, a[href], input, select, [role="button"]';
      return [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          if (box.width === 0 || box.height === 0 || getComputedStyle(element).visibility === 'hidden') return false;
          if (exempt.some((rule) => element.matches(rule) || element.closest(rule.split(' ')[0]) && element.matches(rule.split(' ').at(-1)!) && rule.includes(' '))) return false;
          return box.width < 44 || box.height < 44;
        })
        .map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].join('.')} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 30)}" ${Math.round(element.getBoundingClientRect().width)}x${Math.round(element.getBoundingClientRect().height)}`);
    }, EXEMPT);
    expect(small, `${name}: under 44 px on a phone`).toEqual([]);
  }
});
