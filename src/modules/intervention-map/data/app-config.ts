// Where this copy of the app gets its data. Local mode only exists on the dev server, so a deployed
// build without Supabase settings shows an error rather than running on nothing. The demo site is the
// exception: built with `--mode demo`, it runs like local mode on made-up data, with no database.
const env = import.meta.env;

// Whether this is the demo site. Read straight from import.meta.env.MODE, which Vite writes in as it
// builds, so any other build drops what's only for the demo.
export const isDemo = import.meta.env.MODE === 'demo';

// The demo build reads no settings files (envDir in vite.config.ts). This also makes sure that a
// VITE_SUPABASE_ setting from elsewhere can't point the demo at a database.
const demo = env.MODE === 'demo';
const url: string | undefined = demo ? undefined : env.VITE_SUPABASE_URL;
const key: string | undefined = demo ? undefined : env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfig = url && key ? { url, key } : null;

export const dataMode: 'demo' | 'local' | 'supabase' | 'unconfigured' =
  env.MODE === 'demo'
    ? 'demo'
    : env.DEV && (env.MODE === 'localdata' || !supabaseConfig)
      ? 'local'
      : supabaseConfig
        ? 'supabase'
        : 'unconfigured';

// Both keep their data in the browser, through local-store.ts.
export const inBrowserData = dataMode === 'demo' || dataMode === 'local';
