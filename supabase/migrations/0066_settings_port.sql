-- 0066_settings_port.sql
-- Purpose: Phase 15 — per-org settings table with grouped key/value defaults
--   for company, invoicing, quoting, finance, branding, clients. Replaces
--   the legacy Idurar-shaped org_settings table from 0037 (seed-only,
--   unused by any handler). New shape: composite PK (org_id, "group", key),
--   value as jsonb, audit columns. RLS: member-read, admin+ writes.
--
--   Also wires `set_quote_requires_approval` to read the per-org threshold
--   from org_settings (group='quoting', key='approval_threshold_cents'),
--   falling back to 2,500,000 cents ($25k) when the row is missing.
--
--   Defines `seed_org_defaults(p_org_id)` which calls `seed_org_numbering`
--   (added by Phase 14 / migration 0065_unify_numbering) if present and
--   `seed_org_settings` unconditionally. The seed_org_numbering guard via
--   to_regprocedure makes merge-order tolerant; this file was originally
--   numbered 0065 and was renumbered to 0066 when BE-1's 0065_unify_numbering
--   landed on main first (PR #75 merged before PR #76 / Phase 15 push).
--
-- Closes BUILD-ORDER §Phase 15 (per-org settings + RequireFlag SPA gating),
--   observations R-W7-OBS-01 (per-route gating decision) and R-W8F-OBS-01
--   (SPA flag reader missing). The per-route requireFlag middleware ships
--   in supabase/functions/_shared/requireFlag.ts; this migration only
--   handles schema + seed.
--
-- Date: 2026-05-16
--
-- DOWN MIGRATION (operator-only):
--   DROP FUNCTION public.seed_org_defaults(uuid);
--   DROP FUNCTION public.seed_org_settings(uuid);
--   DROP TABLE public.org_settings CASCADE;
--   -- legacy 0037 shape is not restored; data was seed-only.

BEGIN;

-- ============================================================================
-- 1. Drop legacy org_settings (Idurar port, seed-only, never read by handlers)
-- ============================================================================

DROP POLICY IF EXISTS settings_select_member        ON public.org_settings;
DROP POLICY IF EXISTS settings_select_staff_private ON public.org_settings;
DROP POLICY IF EXISTS settings_write_admin          ON public.org_settings;
DROP TRIGGER IF EXISTS trg_org_settings_updated_at  ON public.org_settings;
DROP TABLE  IF EXISTS public.org_settings CASCADE;

-- ============================================================================
-- 2. New org_settings: composite PK, jsonb value, audit cols.
-- ============================================================================

CREATE TABLE public.org_settings (
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  "group"     text        NOT NULL,
  key         text        NOT NULL,
  value       jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        NULL REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        NULL REFERENCES auth.users(id),
  PRIMARY KEY (org_id, "group", key)
);

CREATE INDEX IF NOT EXISTS idx_org_settings_group ON public.org_settings (org_id, "group");

CREATE TRIGGER trg_org_settings_updated_at
  BEFORE UPDATE ON public.org_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

-- RLS mirrors chart_of_accounts pattern from 0043 §finance.
--   SELECT: any org member with current_org_id() match.
--   WRITE : org_owner / org_admin only (Phase 15 spec says admin+).
CREATE POLICY org_settings_select_member ON public.org_settings
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

CREATE POLICY org_settings_write_admin ON public.org_settings
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() IN ('org_owner','org_admin'));

-- ============================================================================
-- 3. seed_org_settings(p_org_id): idempotent group/key/value defaults.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_org_settings(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'seed_org_settings: p_org_id NULL';
  END IF;

  INSERT INTO public.org_settings (org_id, "group", key, value) VALUES
    -- company
    (p_org_id, 'company',   'name',                          '"Team1"'::jsonb),
    (p_org_id, 'company',   'legal_name',                    'null'::jsonb),
    (p_org_id, 'company',   'tax_id',                        'null'::jsonb),
    (p_org_id, 'company',   'default_currency',              '"USD"'::jsonb),
    (p_org_id, 'company',   'timezone',                      '"America/Los_Angeles"'::jsonb),
    (p_org_id, 'company',   'country_code',                  '"US"'::jsonb),
    -- invoicing
    (p_org_id, 'invoicing', 'default_due_days',              '30'::jsonb),
    (p_org_id, 'invoicing', 'default_tax_id',                'null'::jsonb),
    (p_org_id, 'invoicing', 'default_payment_terms',         '"Net 30"'::jsonb),
    (p_org_id, 'invoicing', 'email_subject_template',        '"Invoice {{number}}"'::jsonb),
    (p_org_id, 'invoicing', 'email_body_template',           '"Please find invoice {{number}} attached."'::jsonb),
    -- quoting
    (p_org_id, 'quoting',   'approval_threshold_cents',      '2500000'::jsonb),
    (p_org_id, 'quoting',   'default_validity_days',         '30'::jsonb),
    (p_org_id, 'quoting',   'auto_convert_on_acceptance',    'false'::jsonb),
    -- finance
    (p_org_id, 'finance',   'fiscal_year_start_month',       '1'::jsonb),
    (p_org_id, 'finance',   'default_je_book_after_post',    'true'::jsonb),
    (p_org_id, 'finance',   'auto_reverse_je_on_cancellation','false'::jsonb),
    -- branding
    (p_org_id, 'branding',  'primary_color',                 '"#1f2937"'::jsonb),
    (p_org_id, 'branding',  'accent_color',                  '"#3b82f6"'::jsonb),
    (p_org_id, 'branding',  'logo_url',                      'null'::jsonb),
    (p_org_id, 'branding',  'email_footer',                  'null'::jsonb),
    -- clients
    (p_org_id, 'clients',   'client_status_options',         '["lead","active","inactive"]'::jsonb),
    (p_org_id, 'clients',   'default_client_status',         '"lead"'::jsonb)
  ON CONFLICT (org_id, "group", key) DO NOTHING;
END $$;

COMMENT ON FUNCTION public.seed_org_settings(uuid) IS
  'Phase 15: per-org settings defaults across 6 groups (company, invoicing, '
  'quoting, finance, branding, clients). Idempotent via composite PK '
  '(org_id, group, key). All values jsonb.';

REVOKE EXECUTE ON FUNCTION public.seed_org_settings(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.seed_org_settings(uuid) TO service_role;

-- ============================================================================
-- 4. seed_org_defaults(p_org_id): umbrella seed. Conditionally chains to
--    seed_org_numbering (Phase 14) if that function exists at apply time.
--    The to_regprocedure guard makes merge-order between 0064 and 0065
--    tolerant.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_org_defaults(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'seed_org_defaults: p_org_id NULL';
  END IF;
  IF to_regprocedure('public.seed_org_numbering(uuid)') IS NOT NULL THEN
    PERFORM public.seed_org_numbering(p_org_id);
  END IF;
  PERFORM public.seed_org_settings(p_org_id);
END $$;

COMMENT ON FUNCTION public.seed_org_defaults(uuid) IS
  'Phase 15 umbrella seed: invokes seed_org_numbering (if Phase 14 fn '
  'present) + seed_org_settings. Safe to call repeatedly.';

REVOKE EXECUTE ON FUNCTION public.seed_org_defaults(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.seed_org_defaults(uuid) TO service_role;

-- ============================================================================
-- 5. Seed all existing orgs (idempotent).
-- ============================================================================

SELECT public.seed_org_defaults(id) FROM public.organizations;

-- ============================================================================
-- 6. requires_approval trigger reads threshold from org_settings (with
--    COALESCE fallback to 2,500,000 cents = $25k). Replaces the hard-coded
--    threshold from 0030 §requires_approval cents.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_quote_requires_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold bigint;
BEGIN
  SELECT COALESCE((value)::text::bigint, 2500000)
    INTO v_threshold
    FROM public.org_settings
   WHERE org_id = NEW.org_id
     AND "group" = 'quoting'
     AND key = 'approval_threshold_cents'
   LIMIT 1;

  IF v_threshold IS NULL THEN
    v_threshold := 2500000;
  END IF;

  NEW.requires_approval := COALESCE(NEW.total_cents, 0) > v_threshold;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_quote_requires_approval() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_quote_requires_approval() TO service_role;

-- ============================================================================
-- 7. Seed Phase 15 feature flags as enabled-by-default for every org.
--    Without this, the per-route requireFlag gate would 403 every
--    /expenses, /chart-of-accounts, /warehouses, /stock-* call on prod.
--    Flags can be flipped off per-org via settings-api once Phase 23
--    admin-console lands.
-- ============================================================================

INSERT INTO public.org_feature_flags (org_id, flag_key, is_enabled, config)
SELECT o.id, f.flag_key, true, '{}'::jsonb
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('finance.expenses'),
    ('finance.chart_of_accounts'),
    ('inventory.enabled')
  ) AS f(flag_key)
ON CONFLICT (org_id, flag_key) DO NOTHING;

-- ============================================================================
-- 8. Post-apply assertions.
-- ============================================================================

DO $$
DECLARE
  v_count integer;
  v_org_count integer;
BEGIN
  SELECT count(*) INTO v_org_count FROM public.organizations;
  SELECT count(*) INTO v_count
    FROM public.org_settings
   WHERE "group" = 'quoting' AND key = 'approval_threshold_cents';
  IF v_org_count > 0 AND v_count < v_org_count THEN
    RAISE EXCEPTION 'org_settings seed coverage gap: % orgs vs % approval_threshold rows', v_org_count, v_count;
  END IF;
END $$;

COMMIT;
