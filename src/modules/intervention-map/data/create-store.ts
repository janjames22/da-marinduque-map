import { dataMode } from './app-config';
import type { DataStore } from './store';
import type { AppUser } from './types';

export interface StoreOptions {
  boundaries: { barangays: GeoJSON.FeatureCollection; municipalities: GeoJSON.FeatureCollection };
  user: AppUser;
}

// The one place that chooses where data lives. The dev check keeps local mode out of deployed builds,
// and only a build made with `--mode demo` runs the demo.
export async function createStore({ boundaries, user }: StoreOptions): Promise<DataStore> {
  if ((import.meta.env.DEV && dataMode === 'local') || import.meta.env.MODE === 'demo') {
    const { createLocalStore } = await import('./local-store');
    return createLocalStore({ boundaries, user });
  }
  const [{ createSupabaseStore }, { createSupabaseBackend }, { getSupabase }] = await Promise.all([
    import('./supabase-store'),
    import('./supabase-backend'),
    import('./supabase-client'),
  ]);
  return createSupabaseStore(createSupabaseBackend(getSupabase()), user);
}

const LOCAL_ROLE_KEY = 'da-local-role';

// There are no logins in local mode, so the screens for each role can be tried with this setting.
export function localUser(): AppUser {
  const saved = window.localStorage.getItem(LOCAL_ROLE_KEY);
  const role = saved === 'encoder' || saved === 'viewer' ? saved : 'admin';
  return { id: 'local', full_name: 'Local user', role };
}
