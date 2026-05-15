/**
 * Service-role Supabase client factory.
 *
 * Service-role bypass; use only after capability check passed.
 *
 * This is the ONLY allowed path to a service-role client in the entire
 * codebase. Per TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §2.4 and §8.1,
 * importing `@supabase/supabase-js` directly anywhere else is a contract
 * violation (lint-enforced).
 *
 * Singleton: created once per Edge Function instance and reused across
 * invocations to keep cold-start latency down (architecture §6.1).
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

let _client: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (_client) return _client;

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url) throw new Error('SUPABASE_URL is not set');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-team1-source': 'edge-function' },
    },
  });
  return _client;
}

export type { SupabaseClient };
export {};
