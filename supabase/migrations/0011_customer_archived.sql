-- 0011_customer_archived.sql
-- Purpose: customers.is_archived boolean + partial index for active rows.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP INDEX public.idx_customers_active;
--   ALTER TABLE public.customers DROP COLUMN is_archived;

BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_customers_active
  ON public.customers (id) WHERE is_archived = false;

COMMIT;
