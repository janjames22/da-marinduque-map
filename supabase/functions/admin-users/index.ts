// Runs in Supabase's Deno runtime, which provides the project's keys. See handler.ts for what it does.
import { handleRequest } from './handler.ts';

const named = (name: string): string | undefined => {
  const value = Deno.env.get(name);
  return value ? (JSON.parse(value) as Record<string, string>).default : undefined;
};

const env = {
  url: Deno.env.get('SUPABASE_URL') ?? '',
  publishableKey: named('SUPABASE_PUBLISHABLE_KEYS') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  secretKey: named('SUPABASE_SECRET_KEYS') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
};

Deno.serve((request) => handleRequest(request, env));
