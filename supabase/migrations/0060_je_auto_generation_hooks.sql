-- 0060_je_auto_generation_hooks.sql
-- Wave 8b — JE auto-generation hooks (constitutional "triggers, not handlers").
--
-- Ships:
--   1. seed_org_chart_of_accounts(p_org_id uuid) SECURITY DEFINER fn —
--      idempotent seed of the default per-org chart of accounts (13 system
--      rows, codes 1000..6200). Guarded by the (org_id, account_code)
--      UNIQUE constraint (chart_of_accounts_org_id_account_code_key).
--      Applied inline at the end of this migration for the Team1 org.
--   2. _coa_id(p_org_id, p_code) STABLE lookup helper used by every JE
--      trigger to resolve account UUIDs from stable codes.
--   3. post_journal_entry(p_org_id, p_source_type, p_source_id,
--      p_entry_date, p_description, p_currency_code, p_lines jsonb)
--      SECURITY DEFINER RPC — inserts a posted journal_entries row +
--      journal_entry_lines from a jsonb array, then calls
--      check_journal_balance(entry_id) to enforce the debits=credits
--      invariant before returning {entry_id, entry_number}.
--   4. Six AFTER triggers wiring business events to post_journal_entry:
--        * tg_invoices_je_on_send         — invoice transitions out of
--          draft/pending/on_hold into a posted-AR state (sent /
--          partially_paid / paid / overdue).
--            Dr AR (1100) total          Cr Revenue (4000) subtotal-discount
--                                        Cr Sales Tax Payable (2100) tax
--        * tg_payments_je_on_create      — INSERT on payments.
--            Dr Cash (1000) amount       Cr AR (1100) amount
--          source_type='payment'. Skips if amount_cents=0.
--        * tg_expenses_je_on_paid        — expense transitions from
--          approved → paid|reimbursed.
--            Dr Expense (preferred:
--               expenses.account_id when set, else 6000) total_cents
--            Cr Cash (1000) total_cents
--          (Input VAT on expenses is not separated v1 — total_cents
--          already includes amount + tax via 0058's tg_expenses_total_biu.)
--        * tg_vendor_bills_je_on_approved — vendor_bill pending → approved.
--            Dr General Expenses (6000) subtotal
--            Dr Sales Tax Payable (2100) tax
--            Cr AP (2000) total
--          source_type='vendor_bill'.
--        * tg_vendor_bills_je_on_paid    — vendor_bill (approved |
--          partially_paid) → paid.
--            Dr AP (2000) total          Cr Cash (1000) total
--          source_type='vendor_bill_payment' (new value added below).
--        * tg_credit_note_allocations_je — INSERT on credit_note_allocations.
--            Dr Sales Returns (4900) amount
--            Cr AR (1100) amount
--          source_type='credit_note'.
--   5. Extends journal_entries.source_type CHECK to include
--      'vendor_bill_payment' (existing CHECK: invoice / payment / expense
--      / credit_note / manual / vendor_bill).
--
-- Per constitutional rule (00-SHARED-CONTEXT.md → Allowed Patterns:
-- "Triggers for audit log and journal entry generation, not application
-- code"), JE auto-generation is purely DB-layer. Handlers continue to
-- write invoices/payments/expenses/vendor_bills as before; the trigger
-- picks up the state change and writes the JE. No handler edits in this
-- migration.
--
-- Step-2 verification (MCP 2026-05-16):
--   chart_of_accounts: 0 rows (org seed needed).
--   journal_entries / journal_entry_lines: 0 rows.
--   invoices / payments / expenses / vendor_bills / credit_note_allocations:
--     0 rows each — backfill (0061) deferred / not needed.
--   check_journal_balance(uuid) function exists.
--   next_doc_number(uuid, text) function exists.
--   journal_entries.source_type CHECK currently:
--     invoice / payment / expense / credit_note / manual / vendor_bill.
--
-- Forward-only.
--
-- Date:     2026-05-16
-- Sub-wave: 8b
-- Closes:   Wave 8b dispatch — JE auto-generation hooks.

BEGIN;

-- ============================================================================
-- 1. Lookup helper.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._coa_id(p_org_id uuid, p_code text)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id
    FROM public.chart_of_accounts
   WHERE org_id = p_org_id
     AND account_code = p_code
     AND is_active
     AND deleted_at IS NULL
   LIMIT 1;
$$;

COMMENT ON FUNCTION public._coa_id(uuid, text) IS
  'Wave 8b: stable per-org lookup from account_code -> chart_of_accounts.id. '
  'Used by every JE trigger function. Returns NULL if the row is missing or '
  'archived; triggers raise on NULL to surface mis-seeded orgs early.';

-- ============================================================================
-- 2. seed_org_chart_of_accounts: idempotent default COA per org.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_org_chart_of_accounts(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'seed_org_chart_of_accounts: p_org_id NULL';
  END IF;

  INSERT INTO public.chart_of_accounts
    (org_id, account_code, label, account_type, is_active, is_system, description)
  VALUES
    (p_org_id, '1000', 'Cash',                          'asset',     true, true, 'Default cash / operating bank account.'),
    (p_org_id, '1100', 'Accounts Receivable',           'asset',     true, true, 'Customer balances owed.'),
    (p_org_id, '1200', 'Inventory',                     'asset',     true, true, 'On-hand inventory at cost.'),
    (p_org_id, '1500', 'Prepaid Expenses',              'asset',     true, true, 'Prepaid insurance, software, retainers.'),
    (p_org_id, '2000', 'Accounts Payable',              'liability', true, true, 'Vendor balances owed.'),
    (p_org_id, '2100', 'Sales Tax Payable',             'liability', true, true, 'Sales tax collected + input VAT routed.'),
    (p_org_id, '3000', 'Owner''s Equity',               'equity',    true, true, 'Owner capital + retained earnings.'),
    (p_org_id, '4000', 'Revenue',                       'revenue',   true, true, 'Default income account.'),
    (p_org_id, '4900', 'Sales Returns & Allowances',    'revenue',   true, true, 'Credit-note offsets / refunds (contra-revenue).'),
    (p_org_id, '5000', 'Cost of Goods Sold',            'cogs',      true, true, 'COGS for inventory shipments.'),
    (p_org_id, '6000', 'General Expenses',              'expense',   true, true, 'Default expense / vendor bill catch-all.'),
    (p_org_id, '6100', 'Travel & Meals',                'expense',   true, true, 'Travel, meals & entertainment.'),
    (p_org_id, '6200', 'Office Supplies',               'expense',   true, true, 'Office supplies & consumables.')
  ON CONFLICT (org_id, account_code) DO NOTHING;
END $$;

COMMENT ON FUNCTION public.seed_org_chart_of_accounts(uuid) IS
  'Wave 8b: seeds the default 13-row chart of accounts for a single org. '
  'Idempotent via the (org_id, account_code) UNIQUE constraint. All rows '
  'flagged is_system=true so the existing handler refuses edit/archive. '
  'Codes 1000/1100/1200/1500/2000/2100/3000/4000/4900/5000/6000/6100/6200.';

REVOKE EXECUTE ON FUNCTION public.seed_org_chart_of_accounts(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.seed_org_chart_of_accounts(uuid) TO service_role;

-- ============================================================================
-- 3. post_journal_entry RPC.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_org_id        uuid,
  p_source_type   text,
  p_source_id     uuid,
  p_entry_date    date,
  p_description   text,
  p_currency_code text,
  p_lines         jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id     uuid;
  v_entry_number text;
  v_line         jsonb;
  v_position     int := 0;
  v_account_id   uuid;
  v_debit        bigint;
  v_credit       bigint;
  v_memo         text;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'post_journal_entry: p_org_id NULL';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'post_journal_entry: p_lines must be a jsonb array with >= 2 entries (got %)', p_lines;
  END IF;
  IF p_currency_code IS NULL OR length(p_currency_code) = 0 THEN
    RAISE EXCEPTION 'post_journal_entry: p_currency_code required';
  END IF;

  v_entry_number := public.next_doc_number(p_org_id, 'journal_entry');

  INSERT INTO public.journal_entries
    (org_id, entry_number, entry_date, description, status,
     source_type, source_id, currency_code, posted_at)
  VALUES
    (p_org_id, v_entry_number, p_entry_date, p_description, 'posted',
     p_source_type, p_source_id, p_currency_code, now())
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT jsonb_array_elements(p_lines)
  LOOP
    v_position   := v_position + 1;
    v_account_id := (v_line->>'account_id')::uuid;
    v_debit      := COALESCE((v_line->>'debit_cents')::bigint, 0);
    v_credit     := COALESCE((v_line->>'credit_cents')::bigint, 0);
    v_memo       := v_line->>'memo';

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'post_journal_entry: line % missing account_id (line=%)', v_position, v_line;
    END IF;
    IF v_debit < 0 OR v_credit < 0 THEN
      RAISE EXCEPTION 'post_journal_entry: line % has negative debit/credit (line=%)', v_position, v_line;
    END IF;
    IF v_debit = 0 AND v_credit = 0 THEN
      RAISE EXCEPTION 'post_journal_entry: line % has zero debit AND credit (line=%)', v_position, v_line;
    END IF;
    IF v_debit > 0 AND v_credit > 0 THEN
      RAISE EXCEPTION 'post_journal_entry: line % has both debit AND credit non-zero (line=%)', v_position, v_line;
    END IF;

    INSERT INTO public.journal_entry_lines
      (org_id, journal_entry_id, account_id, debit_cents, credit_cents, memo, position)
    VALUES
      (p_org_id, v_entry_id, v_account_id, v_debit, v_credit, v_memo, v_position);
  END LOOP;

  -- Constitutional invariant: debits = credits.
  PERFORM public.check_journal_balance(v_entry_id);

  RETURN jsonb_build_object(
    'entry_id',     v_entry_id,
    'entry_number', v_entry_number
  );
END $$;

COMMENT ON FUNCTION public.post_journal_entry(uuid, text, uuid, date, text, text, jsonb) IS
  'Wave 8b: posts a balanced journal entry. Inserts journal_entries '
  '(status=''posted'', posted_at=now(), entry_number from next_doc_number) '
  '+ N journal_entry_lines from p_lines jsonb array '
  '([{account_id, debit_cents?, credit_cents?, memo?}, ...]). Calls '
  'check_journal_balance() before returning {entry_id, entry_number}. '
  'Each line must have exactly one of debit_cents | credit_cents non-zero. '
  'service_role only.';

REVOKE EXECUTE ON FUNCTION public.post_journal_entry(uuid, text, uuid, date, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.post_journal_entry(uuid, text, uuid, date, text, text, jsonb) TO service_role;

-- ============================================================================
-- 4. Extend journal_entries.source_type CHECK to include 'vendor_bill_payment'.
-- ============================================================================

ALTER TABLE public.journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_source_type_check
  CHECK (
    source_type IS NULL OR source_type = ANY (ARRAY[
      'invoice',
      'payment',
      'expense',
      'credit_note',
      'manual',
      'vendor_bill',
      'vendor_bill_payment'
    ])
  );

-- ============================================================================
-- 5. JE trigger: invoice transition out of draft/pending/on_hold.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_invoices_je_on_send() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar    uuid;
  v_rev   uuid;
  v_tax   uuid;
  v_net   bigint;
  v_check bigint;
BEGIN
  -- Only fire on transition OUT of an unposted state INTO a posted state.
  IF NEW.status NOT IN ('sent','partially_paid','paid','overdue') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status NOT IN ('draft','pending','on_hold') THEN
    RETURN NEW;
  END IF;

  -- Idempotency: skip if a posted JE for this invoice already exists.
  IF EXISTS (
    SELECT 1 FROM public.journal_entries
     WHERE source_type='invoice'
       AND source_id   = NEW.id
       AND status      = 'posted'
       AND deleted_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  v_net   := COALESCE(NEW.subtotal_cents,0) - COALESCE(NEW.discount_cents,0);
  v_check := v_net + COALESCE(NEW.tax_cents,0);
  IF v_check <> COALESCE(NEW.total_cents,0) THEN
    RAISE EXCEPTION
      'tg_invoices_je_on_send: invariant violated for invoice % (subtotal % - discount % + tax % = % but total_cents = %)',
      NEW.id, NEW.subtotal_cents, NEW.discount_cents, NEW.tax_cents, v_check, NEW.total_cents
      USING ERRCODE='check_violation';
  END IF;

  v_ar  := public._coa_id(NEW.org_id, '1100');
  v_rev := public._coa_id(NEW.org_id, '4000');
  v_tax := public._coa_id(NEW.org_id, '2100');
  IF v_ar IS NULL OR v_rev IS NULL OR v_tax IS NULL THEN
    RAISE EXCEPTION
      'tg_invoices_je_on_send: chart of accounts missing for org % (1100=%, 4000=%, 2100=%)',
      NEW.org_id, v_ar, v_rev, v_tax;
  END IF;

  PERFORM public.post_journal_entry(
    NEW.org_id,
    'invoice',
    NEW.id,
    COALESCE(NEW.issue_date, CURRENT_DATE),
    'Invoice ' || NEW.invoice_number,
    NEW.currency_code,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ar,  'debit_cents',  NEW.total_cents,           'memo', 'AR'),
      jsonb_build_object('account_id', v_rev, 'credit_cents', v_net,                     'memo', 'Revenue')
    )
    -- Tax line conditionally appended below.
    || CASE WHEN COALESCE(NEW.tax_cents,0) > 0
            THEN jsonb_build_array(jsonb_build_object('account_id', v_tax, 'credit_cents', NEW.tax_cents, 'memo', 'Sales tax'))
            ELSE '[]'::jsonb END
  );

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_invoices_je_on_send() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_invoices_je_on_send() TO service_role;

DROP TRIGGER IF EXISTS tg_invoices_je_on_send ON public.invoices;
CREATE TRIGGER tg_invoices_je_on_send
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_je_on_send();

-- ============================================================================
-- 6. JE trigger: payment INSERT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_payments_je_on_create() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash uuid;
  v_ar   uuid;
BEGIN
  IF COALESCE(NEW.amount_cents,0) = 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.voided_at IS NOT NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
     WHERE source_type='payment'
       AND source_id   = NEW.id
       AND status      = 'posted'
       AND deleted_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  v_cash := public._coa_id(NEW.org_id, '1000');
  v_ar   := public._coa_id(NEW.org_id, '1100');
  IF v_cash IS NULL OR v_ar IS NULL THEN
    RAISE EXCEPTION
      'tg_payments_je_on_create: chart of accounts missing for org % (1000=%, 1100=%)',
      NEW.org_id, v_cash, v_ar;
  END IF;

  PERFORM public.post_journal_entry(
    NEW.org_id,
    'payment',
    NEW.id,
    COALESCE(NEW.paid_at::date, CURRENT_DATE),
    'Payment ' || NEW.payment_number,
    NEW.currency_code,
    jsonb_build_array(
      jsonb_build_object('account_id', v_cash, 'debit_cents',  NEW.amount_cents, 'memo', 'Cash receipt'),
      jsonb_build_object('account_id', v_ar,   'credit_cents', NEW.amount_cents, 'memo', 'AR settled')
    )
  );

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_payments_je_on_create() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_payments_je_on_create() TO service_role;

DROP TRIGGER IF EXISTS tg_payments_je_on_create ON public.payments;
CREATE TRIGGER tg_payments_je_on_create
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_payments_je_on_create();

-- ============================================================================
-- 7. JE trigger: expense approved -> paid|reimbursed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_expenses_je_on_paid() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp  uuid;
  v_cash uuid;
BEGIN
  IF NEW.status NOT IN ('paid','reimbursed') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
     WHERE source_type='expense'
       AND source_id   = NEW.id
       AND status      = 'posted'
       AND deleted_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  -- Prefer expenses.account_id when set; fall back to '6000' General Expenses.
  v_exp := NEW.account_id;
  IF v_exp IS NULL THEN
    v_exp := public._coa_id(NEW.org_id, '6000');
  END IF;
  v_cash := public._coa_id(NEW.org_id, '1000');
  IF v_exp IS NULL OR v_cash IS NULL THEN
    RAISE EXCEPTION
      'tg_expenses_je_on_paid: chart of accounts missing for org % (expense=%, cash=%)',
      NEW.org_id, v_exp, v_cash;
  END IF;

  PERFORM public.post_journal_entry(
    NEW.org_id,
    'expense',
    NEW.id,
    COALESCE(NEW.paid_at::date, NEW.spent_at, CURRENT_DATE),
    'Expense ' || NEW.expense_number,
    NEW.currency_code,
    jsonb_build_array(
      jsonb_build_object('account_id', v_exp,  'debit_cents',  NEW.total_cents, 'memo', 'Expense'),
      jsonb_build_object('account_id', v_cash, 'credit_cents', NEW.total_cents, 'memo', 'Cash')
    )
  );

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_expenses_je_on_paid() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_expenses_je_on_paid() TO service_role;

DROP TRIGGER IF EXISTS tg_expenses_je_on_paid ON public.expenses;
CREATE TRIGGER tg_expenses_je_on_paid
  AFTER UPDATE OF status ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_expenses_je_on_paid();

-- ============================================================================
-- 8. JE trigger: vendor_bill pending -> approved (AP accrual).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_vendor_bills_je_on_approved() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp uuid;
  v_tax uuid;
  v_ap  uuid;
BEGIN
  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
     WHERE source_type='vendor_bill'
       AND source_id   = NEW.id
       AND status      = 'posted'
       AND deleted_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  v_exp := public._coa_id(NEW.org_id, '6000');
  v_tax := public._coa_id(NEW.org_id, '2100');
  v_ap  := public._coa_id(NEW.org_id, '2000');
  IF v_exp IS NULL OR v_tax IS NULL OR v_ap IS NULL THEN
    RAISE EXCEPTION
      'tg_vendor_bills_je_on_approved: chart of accounts missing for org % (6000=%, 2100=%, 2000=%)',
      NEW.org_id, v_exp, v_tax, v_ap;
  END IF;

  PERFORM public.post_journal_entry(
    NEW.org_id,
    'vendor_bill',
    NEW.id,
    COALESCE(NEW.issue_date, CURRENT_DATE),
    'Vendor bill ' || NEW.bill_number,
    NEW.currency_code,
    jsonb_build_array(
      jsonb_build_object('account_id', v_exp, 'debit_cents',  NEW.subtotal_cents, 'memo', 'Expense (bill subtotal)')
    )
    || CASE WHEN COALESCE(NEW.tax_cents,0) > 0
            THEN jsonb_build_array(jsonb_build_object('account_id', v_tax, 'debit_cents', NEW.tax_cents, 'memo', 'Input VAT routed via Sales Tax Payable'))
            ELSE '[]'::jsonb END
    || jsonb_build_array(
      jsonb_build_object('account_id', v_ap,  'credit_cents', NEW.total_cents,    'memo', 'AP accrual')
    )
  );

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_vendor_bills_je_on_approved() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_vendor_bills_je_on_approved() TO service_role;

DROP TRIGGER IF EXISTS tg_vendor_bills_je_on_approved ON public.vendor_bills;
CREATE TRIGGER tg_vendor_bills_je_on_approved
  AFTER UPDATE OF status ON public.vendor_bills
  FOR EACH ROW EXECUTE FUNCTION public.tg_vendor_bills_je_on_approved();

-- ============================================================================
-- 9. JE trigger: vendor_bill (approved | partially_paid) -> paid.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_vendor_bills_je_on_paid() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap   uuid;
  v_cash uuid;
BEGIN
  IF NEW.status <> 'paid' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status NOT IN ('approved','partially_paid') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.journal_entries
     WHERE source_type='vendor_bill_payment'
       AND source_id   = NEW.id
       AND status      = 'posted'
       AND deleted_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  v_ap   := public._coa_id(NEW.org_id, '2000');
  v_cash := public._coa_id(NEW.org_id, '1000');
  IF v_ap IS NULL OR v_cash IS NULL THEN
    RAISE EXCEPTION
      'tg_vendor_bills_je_on_paid: chart of accounts missing for org % (2000=%, 1000=%)',
      NEW.org_id, v_ap, v_cash;
  END IF;

  PERFORM public.post_journal_entry(
    NEW.org_id,
    'vendor_bill_payment',
    NEW.id,
    COALESCE(NEW.paid_at::date, CURRENT_DATE),
    'Payment for bill ' || NEW.bill_number,
    NEW.currency_code,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ap,   'debit_cents',  NEW.total_cents, 'memo', 'AP settled'),
      jsonb_build_object('account_id', v_cash, 'credit_cents', NEW.total_cents, 'memo', 'Cash paid')
    )
  );

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_vendor_bills_je_on_paid() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_vendor_bills_je_on_paid() TO service_role;

DROP TRIGGER IF EXISTS tg_vendor_bills_je_on_paid ON public.vendor_bills;
CREATE TRIGGER tg_vendor_bills_je_on_paid
  AFTER UPDATE OF status ON public.vendor_bills
  FOR EACH ROW EXECUTE FUNCTION public.tg_vendor_bills_je_on_paid();

-- ============================================================================
-- 10. JE trigger: credit_note_allocation INSERT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_credit_note_allocations_je() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ret uuid;
  v_ar  uuid;
  v_cn_currency text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.amount_cents,0) = 0 THEN
    RETURN NEW;
  END IF;

  -- credit_note_allocations PK -> one JE per allocation row; idempotent on
  -- (source_type='credit_note', source_id=allocation.id).
  IF EXISTS (
    SELECT 1 FROM public.journal_entries
     WHERE source_type='credit_note'
       AND source_id   = NEW.id
       AND status      = 'posted'
       AND deleted_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  v_ret := public._coa_id(NEW.org_id, '4900');
  v_ar  := public._coa_id(NEW.org_id, '1100');
  IF v_ret IS NULL OR v_ar IS NULL THEN
    RAISE EXCEPTION
      'tg_credit_note_allocations_je: chart of accounts missing for org % (4900=%, 1100=%)',
      NEW.org_id, v_ret, v_ar;
  END IF;

  SELECT currency_code INTO v_cn_currency
    FROM public.credit_notes WHERE id = NEW.credit_note_id;

  PERFORM public.post_journal_entry(
    NEW.org_id,
    'credit_note',
    NEW.id,
    CURRENT_DATE,
    'CN allocation to invoice ' || NEW.invoice_id::text,
    COALESCE(v_cn_currency, 'USD'),
    jsonb_build_array(
      jsonb_build_object('account_id', v_ret, 'debit_cents',  NEW.amount_cents, 'memo', 'Sales returns / CN'),
      jsonb_build_object('account_id', v_ar,  'credit_cents', NEW.amount_cents, 'memo', 'AR reduced')
    )
  );

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_credit_note_allocations_je() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_credit_note_allocations_je() TO service_role;

DROP TRIGGER IF EXISTS tg_credit_note_allocations_je ON public.credit_note_allocations;
CREATE TRIGGER tg_credit_note_allocations_je
  AFTER INSERT ON public.credit_note_allocations
  FOR EACH ROW EXECUTE FUNCTION public.tg_credit_note_allocations_je();

-- ============================================================================
-- 11. Seed Team1's chart of accounts inline.
-- ============================================================================

SELECT public.seed_org_chart_of_accounts(id)
  FROM public.organizations WHERE slug='team1';

-- ============================================================================
-- 12. Post-state assertions.
-- ============================================================================

DO $$
DECLARE
  v_count int;
  v_team1_coa int;
  v_check_def text;
BEGIN
  -- Helper + seed function exist.
  SELECT COUNT(*) INTO v_count FROM pg_proc WHERE proname='_coa_id';
  IF v_count < 1 THEN
    RAISE EXCEPTION '_coa_id helper missing post-migration';
  END IF;

  SELECT COUNT(*) INTO v_count FROM pg_proc WHERE proname='seed_org_chart_of_accounts';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'seed_org_chart_of_accounts missing post-migration';
  END IF;

  SELECT COUNT(*) INTO v_count FROM pg_proc WHERE proname='post_journal_entry';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'post_journal_entry missing post-migration';
  END IF;

  -- All 6 triggers exist.
  SELECT COUNT(*) INTO v_count
    FROM pg_trigger
   WHERE tgname IN (
           'tg_invoices_je_on_send',
           'tg_payments_je_on_create',
           'tg_expenses_je_on_paid',
           'tg_vendor_bills_je_on_approved',
           'tg_vendor_bills_je_on_paid',
           'tg_credit_note_allocations_je'
         )
     AND NOT tgisinternal;
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'Wave 8b JE triggers missing (expected 6, got %)', v_count;
  END IF;

  -- Team1 COA seeded with all 13 default rows.
  SELECT COUNT(*) INTO v_team1_coa
    FROM public.chart_of_accounts coa
    JOIN public.organizations o ON o.id = coa.org_id
   WHERE o.slug='team1' AND coa.is_system = true;
  IF v_team1_coa < 13 THEN
    RAISE EXCEPTION 'Team1 default COA seed incomplete (expected >= 13 system rows, got %)', v_team1_coa;
  END IF;

  -- source_type CHECK includes 'vendor_bill_payment'.
  SELECT pg_get_constraintdef(oid) INTO v_check_def
    FROM pg_constraint
   WHERE conrelid='public.journal_entries'::regclass
     AND conname='journal_entries_source_type_check';
  IF v_check_def IS NULL OR position('vendor_bill_payment' IN v_check_def) = 0 THEN
    RAISE EXCEPTION 'journal_entries.source_type CHECK missing vendor_bill_payment: %', v_check_def;
  END IF;
END $$;

COMMIT;
