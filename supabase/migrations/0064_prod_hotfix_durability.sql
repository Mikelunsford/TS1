-- 0064_prod_hotfix_durability.sql
--
-- Production hotfix durability — codifies two patches applied in-place during
-- the 2026-05-16 first-prod-signin incident (post Wave 8 cutover).
--
-- Part A — auth.users defensive NULL-token backfill.
--
-- GoTrue v2.x scans 8 auth.users token / change-target columns as Go `string`
-- (not sql.NullString). When ANY of these are NULL on the row GoTrue is
-- authenticating, /token returns 500 with "Database error querying schema",
-- manifesting as a sign-in failure even though credentials are valid. See
-- feedback_supabase_auth_seeding.md for the original incident details.
--
-- The 2026-05-16 production fix was applied directly via service-role SQL on
-- the affected row. This migration codifies that fix as a defensive,
-- idempotent forward-backfill so any future hand-seeded auth.users rows
-- (or imports) cannot reintroduce the regression. COALESCE-to-'' is safe
-- to replay any number of times.
--
-- NOTE on `phone` (revised 2026-05-16, post first-apply failure):
-- The original incident memo listed `phone` among the affected columns, but
-- `auth.users.phone` carries a UNIQUE constraint (with '' treated as a value),
-- so a bulk COALESCE across multiple NULL-phone rows hits SQLSTATE 23505
-- "duplicate key value violates unique constraint users_phone_key" the moment
-- a second user is added. The first apply of this migration failed on exactly
-- that. Empirically (verified 2026-05-16 against prod) GoTrue's /token row-scan
-- does NOT require `phone` to be non-NULL — only the 8 token / change-target
-- columns below. We deliberately exclude `phone` from this backfill.
--
-- Data-only — NO auth.* schema alteration (Supabase-managed).
--
-- Part B (this PR) — supabase/functions/_shared/cors.ts wildcard-subdomain
-- support. Already merged in PR #73 alongside the original (failing) 0064;
-- cors.ts deploys via deploy-functions.yml independently of migrate.yml, so
-- Part B is already live in prod. No SQL is required for Part B.

UPDATE auth.users
SET confirmation_token         = COALESCE(confirmation_token, ''),
    recovery_token             = COALESCE(recovery_token, ''),
    email_change               = COALESCE(email_change, ''),
    email_change_token_new     = COALESCE(email_change_token_new, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''),
    phone_change               = COALESCE(phone_change, ''),
    phone_change_token         = COALESCE(phone_change_token, ''),
    reauthentication_token     = COALESCE(reauthentication_token, '')
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change IS NULL
   OR email_change_token_new IS NULL
   OR email_change_token_current IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR reauthentication_token IS NULL;
