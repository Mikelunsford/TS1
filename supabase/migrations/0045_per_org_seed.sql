-- 0045_per_org_seed.sql
-- Purpose: Wave 1 / Phase 1 seed for the founding tenant. The Wave 0
--   placeholder org (id 00000000-0000-0000-0000-000000000001, slug 'team1')
--   has already been seeded by 0029 and stamped onto 36 customers, 16
--   feature flags, 39 settings rows, and the org_branding default row.
--   Rather than introduce a second org and migrate references off the
--   placeholder, this migration rebrands the placeholder in place: it
--   verifies the row exists, fills in the public-facing fields that were
--   defaulted in 0029, and seeds the host->org row for
--   tenants-api/resolve-host. Forward-only.
-- Date:    2026-05-15
--
-- Per the user (2026-05-15 dispatch): slug=`team1`, host=`team1.app`,
-- brand defaults from 0029 retained. Source-of-truth answers logged in
-- /03-workspace/journal/2026-05-15-wave-1-migrations-per-org-seed.md.
--
-- DOWN MIGRATION:
--   DELETE FROM public.org_domains WHERE org_id = '00000000-0000-0000-0000-000000000001'
--     AND hostname IN ('team1.app','localhost');
--   UPDATE public.organizations SET legal_name = NULL, billing_email = NULL,
--     support_email = NULL WHERE id = '00000000-0000-0000-0000-000000000001';
--   UPDATE public.org_branding SET app_name_override = NULL, support_url = NULL
--     WHERE org_id = '00000000-0000-0000-0000-000000000001';

BEGIN;

-- 1. Sanity check: the placeholder org must exist exactly as 0029 seeded it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = '00000000-0000-0000-0000-000000000001'
      AND slug = 'team1'
  ) THEN
    RAISE EXCEPTION
      '0045 invariant: organizations row 00000000-...-0001 with slug=team1 not found. 0029 must have run.';
  END IF;
END $$;

-- 2. Fill in the public-facing org fields that 0029 left null.
UPDATE public.organizations
SET
  legal_name    = COALESCE(legal_name,    'Team1'),
  industry      = COALESCE(industry,      'operations'),
  billing_email = COALESCE(billing_email, 'billing@team1.app'),
  support_email = COALESCE(support_email, 'support@team1.app')
WHERE id = '00000000-0000-0000-0000-000000000001';

-- 3. Branding row: 0029 seeded the defaults (#0F172A primary / #3B82F6 accent
--    / Inter font). Just light the public-facing optional fields.
UPDATE public.org_branding
SET
  app_name_override = COALESCE(app_name_override, 'Team1'),
  support_url       = COALESCE(support_url,       'https://team1.app/support')
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- 4. The host->org rows that tenants-api/resolve-host will read.
--    team1.app is the production host; localhost is the dev fallback so
--    the SPA can resolve a host even without a real DNS record.
INSERT INTO public.org_domains (org_id, hostname, is_primary, verified_at, ssl_status)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'team1.app',  true,  now(), 'active'),
  ('00000000-0000-0000-0000-000000000001', 'localhost',  false, now(), 'active')
ON CONFLICT (hostname) DO NOTHING;

-- 5. Invariant checks before commit.
DO $$
DECLARE
  v_primary_count int;
  v_total_count   int;
BEGIN
  SELECT count(*) INTO v_primary_count
    FROM public.org_domains
   WHERE org_id = '00000000-0000-0000-0000-000000000001'
     AND is_primary;
  IF v_primary_count <> 1 THEN
    RAISE EXCEPTION '0045 invariant: expected exactly one primary domain for team1, got %', v_primary_count;
  END IF;

  SELECT count(*) INTO v_total_count
    FROM public.org_domains
   WHERE org_id = '00000000-0000-0000-0000-000000000001';
  IF v_total_count < 2 THEN
    RAISE EXCEPTION '0045 invariant: expected at least 2 domains for team1, got %', v_total_count;
  END IF;
END $$;

COMMIT;
