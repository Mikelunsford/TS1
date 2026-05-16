-- 0053_drop_legacy_idempotency_columns.sql
-- Wave 6 / F-Wave6-04 — closes R-W1-05 fully.
--
-- Stage 3 cleanup of the 3-stage idempotency-cleanup sequence defined in
-- 0048's header (Wave 3, sub-wave 3.0b). 0048 relaxed NOT NULL + added empty
-- defaults on the legacy trio (`endpoint`, `request_hash`, `response`) and
-- redeployed `_shared/idempotency.ts` under the `workflow_run` gate so the
-- helper no longer writes those columns. Two release cycles have now passed
-- (Wave 5 PR #43, #44, #46 BE writes; Wave 5 QA PR #47 contract suite
-- exercising 30 invoicing-api routes) with zero writes to the legacy trio.
--
-- Pre-flight verification (run via MCP execute_sql against prod 2026-05-16
-- before drafting this migration; mirrored in the DO-block invariant below):
--
--   SELECT COUNT(*) FILTER (WHERE endpoint IS NOT NULL AND endpoint <> '')      AS endpoint_writes,
--          COUNT(*) FILTER (WHERE request_hash IS NOT NULL AND request_hash <> '') AS request_hash_writes,
--          COUNT(*) FILTER (WHERE response IS NOT NULL AND response::text <> '{}') AS response_writes,
--          COUNT(*) AS total_keys,
--          COUNT(*) FILTER (WHERE route_hash    IS NOT NULL) AS new_route_hash_writes,
--          COUNT(*) FILTER (WHERE body_hash     IS NOT NULL) AS new_body_hash_writes,
--          COUNT(*) FILTER (WHERE response_jsonb IS NOT NULL) AS new_response_jsonb_writes
--     FROM public.idempotency_keys;
--   -- → all zeros (table is currently empty; 24h key expiry has rolled all
--   --   rows out since the last Wave 5 batch).
--
-- After this drop, the post-state shape of `idempotency_keys` is the canonical
-- Wave 1 architecture-spec set: (key, user_id, org_id, route_hash, body_hash,
-- status_code, response_jsonb, created_at). PK remains `(key, user_id)` —
-- widening to `(key, user_id, org_id)` (R-W1-04) is a separate forward-looking
-- change and deliberately out of Wave 6 scope per the dispatch plan.
--
-- The `_shared/idempotency.ts` helper has not written to these columns since
-- the Wave 3 redeploy; this migration is a pure data-shape cleanup with no
-- companion code change required.
--
-- Forward-only.
--
-- Date:     2026-05-16
-- Sub-wave: 6.0a (Wave 6 pre-flight; smallest blast radius, ships first)
-- Closes:   R-W1-05 fully (the legacy idempotency-shape risk).
--
-- DOWN MIGRATION:
--   ALTER TABLE public.idempotency_keys
--     ADD COLUMN endpoint     text NULL DEFAULT '',
--     ADD COLUMN request_hash text NULL DEFAULT '',
--     ADD COLUMN response     jsonb NULL DEFAULT '{}'::jsonb;
--   -- Note: re-adding the legacy trio is sufficient for emergency rollback;
--   --       backfilling historical values is impossible (helper never persisted
--   --       them after 0048 + Wave 3 redeploy).

BEGIN;

-- ---------------------------------------------------------------------------
-- Pre-drop invariant: every legacy column is empty or NULL across all rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_endpoint_writes      bigint;
  v_request_hash_writes  bigint;
  v_response_writes      bigint;
BEGIN
  SELECT COUNT(*) FILTER (WHERE endpoint     IS NOT NULL AND endpoint     <> ''),
         COUNT(*) FILTER (WHERE request_hash IS NOT NULL AND request_hash <> ''),
         COUNT(*) FILTER (WHERE response     IS NOT NULL AND response::text <> '{}')
    INTO v_endpoint_writes, v_request_hash_writes, v_response_writes
    FROM public.idempotency_keys;

  IF v_endpoint_writes <> 0 OR v_request_hash_writes <> 0 OR v_response_writes <> 0 THEN
    RAISE EXCEPTION
      '0053 pre-drop assertion failed: endpoint=% request_hash=% response=% (expected all 0). '
      'A caller is still writing to the legacy idempotency columns; investigate before dropping.',
      v_endpoint_writes, v_request_hash_writes, v_response_writes;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Drop the legacy trio.
-- ---------------------------------------------------------------------------
ALTER TABLE public.idempotency_keys
  DROP COLUMN endpoint,
  DROP COLUMN request_hash,
  DROP COLUMN response;

-- ---------------------------------------------------------------------------
-- Post-state invariant: the legacy columns are gone; the Wave 1 trio remains.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_legacy_count integer;
  v_modern_count integer;
BEGIN
  SELECT COUNT(*)
    INTO v_legacy_count
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'idempotency_keys'
     AND column_name  IN ('endpoint', 'request_hash', 'response');

  SELECT COUNT(*)
    INTO v_modern_count
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'idempotency_keys'
     AND column_name  IN ('route_hash', 'body_hash', 'response_jsonb');

  IF v_legacy_count <> 0 THEN
    RAISE EXCEPTION
      '0053 post-state assertion failed: legacy columns still present (count=%); expected 0.',
      v_legacy_count;
  END IF;

  IF v_modern_count <> 3 THEN
    RAISE EXCEPTION
      '0053 post-state assertion failed: modern columns count=% (expected 3 — route_hash, body_hash, response_jsonb).',
      v_modern_count;
  END IF;
END $$;

COMMIT;
