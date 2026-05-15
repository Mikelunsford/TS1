import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy apps/web/.env.example to .env.local.',
  );
}

/**
 * The single Supabase JS client used by the SPA. AUTH ONLY: no direct
 * Postgres reads from the browser except `profiles.self_read` (Wave 1+).
 * Business data flows through Edge Functions via `lib/apiClient.ts`.
 *
 * See TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §6.
 */
export const supabase: SupabaseClient = createClient(url, anon, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});
