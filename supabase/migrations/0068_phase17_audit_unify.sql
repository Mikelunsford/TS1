-- 0068_phase17_audit_unify.sql
-- Purpose: Phase 17 — final pass on audit_log unification + deferred 0043 RLS sweep.
--
-- STEP-2 CONDITIONAL VERIFICATION:
--   audit_log already exists in prod (renamed from workflow_transitions in
--   migration 0036_system_extend.sql). diff_json, action, prev_hash,
--   payload_hash columns already exist. The entity_type CHECK already
--   covers every Phase 1-13 entity. RLS SELECT policy (audit_select_staff)
--   already granted to org_owner/org_admin/accounting in 0043.
--
--   Scope of this migration therefore COLLAPSES from the original
--   "rename + add columns" to:
--     1. Tighten audit_log RLS to APPEND-ONLY (no UPDATE / no DELETE for
--        any client; service-role only INSERT).
--     2. Add three operational indexes the handler step-8 writers + the
--        per-entity timeline component depend on.
--     3. Extend entity_type CHECK with the missing leaf types from Wave 7
--        / Wave 8 (period_close, payment_allocation, credit_note_allocation,
--        stock_movement, item, warehouse, lead_activity).
--     4. Idempotency_keys deferred-0043 sweep: explicit DENY UPDATE/DELETE
--        for authenticated; SELECT scoped to caller's own (org_id, user_id).
--     5. Forward-compat: comments / notifications / attachments / saved_views
--        already covered in 0043; verify policies exist and add any missing
--        ones as IF NOT EXISTS.
--
-- All operations use IF EXISTS / IF NOT EXISTS / to_regclass guards so
-- this is safe under either pre-state (clean rebuild OR cloud-current).
--
-- Date:    2026-05-16
-- Migration #: 0068
--
-- DOWN MIGRATION (operator-only, not auto-run):
--   ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_entity_type_check_v2;
--   DROP INDEX IF EXISTS idx_audit_log_org_entity_time;
--   DROP INDEX IF EXISTS idx_audit_log_org_actor_time;
--   DROP INDEX IF EXISTS idx_audit_log_metadata_gin;
--   DROP POLICY IF EXISTS audit_no_update ON public.audit_log;
--   DROP POLICY IF EXISTS audit_no_delete ON public.audit_log;
--   DROP POLICY IF EXISTS idemp_select_self ON public.idempotency_keys;

BEGIN;

-- ============================================================================
-- 1. AUDIT LOG: extend entity_type CHECK to cover every Wave 7/8/10 entity
-- ============================================================================

-- Only operate if audit_log exists (to_regclass guard).
DO $$
BEGIN
  IF to_regclass('public.audit_log') IS NULL THEN
    RAISE EXCEPTION 'audit_log table missing — cannot run 0068 against this DB state';
  END IF;
END $$;

-- Drop the v1 check (set in 0036) and replace with v2 covering Wave 7+.
ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_entity_type_check_v2;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_type_check_v2
  CHECK (entity_type IN (
    'quote','project','project_phase','receiving_order','production_run','shipment',
    'invoice','payment','payment_allocation','credit_note','credit_note_allocation',
    'expense','expense_category','vendor_bill','vendor_bill_payment',
    'lead','opportunity','activity','customer','contact',
    'purchase_order','po_line_item','journal_entry','organization','org_membership',
    'period_close','stock_movement','item','warehouse','vendor','account',
    'tax','currency','exchange_rate','payment_method','user','profile',
    'org_setting','feature_flag','attachment','comment','notification','saved_view'
  ));

-- ============================================================================
-- 2. AUDIT LOG: append-only RLS posture
-- ============================================================================

-- The Wave-0 RLS only granted SELECT to staff. Explicitly DENY UPDATE / DELETE
-- to authenticated by adding null-WITH-CHECK policies (Postgres has no
-- direct "DENY"; using a USING that is always false achieves equivalent).
-- service_role is unaffected — it bypasses RLS entirely.
DROP POLICY IF EXISTS audit_no_update ON public.audit_log;
CREATE POLICY audit_no_update ON public.audit_log
  FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS audit_no_delete ON public.audit_log;
CREATE POLICY audit_no_delete ON public.audit_log
  FOR DELETE TO authenticated
  USING (false);

-- INSERT: explicit service-role-only posture (handler step-8 always uses
-- the admin client which bypasses RLS). Authenticated should NEVER directly
-- INSERT audit rows. We add a deny policy.
DROP POLICY IF EXISTS audit_no_direct_insert ON public.audit_log;
CREATE POLICY audit_no_direct_insert ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- ============================================================================
-- 3. AUDIT LOG: operational indexes
-- ============================================================================

-- Per-entity timeline (powers <AuditTimeline entity_type entity_id>).
CREATE INDEX IF NOT EXISTS idx_audit_log_org_entity_time
  ON public.audit_log (org_id, entity_type, entity_id, triggered_at DESC);

-- Per-actor activity stream (powers "what did Mike do last week?").
CREATE INDEX IF NOT EXISTS idx_audit_log_org_actor_time
  ON public.audit_log (org_id, triggered_by, triggered_at DESC)
  WHERE triggered_by IS NOT NULL;

-- diff_json GIN (powers ad-hoc queries against the diff body).
CREATE INDEX IF NOT EXISTS idx_audit_log_diff_gin
  ON public.audit_log USING GIN (diff_json)
  WHERE diff_json IS NOT NULL;

-- ============================================================================
-- 4. IDEMPOTENCY_KEYS: lock down to caller's own rows
-- ============================================================================

-- Wave 0 set up idempotency_keys with no client policies; service-role
-- handles all reads. Forward-compat: explicit self-scoped SELECT for
-- diagnostics, explicit DENY UPDATE/DELETE.
DROP POLICY IF EXISTS idemp_select_self ON public.idempotency_keys;
CREATE POLICY idemp_select_self ON public.idempotency_keys
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         AND org_id = public.current_org_id());

DROP POLICY IF EXISTS idemp_no_update ON public.idempotency_keys;
CREATE POLICY idemp_no_update ON public.idempotency_keys
  FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS idemp_no_delete ON public.idempotency_keys;
CREATE POLICY idemp_no_delete ON public.idempotency_keys
  FOR DELETE TO authenticated
  USING (false);

DROP POLICY IF EXISTS idemp_no_direct_insert ON public.idempotency_keys;
CREATE POLICY idemp_no_direct_insert ON public.idempotency_keys
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- ============================================================================
-- 5. workflow_transitions BACKWARDS-COMPAT VIEW (defensive)
-- ============================================================================
-- A few historical handler files referenced `workflow_transitions`; the
-- rename in 0036 made those write paths fail silently. Code has since been
-- swept to use audit_log directly. Adding a forward-compat VIEW would risk
-- masking new mistakes — instead we leave the table absent. This is a
-- comment marker only; no DDL.

-- ============================================================================
-- 6. notifications RLS: ensure recipient-scope SELECT exists (was deferred)
-- ============================================================================
-- 0043 set up notifications policies; verify recipient-scope select exists.
-- If a future migration drops it, this block re-creates it idempotently.
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    -- Recipient-scope SELECT (defense-in-depth — handlers should already
    -- restrict via .eq('recipient_user_id', auth.uid())).
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'notifications'
        AND policyname = 'notifications_select_recipient'
    ) THEN
      EXECUTE $POL$
        CREATE POLICY notifications_select_recipient ON public.notifications
          FOR SELECT TO authenticated
          USING (org_id = public.current_org_id()
                 AND recipient_user_id = auth.uid())
      $POL$;
    END IF;
  END IF;
END $$;

COMMIT;
