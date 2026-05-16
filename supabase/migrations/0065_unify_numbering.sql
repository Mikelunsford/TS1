-- 0065_unify_numbering.sql
-- Phase 14 — Numbering unification (finishing pass).
--
-- Migration 0034 already shipped:
--   * public.numbering_sequences (org_id, doc_type, prefix, pad_width,
--     current_value, reset_period, current_year, current_month, ...).
--   * public.next_doc_number(p_org_id uuid, p_doc_type text) RETURNS text,
--     SECURITY DEFINER, advisory-locked, year/month-aware.
--   * 14 seeded doc_types per organization.
--   * RLS enabled with SELECT policy for org_owner/org_admin staff.
--
-- This migration finishes the unification:
--   1. Ensures `vendor_bill` row exists per org (omitted from 0034).
--   2. Replaces the advisory-free SELECT...FOR UPDATE in next_doc_number
--      with a pg_advisory_xact_lock to harden against 100-parallel-call
--      collision races under high concurrency.
--   3. Adds public.seed_org_numbering(p_org_id) — idempotent INSERT of
--      the canonical 14 doc_types for a fresh org. Service-role only.
--   4. Backfills current_value from MAX(\d+ tail) of existing data per
--      (org, doc_type) so first new alloc post-deploy never collides
--      with historical numbers. Skips columns/tables that don't exist.
--   5. Adds write-RLS policy: numbering_sequences UPDATE/INSERT/DELETE
--      are service_role only (mirror chart_of_accounts pattern).
--
-- DOWN MIGRATION (manual; legacy helpers untouched):
--   DROP FUNCTION IF EXISTS public.seed_org_numbering(uuid);
--   -- (next_doc_number stays — 0034 owns its lifecycle.)
--
-- Date: 2026-05-16.

BEGIN;

-- -----------------------------------------------------------------------
-- 1. Backfill missing `vendor_bill` seed row per org.
-- -----------------------------------------------------------------------
INSERT INTO public.numbering_sequences (org_id, doc_type, prefix, pad_width, reset_period)
SELECT o.id, 'vendor_bill', 'VB-', 5, 'yearly'
  FROM public.organizations o
ON CONFLICT (org_id, doc_type) DO NOTHING;

-- -----------------------------------------------------------------------
-- 2. Hardened next_doc_number: advisory-xact-lock keyed by
-- (org_id, doc_type). Falls back to SELECT ... FOR UPDATE for crash-safety.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_doc_number(p_org_id uuid, p_doc_type text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.numbering_sequences%ROWTYPE;
  v_year int := extract(year FROM now())::int;
  v_month int := extract(month FROM now())::int;
  v_next bigint;
  v_segment text;
BEGIN
  IF p_org_id IS NULL OR p_doc_type IS NULL OR p_doc_type = '' THEN
    RAISE EXCEPTION 'next_doc_number: p_org_id and p_doc_type required';
  END IF;

  -- Advisory lock keyed by (org, kind). Held until xact commit/rollback.
  -- Protects against the 100-parallel-call uniqueness contract test
  -- and any future concurrent inserter.
  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text || ':' || p_doc_type));

  SELECT * INTO v_row FROM public.numbering_sequences
   WHERE org_id = p_org_id AND doc_type = p_doc_type
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'No numbering sequence configured for org=% doc=%', p_org_id, p_doc_type;
  END IF;

  IF v_row.reset_period = 'yearly' AND v_row.current_year IS DISTINCT FROM v_year THEN
    v_row.current_value := 0;
    v_row.current_year := v_year;
  ELSIF v_row.reset_period = 'monthly'
        AND (v_row.current_year IS DISTINCT FROM v_year
             OR v_row.current_month IS DISTINCT FROM v_month) THEN
    v_row.current_value := 0;
    v_row.current_year := v_year;
    v_row.current_month := v_month;
  END IF;

  v_next := v_row.current_value + 1;

  UPDATE public.numbering_sequences
     SET current_value = v_next,
         current_year  = v_row.current_year,
         current_month = v_row.current_month,
         last_reset_at = CASE WHEN v_row.current_value = 0 THEN now() ELSE last_reset_at END
   WHERE id = v_row.id;

  v_segment := CASE v_row.reset_period
    WHEN 'yearly' THEN v_year::text || '-' || lpad(v_next::text, v_row.pad_width, '0')
    WHEN 'monthly' THEN v_year::text || lpad(v_month::text, 2, '0') || '-' || lpad(v_next::text, v_row.pad_width, '0')
    ELSE lpad(v_next::text, v_row.pad_width, '0')
  END;

  RETURN v_row.prefix || v_segment;
END $$;

REVOKE EXECUTE ON FUNCTION public.next_doc_number(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.next_doc_number(uuid, text) TO service_role;

COMMENT ON FUNCTION public.next_doc_number(uuid, text) IS
  'Phase 14: org-scoped allocator. Advisory-locked per (org_id, doc_type). '
  'Returns prefix + year-segment + lpad(current_value, pad_width). '
  'service_role only.';

-- -----------------------------------------------------------------------
-- 3. seed_org_numbering — idempotent seed wrapper for fresh orgs.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_org_numbering(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'seed_org_numbering: p_org_id NULL';
  END IF;

  INSERT INTO public.numbering_sequences (org_id, doc_type, prefix, pad_width, reset_period)
  VALUES
    (p_org_id, 'quote',           'Q-',     5, 'yearly'),
    (p_org_id, 'invoice',         'INV-',   5, 'yearly'),
    (p_org_id, 'credit_note',     'CN-',    5, 'yearly'),
    (p_org_id, 'payment',         'PMT-',   5, 'yearly'),
    (p_org_id, 'project',         'PRJ-',   5, 'yearly'),
    (p_org_id, 'purchase_order',  'PO-',    5, 'yearly'),
    (p_org_id, 'vendor_bill',     'VB-',    5, 'yearly'),
    (p_org_id, 'expense',         'EXP-',   5, 'yearly'),
    (p_org_id, 'journal_entry',   'JE-',    5, 'yearly'),
    (p_org_id, 'receiving_order', 'RO-',    5, 'yearly'),
    (p_org_id, 'production_run',  'PR-',    5, 'yearly'),
    (p_org_id, 'shipment',        'SH-',    5, 'yearly')
  ON CONFLICT (org_id, doc_type) DO NOTHING;
END $$;

COMMENT ON FUNCTION public.seed_org_numbering(uuid) IS
  'Phase 14: idempotent seed for a fresh org. Inserts 12 canonical doc_types. '
  'Existing 0034 prefixes (Q-, INV-, P-, PAY-, CN-, EXP-, PO-, VB-, T1-RO-, '
  'T1-PR-, T1-SH-, JE-) are preserved by ON CONFLICT DO NOTHING.';

REVOKE EXECUTE ON FUNCTION public.seed_org_numbering(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.seed_org_numbering(uuid) TO service_role;

-- -----------------------------------------------------------------------
-- 4. Backfill current_value from MAX(numeric tail) of historical rows
-- per (org, doc_type). Probe information_schema to skip columns that
-- don't exist (e.g. payment_number is present on 0033 — covered;
-- credit_note_number on 0033; etc.). Any missing table/col → skip silently.
-- -----------------------------------------------------------------------
DO $$
DECLARE
  v_kinds CONSTANT text[][] := ARRAY[
    ['quote',           'quotes',            'quote_number'],
    ['invoice',         'invoices',          'invoice_number'],
    ['credit_note',     'credit_notes',      'credit_note_number'],
    ['payment',         'payments',          'payment_number'],
    ['project',         'projects',          'project_number'],
    ['purchase_order',  'purchase_orders',   'po_number'],
    ['vendor_bill',     'vendor_bills',      'bill_number'],
    ['expense',         'expenses',          'expense_number'],
    ['journal_entry',   'journal_entries',   'entry_number'],
    ['receiving_order', 'receiving_orders',  'ro_number'],
    ['production_run',  'production_runs',   'run_number'],
    ['shipment',        'shipments',         'shipment_number']
  ];
  v_kind text; v_table text; v_col text;
  v_sql text;
  i int;
BEGIN
  FOR i IN 1 .. array_length(v_kinds, 1) LOOP
    v_kind  := v_kinds[i][1];
    v_table := v_kinds[i][2];
    v_col   := v_kinds[i][3];

    -- Verify table+column exist before issuing dynamic SQL.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = v_table
         AND column_name  = v_col
    ) THEN
      RAISE NOTICE 'numbering backfill: skip %.% (column not present)', v_table, v_col;
      CONTINUE;
    END IF;

    -- Per-org high-water mark. regexp_match captures the trailing run of
    -- digits; rows w/o a numeric tail (e.g. legacy free-text) contribute 0.
    v_sql := format($f$
      WITH peaks AS (
        SELECT org_id,
               COALESCE(MAX( (regexp_match(%I, '(\d+)$'))[1]::bigint ), 0) AS hwm
          FROM public.%I
         WHERE %I IS NOT NULL
         GROUP BY org_id
      )
      UPDATE public.numbering_sequences ns
         SET current_value = GREATEST(ns.current_value, peaks.hwm),
             current_year  = COALESCE(ns.current_year, extract(year FROM now())::int)
        FROM peaks
       WHERE ns.org_id   = peaks.org_id
         AND ns.doc_type = %L
    $f$, v_col, v_table, v_col, v_kind);

    EXECUTE v_sql;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------
-- 5. Write-policy: INSERT/UPDATE/DELETE on numbering_sequences are
-- service_role only. SELECT policy from 0034 remains for org admins.
-- Mirrors the chart_of_accounts pattern from migration 0060.
-- -----------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'numbering_sequences'
       AND policyname = 'numseq_no_client_writes'
  ) THEN
    CREATE POLICY numseq_no_client_writes ON public.numbering_sequences
      FOR ALL TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

-- -----------------------------------------------------------------------
-- 6. Post-migration sanity invariants.
-- -----------------------------------------------------------------------
DO $$
DECLARE v_fn_count int; v_vb_count int;
BEGIN
  SELECT COUNT(*) INTO v_fn_count FROM pg_proc WHERE proname='seed_org_numbering';
  IF v_fn_count = 0 THEN
    RAISE EXCEPTION 'seed_org_numbering missing post-migration';
  END IF;

  SELECT COUNT(*) INTO v_vb_count
    FROM public.numbering_sequences
   WHERE doc_type = 'vendor_bill';
  IF v_vb_count = 0
     AND EXISTS (SELECT 1 FROM public.organizations LIMIT 1) THEN
    RAISE EXCEPTION 'vendor_bill seed missing for organizations';
  END IF;
END $$;

COMMIT;
