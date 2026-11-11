import { describe, expect, it } from 'vitest';
import { movedAddress, pageFor } from '../src/app/routes';
import { isCurrent, navGroups } from '../src/app/shell/nav';

const labels = (role: Parameters<typeof navGroups>[0]) => navGroups(role).flatMap((group) => group.items.map((item) => item.label));

describe('addresses', () => {
  it('sends the old map addresses to their new place', () => {
    expect(movedAddress('/barangays/12')).toBe('/map/barangays/12');
    expect(movedAddress('/barangays/12/')).toBe('/map/barangays/12');
  });

  it('leaves the current addresses alone', () => {
    for (const path of ['/', '/dashboard', '/map', '/map/', '/map/barangays/12', '/map/records/abc', '/records', '/records/0b5e-41', '/qa', '/qa/condition', '/import', '/reports', '/reports/inventory', '/admin', '/admin/types/3']) {
      expect(movedAddress(path), path).toBeNull();
    }
  });

  it("opens Home for an address it doesn't know", () => {
    expect(movedAddress('/nowhere')).toBe('/');
    expect(movedAddress('/mapping')).toBe('/');
    expect(movedAddress('/administer')).toBe('/');
  });

  it('knows which page an address is on', () => {
    expect(pageFor('/')).toBe('home');
    expect(pageFor('/dashboard')).toBe('dashboard');
    expect(pageFor('/map/records/abc')).toBe('map');
    expect(pageFor('/records')).toBe('records');
    expect(pageFor('/records/0b5e-41')).toBe('records');
    expect(pageFor('/qa/condition')).toBe('work');
    expect(pageFor('/import')).toBe('work');
    expect(pageFor('/reports/beneficiary/x')).toBe('reports');
    expect(pageFor('/admin/audit')).toBe('admin');
  });
});

describe('the sidebar', () => {
  it('shows each role only the pages it can use', () => {
    expect(labels('viewer')).toEqual(['Home', 'Dashboard', 'Map', 'Interventions', 'Reports']);
    expect(labels('encoder')).toEqual(['Home', 'Dashboard', 'Map', 'Interventions', 'QA queue', 'Condition check', 'Import', 'Reports']);
    expect(labels('admin')).toEqual(['Home', 'Dashboard', 'Map', 'Interventions', 'QA queue', 'Condition check', 'Import', 'Reports', 'Users', 'Types and fields', 'Lists', 'Signature blocks', 'Audit log']);
  });

  it('marks the page that is open, and only that one', () => {
    const items = navGroups('admin').flatMap((group) => group.items);
    const current = (pathname: string) => items.filter((item) => isCurrent(item, pathname)).map((item) => item.label);
    expect(current('/')).toEqual(['Home']);
    expect(current('/dashboard')).toEqual(['Dashboard']);
    expect(current('/map/barangays/4')).toEqual(['Map']);
    expect(current('/qa')).toEqual(['QA queue']);
    expect(current('/qa/condition')).toEqual(['Condition check']);
    expect(current('/admin/types/7')).toEqual(['Types and fields']);
    expect(current('/admin/barangay-fields')).toEqual(['Types and fields']);
    expect(current('/admin/programs')).toEqual(['Lists']);
    expect(current('/admin')).toEqual([]);
  });
});
