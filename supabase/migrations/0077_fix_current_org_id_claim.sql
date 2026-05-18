-- 0077_fix_current_org_id_claim.sql
--
-- R-AUDIT-C1: fix RLS helper to read the actual JWT claim the app stamps.
--
-- Background
-- ----------
-- `current_org_id()` (defined in 0029_tenancy_init.sql:275) reads a
-- root-level `org_id` claim from `request.jwt.claims`. The app stamps
-- `app_metadata.team1_org_id` only — see:
--   * supabase/functions/auth-api/handlers/switch-org.ts:68
--   * supabase/functions/admin-console-api/handlers/impersonate.ts:111
--   * supabase/functions/_shared/tenant.ts:77 (read side, edge layer)
-- Nothing in the codebase writes a root-level `org_id`. Verified by grep:
-- `request.jwt.claims` is read in exactly one place (this function);
-- `team1_org_id` is the only claim name the SPA + edge functions know.
--
-- Result of the bug
-- -----------------
-- The JWT branch in `current_org_id()` always returns NULL, and the
-- function falls through to `SELECT om.org_id FROM org_memberships WHERE
-- user_id = auth.uid() AND is_active LIMIT 1` — with no `ORDER BY`. For a
-- multi-org user, RLS pins them to an arbitrary org chosen by Postgres,
-- not the org they switched to. `current_user_role()`,
-- `current_user_customer_id()`, and `is_staff()` all chain through
-- `current_org_id()` and inherit the bug. Storage RLS policies for the
-- `attachments` bucket (0069_phase16_collaboration.sql:359-389) read
-- `current_org_id()::text` directly and inherit it as well — a direct
-- Storage call bypasses every edge-handler `.eq('org_id', ...)` filter.
--
-- Today's prod is single-org-per-user (mike@team-01.com → Team1;
-- mike@kitstak.com → KitStak), so the bug is not actively exploited. The
-- finding is "one bug from breach" rather than "currently breached." Fix
-- restores defense-in-depth before that assumption breaks.
--
-- Fix
-- ---
-- Read `app_metadata.team1_org_id` (matches `_shared/tenant.ts:77`).
-- Drop the membership-table fallback — no claim means "no active org,"
-- and RLS should return zero rows rather than silently pick one. The
-- `useOrgClaimSync()` hook (PR #96) auto-stamps the claim on AppShell
-- mount, so first-sign-in transitional states self-heal in milliseconds.
-- The fallback was the mechanism that made the bug invisible; removing
-- it is the regression guard.
--
-- Forward-only and idempotent: `CREATE OR REPLACE` preserves the existing
-- GRANTs and the ~320 RLS-policy references that chain through this
-- function. No CASCADE / DROP required. The function signature
-- (`() RETURNS uuid`) is unchanged.
--
-- Companion test: apps/web/playwright/rls-multi-org-probe.spec.ts (new in
-- this PR) drives the multi-org scenario that nightly CI did not cover.
-- Without that probe, a future regression of the same bug class — anyone
-- writing a helper that reads `'org_id'` or any other non-stamped claim
-- name — would pass CI silently again.
--
-- See AUDIT-2026-05-18.md §5 C-1 for full provenance.

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE claim_org uuid;
BEGIN
  BEGIN
    claim_org := nullif(
      current_setting('request.jwt.claims', true)::jsonb
        -> 'app_metadata' ->> 'team1_org_id',
      ''
    )::uuid;
  EXCEPTION WHEN OTHERS THEN
    claim_org := NULL;
  END;
  RETURN claim_org;
END $$;
