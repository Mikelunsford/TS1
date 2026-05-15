-- 0032_crm_extend.sql
-- Purpose: Rename crm_activities -> activities; extend customers with the
--   Idurar Client field set; create leads + opportunities. Activities gains
--   lead_id / opportunity_id polymorphic FKs.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.opportunities, public.leads CASCADE;
--   ALTER TABLE public.activities RENAME TO crm_activities;
--   ALTER TABLE public.customers DROP COLUMN client_type, ...;

BEGIN;

-- Customer field expansion ----------------------------------------------

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS external_ref         text NULL,
  ADD COLUMN IF NOT EXISTS client_type          text NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS client_status        text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS client_source        text NULL,
  ADD COLUMN IF NOT EXISTS client_category      text NULL,
  ADD COLUMN IF NOT EXISTS email                citext NULL,
  ADD COLUMN IF NOT EXISTS phone                text NULL,
  ADD COLUMN IF NOT EXISTS website              text NULL,
  ADD COLUMN IF NOT EXISTS tax_id               text NULL,
  ADD COLUMN IF NOT EXISTS vat_id               text NULL,
  ADD COLUMN IF NOT EXISTS registration_number  text NULL,
  ADD COLUMN IF NOT EXISTS payment_terms_days   int NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS billing_address      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS shipping_address     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes                text NULL,
  ADD COLUMN IF NOT EXISTS assigned_to          uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by           uuid NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_by           uuid NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at           timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_customers_org_status
  ON public.customers (org_id, client_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_email_trgm
  ON public.customers USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_assigned
  ON public.customers (assigned_to) WHERE assigned_to IS NOT NULL AND deleted_at IS NULL;

DO $$ BEGIN
  CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Contacts: add deleted_at, audit columns ------------------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS updated_by uuid NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- Rename crm_activities -> activities -----------------------------------
ALTER TABLE IF EXISTS public.crm_activities RENAME TO activities;

-- Create leads (forward-decl FK to opportunities resolved at end) -------
CREATE TABLE IF NOT EXISTS public.leads (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  lead_number             text NOT NULL,
  display_name            text NOT NULL,
  company_name            text NULL,
  email                   citext NULL,
  phone                   text NULL,
  source                  text NULL,
  status                  text NOT NULL DEFAULT 'new'
                          CHECK (status IN ('new','contacted','qualified','disqualified','converted')),
  assigned_to             uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  estimated_value_cents   bigint NOT NULL DEFAULT 0,
  currency_code           text NULL,
  expected_close_at       date NULL,
  converted_customer_id   uuid NULL REFERENCES public.customers(id) ON DELETE SET NULL,
  converted_opportunity_id uuid NULL,
  converted_at            timestamptz NULL,
  notes                   text NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL REFERENCES auth.users(id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NULL REFERENCES auth.users(id),
  deleted_at              timestamptz NULL,
  UNIQUE (org_id, lead_number)
);
CREATE INDEX IF NOT EXISTS idx_leads_org_status ON public.leads (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON public.leads (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_name_trgm ON public.leads USING gin (display_name gin_trgm_ops);
CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Create opportunities --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opportunities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  opportunity_number  text NOT NULL,
  customer_id         uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  lead_id             uuid NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  name                text NOT NULL,
  stage               text NOT NULL DEFAULT 'prospect'
                      CHECK (stage IN ('prospect','discovery','proposal','negotiation','won','lost','abandoned')),
  amount_cents        bigint NOT NULL DEFAULT 0,
  currency_code       text NULL,
  probability_pct     numeric(5,2) NOT NULL DEFAULT 0 CHECK (probability_pct BETWEEN 0 AND 100),
  expected_close_at   date NULL,
  closed_at           timestamptz NULL,
  close_reason        text NULL,
  owner_user_id       uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  notes               text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL REFERENCES auth.users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL REFERENCES auth.users(id),
  deleted_at          timestamptz NULL,
  UNIQUE (org_id, opportunity_number)
);
CREATE INDEX IF NOT EXISTS idx_opportunities_org_stage ON public.opportunities (org_id, stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_opportunities_customer ON public.opportunities (customer_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_owner ON public.opportunities (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE TRIGGER trg_opportunities_updated_at
  BEFORE UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Resolve the deferred FK on leads.
ALTER TABLE public.leads
  ADD CONSTRAINT fk_leads_opportunity FOREIGN KEY (converted_opportunity_id)
  REFERENCES public.opportunities(id) ON DELETE SET NULL;

-- Activities extension --------------------------------------------------
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS lead_id         uuid NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opportunity_id  uuid NULL REFERENCES public.opportunities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at      timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_activities_org_due
  ON public.activities (org_id, due_at) WHERE status = 'open' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_activities_lead
  ON public.activities (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_opportunity
  ON public.activities (opportunity_id) WHERE opportunity_id IS NOT NULL;

-- RLS for new tables (full unification in 0043) --------------------------
ALTER TABLE public.leads         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

COMMIT;
