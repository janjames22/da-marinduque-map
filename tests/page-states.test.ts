import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRST_LOAD_BUDGET, firstLoadFiles, firstLoadSizes, overBudget } from '../scripts/check-bundle';
import { describeError, isUpdateError } from '../src/modules/intervention-map/lib/error-message';
import { hasFilters, isNarrowed } from '../src/modules/intervention-map/state/map-ui';

describe('what a page says when it could not load', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls a dropped connection a dropped connection, in every browser', () => {
    for (const message of ['Failed to fetch', 'TypeError: NetworkError when attempting to fetch resource.', 'Load failed', 'FetchError: Failed to fetch']) {
      expect(describeError(new Error(message)), message).toMatchObject({ problem: 'offline', summary: 'No connection. Check your internet, then try again.', details: message });
    }
  });

  it("asks for a reload when a page's code is gone after a new version", () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://example.org/assets/MapPage-abc.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/WorkPage-abc.css',
    ]) {
      expect(isUpdateError(new Error(message)), message).toBe(true);
      expect(describeError(new Error(message)).problem, message).toBe('update');
    }
  });

  it("says no connection, not a new version, when the browser is offline and a page's code didn't come", () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(describeError(new Error('Failed to fetch dynamically imported module: /assets/x.js')).problem).toBe('offline');
  });

  it('asks to sign in again when the sign-in ran out', () => {
    expect(describeError({ message: 'JWT expired' })).toMatchObject({ problem: 'signed-out' });
  });

  it("keeps anything else's own words as details, under a plain summary", () => {
    const { problem, summary, details } = describeError(new Error('Database unavailable'));
    expect(problem).toBe('other');
    expect(summary).toMatch(/^Something went wrong\./);
    expect(details).toBe('Database unavailable');
    expect(describeError('not an error object').details).toBe('not an error object');
    expect(describeError(undefined).details).toBeNull();
  });
});

describe('when a list is empty because of the filters', () => {
  const none = { mode: 'count' as const, pickedProgramId: null, pickedTypeId: null, hiddenTypeIds: [], programId: null, yearFrom: null, yearTo: null, municipalityId: null, barangayId: null, fieldFilters: [] };

  it('knows nothing is narrowing the records', () => {
    expect(hasFilters(none)).toBe(false);
    expect(isNarrowed(none)).toBe(false);
  });

  it('counts a filter, a layer switched off, or shading by one program or type', () => {
    expect(isNarrowed({ ...none, yearFrom: 2020 })).toBe(true);
    expect(isNarrowed({ ...none, fieldFilters: [{ field: 'beneficiary', op: 'contains', value: 'x' }] as never })).toBe(true);
    expect(isNarrowed({ ...none, hiddenTypeIds: [3] })).toBe(true);
    const layerOff = { ...none, hiddenTypeIds: [3] };
    expect(hasFilters(layerOff)).toBe(false);
    expect(isNarrowed({ ...none, mode: 'type', pickedTypeId: 2 })).toBe(true);
    expect(isNarrowed({ ...none, mode: 'program', pickedProgramId: 1 })).toBe(true);
    expect(isNarrowed({ ...none, mode: 'gap' })).toBe(false);
  });
});

describe('the first load budget', () => {
  const html = `<!doctype html><html><head>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/jsx-runtime-abc.js">
    <link rel="modulepreload" crossorigin href="/assets/jsx-runtime-abc.js">
    <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
    <link rel="icon" href="/favicon.svg">
  </head></html>`;

  it('takes the scripts and styles the page names, once each, and nothing else', () => {
    expect(firstLoadFiles(html)).toEqual(['assets/index-abc.js', 'assets/jsx-runtime-abc.js', 'assets/index-abc.css']);
  });

  it('measures them gzipped, scripts and styles apart', () => {
    const sizes = firstLoadSizes([
      { name: 'assets/a.js', bytes: Buffer.from('x'.repeat(10_000)) },
      { name: 'assets/a.css', bytes: Buffer.from('y'.repeat(10_000)) },
    ]);
    expect(sizes.js).toBeGreaterThan(0);
    expect(sizes.js).toBeLessThan(200); // the same letter again and again packs down to almost nothing
    expect(sizes.css).toBeGreaterThan(0);
  });

  it('fails a build over budget, and says which part', () => {
    expect(overBudget({ js: FIRST_LOAD_BUDGET.js, css: FIRST_LOAD_BUDGET.css })).toEqual([]);
    const problems = overBudget({ js: FIRST_LOAD_BUDGET.js + 1, css: 0 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/of script, over its budget of 130\.0 kB/);
  });
});
