-- 0058_wave7_rollup_triggers.sql
-- Wave 7 / Phase 10 + Phase 11 prerequisite.
--
-- Adds three small rollup functions + their BEFORE/AFTER triggers so
-- the new handler surfaces (vendors-api PO + vendor-bills routes;
-- finance-api expenses routes) can rely on the database to keep
-- header totals in sync without app-side recompute calls. Mirrors the
-- Wave 5/6 pattern (0052 recompute_invoice_totals,
-- 0056 recompute_credit_note_applied, etc).
--
--   1. recompute_purchase_order_totals(p_po_id uuid)
--        - subtotal_cents := SUM(po_line_items.line_total_cents WHERE po_id=p_po_id, not soft-deleted)
--        - total_cents    := subtotal_cents + tax_cents + shipping_cents
--      Trigger tg_po_lines_recompute on po_line_items AFTER I/U/D
--      fires recompute_purchase_order_totals(NEW.po_id) (and OLD.po_id
--      on DELETE / cross-PO UPDATE).
--
--   2. tg_vendor_bills_balance_biu on vendor_bills BEFORE I/U
--      stamps NEW.balance_cents := NEW.total_cents - NEW.paid_cents.
--      Header-only — no vendor_bill_line_items table exists in prod
--      (D-W7-6 in the Wave 7 dispatch plan). vendor_bills is captured
--      with subtotal/tax/total set directly by the BE handler.
--
--   3. tg_expenses_total_biu on expenses BEFORE I/U
--      stamps NEW.total_cents := NEW.amount_cents + NEW.tax_cents.
--      expenses is single-line (no expense_line_items in prod, D-W7-7).
--
-- Plus feature-flag seeds: flips procurement.enabled and
-- finance.expenses to true for Team1 so the new surfaces become "live"
-- for the active dispatch org. Other orgs' flags untouched.
--
-- Step-2 verification (MCP 2026-05-16):
--   purchase_orders columns: subtotal_cents bigint NN default 0,
--     tax_cents bigint NN default 0, shipping_cents bigint NN default 0,
--     total_cents bigint NN default 0. CHECK status IN (draft/submitted/
--     approved/partial_received/received/cancelled/closed). State stamp
--     column is state_changed_at (single timestamp, Wave 0 convention).
--   po_line_items columns: line_total_cents bigint NN default 0 + CHECK
--     line_total_cents >= 0 + CHECK quantity > 0 + CHECK quantity_received >= 0.
--   vendor_bills columns: subtotal_cents/tax_cents/total_cents/paid_cents
--     bigint NN default 0; balance_cents bigint NULL (no default — set
--     by trigger). approved_at/by, paid_at sentinels.
--   expenses columns: amount_cents/tax_cents/total_cents bigint NN
--     default 0; CHECK amount_cents >= 0. status CHECK 6 values
--     (draft/submitted/approved/rejected/reimbursed/paid).
--   org_feature_flags has procurement.enabled=false + finance.expenses=false
--     rows for Team1 (D-W7-10).
--
-- Forward-only. The trigger functions are idempotent (running them on
-- a row whose totals are already correct is a no-op write of identical
-- values). All three are SECURITY INVOKER (caller's RLS still applies);
-- the BEFORE-stamp triggers don't query other tables so RLS is moot.
--
-- Date:     2026-05-16
-- Sub-wave: 7.0
-- Closes:   none — gates Wave 7 Phase 10 + Phase 11 BE work (PR #61, #62).

BEGIN;

-- ============================================================================
-- 1. recompute_purchase_order_totals + trigger on po_line_items
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_purchase_order_totals(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_subtotal bigint;
  v_tax      bigint;
  v_shipping bigint;
  v_total    bigint;
BEGIN
  -- Skip if PO doesn't exist (or is soft-deleted). Mirror of the
  -- recompute_invoice_totals defensive guard from 0052.
  SELECT tax_cents, shipping_cents
    INTO v_tax, v_shipping
    FROM public.purchase_orders
   WHERE id = p_po_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(line_total_cents), 0)
    INTO v_subtotal
    FROM public.po_line_items
   WHERE po_id = p_po_id;

  v_total := v_subtotal + v_tax + v_shipping;

  UPDATE public.purchase_orders
     SET subtotal_cents = v_subtotal,
         total_cents    = v_total,
         updated_at     = now()
   WHERE id = p_po_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_purchase_order_totals(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_purchase_order_totals(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.tg_po_line_items_recompute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_purchase_order_totals(OLD.po_id);
    RETURN OLD;
  END IF;

  -- INSERT or UPDATE: recompute the new parent.
  PERFORM public.recompute_purchase_order_totals(NEW.po_id);

  -- Cross-PO UPDATE: also recompute the old parent.
  IF TG_OP = 'UPDATE' AND OLD.po_id IS DISTINCT FROM NEW.po_id THEN
    PERFORM public.recompute_purchase_order_totals(OLD.po_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_po_lines_recompute ON public.po_line_items;
CREATE TRIGGER tg_po_lines_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.po_line_items
FOR EACH ROW
EXECUTE FUNCTION public.tg_po_line_items_recompute();

-- ============================================================================
-- 2. tg_vendor_bills_balance_biu on vendor_bills BEFORE I/U
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_vendor_bills_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.balance_cents := COALESCE(NEW.total_cents, 0) - COALESCE(NEW.paid_cents, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_vendor_bills_balance_biu ON public.vendor_bills;
CREATE TRIGGER tg_vendor_bills_balance_biu
BEFORE INSERT OR UPDATE ON public.vendor_bills
FOR EACH ROW
EXECUTE FUNCTION public.tg_vendor_bills_balance();

-- ============================================================================
-- 3. tg_expenses_total_biu on expenses BEFORE I/U
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_expenses_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.total_cents := COALESCE(NEW.amount_cents, 0) + COALESCE(NEW.tax_cents, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_expenses_total_biu ON public.expenses;
CREATE TRIGGER tg_expenses_total_biu
BEFORE INSERT OR UPDATE ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.tg_expenses_total();

-- ============================================================================
-- 4. Feature-flag seeds: procurement.enabled + finance.expenses for Team1
-- ============================================================================

-- These flags already exist for Team1 with is_enabled=false. Flip to true so
-- the new Phase 10 / 11 surfaces become "live" for the active dispatch org.
UPDATE public.org_feature_flags off
   SET is_enabled = true,
       updated_at = now()
  FROM public.organizations o
 WHERE off.org_id = o.id
   AND o.slug = 'team1'
   AND off.flag_key IN ('procurement.enabled', 'finance.expenses');

-- ============================================================================
-- 5. Post-state invariants
-- ============================================================================

DO $$
DECLARE
  v_po_fn_count    integer;
  v_vb_fn_count    integer;
  v_exp_fn_count   integer;
  v_po_trg_count   integer;
  v_vb_trg_count   integer;
  v_exp_trg_count  integer;
  v_flag_team1_proc boolean;
  v_flag_team1_exp  boolean;
BEGIN
  SELECT COUNT(*) INTO v_po_fn_count
    FROM pg_proc WHERE proname = 'recompute_purchase_order_totals';
  IF v_po_fn_count = 0 THEN
    RAISE EXCEPTION '0058 post-state: recompute_purchase_order_totals function missing';
  END IF;

  SELECT COUNT(*) INTO v_po_trg_count
    FROM pg_trigger WHERE tgname = 'tg_po_lines_recompute';
  IF v_po_trg_count = 0 THEN
    RAISE EXCEPTION '0058 post-state: tg_po_lines_recompute trigger missing';
  END IF;

  SELECT COUNT(*) INTO v_vb_trg_count
    FROM pg_trigger WHERE tgname = 'tg_vendor_bills_balance_biu';
  IF v_vb_trg_count = 0 THEN
    RAISE EXCEPTION '0058 post-state: tg_vendor_bills_balance_biu trigger missing';
  END IF;

  SELECT COUNT(*) INTO v_exp_trg_count
    FROM pg_trigger WHERE tgname = 'tg_expenses_total_biu';
  IF v_exp_trg_count = 0 THEN
    RAISE EXCEPTION '0058 post-state: tg_expenses_total_biu trigger missing';
  END IF;

  SELECT off.is_enabled INTO v_flag_team1_proc
    FROM public.org_feature_flags off
    JOIN public.organizations o ON o.id = off.org_id
   WHERE o.slug = 'team1' AND off.flag_key = 'procurement.enabled';
  IF NOT COALESCE(v_flag_team1_proc, false) THEN
    RAISE EXCEPTION '0058 post-state: procurement.enabled is not true for Team1 org';
  END IF;

  SELECT off.is_enabled INTO v_flag_team1_exp
    FROM public.org_feature_flags off
    JOIN public.organizations o ON o.id = off.org_id
   WHERE o.slug = 'team1' AND off.flag_key = 'finance.expenses';
  IF NOT COALESCE(v_flag_team1_exp, false) THEN
    RAISE EXCEPTION '0058 post-state: finance.expenses is not true for Team1 org';
  END IF;
END $$;

COMMIT;
