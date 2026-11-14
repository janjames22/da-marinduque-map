// The demo site's accounts, one per role, listed on its sign-in screen. They aren't secrets: the demo
// has no server and no real data, and each visitor works on their own copy in their browser.
import type { AppUser, UserRole } from '../../modules/intervention-map/data/types';

export interface DemoAccount {
  role: UserRole;
  label: string;
  note: string;
  email: string;
  password: string;
  name: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { role: 'admin', label: 'Admin', note: 'Everything, with the Admin pages', email: 'admin@demo.test', password: 'Demo-Admin-2026', name: 'Demo admin' },
  { role: 'encoder', label: 'Encoder', note: 'Adds and changes records', email: 'encoder@demo.test', password: 'Demo-Encoder-2026', name: 'Demo encoder' },
  { role: 'viewer', label: 'Viewer', note: 'Looks, filters and exports', email: 'viewer@demo.test', password: 'Demo-Viewer-2026', name: 'Demo viewer' },
];

export function findDemoAccount(email: string, password: string): DemoAccount | null {
  const wanted = email.trim().toLowerCase();
  return DEMO_ACCOUNTS.find((account) => account.email === wanted && account.password === password) ?? null;
}

export function demoUser(account: DemoAccount): AppUser {
  return { id: `demo-${account.role}`, full_name: account.name, role: account.role };
}

// Who is signed in, for this tab: a reload stays signed in, and closing the tab signs out.
const SESSION_KEY = 'da-demo-account';

export function savedDemoAccount(): DemoAccount | null {
  try {
    const role = sessionStorage.getItem(SESSION_KEY);
    return DEMO_ACCOUNTS.find((account) => account.role === role) ?? null;
  } catch {
    return null; // storage can be blocked
  }
}

export function saveDemoAccount(account: DemoAccount | null) {
  try {
    if (account) sessionStorage.setItem(SESSION_KEY, account.role);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Without storage, a reload just asks again.
  }
}
