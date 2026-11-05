import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from './app-config';

export interface AuthLink {
  type: string | null;
  error: string | null;
}

// An invite or reset link arrives with its details after the #. The client removes them as soon as
// it starts, so they're read first.
function readAuthLink(): AuthLink {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  return { type: hash.get('type'), error: hash.get('error_code') ?? hash.get('error') };
}

export const authLink: AuthLink = readAuthLink();

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabaseConfig) throw new Error('Supabase is not configured');
  // Implicit flow, because links from the Admin API carry tokens that way.
  client ??= createClient(supabaseConfig.url, supabaseConfig.key, { auth: { flowType: 'implicit' } });
  return client;
}
