import { test, type BrowserContext } from '@playwright/test';

// Since November 2026, Netlify can add its "Powered by Netlify" badge to every page of the deployed site:
// <script async src="/.netlify/scripts/hud?variant=public">. That script writes an inline script, which the
// site's security rules block, so the badge never shows, but the block is logged on every page. The message
// doesn't say which script caused it, so the tests that fail on anything blocked don't load that one script,
// at that exact address on the site under test. Anything else that's blocked still fails them.
export const NETLIFY_BADGE_SCRIPT = '/.netlify/scripts/hud?variant=public';

export async function skipNetlifyBadge(context: BrowserContext) {
  const site = test.info().project.use.baseURL;
  if (!site) throw new Error('The live tests need a baseURL.');
  const badge = new URL(NETLIFY_BADGE_SCRIPT, site).href;
  await context.route((url) => url.href === badge, (route) => route.abort());
}
