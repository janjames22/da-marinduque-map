// Where this copy of the app gets its data. Local mode only exists on the dev server, so a deployed
// build without Supabase settings shows an error rather than running on nothing.
const env = import.meta.env;

const url: string | undefined = env.VITE_SUPABASE_URL;
const key: string | undefined = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfig = url && key ? { url, key } : null;

export const dataMode: 'local' | 'supabase' | 'unconfigured' =
  env.DEV && (env.MODE === 'localdata' || !supabaseConfig) ? 'local' : supabaseConfig ? 'supabase' : 'unconfigured';
