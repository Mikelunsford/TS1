-- 0029_tenancy_init.sql
-- Purpose: Bring up the tenancy layer (organizations, branding, feature
--   flags, domains, memberships, roles, app_users, profiles helpers) and
--   the org-aware helper functions every downstream migration depends on.
--   Seeds the default org and base roles.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.org_memberships, public.app_users, public.org_domains,
--              public.org_feature_flags, public.org_branding, public.organizations,
--              public.roles CASCADE;
--   DROP FUNCTION public.current_org_id(), public.is_staff(),
--                 public.check_membership_customer_scope(),
--                 public.set_updated_at_v2();
--   (note: current_user_role and current_user_customer_id are
--    REPLACEd, not dropped, to keep prior policies functional.)

BEGIN;

-- Updated set_updated_at variant that also records updated_by from auth.uid().
CREATE OR REPLACE FUNCTION public.set_updated_at_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  IF to_jsonb(NEW) ? 'updated_by' THEN
    BEGIN
      NEW.updated_by := auth.uid();
    EXCEPTION WHEN OTHERS THEN
      -- ignore if auth.uid() unavailable in this context
      NULL;
    END;
  END IF;
  RETURN NEW;
END $$;

-- Roles --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  label         text NOT NULL,
  description   text NULL,
  is_staff      boolean NOT NULL DEFAULT true,
  is_system     boolean NOT NULL DEFAULT true,
  scope_level   int NOT NULL DEFAULT 50,
  capabilities  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.roles (code, label, description, is_staff, is_system, scope_level) VALUES
  ('org_owner',     'Owner',           'Full control of the organization including billing and ownership transfer.', true,  true, 10),
  ('org_admin',     'Administrator',   'Manage members, settings, branding, and most app features.',                  true,  true, 20),
  ('sales',         'Sales',           'Create and manage quotes, customers, leads, and opportunities.',              true,  true, 30),
  ('ops',           'Operations',      'Manage projects, BOM, receiving, production, shipments.',                     true,  true, 30),
  ('accounting',    'Accounting',      'Manage invoices, payments, expenses, vendor bills, GL.',                      true,  true, 30),
  ('viewer',        'Viewer',          'Read-only access across the application.',                                    true,  true, 80),
  ('customer_user', 'Customer Portal', 'External user scoped to a single customer record.',                           false, true, 90)
ON CONFLICT (code) DO NOTHING;

-- Organizations ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organizations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  citext NOT NULL UNIQUE,
  display_name          text NOT NULL,
  legal_name            text NULL,
  industry              text NULL,
  default_locale        text NOT NULL DEFAULT 'en_us',
  default_timezone      text NOT NULL DEFAULT 'UTC',
  default_currency_code text NOT NULL DEFAULT 'USD',
  date_format           text NOT NULL DEFAULT 'YYYY-MM-DD',
  plan_code             text NOT NULL DEFAULT 'starter',
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  trial_ends_at         timestamptz NULL,
  billing_email         text NULL,
  support_email         text NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at            timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_organizations_slug   ON public.organizations (slug);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON public.organizations (status) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.organizations (id, slug, display_name, legal_name, default_locale, default_timezone, default_currency_code, date_format, plan_code, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'team1', 'Team1', 'Team1, Inc.', 'en_us', 'America/New_York', 'USD', 'YYYY-MM-DD', 'starter', 'active')
ON CONFLICT (id) DO NOTHING;

-- Branding -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.org_branding (
  org_id              uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  logo_url            text NULL,
  icon_url            text NULL,
  email_logo_url      text NULL,
  primary_color       text NOT NULL DEFAULT '#0F172A',
  accent_color        text NOT NULL DEFAULT '#3B82F6',
  on_primary          text NOT NULL DEFAULT '#FFFFFF',
  font_family         text NOT NULL DEFAULT 'Inter, system-ui, sans-serif',
  invoice_pdf_footer  text NULL,
  quote_pdf_footer    text NULL,
  app_name_override   text NULL,
  support_url         text NULL,
  privacy_url         text NULL,
  terms_url           text NULL,
  custom_css          text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL REFERENCES auth.users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid NULL REFERENCES auth.users(id)
);
CREATE TRIGGER trg_org_branding_updated_at
  BEFORE UPDATE ON public.org_branding
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.org_branding (
  org_id, primary_color, accent_color, on_primary, font_family,
  invoice_pdf_footer, quote_pdf_footer
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  '#0F172A', '#3B82F6', '#FFFFFF', 'Inter, system-ui, sans-serif',
  'Invoice was created on a computer and is valid without the signature and seal',
  'Quote was created on a computer and is valid without the signature and seal'
) ON CONFLICT (org_id) DO NOTHING;

-- Feature flags ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.org_feature_flags (
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  flag_key   text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users(id),
  PRIMARY KEY (org_id, flag_key)
);
CREATE INDEX IF NOT EXISTS idx_org_feature_flags_enabled
  ON public.org_feature_flags (org_id) WHERE is_enabled;
CREATE TRIGGER trg_org_feature_flags_updated_at
  BEFORE UPDATE ON public.org_feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.org_feature_flags (org_id, flag_key, is_enabled)
SELECT o.id, flag.k, flag.enabled
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('crm.leads',                  false),
    ('crm.opportunities',          false),
    ('sales.invoices',             true),
    ('sales.credit_notes',         true),
    ('finance.expenses',           false),
    ('finance.taxes',              true),
    ('finance.chart_of_accounts',  false),
    ('inventory.enabled',          false),
    ('procurement.enabled',        false),
    ('plugins.3pl',                true),
    ('plugins.production',         true),
    ('plugins.shipping',           true),
    ('ux.saved_views',             true),
    ('ux.comments',                true),
    ('ux.notifications_email',     false),
    ('ux.realtime',                false)
  ) AS flag(k, enabled)
ON CONFLICT (org_id, flag_key) DO NOTHING;

-- Domains ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.org_domains (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  hostname    citext NOT NULL UNIQUE,
  is_primary  boolean NOT NULL DEFAULT false,
  verified_at timestamptz NULL,
  ssl_status  text NOT NULL DEFAULT 'pending' CHECK (ssl_status IN ('pending','active','failed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NULL REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid NULL REFERENCES auth.users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_domains_primary
  ON public.org_domains (org_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_org_domains_org ON public.org_domains (org_id);
CREATE TRIGGER trg_org_domains_updated_at
  BEFORE UPDATE ON public.org_domains
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Memberships --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.org_memberships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id       uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  customer_id   uuid NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  is_active     boolean NOT NULL DEFAULT true,
  invited_at    timestamptz NULL,
  joined_at     timestamptz NULL,
  last_seen_at  timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NULL REFERENCES auth.users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid NULL REFERENCES auth.users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_memberships_user_org
  ON public.org_memberships (org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user
  ON public.org_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_active
  ON public.org_memberships (org_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_org_memberships_customer
  ON public.org_memberships (customer_id) WHERE customer_id IS NOT NULL;
CREATE TRIGGER trg_org_memberships_updated_at
  BEFORE UPDATE ON public.org_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Invariant: customer_user must have customer_id; staff roles must not.
CREATE OR REPLACE FUNCTION public.check_membership_customer_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r_code text;
BEGIN
  SELECT code INTO r_code FROM public.roles WHERE id = NEW.role_id;
  IF r_code = 'customer_user' AND NEW.customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_user membership requires customer_id';
  END IF;
  IF r_code <> 'customer_user' AND NEW.customer_id IS NOT NULL THEN
    RAISE EXCEPTION 'staff role membership must not set customer_id';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.check_membership_customer_scope() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_membership_customer_scope() TO service_role;

CREATE TRIGGER trg_org_memberships_check_scope
  BEFORE INSERT OR UPDATE ON public.org_memberships
  FOR EACH ROW EXECUTE FUNCTION public.check_membership_customer_scope();

-- App users (API keys / service principals) -------------------------------

CREATE TABLE IF NOT EXISTS public.app_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label         text NOT NULL,
  api_key_hash  text NOT NULL,
  scopes        text[] NOT NULL DEFAULT '{}'::text[],
  is_active     boolean NOT NULL DEFAULT true,
  expires_at    timestamptz NULL,
  last_used_at  timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NULL REFERENCES auth.users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid NULL REFERENCES auth.users(id),
  deleted_at    timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_app_users_org_active
  ON public.app_users (org_id) WHERE is_active AND deleted_at IS NULL;
CREATE TRIGGER trg_app_users_updated_at
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper functions ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE claim_org uuid; fallback_org uuid;
BEGIN
  BEGIN
    claim_org := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'org_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    claim_org := NULL;
  END;
  IF claim_org IS NOT NULL THEN RETURN claim_org; END IF;
  SELECT om.org_id INTO fallback_org
    FROM public.org_memberships om
   WHERE om.user_id = auth.uid() AND om.is_active
   LIMIT 1;
  RETURN fallback_org;
END $$;

-- REPLACE earlier current_user_role/current_user_customer_id to be org-aware.
DROP FUNCTION IF EXISTS public.current_user_role() CASCADE;
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT r.code
    FROM public.org_memberships om
    JOIN public.roles r ON r.id = om.role_id
   WHERE om.user_id = auth.uid()
     AND om.org_id = public.current_org_id()
     AND om.is_active
   LIMIT 1
$$;

DROP FUNCTION IF EXISTS public.current_user_customer_id() CASCADE;
CREATE OR REPLACE FUNCTION public.current_user_customer_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT om.customer_id
    FROM public.org_memberships om
   WHERE om.user_id = auth.uid()
     AND om.org_id = public.current_org_id()
     AND om.is_active
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(public.current_user_role() <> 'customer_user', false)
$$;

REVOKE EXECUTE ON FUNCTION public.current_org_id()             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_role()          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_customer_id()   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff()                   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_org_id()             TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.current_user_role()          TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.current_user_customer_id()   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.is_staff()                   TO authenticated, service_role;

-- Backfill: every TS user_profile becomes an org_memberships row in the
-- default org. management -> org_admin; customer_user -> customer_user.
INSERT INTO public.org_memberships (org_id, user_id, role_id, customer_id, is_active)
SELECT '00000000-0000-0000-0000-000000000001',
       up.user_id,
       r.id,
       CASE WHEN up.role::text = 'customer_user' THEN up.customer_id ELSE NULL END,
       COALESCE(up.is_active, true)
  FROM public.user_profiles up
  JOIN public.roles r ON r.code = CASE
        WHEN up.role::text = 'management' THEN 'org_admin'
        ELSE 'customer_user'
      END
ON CONFLICT (org_id, user_id) DO NOTHING;

DO $$
DECLARE expected int; got int;
BEGIN
  SELECT count(*) INTO expected FROM public.user_profiles;
  SELECT count(*) INTO got      FROM public.org_memberships
    WHERE org_id = '00000000-0000-0000-0000-000000000001';
  IF got < expected THEN
    RAISE EXCEPTION 'org_memberships backfill drift: expected at least %, got %', expected, got;
  END IF;
END $$;

-- RLS ---------------------------------------------------------------------

ALTER TABLE public.organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_branding        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_feature_flags   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_domains         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_memberships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users           ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizations_select_member ON public.organizations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.org_memberships m
                 WHERE m.org_id = organizations.id AND m.user_id = auth.uid() AND m.is_active));
CREATE POLICY organizations_update_owner ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = public.current_org_id() AND public.current_user_role() = 'org_owner')
  WITH CHECK (id = public.current_org_id() AND public.current_user_role() = 'org_owner');

CREATE POLICY org_branding_select_member ON public.org_branding
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY org_branding_update_admin ON public.org_branding
  FOR UPDATE TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'));

CREATE POLICY oflags_select_member ON public.org_feature_flags
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY oflags_write_admin ON public.org_feature_flags
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'));

CREATE POLICY odomains_select_member ON public.org_domains
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY odomains_write_owner ON public.org_domains
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = 'org_owner')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'org_owner');

CREATE POLICY org_memberships_select_self ON public.org_memberships
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY org_memberships_select_admin ON public.org_memberships
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'));
CREATE POLICY org_memberships_insert_admin ON public.org_memberships
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'));
CREATE POLICY org_memberships_update_admin ON public.org_memberships
  FOR UPDATE TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'));

CREATE POLICY roles_select_any ON public.roles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY app_users_select_admin ON public.app_users
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'));
CREATE POLICY app_users_write_admin ON public.app_users
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'));

COMMIT;
