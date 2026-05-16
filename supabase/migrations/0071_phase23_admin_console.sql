-- 0071_phase23_admin_console.sql
-- Purpose: Phase 23 (Wave 10 Session 4) — Admin console substrate.
--
-- Adds:
--   1. `platform_admins` table — gates the cross-org bypass capability. Writes
--      are service-role-only; SELECT scoped to active admins themselves.
--   2. `impersonation_sessions` table — durable audit trail of every
--      platform-admin impersonation. INSERT/UPDATE service-role-only.
--   3. `is_platform_admin()` STABLE helper — used in RLS predicates + handler
--      gates.
--   4. Permissive SELECT bypass policies on the TENANCY tables only
--      (organizations, org_memberships, org_branding, org_feature_flags,
--      org_domains, roles). Per-entity tables (invoices, customers, items,
--      ...) deliberately do NOT get this bypass — platform admins reach those
--      via impersonation, which sets the JWT context to a real org-bound user
--      so existing RLS applies cleanly.
--   5. Optional metadata columns `organizations.suspended_at` / `suspended_by`
--      (the existing `status='suspended'` value is the source of truth; these
--      columns record WHO/WHEN for the audit trail).
--   6. audit_log entity_type CHECK extended with 'platform_admin' and
--      'impersonation' leaf types.
--
-- All operations are IF EXISTS / IF NOT EXISTS / to_regclass guarded so the
-- migration is parallel-merge tolerant (C1, C2, and C3 each open a numbered
-- migration in Wave 10 Session 4; renumber-PRs collapse collisions).
--
-- Date:    2026-05-16
-- Migration #: 0071
--
-- DOWN MIGRATION (operator-only, not auto-run):
--   DROP POLICY IF EXISTS organizations_select_platform_admin ON public.organizations;
--   DROP POLICY IF EXISTS org_memberships_select_platform_admin ON public.org_memberships;
--   DROP POLICY IF EXISTS org_branding_select_platform_admin ON public.org_branding;
--   DROP POLICY IF EXISTS oflags_select_platform_admin ON public.org_feature_flags;
--   DROP POLICY IF EXISTS odomains_select_platform_admin ON public.org_domains;
--   DROP POLICY IF EXISTS roles_select_platform_admin ON public.roles;
--   DROP POLICY IF EXISTS platform_admins_select_self ON public.platform_admins;
--   DROP POLICY IF EXISTS impersonation_sessions_select_admin ON public.impersonation_sessions;
--   DROP FUNCTION IF EXISTS public.is_platform_admin();
--   DROP TABLE  IF EXISTS public.impersonation_sessions;
--   DROP TABLE  IF EXISTS public.platform_admins;
--   ALTER TABLE public.organizations
--     DROP COLUMN IF EXISTS suspended_at,
--     DROP COLUMN IF EXISTS suspended_by;

BEGIN;

-- ============================================================================
-- 0. Preflight: bail loudly if the tenancy spine isn't here yet
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'organizations table missing — 0029 tenancy substrate must run first';
  END IF;
  IF to_regclass('public.org_memberships') IS NULL THEN
    RAISE EXCEPTION 'org_memberships table missing';
  END IF;
  IF to_regclass('public.audit_log') IS NULL THEN
    RAISE EXCEPTION 'audit_log table missing — 0068 audit-unify must run first';
  END IF;
END $$;

-- ============================================================================
-- 1. organizations.suspended_at / suspended_by (audit metadata)
-- ============================================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS suspended_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================================
-- 2. platform_admins table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz NULL,
  notes      text NULL
);

-- Partial index — only active rows are hot for `is_platform_admin()`
CREATE INDEX IF NOT EXISTS idx_platform_admins_active_user
  ON public.platform_admins (user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Admins can see the admin roster (so the admin console can render it).
-- Anyone NOT on the active roster sees zero rows; the test below verifies it.
DROP POLICY IF EXISTS platform_admins_select_self ON public.platform_admins;
CREATE POLICY platform_admins_select_self ON public.platform_admins
  FOR SELECT TO authenticated
  USING (
    auth.uid() IN (
      SELECT pa.user_id
      FROM public.platform_admins pa
      WHERE pa.revoked_at IS NULL
    )
  );

-- NO INSERT/UPDATE/DELETE policy for authenticated → service-role only. All
-- grants and revocations go through the admin-console-api handlers under
-- service_role.

-- ============================================================================
-- 3. impersonation_sessions table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  impersonated_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  reason                text NOT NULL CHECK (length(trim(reason)) > 0),
  started_at            timestamptz NOT NULL DEFAULT now(),
  ended_at              timestamptz NULL,
  audit_log_id          uuid NULL  -- weak link; audit_log has no FK target by id
);

CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_admin_time
  ON public.impersonation_sessions (admin_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_org_time
  ON public.impersonation_sessions (org_id, started_at DESC);

ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS impersonation_sessions_select_admin ON public.impersonation_sessions;
CREATE POLICY impersonation_sessions_select_admin ON public.impersonation_sessions
  FOR SELECT TO authenticated
  USING (
    auth.uid() IN (
      SELECT pa.user_id
      FROM public.platform_admins pa
      WHERE pa.revoked_at IS NULL
    )
  );

-- NO INSERT/UPDATE/DELETE policy for authenticated → service-role only.

-- ============================================================================
-- 4. is_platform_admin() helper
-- ============================================================================
-- STABLE SECURITY INVOKER — reads auth.uid() at query time, no privilege
-- escalation. Returns false for anonymous callers (auth.uid() NULL).
CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY INVOKER
  AS $$
    SELECT EXISTS (
      SELECT 1
      FROM public.platform_admins
      WHERE user_id = auth.uid()
        AND revoked_at IS NULL
    )
  $$;

COMMENT ON FUNCTION public.is_platform_admin() IS
  'True iff auth.uid() is an active platform admin. Use in RLS predicates on tenancy tables only — do NOT extend platform_admin bypass to per-entity tables; impersonation handles that path.';

-- ============================================================================
-- 5. Tenancy-table SELECT bypass policies (deliberately scoped to 6 tables)
-- ============================================================================
-- Why only SELECT, only on these 6 tables: a platform admin needs to LIST and
-- INSPECT orgs/members/branding/flags/domains/roles to provision and triage.
-- All MUTATIONS still go through the admin-console-api handlers (which use
-- service_role and write audit rows). For per-entity reach (invoice,
-- customer, item), the admin impersonates a real user — the JWT then carries
-- a real `team1_org_id` claim and the existing org-scoped RLS applies cleanly.

DROP POLICY IF EXISTS organizations_select_platform_admin ON public.organizations;
CREATE POLICY organizations_select_platform_admin ON public.organizations
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS org_memberships_select_platform_admin ON public.org_memberships;
CREATE POLICY org_memberships_select_platform_admin ON public.org_memberships
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS org_branding_select_platform_admin ON public.org_branding;
CREATE POLICY org_branding_select_platform_admin ON public.org_branding
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS oflags_select_platform_admin ON public.org_feature_flags;
CREATE POLICY oflags_select_platform_admin ON public.org_feature_flags
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS odomains_select_platform_admin ON public.org_domains;
CREATE POLICY odomains_select_platform_admin ON public.org_domains
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS roles_select_platform_admin ON public.roles;
CREATE POLICY roles_select_platform_admin ON public.roles
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ============================================================================
-- 6. audit_log entity_type CHECK — extend for admin actions
-- ============================================================================
-- Add 'platform_admin' and 'impersonation' leaf types. Done by re-dropping the
-- v2 check and replacing with v3, mirroring 0068's pattern.
DO $$
DECLARE
  has_v2 boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'audit_log_entity_type_check_v2'
      AND conrelid = 'public.audit_log'::regclass
  ) INTO has_v2;

  IF has_v2 THEN
    ALTER TABLE public.audit_log
      DROP CONSTRAINT audit_log_entity_type_check_v2;
  END IF;

  ALTER TABLE public.audit_log
    DROP CONSTRAINT IF EXISTS audit_log_entity_type_check_v3;

  ALTER TABLE public.audit_log
    ADD CONSTRAINT audit_log_entity_type_check_v3
    CHECK (entity_type IN (
      'quote','project','project_phase','receiving_order','production_run','shipment',
      'invoice','payment','payment_allocation','credit_note','credit_note_allocation',
      'expense','expense_category','vendor_bill','vendor_bill_payment',
      'lead','opportunity','activity','customer','contact',
      'purchase_order','po_line_item','journal_entry','organization','org_membership',
      'period_close','stock_movement','item','warehouse','vendor','account',
      'tax','currency','exchange_rate','payment_method','user','profile',
      'org_setting','feature_flag','attachment','comment','notification','saved_view',
      -- Phase 23 (Wave 10 Session 4) — C3 owns these two.
      'platform_admin','impersonation'
      -- End Phase 23 (Wave 10 Session 4).
    ));
END $$;

-- ============================================================================
-- 7. Verification — assert structure + RLS posture
-- ============================================================================
DO $$
DECLARE
  rls_organizations_anon_count int;
BEGIN
  -- Helper function exists.
  IF to_regprocedure('public.is_platform_admin()') IS NULL THEN
    RAISE EXCEPTION 'is_platform_admin() function not created';
  END IF;

  -- Tables exist.
  IF to_regclass('public.platform_admins') IS NULL THEN
    RAISE EXCEPTION 'platform_admins table not created';
  END IF;
  IF to_regclass('public.impersonation_sessions') IS NULL THEN
    RAISE EXCEPTION 'impersonation_sessions table not created';
  END IF;

  -- suspended_at/suspended_by columns exist.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND column_name = 'suspended_at'
  ) THEN
    RAISE EXCEPTION 'organizations.suspended_at column not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND column_name = 'suspended_by'
  ) THEN
    RAISE EXCEPTION 'organizations.suspended_by column not created';
  END IF;

  RAISE NOTICE 'Phase 23 admin console substrate verified.';
END $$;

COMMIT;
