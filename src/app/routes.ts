// The app's top-level addresses. The map moved from / to /map in Phase 12, so links saved or shared
// before then still have to open the right place.

const PAGES = ['/map', '/qa', '/import', '/reports', '/admin'];

const isUnder = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

// Where an address from before the move lives now, or null when it's already right. Anything
// unknown opens the map, as it always did.
export function movedAddress(pathname: string): string | null {
  const old = /^\/(barangays|records)\/([^/]+)\/?$/.exec(pathname);
  if (old) return `/map/${old[1]}/${old[2]}`;
  if (PAGES.some((prefix) => isUnder(pathname, prefix))) return null;
  return '/map';
}

export type Page = 'map' | 'admin' | 'work' | 'reports';

export function pageFor(pathname: string): Page {
  if (isUnder(pathname, '/admin')) return 'admin';
  if (isUnder(pathname, '/qa') || isUnder(pathname, '/import')) return 'work';
  if (isUnder(pathname, '/reports')) return 'reports';
  return 'map';
}
