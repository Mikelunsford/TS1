-- 0040_finance.sql
-- Purpose: chart_of_accounts, journal_entries, journal_entry_lines,
--   expenses, expense_categories. Includes the journal-balance validator.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.journal_entry_lines, public.journal_entries,
--              public.expenses, public.expense_categories,
--              public.chart_of_accounts CASCADE;
--   DROP FUNCTION public.check_journal_balance(uuid);

BEGIN;

CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  account_code  text NOT NULL,
  label         text NOT NULL,
  account_type  text NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense','cogs')),
  parent_id     uuid NULL REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  currency_code text NULL REFERENCES public.currencies(code),
  description   text NULL,
  is_active     boolean NOT NULL DEFAULT true,
  is_system     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NULL REFERENCES auth.users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid NULL REFERENCES auth.users(id),
  deleted_at    timestamptz NULL,
  UNIQUE (org_id, account_code)
);
CREATE INDEX IF NOT EXISTS idx_coa_org_type ON public.chart_of_accounts (org_id, account_type) WHERE is_active AND deleted_at IS NULL;
CREATE TRIGGER trg_coa_updated_at
  BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.journal_entries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  entry_number          text NOT NULL,
  entry_date            date NOT NULL DEFAULT current_date,
  description           text NULL,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
  source_type           text NULL CHECK (source_type IS NULL OR source_type IN
                          ('invoice','payment','expense','credit_note','manual','vendor_bill')),
  source_id             uuid NULL,
  currency_code         text NOT NULL DEFAULT 'USD' REFERENCES public.currencies(code),
  posted_at             timestamptz NULL,
  reversed_at           timestamptz NULL,
  reversed_by_entry_id  uuid NULL REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NULL REFERENCES auth.users(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NULL REFERENCES auth.users(id),
  deleted_at            timestamptz NULL,
  UNIQUE (org_id, entry_number)
);
CREATE INDEX IF NOT EXISTS idx_je_org_status ON public.journal_entries (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_je_source ON public.journal_entries (source_type, source_id) WHERE source_id IS NOT NULL;
CREATE TRIGGER trg_je_updated_at
  BEFORE UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  journal_entry_id  uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id        uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  debit_cents       bigint NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents      bigint NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  memo              text NULL,
  position          int NOT NULL DEFAULT 0,
  CHECK (NOT (debit_cents > 0 AND credit_cents > 0)),
  CHECK (debit_cents > 0 OR credit_cents > 0)
);
CREATE INDEX IF NOT EXISTS idx_jel_entry ON public.journal_entry_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_account ON public.journal_entry_lines (account_id);

CREATE OR REPLACE FUNCTION public.check_journal_balance(p_entry_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_diff bigint;
BEGIN
  SELECT COALESCE(SUM(debit_cents - credit_cents), 0) INTO v_diff
    FROM public.journal_entry_lines WHERE journal_entry_id = p_entry_id;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'Journal entry % does not balance (diff=%)', p_entry_id, v_diff;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.check_journal_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_journal_balance(uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  code                text NOT NULL,
  label               text NOT NULL,
  default_account_id  uuid NULL REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL REFERENCES auth.users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL REFERENCES auth.users(id),
  UNIQUE (org_id, code)
);
CREATE TRIGGER trg_expense_categories_updated_at
  BEFORE UPDATE ON public.expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.expenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expense_number text NOT NULL,
  category_id    uuid NULL REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  vendor_id      uuid NULL REFERENCES public.vendors(id) ON DELETE SET NULL,
  project_id     uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  account_id     uuid NULL REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  spent_at       date NOT NULL DEFAULT current_date,
  description    text NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','reimbursed','paid')),
  currency_code  text NOT NULL DEFAULT 'USD' REFERENCES public.currencies(code),
  amount_cents   bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  tax_cents      bigint NOT NULL DEFAULT 0,
  tax_id         uuid NULL REFERENCES public.taxes(id),
  total_cents    bigint NOT NULL DEFAULT 0,
  paid_at        timestamptz NULL,
  receipt_url    text NULL,
  notes          text NULL,
  submitted_by   uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by    uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at    timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NULL REFERENCES auth.users(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid NULL REFERENCES auth.users(id),
  deleted_at     timestamptz NULL,
  UNIQUE (org_id, expense_number)
);
CREATE INDEX IF NOT EXISTS idx_expenses_org_status ON public.expenses (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_project ON public.expenses (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_vendor ON public.expenses (vendor_id) WHERE vendor_id IS NOT NULL;
CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.chart_of_accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses             ENABLE ROW LEVEL SECURITY;

COMMIT;
