-- 0056_credit_note_allocations.sql
-- Wave 6 / Phase 9 — closes R-W5-CN-01.
--
-- Ships the invoice-side rollup of credit notes:
--   1. New table public.credit_note_allocations (credit_note_id × invoice_id
--      × amount_cents) as the source of truth for "this CN dollar offset
--      that invoice dollar".
--   2. Trigger tg_cna_sync_cn AIUD: keeps credit_notes.applied_cents in
--      sync with SUM(credit_note_allocations.amount_cents). Flips
--      credit_notes.status to 'applied' when applied_cents = amount_cents.
--   3. Extended recompute_invoice_totals: subtracts
--      SUM(credit_note_allocations) from balance_cents so applying a CN
--      actually reduces invoice balance. payment_status now considers
--      payments + credit-note allocations together (an invoice with
--      total $100 + payment $40 + CN allocation $60 = balance 0,
--      payment_status='paid').
--   4. Trigger tg_cna_recompute_invoice AIUD: fires
--      recompute_invoice_totals(NEW.invoice_id) on every CNA mutation.
--
-- Handler refactor lands in this same PR: applyCreditNote in
-- invoicing-api/handlers/credit-notes.ts INSERTs an allocation row;
-- triggers do the rest (no manual applied_cents bump; no manual status
-- flip).
--
-- Pre-Wave-6 context: Wave 5 closeout left applyCreditNote stamping the
-- link + bumping applied_cents only, with no invoice-side balance effect.
-- The schema-master §9.6 synthetic-payments-row strategy was rejected
-- (payments.amount_cents > 0 CHECK + payment_method_id FK; see Wave 5
-- closeout R-W5-CN-01 notes). credit_note_allocations is the canonical
-- ledger.
--
-- Step-2 verification (MCP 2026-05-16):
--   credit_notes has applied_cents bigint NN default 0 + CHECK
--     (applied_cents <= amount_cents). Status CHECK 4 values
--     (draft/issued/applied/voided).
--   recompute_invoice_totals(uuid) present (Wave 5 / 0052).
--   tg_invoice_line_items_recompute + tg_payments_recompute already
--     fire recompute_invoice_totals; this migration adds the CN-side
--     trigger pair.
--
-- Forward-only. payment_status decision now factors CN allocations;
-- callers (FE-A/FE-B) read it as a single rollup field — no SPA change
-- needed for the rollup itself (the new behavior is server-side only).
--
-- Date:     2026-05-16
-- Sub-wave: 6.1
-- Closes:   R-W5-CN-01 (Wave 5 credit-note invoice-side rollup).

BEGIN;

-- ============================================================================
-- 1. credit_note_allocations table
-- ============================================================================

CREATE TABLE public.credit_note_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  credit_note_id  uuid NOT NULL REFERENCES public.credit_notes(id) ON DELETE RESTRICT,
  invoice_id      uuid NOT NULL REFERENCES public.invoices(id)     ON DELETE RESTRICT,
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  deleted_at      timestamptz,
  UNIQUE (credit_note_id, invoice_id, deleted_at)
);

COMMENT ON TABLE public.credit_note_allocations IS
  'Phase 9 / R-W5-CN-01: ledger of credit-note dollar offsets against '
  'specific invoices. SUM(amount_cents) per credit_note rolls into '
  'credit_notes.applied_cents via tg_cna_sync_cn. SUM(amount_cents) per '
  'invoice subtracts from invoices.balance_cents via the extended '
  'recompute_invoice_totals (triggered by tg_cna_recompute_invoice).';

CREATE INDEX idx_cna_org_invoice    ON public.credit_note_allocations (org_id, invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cna_credit_note    ON public.credit_note_allocations (credit_note_id)     WHERE deleted_at IS NULL;
CREATE INDEX idx_cna_created_at_id  ON public.credit_note_allocations (created_at DESC, id DESC);

ALTER TABLE public.credit_note_allocations ENABLE ROW LEVEL SECURITY;

-- Staff: full read + write within their org.
CREATE POLICY cna_select_staff
  ON public.credit_note_allocations
  FOR SELECT TO authenticated
  USING (org_id = current_org_id() AND is_staff());

CREATE POLICY cna_write_fin
  ON public.credit_note_allocations
  FOR ALL TO authenticated
  USING (org_id = current_org_id() AND is_staff())
  WITH CHECK (org_id = current_org_id() AND is_staff());

-- Customer-user: read allocations that reference invoices their customer
-- can see (mirror of credit_notes_select_customer; status of parent
-- credit_note must be issued/applied — never draft/voided exposure).
CREATE POLICY cna_select_customer
  ON public.credit_note_allocations
  FOR SELECT TO authenticated
  USING (
    org_id = current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.credit_notes cn
       WHERE cn.id = credit_note_allocations.credit_note_id
         AND cn.customer_id = current_user_customer_id()
         AND cn.status IN ('issued', 'applied')
    )
  );

-- ============================================================================
-- 2. Trigger: keep credit_notes.applied_cents in sync with the ledger.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_credit_note_applied(p_credit_note_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_applied   bigint;
  v_amount    bigint;
  v_status    text;
  v_new_status text;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_applied
    FROM public.credit_note_allocations
   WHERE credit_note_id = p_credit_note_id
     AND deleted_at IS NULL;

  SELECT amount_cents, status INTO v_amount, v_status
    FROM public.credit_notes WHERE id = p_credit_note_id;

  IF v_applied > v_amount THEN
    RAISE EXCEPTION
      'credit_note_allocations sum (% cents) exceeds credit_note.amount_cents (% cents) for cn %',
      v_applied, v_amount, p_credit_note_id USING ERRCODE = 'check_violation';
  END IF;

  -- Flip to 'applied' when fully consumed; flip back to 'issued' if
  -- allocations were deleted and the CN is currently 'applied' but no
  -- longer fully applied. Never touch draft/voided rows.
  v_new_status := v_status;
  IF v_status NOT IN ('draft', 'voided') THEN
    IF v_applied = v_amount AND v_amount > 0 THEN
      v_new_status := 'applied';
    ELSIF v_status = 'applied' AND v_applied < v_amount THEN
      v_new_status := 'issued';
    END IF;
  END IF;

  UPDATE public.credit_notes
     SET applied_cents = v_applied,
         status        = v_new_status,
         updated_at    = now()
   WHERE id = p_credit_note_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.recompute_credit_note_applied(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_credit_note_applied(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_cna_sync_cn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_credit_note_applied(OLD.credit_note_id);
    RETURN OLD;
  END IF;
  PERFORM public.recompute_credit_note_applied(NEW.credit_note_id);
  -- On UPDATE that re-points credit_note_id, also recompute the OLD one.
  IF TG_OP = 'UPDATE' AND OLD.credit_note_id IS DISTINCT FROM NEW.credit_note_id THEN
    PERFORM public.recompute_credit_note_applied(OLD.credit_note_id);
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_cna_sync_cn() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_cna_sync_cn() TO service_role;

DROP TRIGGER IF EXISTS trg_cna_sync_cn ON public.credit_note_allocations;
CREATE TRIGGER trg_cna_sync_cn
  AFTER INSERT OR UPDATE OR DELETE ON public.credit_note_allocations
  FOR EACH ROW EXECUTE FUNCTION public.tg_cna_sync_cn();

-- ============================================================================
-- 3. Regen recompute_invoice_totals to subtract CN allocations from balance.
-- ============================================================================

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

  SELECT COALESCE(SUM(amount_cents), 0)
    INTO v_paid
    FROM public.payments
   WHERE invoice_id = p_invoice_id
     AND voided_at IS NULL
     AND deleted_at IS NULL;

  -- New in Wave 6 / Phase 9: credit-note allocations reduce balance.
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
  'Phase 9 / Wave 6: header rollup extended to include credit-note '
  'allocations. balance_cents = total - (payments + CN allocations); '
  'payment_status flips paid/partially_paid/unpaid based on the combined '
  'settled amount. paid_cents continues to track payments-only (audit '
  'clarity); credit-note offsets surface as applied_cents on the CN row '
  'and indirectly via balance_cents on the invoice.';

REVOKE EXECUTE ON FUNCTION public.recompute_invoice_totals(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_invoice_totals(uuid) TO service_role;

-- ============================================================================
-- 4. Trigger: fire recompute_invoice_totals on CNA mutation.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_cna_recompute_invoice() RETURNS trigger
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

REVOKE EXECUTE ON FUNCTION public.tg_cna_recompute_invoice() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_cna_recompute_invoice() TO service_role;

DROP TRIGGER IF EXISTS trg_cna_recompute_invoice ON public.credit_note_allocations;
CREATE TRIGGER trg_cna_recompute_invoice
  AFTER INSERT OR UPDATE OR DELETE ON public.credit_note_allocations
  FOR EACH ROW EXECUTE FUNCTION public.tg_cna_recompute_invoice();

COMMIT;
