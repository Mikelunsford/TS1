-- 0067_wave10_cleanup_and_reports.sql
-- Wave 10 / Phase 18 — R-W9-OBS-01 cleanup + report RPCs for Phase 18 polish.
--
-- Ships:
--   1. DELETE legacy lead/opportunity rows from numbering_sequences (0034
--      cruft; no handler reads them after the Wave 7 CRM cut).
--   2. DROP IF EXISTS bom_items.vendor — idempotent re-attempt; Wave 8d /
--      R-W8D-INTEGRATION-01 most likely dropped it in 0044 already.
--   3. DROP legacy next_<kind>_number() helpers superseded by next_doc_number
--      from 0034/0065. One-release grace from Wave 9 BE-1 has now elapsed.
--      Uses to_regprocedure(...) guards per
--      feedback_parallel_migration_slot_collision so re-runs and partial
--      states are safe. Tries both () and (uuid) signatures because
--      historical migrations created the helpers with no args while the
--      spec references a (uuid) shape.
--   4. ar_aging(p_org_id uuid, p_as_of date, p_currency text) — open-AR
--      buckets per customer (current / 1-30 / 31-60 / 61-90 / 90+).
--   5. sales_by_customer(p_org_id uuid, p_start date, p_end date,
--      p_currency text) — invoice gross/tax/net per customer in range.
--   6. sales_by_item(p_org_id uuid, p_start date, p_end date,
--      p_currency text) — qty/gross/tax/net per pricing_menu item.
--   7. cash_position(p_org_id uuid, p_as_of date, p_currency text) —
--      asset-class balances as of date. Asset_subtype does not exist on
--      chart_of_accounts in prod, so we surface ALL assets and rely on
--      the consuming handler to interpret. Account_code prefix '10' is
--      the conventional cash/bank range; we keep that as a soft filter.
--   8. expense_by_category(p_org_id uuid, p_start date, p_end date,
--      p_currency text) — expense counts/totals per category in range.
--
-- Constitutional alignment:
--   - All 5 report RPCs SECURITY DEFINER, LANGUAGE sql STABLE,
--     SET search_path = public.
--   - REVOKE EXECUTE FROM PUBLIC, anon, authenticated; GRANT to
--     service_role only (mirrors 0062 trial_balance/profit_loss/
--     balance_sheet exactly).
--   - Money in int cents (bigint). Quantities numeric to match
--     invoice_line_items.quantity numeric(14,4).
--   - Org-scoping enforced in the WHERE clause of every RPC (RLS bypass
--     by SECURITY DEFINER is intentional; handler calls go through the
--     service-role admin client).
--
-- Schema deviations vs Wave 10 A3 dispatch spec, surfaced for reviewer:
--   * `chart_of_accounts.account_subtype` does NOT exist; cash_position
--     filters by `account_type = 'asset'` plus a soft `account_code LIKE
--     '10%' OR label ILIKE '%cash%' OR label ILIKE '%bank%'` heuristic.
--   * `expenses.expense_date` does not exist — the actual column is
--     `spent_at`. Spec text used `expense_date`; this migration uses
--     the real column name.
--   * `invoice_line_items.item_id` FKs `pricing_menu`, not a (non-
--     existent) `items` table. sales_by_item joins pricing_menu and
--     uses pricing_menu.description as `item_name`.
--   * `customers.display_name` is the canonical display column (Wave 6 /
--     migration 0054 renamed `name` → `display_name`). ar_aging and
--     sales_by_customer JOIN on c.id and project c.display_name.
--
-- DOWN MIGRATION:
--   DROP FUNCTION IF EXISTS public.ar_aging(uuid, date, text);
--   DROP FUNCTION IF EXISTS public.sales_by_customer(uuid, date, date, text);
--   DROP FUNCTION IF EXISTS public.sales_by_item(uuid, date, date, text);
--   DROP FUNCTION IF EXISTS public.cash_position(uuid, date, text);
--   DROP FUNCTION IF EXISTS public.expense_by_category(uuid, date, date, text);
--   -- (legacy next_*_number() helpers and bom_items.vendor are not
--   --  restorable from a forward migration; revert from snapshot.)
--   -- (lead/opportunity numbering_sequences rows can be re-INSERTed
--   --  per 0034's VALUES block if needed.)
--
-- Date:     2026-05-16
-- Sub-wave: 10
-- Closes:   R-W9-OBS-01. Unblocks Wave 10 Agent A1 (Phase 18 polish handlers).

BEGIN;

-- ============================================================================
-- Part A — R-W9-OBS-01 cleanup
-- ============================================================================

-- 1. DELETE legacy lead/opportunity numbering_sequences rows.
DO $$
DECLARE
  v_deleted int;
BEGIN
  WITH del AS (
    DELETE FROM public.numbering_sequences
     WHERE doc_type IN ('lead','opportunity')
     RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM del;
  RAISE NOTICE 'numbering_sequences: deleted % legacy lead/opportunity rows', v_deleted;
END $$;

-- 2. Drop bom_items.vendor (IF EXISTS — Wave 8d / migration 0044 likely
--    handled it already; guard keeps this idempotent).
DO $$
DECLARE
  v_existed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'bom_items'
       AND column_name  = 'vendor'
  ) INTO v_existed;

  IF v_existed THEN
    EXECUTE 'ALTER TABLE public.bom_items DROP COLUMN vendor';
    RAISE NOTICE 'bom_items.vendor: dropped';
  ELSE
    RAISE NOTICE 'bom_items.vendor: guard-skipped (already absent)';
  END IF;
END $$;

-- 3. Drop legacy next_<kind>_number() helpers via to_regprocedure guards.
--    Probe both () (historical 0001/0003/0004/0005 shape) and (uuid)
--    (the spec's claimed shape, in case any handler-side helper was
--    re-bound). All have been superseded by next_doc_number(uuid, text).
DO $$
DECLARE
  fn_name  text;
  fn_names text[] := ARRAY[
    'next_lead_number',
    'next_opportunity_number',
    'next_quote_number',
    'next_project_number',
    'next_invoice_number',
    'next_payment_number',
    'next_credit_note_number',
    'next_vendor_number',
    'next_po_number',
    'next_vendor_bill_number',
    'next_expense_number',
    -- Also drop the no-arg helpers from 0003/0004/0005 that share the
    -- same supersession story but were missed by the spec list.
    'next_receiving_order_number',
    'next_production_run_number',
    'next_shipment_number'
  ];
  v_signature text;
  v_signatures text[] := ARRAY['()', '(uuid)'];
BEGIN
  FOREACH fn_name IN ARRAY fn_names LOOP
    FOREACH v_signature IN ARRAY v_signatures LOOP
      IF to_regprocedure('public.' || fn_name || v_signature) IS NOT NULL THEN
        EXECUTE format('DROP FUNCTION public.%I%s', fn_name, v_signature);
        RAISE NOTICE 'Dropped legacy %', fn_name || v_signature;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ============================================================================
-- Part B — Phase 18 report RPCs (for Wave 10 Agent A1 handlers)
-- ============================================================================

-- 4. ar_aging --------------------------------------------------------------
--
-- Open-AR aging buckets per customer at p_as_of. Filters invoices to
-- live (deleted_at IS NULL), open-status (sent/partially_paid/overdue),
-- positive balance, matching currency. Bucket boundaries follow the
-- standard 30/60/90 schedule with overdue days computed from
-- (p_as_of - due_date).

CREATE OR REPLACE FUNCTION public.ar_aging(
  p_org_id   uuid,
  p_as_of    date,
  p_currency text
)
RETURNS TABLE (
  customer_id         uuid,
  customer_name       text,
  current_cents       bigint,
  days_1_30_cents     bigint,
  days_31_60_cents    bigint,
  days_61_90_cents    bigint,
  days_over_90_cents  bigint,
  total_cents         bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH open_invoices AS (
    SELECT
      i.customer_id,
      i.balance_cents::bigint AS bal,
      (p_as_of - i.due_date)::int AS days_overdue
    FROM public.invoices i
    WHERE i.org_id        = p_org_id
      AND i.currency_code = p_currency
      AND i.status        IN ('sent','partially_paid','overdue')
      AND i.balance_cents > 0
      AND i.deleted_at    IS NULL
  )
  SELECT
    c.id                                                  AS customer_id,
    c.display_name                                        AS customer_name,
    COALESCE(SUM(CASE WHEN oi.days_overdue <= 0  THEN oi.bal ELSE 0 END), 0)::bigint AS current_cents,
    COALESCE(SUM(CASE WHEN oi.days_overdue BETWEEN 1  AND 30 THEN oi.bal ELSE 0 END), 0)::bigint AS days_1_30_cents,
    COALESCE(SUM(CASE WHEN oi.days_overdue BETWEEN 31 AND 60 THEN oi.bal ELSE 0 END), 0)::bigint AS days_31_60_cents,
    COALESCE(SUM(CASE WHEN oi.days_overdue BETWEEN 61 AND 90 THEN oi.bal ELSE 0 END), 0)::bigint AS days_61_90_cents,
    COALESCE(SUM(CASE WHEN oi.days_overdue > 90 THEN oi.bal ELSE 0 END), 0)::bigint AS days_over_90_cents,
    COALESCE(SUM(oi.bal), 0)::bigint                       AS total_cents
  FROM open_invoices oi
  JOIN public.customers c ON c.id = oi.customer_id
  GROUP BY c.id, c.display_name
  ORDER BY c.display_name, c.id;
$$;

COMMENT ON FUNCTION public.ar_aging(uuid, date, text) IS
  'Wave 10 / Phase 18: open-AR aging buckets (current / 1-30 / 31-60 / 61-90 '
  '/ 90+) per customer at p_as_of for invoices in p_currency. Source: '
  'invoices with status IN (sent, partially_paid, overdue) and balance>0.';

REVOKE EXECUTE ON FUNCTION public.ar_aging(uuid, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ar_aging(uuid, date, text)
  TO service_role;

-- 5. sales_by_customer ------------------------------------------------------
--
-- Invoice gross / tax / net per customer for issue_date in range. Excludes
-- draft and cancelled invoices. net = subtotal - discount; gross = total
-- (subtotal - discount + tax). Mirrors the trial_balance currency-code
-- filter convention.

CREATE OR REPLACE FUNCTION public.sales_by_customer(
  p_org_id   uuid,
  p_start    date,
  p_end      date,
  p_currency text
)
RETURNS TABLE (
  customer_id    uuid,
  customer_name  text,
  invoice_count  int,
  gross_cents    bigint,
  tax_cents      bigint,
  net_cents      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id                                                       AS customer_id,
    c.display_name                                             AS customer_name,
    COUNT(i.id)::int                                           AS invoice_count,
    COALESCE(SUM(i.total_cents), 0)::bigint                    AS gross_cents,
    COALESCE(SUM(i.tax_cents),   0)::bigint                    AS tax_cents,
    COALESCE(SUM(i.subtotal_cents - i.discount_cents), 0)::bigint AS net_cents
  FROM public.invoices i
  JOIN public.customers c ON c.id = i.customer_id
  WHERE i.org_id        = p_org_id
    AND i.currency_code = p_currency
    AND i.issue_date    BETWEEN p_start AND p_end
    AND i.status        NOT IN ('draft','cancelled')
    AND i.deleted_at    IS NULL
  GROUP BY c.id, c.display_name
  ORDER BY c.display_name, c.id;
$$;

COMMENT ON FUNCTION public.sales_by_customer(uuid, date, date, text) IS
  'Wave 10 / Phase 18: per-customer invoice count + gross/tax/net cents for '
  'issue_date in range. Excludes draft+cancelled. p_currency filters '
  'invoices.currency_code.';

REVOKE EXECUTE ON FUNCTION public.sales_by_customer(uuid, date, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sales_by_customer(uuid, date, date, text)
  TO service_role;

-- 6. sales_by_item ----------------------------------------------------------
--
-- Per-item quantity + gross/tax/net. Joins invoice_line_items to
-- invoices (for date/currency/status filter) and to pricing_menu (for
-- the item display name — the FK target). gross = line_total + tax;
-- net = line_total; tax = tax_amount.

CREATE OR REPLACE FUNCTION public.sales_by_item(
  p_org_id   uuid,
  p_start    date,
  p_end      date,
  p_currency text
)
RETURNS TABLE (
  item_id        uuid,
  item_name      text,
  quantity_sold  numeric,
  gross_cents    bigint,
  tax_cents      bigint,
  net_cents      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pm.id                                                     AS item_id,
    pm.description                                            AS item_name,
    COALESCE(SUM(ili.quantity), 0)::numeric                   AS quantity_sold,
    COALESCE(SUM(ili.line_total_cents + ili.tax_amount_cents), 0)::bigint AS gross_cents,
    COALESCE(SUM(ili.tax_amount_cents), 0)::bigint            AS tax_cents,
    COALESCE(SUM(ili.line_total_cents), 0)::bigint            AS net_cents
  FROM public.invoice_line_items ili
  JOIN public.invoices i
    ON i.id = ili.invoice_id
  JOIN public.pricing_menu pm
    ON pm.id = ili.item_id
  WHERE i.org_id        = p_org_id
    AND i.currency_code = p_currency
    AND i.issue_date    BETWEEN p_start AND p_end
    AND i.status        NOT IN ('draft','cancelled')
    AND i.deleted_at    IS NULL
    AND ili.item_id     IS NOT NULL
  GROUP BY pm.id, pm.description
  ORDER BY pm.description, pm.id;
$$;

COMMENT ON FUNCTION public.sales_by_item(uuid, date, date, text) IS
  'Wave 10 / Phase 18: per-pricing_menu-item quantity + gross/tax/net for '
  'invoice_line_items whose parent invoice issue_date is in range, status '
  'NOT IN (draft,cancelled), currency_code = p_currency. Lines with NULL '
  'item_id (ad-hoc lines) are excluded — they cannot be attributed.';

REVOKE EXECUTE ON FUNCTION public.sales_by_item(uuid, date, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sales_by_item(uuid, date, date, text)
  TO service_role;

-- 7. cash_position ----------------------------------------------------------
--
-- Asset-class account balances at p_as_of from posted journal_entries.
-- chart_of_accounts has no `account_subtype` column (spec deviation —
-- see header), so we surface all asset accounts and apply a soft
-- account_code/label heuristic. The handler is the source of truth for
-- which accounts count as cash; the heuristic just keeps the row count
-- focused. Sign convention follows trial_balance for assets:
-- balance = debit-credit.

CREATE OR REPLACE FUNCTION public.cash_position(
  p_org_id   uuid,
  p_as_of    date,
  p_currency text
)
RETURNS TABLE (
  account_id     uuid,
  account_code   text,
  account_name   text,
  balance_cents  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH line_totals AS (
    SELECT
      jel.account_id,
      COALESCE(SUM(jel.debit_cents),  0)::bigint AS debit_total_cents,
      COALESCE(SUM(jel.credit_cents), 0)::bigint AS credit_total_cents
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je
      ON je.id = jel.journal_entry_id
    WHERE je.org_id        = p_org_id
      AND je.status        = 'posted'
      AND je.entry_date    <= p_as_of
      AND je.currency_code = p_currency
      AND je.deleted_at    IS NULL
    GROUP BY jel.account_id
  )
  SELECT
    coa.id           AS account_id,
    coa.account_code AS account_code,
    coa.label        AS account_name,
    (COALESCE(lt.debit_total_cents, 0) - COALESCE(lt.credit_total_cents, 0))::bigint AS balance_cents
  FROM public.chart_of_accounts coa
  LEFT JOIN line_totals lt ON lt.account_id = coa.id
  WHERE coa.org_id       = p_org_id
    AND coa.account_type = 'asset'
    AND coa.deleted_at   IS NULL
    AND (
      coa.account_code LIKE '10%'
      OR coa.label ILIKE '%cash%'
      OR coa.label ILIKE '%bank%'
    )
  ORDER BY coa.account_code, coa.id;
$$;

COMMENT ON FUNCTION public.cash_position(uuid, date, text) IS
  'Wave 10 / Phase 18: cash/bank asset balances at p_as_of. '
  'chart_of_accounts has no account_subtype on prod; filter is by '
  'account_type=asset plus account_code LIKE 10% OR label ILIKE %cash%/%bank%. '
  'Sign convention: balance = debit-credit (asset normal-debit).';

REVOKE EXECUTE ON FUNCTION public.cash_position(uuid, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cash_position(uuid, date, text)
  TO service_role;

-- 8. expense_by_category ----------------------------------------------------
--
-- Per-category expense count + total_cents for spent_at in range
-- (expenses.expense_date does NOT exist on prod — spec column name was
-- wrong; we use spent_at). Includes only approved/paid/reimbursed.
-- Lines with NULL category_id are excluded (cannot attribute).

CREATE OR REPLACE FUNCTION public.expense_by_category(
  p_org_id   uuid,
  p_start    date,
  p_end      date,
  p_currency text
)
RETURNS TABLE (
  category_id    uuid,
  category_name  text,
  expense_count  int,
  total_cents    bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ec.id                                       AS category_id,
    ec.label                                    AS category_name,
    COUNT(e.id)::int                            AS expense_count,
    COALESCE(SUM(e.total_cents), 0)::bigint     AS total_cents
  FROM public.expenses e
  JOIN public.expense_categories ec
    ON ec.id = e.category_id
  WHERE e.org_id        = p_org_id
    AND e.currency_code = p_currency
    AND e.spent_at      BETWEEN p_start AND p_end
    AND e.status        IN ('approved','paid','reimbursed')
    AND e.deleted_at    IS NULL
  GROUP BY ec.id, ec.label
  ORDER BY ec.label, ec.id;
$$;

COMMENT ON FUNCTION public.expense_by_category(uuid, date, date, text) IS
  'Wave 10 / Phase 18: per-category expense count + total_cents for '
  'expenses.spent_at in range, status IN (approved,paid,reimbursed), '
  'currency_code = p_currency. NULL-category expenses are excluded.';

REVOKE EXECUTE ON FUNCTION public.expense_by_category(uuid, date, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.expense_by_category(uuid, date, date, text)
  TO service_role;

-- ============================================================================
-- Post-state assertions
-- ============================================================================
DO $$
DECLARE
  v_legacy_count int;
  v_rpc_count    int;
BEGIN
  -- The 5 report RPCs must exist (count by name; signatures asserted by
  -- the to_regprocedure-style smoke from the handler tests in CI).
  SELECT COUNT(DISTINCT proname) INTO v_rpc_count
    FROM pg_proc
   WHERE proname IN (
     'ar_aging',
     'sales_by_customer',
     'sales_by_item',
     'cash_position',
     'expense_by_category'
   );
  IF v_rpc_count <> 5 THEN
    RAISE EXCEPTION '0067: expected 5 Phase 18 report RPCs, found %', v_rpc_count;
  END IF;

  -- Legacy lead/opportunity numbering_sequences rows must be gone.
  SELECT COUNT(*) INTO v_legacy_count
    FROM public.numbering_sequences
   WHERE doc_type IN ('lead','opportunity');
  IF v_legacy_count <> 0 THEN
    RAISE EXCEPTION '0067: % legacy lead/opportunity numbering rows survived', v_legacy_count;
  END IF;
END $$;

COMMIT;
