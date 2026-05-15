-- 0048_idempotency_legacy_nullable.sql
-- Wave 2 (CRM Core) — bridge migration: relax NOT NULL on the three legacy
-- `idempotency_keys` columns (`endpoint`, `request_hash`, `response`) so the
-- _shared/idempotency.ts helper can stop writing them.
--
-- The architecture-spec columns (`route_hash`, `body_hash`, `response_jsonb`)
-- carry the same semantic values and are the canonical store going forward.
--
-- Why two-step deprecation:
--   Step 1 (THIS PR): drop NOT NULL on legacy columns + patch helper to stop
--     writing them. Order is safe because migrate.yml applies migrations BEFORE
--     deploy-functions.yml redeploys the helper.
--   Step 2 (future PR after this is live in prod for one release cycle): drop
--     the legacy columns outright. See R-W1-05 in the wave-1 closeout journal.
--
-- Date: 2026-05-15
--
-- DOWN MIGRATION:
--   First repopulate any NULLs (rare; only rows written between deploy of
--   this migration and the helper update), then re-add NOT NULL:
--   UPDATE public.idempotency_keys SET endpoint = ''   WHERE endpoint IS NULL;
--   UPDATE public.idempotency_keys SET request_hash = '' WHERE request_hash IS NULL;
--   UPDATE public.idempotency_keys SET response = '{}'::jsonb WHERE response IS NULL;
--   ALTER TABLE public.idempotency_keys
--     ALTER COLUMN endpoint     SET NOT NULL,
--     ALTER COLUMN request_hash SET NOT NULL,
--     ALTER COLUMN response     SET NOT NULL;

BEGIN;

ALTER TABLE public.idempotency_keys
  ALTER COLUMN endpoint     DROP NOT NULL,
  ALTER COLUMN request_hash DROP NOT NULL,
  ALTER COLUMN response     DROP NOT NULL;

COMMIT;
