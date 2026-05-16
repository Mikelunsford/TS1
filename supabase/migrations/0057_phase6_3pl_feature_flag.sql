-- 0057_phase6_3pl_feature_flag.sql
-- Wave 6 / Phase 6 — gates the ops-api bundle behind plugins.3pl.
--
-- Seeds the `plugins.3pl` flag row on org_feature_flags for the default
-- Team1 org (slug='team1'); other orgs default to absent → false via the
-- isFeatureEnabled() reader added in PR #52a. ops-api/index.ts gates
-- every non-health route on this flag in the same PR.
--
-- Per per-wave DoD (build-order Phase 6): "org with flag off returns 404
-- on /ops-api/receiving-orders; org with flag on passes all TS regressions."
--
-- Step-2 verification (MCP 2026-05-16):
--   org_feature_flags shape: (org_id, flag_key text NN, is_enabled bool NN
--     default false, config jsonb, audit cols). UNIQUE on (org_id, flag_key)
--     enforced via the table's PK pattern.
--   Existing rows for Team1 org: crm.leads, crm.opportunities,
--     sales.invoices, sales.credit_notes, finance.expenses.
--     plugins.3pl absent — this migration seeds it.
--
-- Forward-only. Adding a new flag_key row is idempotent (ON CONFLICT DO
-- NOTHING). Other orgs' flag state is left untouched.
--
-- Date:     2026-05-16
-- Sub-wave: 6.2
-- Closes:   Phase 6 (per BUILD-ORDER) — 3PL plugin tagging.

BEGIN;

INSERT INTO public.org_feature_flags (org_id, flag_key, is_enabled, config)
SELECT id, 'plugins.3pl', true, '{}'::jsonb
  FROM public.organizations
 WHERE slug = 'team1'
ON CONFLICT (org_id, flag_key) DO NOTHING;

-- Post-state invariant: exactly one row exists for Team1 with the flag on.
DO $$
DECLARE v_count integer; v_enabled boolean;
BEGIN
  SELECT COUNT(*), MAX(is_enabled::int)::boolean
    INTO v_count, v_enabled
    FROM public.org_feature_flags off
    JOIN public.organizations o ON o.id = off.org_id
   WHERE o.slug = 'team1' AND off.flag_key = 'plugins.3pl';

  IF v_count = 0 THEN
    RAISE EXCEPTION '0057 post-state: plugins.3pl row missing for Team1 org';
  END IF;
  IF v_count > 1 THEN
    RAISE EXCEPTION '0057 post-state: multiple plugins.3pl rows for Team1 (count=%)', v_count;
  END IF;
  IF NOT v_enabled THEN
    RAISE EXCEPTION '0057 post-state: plugins.3pl is FALSE for Team1 org (expected true)';
  END IF;
END $$;

COMMIT;
