-- 0033_sales.sql
-- Purpose: ERP sales surface. currencies + exchange_rates + taxes +
--   payment_methods + invoices + invoice_line_items + invoice_versions +
--   payments + credit_notes. Installs the Idurar-derived invoice/payment
--   math as Postgres triggers. Adds currency_code + opportunity_id to
--   quotes; total_cents and currency_code on projects.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TRIGGER ... DROP FUNCTION ... DROP TABLE credit_notes,
--   invoice_versions, invoice_line_items, invoices, payments,
--   payment_methods, taxes, exchange_rates, currencies CASCADE;
--   ALTER TABLE public.customers/quotes/projects/items DROP COLUMN currency_code;

BEGIN;

-- Currencies (global reference) -----------------------------------------
CREATE TABLE IF NOT EXISTS public.currencies (
  code            text PRIMARY KEY,
  label           text NOT NULL,
  symbol          text NOT NULL,
  symbol_position text NOT NULL DEFAULT 'before' CHECK (symbol_position IN ('before','after')),
  decimal_sep     text NOT NULL DEFAULT '.',
  thousand_sep    text NOT NULL DEFAULT ',',
  cent_precision  int NOT NULL DEFAULT 2 CHECK (cent_precision BETWEEN 0 AND 4),
  zero_format     boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.currencies (code, label, symbol, symbol_position, decimal_sep, thousand_sep, cent_precision, zero_format) VALUES
  ('USD', 'US Dollar',         '$',   'before', '.', ',', 2, false),
  ('EUR', 'Euro',               '€',   'before', ',', '.', 2, false),
  ('GBP', 'British Pound',      '£',   'before', '.', ',', 2, false),
  ('CAD', 'Canadian Dollar',    '$',   'before', '.', ',', 2, false),
  ('MXN', 'Mexican Peso',       '$',   'before', '.', ',', 2, false),
  ('AUD', 'Australian Dollar',  '$',   'before', '.', ',', 2, false),
  ('JPY', 'Japanese Yen',       '¥',   'before', '.', ',', 0, false),
  ('CHF', 'Swiss Franc',        'Fr.', 'before', '.', '''', 2, false)
ON CONFLICT (code) DO NOTHING;

-- Now we can wire organizations.default_currency_code -> currencies(code).
ALTER TABLE public.organizations
  ADD CONSTRAINT fk_organizations_currency FOREIGN KEY (default_currency_code)
  REFERENCES public.currencies(code) DEFERRABLE INITIALLY DEFERRED;

-- Exchange rates --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_code  text NOT NULL REFERENCES public.currencies(code),
  quote_code text NOT NULL REFERENCES public.currencies(code),
  rate       numeric(18,8) NOT NULL CHECK (rate > 0),
  as_of      date NOT NULL,
  source     text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES auth.users(id),
  UNIQUE (base_code, quote_code, as_of)
);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup
  ON public.exchange_rates (base_code, quote_code, as_of DESC);

-- Taxes -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.taxes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  code         text NOT NULL,
  label        text NOT NULL,
  rate         numeric(7,6) NOT NULL CHECK (rate >= 0 AND rate <= 1),
  jurisdiction text NULL,
  is_compound  boolean NOT NULL DEFAULT false,
  is_inclusive boolean NOT NULL DEFAULT false,
  is_default   boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NULL REFERENCES auth.users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid NULL REFERENCES auth.users(id),
  UNIQUE (org_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_taxes_default_per_org
  ON public.taxes (org_id) WHERE is_default;
CREATE TRIGGER trg_taxes_updated_at
  BEFORE UPDATE ON public.taxes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Payment methods -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  code        text NOT NULL,
  label       text NOT NULL,
  description text NULL,
  is_default  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NULL REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid NULL REFERENCES auth.users(id),
  UNIQUE (org_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_methods_default_per_org
  ON public.payment_methods (org_id) WHERE is_default;
CREATE TRIGGER trg_payment_methods_updated_at
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Currency codes on TS-era tables --------------------------------------
ALTER TABLE public.customers   ADD COLUMN IF NOT EXISTS currency_code text NULL REFERENCES public.currencies(code);
ALTER TABLE public.quotes      ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'USD' REFERENCES public.currencies(code);
ALTER TABLE public.quotes      ADD COLUMN IF NOT EXISTS opportunity_id uuid NULL REFERENCES public.opportunities(id) ON DELETE SET NULL;
ALTER TABLE public.quotes      ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,8) NULL;
ALTER TABLE public.quotes      ADD COLUMN IF NOT EXISTS tax_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE public.quotes      ADD COLUMN IF NOT EXISTS discount_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE public.quotes      ADD COLUMN IF NOT EXISTS tax_id uuid NULL REFERENCES public.taxes(id);
ALTER TABLE public.quotes      ADD COLUMN IF NOT EXISTS tax_rate_snapshot numeric(7,6) NULL;
ALTER TABLE public.quotes      ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.projects    ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'USD' REFERENCES public.currencies(code);
ALTER TABLE public.projects    ADD COLUMN IF NOT EXISTS budget_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE public.projects    ADD COLUMN IF NOT EXISTS created_by uuid NULL REFERENCES auth.users(id);
ALTER TABLE public.projects    ADD COLUMN IF NOT EXISTS updated_by uuid NULL REFERENCES auth.users(id);
ALTER TABLE public.projects    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.projects    ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.pricing_menu ADD COLUMN IF NOT EXISTS currency_code text NULL REFERENCES public.currencies(code);

-- Quote line items tax columns -----------------------------------------
ALTER TABLE public.quote_line_items
  ADD COLUMN IF NOT EXISTS tax_id uuid NULL REFERENCES public.taxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_amount_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate_snapshot numeric(7,6) NULL,
  ADD COLUMN IF NOT EXISTS discount_cents bigint NOT NULL DEFAULT 0;

-- Invoices -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoices (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  invoice_number           text NOT NULL,
  customer_id              uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  customer_name_snapshot   text NOT NULL,
  project_id               uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  quote_id                 uuid NULL REFERENCES public.quotes(id) ON DELETE SET NULL,
  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN
                             ('draft','pending','sent','partially_paid','paid','overdue','refunded','cancelled','on_hold')),
  payment_status           text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partially_paid','paid')),
  recurring                text NULL CHECK (recurring IS NULL OR recurring IN ('daily','weekly','monthly','quarterly','annually')),
  content                  text NULL,
  notes                    text NULL,
  issue_date               date NOT NULL DEFAULT current_date,
  due_date                 date NOT NULL,
  state_changed_at         timestamptz NOT NULL DEFAULT now(),
  approved                 boolean NOT NULL DEFAULT false,
  is_overdue               boolean NOT NULL DEFAULT false,
  converted_from_type      text NULL CHECK (converted_from_type IS NULL OR converted_from_type IN ('quote','project')),
  converted_from_id        uuid NULL,
  currency_code            text NOT NULL DEFAULT 'USD' REFERENCES public.currencies(code),
  exchange_rate            numeric(18,8) NULL,
  subtotal_cents           bigint NOT NULL DEFAULT 0,
  discount_cents           bigint NOT NULL DEFAULT 0,
  tax_cents                bigint NOT NULL DEFAULT 0,
  total_cents              bigint NOT NULL DEFAULT 0,
  paid_cents               bigint NOT NULL DEFAULT 0,
  balance_cents            bigint GENERATED ALWAYS AS (total_cents - paid_cents) STORED,
  tax_id                   uuid NULL REFERENCES public.taxes(id),
  tax_rate_snapshot        numeric(7,6) NULL,
  pdf_path                 text NULL,
  external_ref             text NULL,
  sent_at                  timestamptz NULL,
  paid_at                  timestamptz NULL,
  cancelled_at             timestamptz NULL,
  cancellation_reason      text NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NULL REFERENCES auth.users(id),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid NULL REFERENCES auth.users(id),
  deleted_at               timestamptz NULL,
  UNIQUE (org_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON public.invoices (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON public.invoices (customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_due ON public.invoices (org_id, due_date)
  WHERE status IN ('sent','partially_paid','overdue');
CREATE INDEX IF NOT EXISTS idx_invoices_project ON public.invoices (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_number_trgm ON public.invoices USING gin (invoice_number gin_trgm_ops);

CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_invoices_state_changed_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.set_state_changed_at();

-- Wire projects.invoice_id (NOW that invoices exists)
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS invoice_id uuid NULL REFERENCES public.invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_projects_invoice ON public.projects (invoice_id) WHERE invoice_id IS NOT NULL;

-- Invoice line items ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  invoice_id          uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  invoice_version_id  uuid NULL,
  item_id             uuid NULL REFERENCES public.pricing_menu(id) ON DELETE RESTRICT,
  description         text NOT NULL,
  quantity            numeric(14,4) NOT NULL CHECK (quantity > 0),
  unit                text NULL,
  unit_price_cents    bigint NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  unit_cost_cents     bigint NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  discount_cents      bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_id              uuid NULL REFERENCES public.taxes(id) ON DELETE SET NULL,
  tax_rate_snapshot   numeric(7,6) NULL,
  tax_amount_cents    bigint NOT NULL DEFAULT 0 CHECK (tax_amount_cents >= 0),
  line_total_cents    bigint NOT NULL DEFAULT 0 CHECK (line_total_cents >= 0),
  position            int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL REFERENCES auth.users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_ili_invoice ON public.invoice_line_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_ili_org ON public.invoice_line_items (org_id);
CREATE INDEX IF NOT EXISTS idx_ili_desc_trgm ON public.invoice_line_items USING gin (description gin_trgm_ops);
CREATE TRIGGER trg_ili_updated_at
  BEFORE UPDATE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Invoice versions -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  invoice_id      uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  version_number  int NOT NULL,
  status          text NOT NULL,
  payment_status  text NOT NULL,
  issue_date      date NOT NULL,
  due_date        date NOT NULL,
  notes           text NULL,
  currency_code   text NOT NULL,
  subtotal_cents  bigint NOT NULL,
  discount_cents  bigint NOT NULL,
  tax_cents       bigint NOT NULL,
  total_cents     bigint NOT NULL,
  paid_cents      bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL REFERENCES auth.users(id),
  UNIQUE (invoice_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_iv_invoice_version ON public.invoice_versions (invoice_id, version_number DESC);

-- Wire ILI -> invoice_versions FK
ALTER TABLE public.invoice_line_items
  ADD CONSTRAINT fk_ili_invoice_version FOREIGN KEY (invoice_version_id)
  REFERENCES public.invoice_versions(id) ON DELETE SET NULL;

-- Payments -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  payment_number      text NOT NULL,
  customer_id         uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  invoice_id          uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  payment_method_id   uuid NULL REFERENCES public.payment_methods(id) ON DELETE SET NULL,
  paid_at             timestamptz NOT NULL DEFAULT now(),
  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),
  currency_code       text NOT NULL DEFAULT 'USD' REFERENCES public.currencies(code),
  exchange_rate       numeric(18,8) NULL,
  reference           text NULL,
  description         text NULL,
  external_ref        text NULL,
  cleared_at          timestamptz NULL,
  voided_at           timestamptz NULL,
  void_reason         text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL REFERENCES auth.users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL REFERENCES auth.users(id),
  deleted_at          timestamptz NULL,
  UNIQUE (org_id, payment_number)
);
CREATE INDEX IF NOT EXISTS idx_payments_org_paid_at ON public.payments (org_id, paid_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON public.payments (invoice_id) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_customer ON public.payments (customer_id);
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Credit notes ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credit_notes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  credit_note_number  text NOT NULL,
  customer_id         uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  invoice_id          uuid NULL REFERENCES public.invoices(id) ON DELETE SET NULL,
  issue_date          date NOT NULL DEFAULT current_date,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','applied','voided')),
  reason              text NULL CHECK (reason IS NULL OR reason IN ('refund','adjustment','write_off','duplicate','other')),
  currency_code       text NOT NULL DEFAULT 'USD' REFERENCES public.currencies(code),
  amount_cents        bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  applied_cents       bigint NOT NULL DEFAULT 0 CHECK (applied_cents >= 0),
  notes               text NULL,
  voided_at           timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL REFERENCES auth.users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL REFERENCES auth.users(id),
  deleted_at          timestamptz NULL,
  UNIQUE (org_id, credit_note_number),
  CHECK (applied_cents <= amount_cents)
);
CREATE INDEX IF NOT EXISTS idx_credit_notes_org_status ON public.credit_notes (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_credit_notes_customer ON public.credit_notes (customer_id);
CREATE TRIGGER trg_credit_notes_updated_at
  BEFORE UPDATE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Invoice math triggers ------------------------------------------------

CREATE OR REPLACE FUNCTION public.recompute_invoice_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
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
    RAISE EXCEPTION 'Payments (% cents) exceed invoice total (% cents) for invoice %', v_paid, v_total, p_invoice_id;
  END IF;

  IF v_paid = 0 THEN
    v_status := 'unpaid';
  ELSIF v_paid >= v_total THEN
    v_status := 'paid';
  ELSE
    v_status := 'partially_paid';
  END IF;

  SELECT due_date INTO v_due FROM public.invoices WHERE id = p_invoice_id;
  v_overdue := (v_due < current_date) AND v_status <> 'paid';

  UPDATE public.invoices
     SET subtotal_cents = v_subtotal,
         tax_cents      = v_tax,
         discount_cents = v_discount,
         total_cents    = v_total,
         paid_cents     = v_paid,
         payment_status = v_status,
         is_overdue     = v_overdue,
         paid_at        = CASE WHEN v_status = 'paid' AND paid_at IS NULL THEN now() ELSE paid_at END
   WHERE id = p_invoice_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.recompute_invoice_totals(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_invoice_totals(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_invoice_line_items_recompute()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.recompute_invoice_totals(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.tg_payments_recompute()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.recompute_invoice_totals(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN COALESCE(NEW, OLD);
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_invoice_line_items_recompute() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_payments_recompute()           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_invoice_line_items_recompute() TO service_role;
GRANT  EXECUTE ON FUNCTION public.tg_payments_recompute()           TO service_role;

CREATE TRIGGER trg_ili_recompute_aiud
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_line_items_recompute();
CREATE TRIGGER trg_payments_recompute_aiud
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_payments_recompute();

-- Daily overdue refresh job target.
CREATE OR REPLACE FUNCTION public.refresh_invoice_overdue_flags()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count int;
BEGIN
  UPDATE public.invoices
     SET is_overdue = true
   WHERE due_date < current_date
     AND payment_status <> 'paid'
     AND status IN ('sent','partially_paid','pending');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE EXECUTE ON FUNCTION public.refresh_invoice_overdue_flags() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_invoice_overdue_flags() TO service_role;

-- convert_quote_to_project amended: stamp org_id, route number through next_doc_number().
-- next_doc_number() is created in 0034, so we update this RPC again there.
-- For now, replace the body to stamp org_id and currency_code.
CREATE OR REPLACE FUNCTION public.convert_quote_to_project(
  p_quote_id uuid, p_project_name text, p_due_date timestamptz
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_org uuid; v_project_id uuid; v_number text; v_currency text;
BEGIN
  SELECT q.org_id, q.currency_code INTO v_org, v_currency
    FROM public.quotes q WHERE q.id = p_quote_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'quote % not found', p_quote_id; END IF;

  v_number := public.next_project_number();

  INSERT INTO public.projects (
    id, org_id, project_number, quote_id, customer_id, customer_name, name,
    status, total_cents, currency_code, due_date
  )
  SELECT gen_random_uuid(), v_org, v_number, q.id, q.customer_id, q.customer_name,
         p_project_name, 'pending', q.total_cents, v_currency, p_due_date
    FROM public.quotes q WHERE q.id = p_quote_id
  RETURNING id INTO v_project_id;

  UPDATE public.quotes SET project_id = v_project_id, status = 'project_pending'
   WHERE id = p_quote_id;
  RETURN v_project_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.convert_quote_to_project(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.convert_quote_to_project(uuid, text, timestamptz) TO service_role;

-- convert_project_to_invoice ------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_project_to_invoice(
  p_project_id uuid, p_due_date date
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_org uuid; v_invoice_id uuid; v_number text;
BEGIN
  SELECT org_id INTO v_org FROM public.projects WHERE id = p_project_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'project % not found', p_project_id; END IF;

  -- Until next_doc_number lands in 0034, fall back to a simple sequence
  -- pattern. Replaced in 0034 with the unified numbering call.
  v_number := 'INV-' || extract(year FROM now())::text || '-' ||
              lpad((floor(random() * 99999))::int::text, 5, '0');

  INSERT INTO public.invoices (
    id, org_id, invoice_number, customer_id, customer_name_snapshot,
    project_id, status, payment_status, issue_date, due_date,
    currency_code, total_cents
  )
  SELECT gen_random_uuid(), v_org, v_number, p.customer_id, p.customer_name,
         p.id, 'draft', 'unpaid', current_date, p_due_date,
         p.currency_code, p.total_cents
    FROM public.projects p WHERE p.id = p_project_id
  RETURNING id INTO v_invoice_id;

  UPDATE public.projects SET invoice_id = v_invoice_id WHERE id = p_project_id;
  RETURN v_invoice_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.convert_project_to_invoice(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.convert_project_to_invoice(uuid, date) TO service_role;

-- RLS on new tables (full unification in 0043) ------------------------
ALTER TABLE public.currencies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_notes        ENABLE ROW LEVEL SECURITY;

CREATE POLICY currencies_select ON public.currencies
  FOR SELECT TO authenticated USING (true);
CREATE POLICY xr_select ON public.exchange_rates
  FOR SELECT TO authenticated USING (true);

COMMIT;
