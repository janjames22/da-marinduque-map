// The app's top-level addresses. Home is at / since Phase 13. The map moved from / to /map in
// Phase 12, so links to its places saved before then still have to open the right place. Since
// Phase 15, /records/:id is the record's own page; the map's link to it is /map/records/:id.

const PAGES = ['/map', '/dashboard', '/records', '/qa', '/import', '/reports', '/admin'];

const isUnder = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

// Where an address from before the move lives now, or null when it's already right. Anything
// unknown opens Home.
export function movedAddress(pathname: string): string | null {
  const old = /^\/barangays\/([^/]+)\/?$/.exec(pathname);
  if (old) return `/map/barangays/${old[1]}`;
  if (pathname === '/' || PAGES.some((prefix) => isUnder(pathname, prefix))) return null;
  return '/';
}

export type Page = 'home' | 'dashboard' | 'map' | 'records' | 'admin' | 'work' | 'reports';

export function pageFor(pathname: string): Page {
  if (isUnder(pathname, '/map')) return 'map';
  if (isUnder(pathname, '/dashboard')) return 'dashboard';
  if (isUnder(pathname, '/records')) return 'records';
  if (isUnder(pathname, '/admin')) return 'admin';
  if (isUnder(pathname, '/qa') || isUnder(pathname, '/import')) return 'work';
  if (isUnder(pathname, '/reports')) return 'reports';
  return 'home';
}
