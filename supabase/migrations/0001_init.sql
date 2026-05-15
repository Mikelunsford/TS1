-- 0001_init.sql
-- Purpose: TS chassis MVP schema. pgcrypto, base enums, customers,
--   user_profiles, pricing_menu, projects, quotes, quote_line_items,
--   workflow_transitions, idempotency_keys, sequences, helper triggers,
--   default-deny RLS scaffolding.
-- Date:    2026-05-14
-- Idempotent: uses CREATE ... IF NOT EXISTS where possible; types are
--   guarded with DO blocks.
--
-- DOWN MIGRATION (operator-only, not auto-run):
--   DROP TABLE public.idempotency_keys, public.workflow_transitions,
--              public.quote_line_items, public.quotes, public.projects,
--              public.pricing_menu, public.user_profiles, public.customers CASCADE;
--   DROP TYPE  public.app_role, public.service_type, public.quote_state,
--              public.project_state CASCADE;
--   DROP SEQUENCE public.quote_number_seq, public.project_number_seq;
--   DROP FUNCTION public.set_updated_at(), public.set_state_changed_at(),
--                 public.current_user_role(), public.current_user_customer_id(),
--                 public.next_quote_number(), public.next_project_number();

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enums --------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('management','customer_user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_type AS ENUM ('co_pack','cross_dock');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.quote_state AS ENUM (
    'draft','submitted','revise_requested','approved','project_pending','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.project_state AS ENUM (
    'pending','in_production','completed','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Generic helper triggers --------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.set_state_changed_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.state_changed_at = now();
  END IF;
  RETURN NEW;
END $$;

-- Sequences ----------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.quote_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.project_number_seq;

CREATE OR REPLACE FUNCTION public.next_quote_number()
RETURNS text LANGUAGE sql AS $$
  SELECT 'Q-' || extract(year FROM now())::text || '-' ||
         lpad(nextval('public.quote_number_seq')::text, 5, '0')
$$;

CREATE OR REPLACE FUNCTION public.next_project_number()
RETURNS text LANGUAGE sql AS $$
  SELECT 'P-' || extract(year FROM now())::text || '-' ||
         lpad(nextval('public.project_number_seq')::text, 5, '0')
$$;

-- Customers ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  contact_name  text NULL,
  contact_email text NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- User profiles ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text NOT NULL,
  display_name  text NULL,
  role          public.app_role NOT NULL DEFAULT 'customer_user',
  customer_id   uuid NULL REFERENCES public.customers(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- SECURITY DEFINER helpers used by RLS; replaced in 0029 to be org-aware.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT role FROM public.user_profiles WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_user_customer_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT customer_id FROM public.user_profiles WHERE user_id = auth.uid()
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_customer_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_customer_id() TO authenticated, service_role;

-- Pricing menu -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pricing_menu (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code    text NOT NULL UNIQUE,
  description  text NOT NULL,
  category     text NULL,
  unit_price   numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  unit_cost    numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_pricing_menu_updated_at
  BEFORE UPDATE ON public.pricing_menu
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Projects -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_number  text NOT NULL UNIQUE,
  quote_id        uuid NULL UNIQUE,         -- FK added after quotes exists
  customer_id     uuid NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  customer_name   text NULL,
  name            text NOT NULL,
  status          public.project_state NOT NULL DEFAULT 'pending',
  total           numeric(12,2) NOT NULL DEFAULT 0,
  due_date        timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Quotes -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number    text NOT NULL UNIQUE,
  customer_id     uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  customer_name   text NOT NULL,
  contact_name    text NULL,
  contact_email   text NULL,
  service_type    public.service_type NOT NULL,
  status          public.quote_state NOT NULL DEFAULT 'draft',
  subtotal        numeric(12,2) NOT NULL DEFAULT 0,
  total           numeric(12,2) NOT NULL DEFAULT 0,
  notes           text NULL,
  valid_until     timestamptz NULL,
  project_id      uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  created_by      uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  state_changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON public.quotes (status);
CREATE INDEX IF NOT EXISTS idx_quotes_customer ON public.quotes (customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_updated ON public.quotes (updated_at DESC);

CREATE TRIGGER trg_quotes_updated_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_quotes_state_changed_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_state_changed_at();

-- Now wire projects.quote_id back to quotes:
ALTER TABLE public.projects
  ADD CONSTRAINT fk_projects_quote FOREIGN KEY (quote_id)
  REFERENCES public.quotes(id) ON DELETE SET NULL;

-- Quote line items ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.quote_line_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  pricing_item_id uuid NULL REFERENCES public.pricing_menu(id) ON DELETE SET NULL,
  description     text NOT NULL,
  quantity        numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_price      numeric(12,2) NOT NULL DEFAULT 0,
  unit_cost       numeric(12,2) NOT NULL DEFAULT 0,
  line_total      numeric(12,2) NOT NULL DEFAULT 0,
  position        int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qli_quote ON public.quote_line_items (quote_id);

-- Workflow transitions (will be renamed to audit_log in 0036) --------------

CREATE TABLE IF NOT EXISTS public.workflow_transitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   text NOT NULL CHECK (entity_type IN ('quote','project')),
  entity_id     uuid NOT NULL,
  from_state    text NULL,
  to_state      text NOT NULL,
  triggered_by  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  triggered_at  timestamptz NOT NULL DEFAULT now(),
  notes         text NULL
);
CREATE INDEX IF NOT EXISTS idx_transitions_entity
  ON public.workflow_transitions (entity_type, entity_id);

-- Idempotency keys ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  key           text NOT NULL,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint      text NOT NULL,
  request_hash  text NOT NULL,
  status_code   int NOT NULL,
  response      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, user_id)
);

-- RLS enable + default-deny -----------------------------------------------

ALTER TABLE public.customers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_menu         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_line_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys     ENABLE ROW LEVEL SECURITY;

-- Self-only profile read.
CREATE POLICY user_profiles_self_select ON public.user_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Pricing menu: all authenticated SELECT (API strips cost).
CREATE POLICY pricing_menu_select_all ON public.pricing_menu
  FOR SELECT TO authenticated USING (true);

-- Management sees everything; customer_user same-scope reads.
CREATE POLICY customers_select_management ON public.customers
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'management');
CREATE POLICY customers_select_self ON public.customers
  FOR SELECT TO authenticated
  USING (id = public.current_user_customer_id());

CREATE POLICY quotes_select_management ON public.quotes
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'management');
CREATE POLICY quotes_select_customer ON public.quotes
  FOR SELECT TO authenticated
  USING (customer_id = public.current_user_customer_id());

CREATE POLICY qli_select_via_parent ON public.quote_line_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_line_items.quote_id
      AND (public.current_user_role() = 'management'
           OR q.customer_id = public.current_user_customer_id())
  ));

CREATE POLICY projects_select_management ON public.projects
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'management');
CREATE POLICY projects_select_customer ON public.projects
  FOR SELECT TO authenticated
  USING (customer_id = public.current_user_customer_id());

CREATE POLICY transitions_select_management ON public.workflow_transitions
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'management');

-- idempotency_keys: no policy granted to clients; service-role only.

COMMIT;
