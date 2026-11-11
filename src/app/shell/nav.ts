// The sidebar's links, and who sees which. The database is what actually refuses people, so this only
// keeps each person from seeing links to pages they can't use.
import type { UserRole } from '../../modules/intervention-map/data/types';

export type NavIcon = 'map' | 'qa' | 'condition' | 'import' | 'reports' | 'users' | 'types' | 'lists' | 'signatures' | 'audit';

export interface NavItem {
  label: string;
  to: string;
  icon: NavIcon;
  // The addresses that count as this page. An exact item doesn't count the pages below it.
  matches: string[];
  exact?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const OVERVIEW: NavGroup = {
  label: 'Overview',
  items: [{ label: 'Map', to: '/map', icon: 'map', matches: ['/map'] }],
};

const RECORDS: NavGroup = {
  label: 'Records',
  items: [
    { label: 'QA queue', to: '/qa', icon: 'qa', matches: ['/qa'], exact: true },
    { label: 'Condition check', to: '/qa/condition', icon: 'condition', matches: ['/qa/condition'] },
    { label: 'Import', to: '/import', icon: 'import', matches: ['/import'] },
  ],
};

const REPORTS: NavGroup = {
  label: 'Reports',
  items: [{ label: 'Reports', to: '/reports', icon: 'reports', matches: ['/reports'] }],
};

const ADMINISTRATION: NavGroup = {
  label: 'Administration',
  items: [
    { label: 'Users', to: '/admin/users', icon: 'users', matches: ['/admin/users'] },
    { label: 'Types and fields', to: '/admin/types', icon: 'types', matches: ['/admin/types', '/admin/barangay-fields'] },
    { label: 'Lists', to: '/admin/categories', icon: 'lists', matches: ['/admin/categories', '/admin/programs', '/admin/statuses', '/admin/lists'] },
    { label: 'Signature blocks', to: '/admin/signatures', icon: 'signatures', matches: ['/admin/signatures'] },
    { label: 'Audit log', to: '/admin/audit', icon: 'audit', matches: ['/admin/audit'] },
  ],
};

export function navGroups(role: UserRole): NavGroup[] {
  if (role === 'admin') return [OVERVIEW, RECORDS, REPORTS, ADMINISTRATION];
  if (role === 'encoder') return [OVERVIEW, RECORDS, REPORTS];
  return [OVERVIEW, REPORTS];
}

export function isCurrent(item: NavItem, pathname: string): boolean {
  return item.matches.some((path) => pathname === path || (!item.exact && pathname.startsWith(`${path}/`)));
}
