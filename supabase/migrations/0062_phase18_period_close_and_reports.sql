-- 0062_phase18_period_close_and_reports.sql
-- Wave 8e / Phase 18 — Period close + financial reports.
--
-- Ships:
--   1. period_close_state pg enum: ('open','in_review','closed','reopened').
--   2. public.period_close table (org-scoped, soft-delete, audit columns).
--      RLS Pattern A: staff SELECT within current_org_id(), finance roles
--      full read/write. Mirrors the Wave 8a payment_allocations shape.
--   3. tg_period_close_set_updated_at — leverages public.set_updated_at().
--   4. close_period(p_org_id, p_period_start, p_period_end, p_actor_user_id,
--      p_notes) SECURITY DEFINER RPC. Refuses if any draft journal_entries
--      fall in the period range, then INSERTs a period_close row with
--      status='closed', closed_at=now(), closed_by_user_id=p_actor_user_id.
--   5. reopen_period(p_period_close_id, p_actor_user_id, p_reason)
--      SECURITY DEFINER RPC. UPDATEs the row to status='reopened',
--      reopened_at=now(), reopened_by_user_id=p_actor_user_id, appends a
--      stamped marker to notes.
--   6. trial_balance(p_org_id, p_as_of, p_currency_code) SECURITY DEFINER
--      RPC. Returns one row per account from chart_of_accounts with the
--      sum of debit_cents / credit_cents from journal_entry_lines joined
--      to journal_entries where status='posted', entry_date <= p_as_of,
--      and currency_code matches. balance_cents = debit-credit for
--      asset/expense/cogs; credit-debit for liability/equity/revenue.
--   7. profit_loss(p_org_id, p_period_start, p_period_end, p_currency_code)
--      RPC. Returns revenue/expense/cogs account rows + virtual
--      'NET_INCOME' subtotal row per the same conventions.
--   8. balance_sheet(p_org_id, p_as_of, p_currency_code) RPC. Returns
--      asset/liability/equity account rows + retained_earnings virtual
--      row (= cumulative revenue - expense - cogs as of p_as_of, treated
--      as equity).
--
-- Constitutional alignment:
--   - Money is int cents (bigint everywhere).
--   - account_type enum on prod is 6-valued: asset/liability/equity/
--     revenue/expense/cogs. 'cogs' is rolled into the expense side in
--     P&L and not separately classified — net_income = revenue - (expense
--     + cogs).
--   - All RPCs SECURITY DEFINER + REVOKE on PUBLIC/anon/authenticated
--     and GRANT to service_role. Handlers call them through the service-
--     role admin client, so RLS bypass is by design; the RPCs still
--     enforce p_org_id scoping in their WHERE clauses.
--
-- Date:     2026-05-16
-- Sub-wave: 8e
-- Closes:   Wave 8e dispatch — period close + reports.

BEGIN;

-- ============================================================================
-- 1. period_close_state enum
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'period_close_state') THEN
    CREATE TYPE public.period_close_state AS ENUM ('open','in_review','closed','reopened');
  END IF;
END $$;

-- ============================================================================
-- 2. period_close table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.period_close (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  period_start            date NOT NULL,
  period_end              date NOT NULL,
  status                  public.period_close_state NOT NULL DEFAULT 'open',
  closed_at               timestamptz NULL,
  closed_by_user_id       uuid NULL REFERENCES auth.users(id),
  reopened_at             timestamptz NULL,
  reopened_by_user_id     uuid NULL REFERENCES auth.users(id),
  notes                   text NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL REFERENCES auth.users(id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NULL REFERENCES auth.users(id),
  deleted_at              timestamptz NULL,
  CONSTRAINT period_close_dates_ordered CHECK (period_end >= period_start),
  UNIQUE (org_id, period_start, period_end, deleted_at)
);

COMMENT ON TABLE public.period_close IS
  'Wave 8e / Phase 18: per-period accounting close marker. The row is the '
  'authoritative state for whether a date range is locked. close_period() '
  'rejects on any draft journal_entries in range. reopen_period() flips '
  'status to reopened and stamps an audit marker into notes. status is the '
  'period_close_state enum (open/in_review/closed/reopened). Soft-delete via '
  'deleted_at; the UNIQUE on (org,start,end,deleted_at) lets soft-deleted '
  'rows coexist with a live row for the same period.';

CREATE INDEX IF NOT EXISTS idx_period_close_org_end
  ON public.period_close (org_id, period_end DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_period_close_org_status
  ON public.period_close (org_id, status)
  WHERE deleted_at IS NULL;

-- BIU updated_at maintenance via the existing shared helper.
DROP TRIGGER IF EXISTS tg_period_close_set_updated_at ON public.period_close;
CREATE TRIGGER tg_period_close_set_updated_at
  BEFORE UPDATE ON public.period_close
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 3. RLS — Pattern A (staff read; finance roles full write)
-- ============================================================================

ALTER TABLE public.period_close ENABLE ROW LEVEL SECURITY;

CREATE POLICY period_close_staff_select
  ON public.period_close
  FOR SELECT TO authenticated
  USING (org_id = current_org_id() AND is_staff());

CREATE POLICY period_close_write_fin
  ON public.period_close
  FOR ALL TO authenticated
  USING (
    org_id = current_org_id()
    AND current_user_role() = ANY (ARRAY['org_owner','org_admin','accounting'])
  )
  WITH CHECK (
    org_id = current_org_id()
    AND current_user_role() = ANY (ARRAY['org_owner','org_admin','accounting'])
  );

-- ============================================================================
-- 4. close_period RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.close_period(
  p_org_id          uuid,
  p_period_start    date,
  p_period_end      date,
  p_actor_user_id   uuid,
  p_notes           text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft_count int;
  v_id uuid;
BEGIN
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'close_period: period_end (%) must be on or after period_start (%)',
      p_period_end, p_period_start
      USING ERRCODE = 'check_violation';
  END IF;

  -- 422 surface: refuse to close while any journal_entries remain draft in range.
  SELECT COUNT(*) INTO v_draft_count
    FROM public.journal_entries
   WHERE org_id = p_org_id
     AND status = 'draft'
     AND entry_date BETWEEN p_period_start AND p_period_end
     AND deleted_at IS NULL;

  IF v_draft_count > 0 THEN
    RAISE EXCEPTION
      'close_period: % draft journal entr%s exist between % and %; post or reverse before closing',
      v_draft_count,
      CASE WHEN v_draft_count = 1 THEN 'y' ELSE 'ie' END,
      p_period_start, p_period_end
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.period_close (
    org_id, period_start, period_end, status,
    closed_at, closed_by_user_id, notes,
    created_by, updated_by
  ) VALUES (
    p_org_id, p_period_start, p_period_end, 'closed',
    now(), p_actor_user_id, p_notes,
    p_actor_user_id, p_actor_user_id
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

COMMENT ON FUNCTION public.close_period(uuid, date, date, uuid, text) IS
  'Wave 8e: close an accounting period. Verifies zero draft JEs in range '
  '(else RAISE -> 422), then inserts a period_close row with status=closed.';

REVOKE EXECUTE ON FUNCTION public.close_period(uuid, date, date, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.close_period(uuid, date, date, uuid, text)
  TO service_role;

-- ============================================================================
-- 5. reopen_period RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reopen_period(
  p_period_close_id  uuid,
  p_actor_user_id    uuid,
  p_reason           text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_status public.period_close_state;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reopen_period: p_reason is required'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT status INTO v_existing_status
    FROM public.period_close
   WHERE id = p_period_close_id
     AND deleted_at IS NULL;

  IF v_existing_status IS NULL THEN
    RAISE EXCEPTION 'reopen_period: row % not found', p_period_close_id;
  END IF;

  IF v_existing_status <> 'closed' THEN
    RAISE EXCEPTION
      'reopen_period: row % is %, only closed periods can be reopened',
      p_period_close_id, v_existing_status
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.period_close
     SET status = 'reopened',
         reopened_at = now(),
         reopened_by_user_id = p_actor_user_id,
         notes = COALESCE(notes, '')
                 || E'\n[REOPENED ' || now()::text
                 || ' by ' || p_actor_user_id::text
                 || ']: ' || p_reason,
         updated_by = p_actor_user_id
   WHERE id = p_period_close_id;
END $$;

COMMENT ON FUNCTION public.reopen_period(uuid, uuid, text) IS
  'Wave 8e: reopen a previously-closed period. Refuses on non-closed rows. '
  'Stamps reopened_at + reopened_by_user_id and appends a marker to notes.';

REVOKE EXECUTE ON FUNCTION public.reopen_period(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reopen_period(uuid, uuid, text)
  TO service_role;

-- ============================================================================
-- 6. trial_balance RPC
-- ============================================================================
--
-- Returns one row per account with debit_total / credit_total / balance.
-- balance is debit-credit for normal-debit account_types (asset, expense,
-- cogs) and credit-debit for normal-credit account_types (liability,
-- equity, revenue). Accounts with zero activity in the period still emit
-- a row (the LEFT JOIN keeps account_code ordering stable for clients).

CREATE OR REPLACE FUNCTION public.trial_balance(
  p_org_id        uuid,
  p_as_of         date,
  p_currency_code text
)
RETURNS TABLE (
  account_id          uuid,
  account_code        text,
  account_name        text,
  account_type        text,
  debit_total_cents   bigint,
  credit_total_cents  bigint,
  balance_cents       bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH line_totals AS (
    SELECT
      jel.account_id,
      COALESCE(SUM(jel.debit_cents),  0)::bigint  AS debit_total_cents,
      COALESCE(SUM(jel.credit_cents), 0)::bigint  AS credit_total_cents
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je
      ON je.id = jel.journal_entry_id
    WHERE je.org_id        = p_org_id
      AND je.status        = 'posted'
      AND je.entry_date    <= p_as_of
      AND je.currency_code = p_currency_code
      AND je.deleted_at    IS NULL
    GROUP BY jel.account_id
  )
  SELECT
    coa.id                                                   AS account_id,
    coa.account_code                                         AS account_code,
    coa.label                                                AS account_name,
    coa.account_type                                         AS account_type,
    COALESCE(lt.debit_total_cents,  0)::bigint               AS debit_total_cents,
    COALESCE(lt.credit_total_cents, 0)::bigint               AS credit_total_cents,
    CASE
      WHEN coa.account_type IN ('asset','expense','cogs')
        THEN COALESCE(lt.debit_total_cents,  0) - COALESCE(lt.credit_total_cents, 0)
      ELSE COALESCE(lt.credit_total_cents, 0) - COALESCE(lt.debit_total_cents,  0)
    END::bigint                                              AS balance_cents
  FROM public.chart_of_accounts coa
  LEFT JOIN line_totals lt ON lt.account_id = coa.id
  WHERE coa.org_id     = p_org_id
    AND coa.deleted_at IS NULL
  ORDER BY coa.account_code, coa.id;
$$;

COMMENT ON FUNCTION public.trial_balance(uuid, date, text) IS
  'Wave 8e: per-account debit/credit totals for posted journal entries '
  'with entry_date <= p_as_of and currency_code = p_currency_code. '
  'balance follows account-type normal sign.';

REVOKE EXECUTE ON FUNCTION public.trial_balance(uuid, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.trial_balance(uuid, date, text)
  TO service_role;

-- ============================================================================
-- 7. profit_loss RPC
-- ============================================================================
--
-- Returns one row per revenue/expense/cogs account for the period plus a
-- virtual NET_INCOME totals row. revenue is signed positive on credits;
-- expense + cogs are signed positive on debits; net_income = revenue -
-- (expense + cogs).

CREATE OR REPLACE FUNCTION public.profit_loss(
  p_org_id        uuid,
  p_period_start  date,
  p_period_end    date,
  p_currency_code text
)
RETURNS TABLE (
  account_id        uuid,
  account_code      text,
  account_name      text,
  account_type      text,
  revenue_cents     bigint,
  expense_cents     bigint,
  net_income_cents  bigint,
  is_total          boolean
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
      AND je.entry_date    BETWEEN p_period_start AND p_period_end
      AND je.currency_code = p_currency_code
      AND je.deleted_at    IS NULL
    GROUP BY jel.account_id
  ),
  account_rows AS (
    SELECT
      coa.id                                                       AS account_id,
      coa.account_code                                             AS account_code,
      coa.label                                                    AS account_name,
      coa.account_type                                             AS account_type,
      CASE WHEN coa.account_type = 'revenue'
           THEN COALESCE(lt.credit_total_cents, 0) - COALESCE(lt.debit_total_cents, 0)
           ELSE 0::bigint
      END                                                          AS revenue_cents,
      CASE WHEN coa.account_type IN ('expense','cogs')
           THEN COALESCE(lt.debit_total_cents, 0) - COALESCE(lt.credit_total_cents, 0)
           ELSE 0::bigint
      END                                                          AS expense_cents
    FROM public.chart_of_accounts coa
    LEFT JOIN line_totals lt ON lt.account_id = coa.id
    WHERE coa.org_id     = p_org_id
      AND coa.deleted_at IS NULL
      AND coa.account_type IN ('revenue','expense','cogs')
  )
  SELECT
    account_id,
    account_code,
    account_name,
    account_type,
    revenue_cents,
    expense_cents,
    (revenue_cents - expense_cents)::bigint  AS net_income_cents,
    false                                     AS is_total
  FROM account_rows
  UNION ALL
  SELECT
    NULL::uuid                AS account_id,
    'NET_INCOME'              AS account_code,
    'Net Income'              AS account_name,
    'total'                   AS account_type,
    COALESCE(SUM(revenue_cents), 0)::bigint                                AS revenue_cents,
    COALESCE(SUM(expense_cents), 0)::bigint                                AS expense_cents,
    (COALESCE(SUM(revenue_cents), 0) - COALESCE(SUM(expense_cents), 0))::bigint
                                                                            AS net_income_cents,
    true                                                                   AS is_total
  FROM account_rows
  ORDER BY is_total, account_code;
$$;

COMMENT ON FUNCTION public.profit_loss(uuid, date, date, text) IS
  'Wave 8e: revenue / expense / cogs detail rows for the period plus a '
  'virtual NET_INCOME total. Net income = revenue - (expense + cogs).';

REVOKE EXECUTE ON FUNCTION public.profit_loss(uuid, date, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.profit_loss(uuid, date, date, text)
  TO service_role;

-- ============================================================================
-- 8. balance_sheet RPC
-- ============================================================================
--
-- Returns per-account rows for asset / liability / equity at p_as_of
-- (cumulative debit-credit, normal-sign convention) plus a virtual
-- RETAINED_EARNINGS row carrying SUM(revenue - (expense+cogs)) over all
-- posted entries with entry_date <= p_as_of. RETAINED_EARNINGS rolls
-- into the equity column for the assets = liabilities + equity identity.

CREATE OR REPLACE FUNCTION public.balance_sheet(
  p_org_id        uuid,
  p_as_of         date,
  p_currency_code text
)
RETURNS TABLE (
  account_id     uuid,
  account_code   text,
  account_name   text,
  account_type   text,
  balance_cents  bigint,
  is_total       boolean
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
      AND je.currency_code = p_currency_code
      AND je.deleted_at    IS NULL
    GROUP BY jel.account_id
  ),
  bs_rows AS (
    SELECT
      coa.id                                                       AS account_id,
      coa.account_code                                             AS account_code,
      coa.label                                                    AS account_name,
      coa.account_type                                             AS account_type,
      CASE
        WHEN coa.account_type = 'asset'
          THEN COALESCE(lt.debit_total_cents, 0) - COALESCE(lt.credit_total_cents, 0)
        ELSE COALESCE(lt.credit_total_cents, 0) - COALESCE(lt.debit_total_cents, 0)
      END::bigint                                                  AS balance_cents
    FROM public.chart_of_accounts coa
    LEFT JOIN line_totals lt ON lt.account_id = coa.id
    WHERE coa.org_id     = p_org_id
      AND coa.deleted_at IS NULL
      AND coa.account_type IN ('asset','liability','equity')
  ),
  retained_earnings AS (
    SELECT
      COALESCE(SUM(
        CASE
          WHEN coa.account_type = 'revenue'
            THEN COALESCE(lt.credit_total_cents, 0) - COALESCE(lt.debit_total_cents, 0)
          WHEN coa.account_type IN ('expense','cogs')
            THEN -(COALESCE(lt.debit_total_cents, 0) - COALESCE(lt.credit_total_cents, 0))
          ELSE 0::bigint
        END
      ), 0)::bigint AS balance_cents
    FROM public.chart_of_accounts coa
    LEFT JOIN line_totals lt ON lt.account_id = coa.id
    WHERE coa.org_id     = p_org_id
      AND coa.deleted_at IS NULL
      AND coa.account_type IN ('revenue','expense','cogs')
  )
  SELECT account_id, account_code, account_name, account_type, balance_cents,
         false AS is_total
    FROM bs_rows
  UNION ALL
  SELECT NULL::uuid                  AS account_id,
         'RETAINED_EARNINGS'         AS account_code,
         'Retained Earnings'         AS account_name,
         'equity'                    AS account_type,
         (SELECT balance_cents FROM retained_earnings) AS balance_cents,
         true                        AS is_total
  ORDER BY is_total, account_type, account_code;
$$;

COMMENT ON FUNCTION public.balance_sheet(uuid, date, text) IS
  'Wave 8e: asset / liability / equity cumulative balances at p_as_of plus '
  'a virtual RETAINED_EARNINGS row (= sum of revenue - (expense+cogs) over '
  'all posted entries through p_as_of). Identity check: assets = '
  'liabilities + equity + retained_earnings (validated by handler when '
  'totals are requested).';

REVOKE EXECUTE ON FUNCTION public.balance_sheet(uuid, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.balance_sheet(uuid, date, text)
  TO service_role;

-- ============================================================================
-- 9. Post-state assertions
-- ============================================================================

DO $$
DECLARE
  v_table_count int;
  v_enum_exists boolean;
  v_policy_count int;
  v_proc_count int;
BEGIN
  SELECT COUNT(*) INTO v_table_count
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'period_close';
  IF v_table_count <> 1 THEN
    RAISE EXCEPTION 'period_close table missing post-migration';
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'period_close_state')
    INTO v_enum_exists;
  IF NOT v_enum_exists THEN
    RAISE EXCEPTION 'period_close_state enum missing post-migration';
  END IF;

  SELECT COUNT(*) INTO v_policy_count
    FROM pg_policies WHERE tablename = 'period_close';
  IF v_policy_count < 2 THEN
    RAISE EXCEPTION 'period_close RLS policies missing (count=%)', v_policy_count;
  END IF;

  SELECT COUNT(*) INTO v_proc_count
    FROM pg_proc
   WHERE proname IN ('close_period','reopen_period','trial_balance','profit_loss','balance_sheet');
  IF v_proc_count < 5 THEN
    RAISE EXCEPTION 'period_close / report RPCs missing (count=%)', v_proc_count;
  END IF;
END $$;

COMMIT;
