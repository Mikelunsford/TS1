-- 0048_idempotency_legacy_relax.sql
-- Wave 3, Sub-wave 3.0b — closes R-W1-05 (legacy NOT-NULL columns on
-- public.idempotency_keys).
--
-- Background: the on-cloud `idempotency_keys` table carries three columns
-- from a pre-Wave-0 shape (`endpoint`, `request_hash`, `response`) alongside
-- the Wave-1 architecture-spec columns (`route_hash`, `body_hash`,
-- `response_jsonb`). The legacy columns are NOT NULL with no defaults, so the
-- `_shared/idempotency.ts` helper has had to dual-write both column sets on
-- every upsert (see the comment in the helper header). Wave 2's PR #22 tried
-- to bundle the helper patch + a NOT-NULL drop migration in the same PR;
-- Code Reviewer surfaced the deploy-race (deploy-functions.yml redeploys the
-- helper BEFORE migrate.yml's production-db gate clears) and we extracted
-- both into this 3-stage Wave 3 sequence:
--
--   stage 1 (this file): relax NOT NULL + add empty defaults on the legacy
--                        columns so old writes still work and new writes
--                        that omit the columns succeed via DEFAULT.
--   stage 2 (this PR's deploy): redeploy `_shared/idempotency.ts` so the
--                        helper no longer writes the legacy columns. Workflow
--                        ordering is enforced by the new `workflow_run` gate
--                        added to deploy-functions.yml in this same PR
--                        (R-W2-01 structural fix).
--   stage 3 (F-Wave3-01-b, Wave 4): once one release cycle of zero writes to
--                        the legacy columns confirms nothing else is reading
--                        them, ship 0049_drop_legacy_idempotency_columns.sql
--                        that ALTER ... DROP COLUMN endpoint, request_hash,
--                        response.
--
-- Forward-only. If you need to undo while testing, the down block is below.
--
-- Date:    2026-05-15
--
-- DOWN MIGRATION:
--   ALTER TABLE public.idempotency_keys
--     ALTER COLUMN endpoint     DROP DEFAULT,
--     ALTER COLUMN request_hash DROP DEFAULT,
--     ALTER COLUMN response     DROP DEFAULT,
--     ALTER COLUMN endpoint     SET NOT NULL,
--     ALTER COLUMN request_hash SET NOT NULL,
--     ALTER COLUMN response     SET NOT NULL;

BEGIN;

ALTER TABLE public.idempotency_keys
  ALTER COLUMN endpoint     DROP NOT NULL,
  ALTER COLUMN endpoint     SET DEFAULT '',
  ALTER COLUMN request_hash DROP NOT NULL,
  ALTER COLUMN request_hash SET DEFAULT '',
  ALTER COLUMN response     DROP NOT NULL,
  ALTER COLUMN response     SET DEFAULT '{}'::jsonb;

-- Idempotent invariant check: an INSERT that omits the legacy columns must
-- succeed. We don't actually run a write here (the migration is in the same
-- transaction as the live table), but we assert the post-state matches the
-- expected shape so a future audit can detect drift.
DO $$
DECLARE
  v_endpoint_nullable     boolean;
  v_request_hash_nullable boolean;
  v_response_nullable     boolean;
BEGIN
  SELECT is_nullable = 'YES'
    INTO v_endpoint_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'idempotency_keys'
     AND column_name = 'endpoint';
  SELECT is_nullable = 'YES'
    INTO v_request_hash_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'idempotency_keys'
     AND column_name = 'request_hash';
  SELECT is_nullable = 'YES'
    INTO v_response_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'idempotency_keys'
     AND column_name = 'response';

  IF NOT (v_endpoint_nullable AND v_request_hash_nullable AND v_response_nullable) THEN
    RAISE EXCEPTION
      '0048 post-state assertion failed: endpoint=% request_hash=% response=% (expected all nullable)',
      v_endpoint_nullable, v_request_hash_nullable, v_response_nullable;
  END IF;
END $$;

COMMIT;
