-- 0059_payment_allocations.sql
-- Wave 8 / Phase 12 — closes R-W5-PAY-01.
--
-- Ships the multi-invoice payment-allocation ledger plus the
-- recompute_invoice_totals extension that makes those allocations roll
-- up onto invoices.
--
--   1. New table public.payment_allocations (payment_id × invoice_id
--      × amount_cents) as the source of truth for "this payment dollar
--      offset that invoice dollar". The legacy 1:1 link
--      (payments.invoice_id NOT NULL) survives unchanged so single-
--      invoice flows keep working with no allocation rows.
--   2. RLS Pattern A (staff select + fin write) mirroring
--      credit_note_allocations (0056).
--   3. Trigger tg_pa_recompute_invoice AIUD on payment_allocations
--      fires recompute_invoice_totals(NEW.invoice_id) (and OLD.invoice_id
--      on cross-invoice UPDATE or DELETE).
--   4. Regen recompute_invoice_totals(uuid): paid_cents now sums
--      allocation rows when a payment has any live allocations, else
--      falls back to the legacy 1:1 payments.amount_cents on the
--      payments.invoice_id = p_invoice_id link. CN allocations still
--      reduce balance as in 0056.
--
-- Forward-only. Handler swap (invoicing-api/handlers/payments.ts)
-- lands in this same PR — POST /payments accepts an optional
-- allocations[] array, and POST /payments/:id/allocate adds rows to
-- an existing payment.
--
-- Phase 12 GL (chart_of_accounts + journal_entries + journal_entry_lines)
-- tables already exist in prod from the Wave 0 chassis; this migration
-- does NOT touch them. The COA / JE BE handlers land in this same PR.
--
-- Date:     2026-05-16
-- Sub-wave: 8a
-- Closes:   R-W5-PAY-01 (Wave 5 multi-invoice payment allocations).

BEGIN;

-- ============================================================================
-- 1. payment_allocations table
-- ============================================================================

CREATE TABLE public.payment_allocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  payment_id    uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  invoice_id    uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  UNIQUE (payment_id, invoice_id, deleted_at)
);

COMMENT ON TABLE public.payment_allocations IS
  'Phase 12 / R-W5-PAY-01: ledger of payment dollar offsets against '
  'specific invoices. SUM(amount_cents) per (payment, invoice) feeds '
  'into invoices.paid_cents + balance_cents via the extended '
  'recompute_invoice_totals (triggered by tg_pa_recompute_invoice). '
  'Single-invoice payments keep using the legacy payments.invoice_id '
  '1:1 link and need no allocation rows.';

CREATE INDEX idx_pa_org_invoice   ON public.payment_allocations (org_id, invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_pa_payment       ON public.payment_allocations (payment_id)         WHERE deleted_at IS NULL;
CREATE INDEX idx_pa_created_at_id ON public.payment_allocations (created_at DESC, id DESC);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

-- Staff: full read within their org.
CREATE POLICY pa_staff_select
  ON public.payment_allocations
  FOR SELECT TO authenticated
  USING (org_id = current_org_id() AND is_staff());

-- Finance roles: full read+write within their org.
CREATE POLICY pa_write_fin
  ON public.payment_allocations
  FOR ALL TO authenticated
  USING (
    org_id = current_org_id()
    AND current_user_role() = ANY (ARRAY['org_owner','org_admin','accounting','ops'])
  )
  WITH CHECK (
    org_id = current_org_id()
    AND current_user_role() = ANY (ARRAY['org_owner','org_admin','accounting','ops'])
  );

-- ============================================================================
-- 2. Regen recompute_invoice_totals to consume payment_allocations.
-- ============================================================================
--
-- New paid_cents semantics:
--   For each non-voided, non-deleted payment that references this
--   invoice (either via the legacy 1:1 payments.invoice_id or via at
--   least one live allocation row):
--     - if the payment has ANY live payment_allocations row, use the
--       SUM of allocation amounts targeting THIS invoice (which is 0
--       when the payment allocates entirely to other invoices);
--     - otherwise fall back to payments.amount_cents iff
--       payments.invoice_id = p_invoice_id (legacy 1:1).
--
-- CN allocations behavior unchanged from 0056. balance_cents =
-- total_cents - (paid_cents + cn_applied). payment_status flips
-- paid/partially_paid/unpaid on the combined settled amount.

CREATE OR REPLACE FUNCTION public.recompute_invoice_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subtotal bigint; v_tax bigint; v_discount bigint; v_total bigint;
  v_paid bigint; v_cn_applied bigint; v_settled bigint;
  v_status text; v_due date; v_overdue boolean;
BEGIN
  SELECT COALESCE(SUM(line_total_cents), 0),
         COALESCE(SUM(tax_amount_cents), 0),
         COALESCE(SUM(discount_cents),   0)
    INTO v_subtotal, v_tax, v_discount
    FROM public.invoice_line_items WHERE invoice_id = p_invoice_id;

  v_total := v_subtotal - v_discount + v_tax;

  -- Wave 8 / Phase 12: paid_cents now consumes payment_allocations when
  -- present, else falls back to the legacy 1:1 payments.invoice_id link.
  -- We sum over the union of payments that touch this invoice either
  -- way, then per-payment pick the allocation sum (if any allocations
  -- exist) or the row's amount_cents (legacy single-invoice path).
  v_paid := COALESCE((
    SELECT SUM(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.payment_allocations pa
           WHERE pa.payment_id = p.id
             AND pa.deleted_at IS NULL
        ) THEN COALESCE((
          SELECT SUM(pa.amount_cents)
            FROM public.payment_allocations pa
           WHERE pa.payment_id = p.id
             AND pa.invoice_id = p_invoice_id
             AND pa.deleted_at IS NULL
        ), 0)
        WHEN p.invoice_id = p_invoice_id THEN p.amount_cents
        ELSE 0
      END
    )
    FROM public.payments p
   WHERE p.voided_at IS NULL
     AND p.deleted_at IS NULL
     AND (
       p.invoice_id = p_invoice_id
       OR EXISTS (
         SELECT 1 FROM public.payment_allocations pa
          WHERE pa.payment_id = p.id
            AND pa.invoice_id = p_invoice_id
            AND pa.deleted_at IS NULL
       )
     )
  ), 0);

  -- Wave 6 / Phase 9: credit-note allocations reduce balance.
  SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_cn_applied
    FROM public.credit_note_allocations
   WHERE invoice_id = p_invoice_id
     AND deleted_at IS NULL;

  v_settled := v_paid + v_cn_applied;

  IF v_settled > v_total THEN
    RAISE EXCEPTION
      'Settled (% cents = payments % + CN allocations %) exceeds invoice total (% cents) for invoice %',
      v_settled, v_paid, v_cn_applied, v_total, p_invoice_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_settled = 0 THEN
    v_status := 'unpaid';
  ELSIF v_settled >= v_total THEN
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
         balance_cents  = v_total - v_settled,
         payment_status = v_status,
         is_overdue     = v_overdue,
         paid_at        = CASE WHEN v_status = 'paid' AND paid_at IS NULL THEN now() ELSE paid_at END
   WHERE id = p_invoice_id;
END $$;

COMMENT ON FUNCTION public.recompute_invoice_totals(uuid) IS
  'Phase 12 / Wave 8: header rollup extended to consume '
  'payment_allocations. paid_cents = SUM(allocation amounts) per '
  'invoice when the payment has any live allocations; otherwise the '
  'legacy 1:1 payments.invoice_id × amount_cents path. CN allocations '
  'still subtract from balance via the 0056 logic. payment_status '
  'flips on the combined settled amount.';

REVOKE EXECUTE ON FUNCTION public.recompute_invoice_totals(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_invoice_totals(uuid) TO service_role;

-- ============================================================================
-- 3. Trigger: fire recompute_invoice_totals on PA mutation.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_pa_recompute_invoice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_invoice_totals(OLD.invoice_id);
    RETURN OLD;
  END IF;
  PERFORM public.recompute_invoice_totals(NEW.invoice_id);
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM public.recompute_invoice_totals(OLD.invoice_id);
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_pa_recompute_invoice() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_pa_recompute_invoice() TO service_role;

DROP TRIGGER IF EXISTS tg_pa_recompute_invoice ON public.payment_allocations;
CREATE TRIGGER tg_pa_recompute_invoice
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.tg_pa_recompute_invoice();

-- ============================================================================
-- 4. Post-state assertions.
-- ============================================================================

DO $$
DECLARE
  v_policy_count int;
  v_trigger_count int;
  v_proc_count int;
  v_table_count int;
BEGIN
  -- payment_allocations table exists.
  SELECT COUNT(*) INTO v_table_count
    FROM information_schema.tables
   WHERE table_schema='public' AND table_name='payment_allocations';
  IF v_table_count <> 1 THEN
    RAISE EXCEPTION 'payment_allocations table missing post-migration';
  END IF;

  -- 2+ RLS policies on payment_allocations.
  SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies WHERE tablename='payment_allocations';
  IF v_policy_count < 2 THEN
    RAISE EXCEPTION 'payment_allocations RLS policies missing (count=%)', v_policy_count;
  END IF;

  -- tg_pa_recompute_invoice trigger exists.
  SELECT COUNT(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgname='tg_pa_recompute_invoice' AND NOT tgisinternal;
  IF v_trigger_count < 1 THEN
    RAISE EXCEPTION 'tg_pa_recompute_invoice trigger missing';
  END IF;

  -- recompute_invoice_totals(uuid) function exists.
  SELECT COUNT(*) INTO v_proc_count
    FROM pg_proc WHERE proname='recompute_invoice_totals';
  IF v_proc_count < 1 THEN
    RAISE EXCEPTION 'recompute_invoice_totals function missing';
  END IF;
END $$;

COMMIT;
