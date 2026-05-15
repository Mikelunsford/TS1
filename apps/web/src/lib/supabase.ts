import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Fallback constants. The Supabase URL + anon key are PUBLIC by design
// (architecture §0 — the anon key ships in every browser bundle as the
// `apikey` header). Baking them as defaults guards against the failure
// mode where the Vercel project env var holds a placeholder string from
// .env.example — process.env takes precedence over .env.production, so a
// bad Vercel env wins even after we commit the right value. The shape
// check below detects placeholders by requiring 3 base64url segments.
const FALLBACK_URL = 'https://ozvanymuzaqbexchuoxz.supabase.co';
const FALLBACK_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96dmFueW11emFxYmV4Y2h1b3h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MDA1NjEsImV4cCI6MjA5NDM3NjU2MX0.qm1vsSJltx-C2uQWvemi0A4YRRAccGlPziGAtuA_HPU';

const JWT_SHAPE = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const envAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const url = envUrl && /^https:\/\//.test(envUrl) ? envUrl : FALLBACK_URL;
const anon = envAnon && JWT_SHAPE.test(envAnon) ? envAnon : FALLBACK_ANON;

if (!url || !anon) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy apps/web/.env.example to .env.local.',
  );
}

if (envAnon && !JWT_SHAPE.test(envAnon)) {
  // eslint-disable-next-line no-console -- one-time boot diagnostic so the
  // operator sees that an env var was set but ignored. Not a PII leak; the
  // string is already in the bundle either way.
  console.warn(
    '[supabase] VITE_SUPABASE_ANON_KEY does not look like a JWT; falling back to bundled default.',
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
