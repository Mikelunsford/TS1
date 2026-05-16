-- 0052_phase7_invoicing_addons.sql
--
-- Wave 5 / Phase 7 invoicing add-ons. Step-2 verification confirmed Wave 0's
-- chassis (0033/0040/0041) shipped every Phase-7 table + the recompute
-- trigger pair, so this migration only fills the remaining gaps:
--
--   1. Regen `recompute_invoice_totals` to also set `balance_cents`
--      (the column exists as plain `bigint NULL` on prod — not the
--      `GENERATED ALWAYS AS (total_cents - paid_cents) STORED` shape
--      schema-master §9.1 originally specified. The trigger now writes
--      it explicitly so the API/SPA can read a fresh balance without
--      recomputing client-side).
--
--   2. Add `create_v1_for_invoice` (AFTER INSERT) and
--      `mirror_invoice_to_current_version` (AFTER UPDATE) trigger
--      functions modeled byte-for-byte on the quote_versions trigger
--      pair (see Wave 4 PR #37 / migration 0050). Without these
--      `invoice_versions` stays empty across the application lifetime.
--
--   3. Add `convert_quote_to_invoice(p_quote_id uuid, p_due_date date)`
--      RPC. Modeled on the existing `convert_project_to_invoice` but also
--      copies quote_line_items → invoice_line_items so the trigger pair
--      computes header totals correctly. Stamps `invoices.quote_id` +
--      `converted_from_type='quote'` + `converted_from_id` so the
--      invoice→quote link is queryable.
--
--   4. Add `assert_invoice_payment_currency` trigger on payments to
--      reject inserts where `payments.currency_code <> invoices.currency_code`
--      (constitution §1.1 currency snapshot rule; defense-in-depth in
--      addition to the BE handler check).
--
-- Forward-only. No data backfill (the prod `invoices` table is empty —
-- no rows exist yet; Wave 5 is the first wave to expose write paths).

BEGIN;

-- ============================================================================
-- 1. Regen recompute_invoice_totals to set balance_cents
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_invoice_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subtotal bigint; v_tax bigint; v_discount bigint; v_total bigint;
  v_paid bigint; v_status text; v_due date; v_overdue boolean;
BEGIN
  SELECT COALESCE(SUM(line_total_cents), 0),
         COALESCE(SUM(tax_amount_cents), 0),
         COALESCE(SUM(discount_cents),   0)
    INTO v_subtotal, v_tax, v_discount
    FROM public.invoice_line_items WHERE invoice_id = p_invoice_id;

  v_total := v_subtotal - v_discount + v_tax;

  SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_paid
    FROM public.payments
   WHERE invoice_id = p_invoice_id
     AND voided_at IS NULL
     AND deleted_at IS NULL;

  IF v_paid > v_total THEN
    RAISE EXCEPTION 'Payments (% cents) exceed invoice total (% cents) for invoice %', v_paid, v_total, p_invoice_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_paid = 0 THEN
    v_status := 'unpaid';
  ELSIF v_paid >= v_total THEN
    v_status := 'paid';
  ELSE
    v_status := 'partially_paid';
  END IF;

  SELECT due_date INTO v_due FROM public.invoices WHERE id = p_invoice_id;
  v_overdue := (v_due IS NOT NULL) AND (v_due < current_date) AND v_status <> 'paid';

  UPDATE public.invoices
     SET subtotal_cents = v_subtotal,
         tax_cents      = v_tax,
         discount_cents = v_discount,
         total_cents    = v_total,
         paid_cents     = v_paid,
         balance_cents  = v_total - v_paid,
         payment_status = v_status,
         is_overdue     = v_overdue,
         paid_at        = CASE WHEN v_status = 'paid' AND paid_at IS NULL THEN now() ELSE paid_at END
   WHERE id = p_invoice_id;
END $$;

COMMENT ON FUNCTION public.recompute_invoice_totals(uuid) IS
  'Phase 7 / Wave 5: header rollup. Sums line totals + non-voided payments, '
  'sets subtotal/tax/discount/total/paid/balance/payment_status/is_overdue, '
  'raises check_violation when payments exceed total. Fires from '
  'tg_invoice_line_items_recompute (AIUD on invoice_line_items) and '
  'tg_payments_recompute (AIUD on payments).';

REVOKE EXECUTE ON FUNCTION public.recompute_invoice_totals(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_invoice_totals(uuid) TO service_role;

-- ============================================================================
-- 2a. create_v1_for_invoice  (AFTER INSERT on invoices)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_v1_for_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.invoice_versions (
    org_id, invoice_id, version_number, status, payment_status,
    issue_date, due_date, notes, currency_code,
    subtotal_cents, discount_cents, tax_cents, total_cents, paid_cents,
    created_by
  ) VALUES (
    NEW.org_id, NEW.id, 1, NEW.status, NEW.payment_status,
    NEW.issue_date, NEW.due_date, NEW.notes, NEW.currency_code,
    NEW.subtotal_cents, NEW.discount_cents, NEW.tax_cents, NEW.total_cents, NEW.paid_cents,
    NEW.created_by
  );
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_v1_for_invoice() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_v1_for_invoice() TO service_role;

DROP TRIGGER IF EXISTS trg_invoices_v1 ON public.invoices;
CREATE TRIGGER trg_invoices_v1
  AFTER INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.create_v1_for_invoice();

-- ============================================================================
-- 2b. mirror_invoice_to_current_version  (AFTER UPDATE on invoices)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mirror_invoice_to_current_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE v_id uuid; v_current int;
BEGIN
  -- Skip mirror when only audit columns (updated_at / updated_by) change.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.payment_status IS NOT DISTINCT FROM OLD.payment_status
     AND NEW.issue_date IS NOT DISTINCT FROM OLD.issue_date
     AND NEW.due_date IS NOT DISTINCT FROM OLD.due_date
     AND NEW.notes IS NOT DISTINCT FROM OLD.notes
     AND NEW.currency_code IS NOT DISTINCT FROM OLD.currency_code
     AND NEW.subtotal_cents = OLD.subtotal_cents
     AND NEW.discount_cents = OLD.discount_cents
     AND NEW.tax_cents = OLD.tax_cents
     AND NEW.total_cents = OLD.total_cents
     AND NEW.paid_cents = OLD.paid_cents THEN
    RETURN NEW;
  END IF;

  SELECT id, version_number INTO v_id, v_current
    FROM public.invoice_versions
   WHERE invoice_id = NEW.id
   ORDER BY version_number DESC LIMIT 1;

  IF v_id IS NULL THEN
    -- Defensive: should not happen given create_v1_for_invoice. Insert v1.
    INSERT INTO public.invoice_versions (
      org_id, invoice_id, version_number, status, payment_status,
      issue_date, due_date, notes, currency_code,
      subtotal_cents, discount_cents, tax_cents, total_cents, paid_cents,
      created_by
    ) VALUES (
      NEW.org_id, NEW.id, 1, NEW.status, NEW.payment_status,
      NEW.issue_date, NEW.due_date, NEW.notes, NEW.currency_code,
      NEW.subtotal_cents, NEW.discount_cents, NEW.tax_cents, NEW.total_cents, NEW.paid_cents,
      NEW.created_by
    );
  ELSE
    -- Update the current version row in place. Mirror pattern matches
    -- mirror_quote_to_current_version (Wave 4 / 0050) — preserves
    -- version_number rather than creating a new row per UPDATE.
    UPDATE public.invoice_versions SET
      status         = NEW.status,
      payment_status = NEW.payment_status,
      issue_date     = NEW.issue_date,
      due_date       = NEW.due_date,
      notes          = NEW.notes,
      currency_code  = NEW.currency_code,
      subtotal_cents = NEW.subtotal_cents,
      discount_cents = NEW.discount_cents,
      tax_cents      = NEW.tax_cents,
      total_cents    = NEW.total_cents,
      paid_cents     = NEW.paid_cents
    WHERE id = v_id;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.mirror_invoice_to_current_version() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mirror_invoice_to_current_version() TO service_role;

DROP TRIGGER IF EXISTS trg_invoices_mirror ON public.invoices;
CREATE TRIGGER trg_invoices_mirror
  AFTER UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.mirror_invoice_to_current_version();

-- ============================================================================
-- 3. convert_quote_to_invoice RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.convert_quote_to_invoice(
  p_quote_id uuid,
  p_due_date date
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_customer_id uuid;
  v_customer_name text;
  v_currency text;
  v_tax_id uuid;
  v_tax_rate_snapshot numeric;
  v_status text;
BEGIN
  SELECT q.org_id, q.customer_id, q.customer_name, q.currency_code,
         q.tax_id, q.tax_rate_snapshot, q.status
    INTO v_org, v_customer_id, v_customer_name, v_currency,
         v_tax_id, v_tax_rate_snapshot, v_status
    FROM public.quotes q
   WHERE q.id = p_quote_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'quote % not found', p_quote_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status NOT IN ('approved', 'project_pending') THEN
    RAISE EXCEPTION 'quote % cannot be invoiced from status %', p_quote_id, v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_invoice_number := public.next_doc_number(v_org, 'invoice');

  INSERT INTO public.invoices (
    id, org_id, invoice_number, customer_id, customer_name_snapshot,
    quote_id, status, payment_status, issue_date, due_date,
    currency_code, tax_id, tax_rate_snapshot,
    converted_from_type, converted_from_id,
    created_by
  ) VALUES (
    gen_random_uuid(), v_org, v_invoice_number, v_customer_id, v_customer_name,
    p_quote_id, 'draft', 'unpaid', current_date, p_due_date,
    v_currency, v_tax_id, v_tax_rate_snapshot,
    'quote', p_quote_id,
    auth.uid()
  ) RETURNING id INTO v_invoice_id;

  -- Copy quote_line_items → invoice_line_items. The
  -- tg_invoice_line_items_recompute trigger fires per INSERT and rolls up
  -- the header totals automatically.
  INSERT INTO public.invoice_line_items (
    org_id, invoice_id, item_id, description, quantity, unit,
    unit_price_cents, unit_cost_cents, discount_cents,
    tax_id, tax_rate_snapshot, tax_amount_cents, line_total_cents, position,
    created_by
  )
  SELECT v_org, v_invoice_id, qli.item_id, qli.description, qli.quantity, qli.unit,
         qli.unit_price_cents, qli.unit_cost_cents, qli.discount_cents,
         qli.tax_id, qli.tax_rate_snapshot, qli.tax_amount_cents, qli.line_total_cents,
         qli.position,
         auth.uid()
    FROM public.quote_line_items qli
   WHERE qli.quote_id = p_quote_id
   ORDER BY qli.position, qli.created_at;

  RETURN v_invoice_id;
END $$;

COMMENT ON FUNCTION public.convert_quote_to_invoice(uuid, date) IS
  'Phase 7 / Wave 5: spawn an invoice from an approved (or project_pending) '
  'quote. Allocates a new invoice_number, snapshots customer_name/currency/tax, '
  'copies all quote_line_items, stamps converted_from_type=quote + quote_id. '
  'Header totals roll up via the recompute trigger as lines are inserted. '
  'Does NOT change the quote''s status — that''s a separate workflow concern.';

REVOKE EXECUTE ON FUNCTION public.convert_quote_to_invoice(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.convert_quote_to_invoice(uuid, date) TO service_role;

-- ============================================================================
-- 4. assert_invoice_payment_currency trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assert_invoice_payment_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_inv_currency text;
BEGIN
  SELECT currency_code INTO v_inv_currency
    FROM public.invoices WHERE id = NEW.invoice_id;
  IF v_inv_currency IS NULL THEN
    RAISE EXCEPTION 'invoice % not found for payment', NEW.invoice_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF NEW.currency_code IS DISTINCT FROM v_inv_currency THEN
    RAISE EXCEPTION 'payment currency % does not match invoice currency %', NEW.currency_code, v_inv_currency
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.assert_invoice_payment_currency() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.assert_invoice_payment_currency() TO service_role;

DROP TRIGGER IF EXISTS trg_payments_assert_currency ON public.payments;
CREATE TRIGGER trg_payments_assert_currency
  BEFORE INSERT OR UPDATE OF currency_code, invoice_id ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.assert_invoice_payment_currency();

COMMIT;
