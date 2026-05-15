-- 0006_customer_intake.sql
-- Purpose: Customer-initiated quote drafts. Nullable pricing fields on
--   quote_line_items so customers can draft without prices. New
--   quote_origin enum and quotes.origin column. RLS for customer write on
--   draft + customer-intake origin.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP POLICY quotes_insert_customer_intake ON public.quotes;
--   DROP POLICY quotes_update_customer_draft ON public.quotes;
--   DROP POLICY qli_write_customer_draft ON public.quote_line_items;
--   ALTER TABLE public.quotes DROP COLUMN origin;
--   DROP TYPE public.quote_origin CASCADE;
--   ALTER TABLE public.quote_line_items ALTER COLUMN unit_price SET NOT NULL,
--     ALTER COLUMN unit_cost SET NOT NULL, ALTER COLUMN line_total SET NOT NULL,
--     ALTER COLUMN unit SET NOT NULL;

BEGIN;

DO $$ BEGIN
  CREATE TYPE public.quote_origin AS ENUM ('management','customer_intake');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS origin public.quote_origin NOT NULL DEFAULT 'management';

CREATE INDEX IF NOT EXISTS idx_quotes_origin ON public.quotes (origin);

-- Relax line-item pricing so customer drafts can omit prices.
ALTER TABLE public.quote_line_items
  ADD COLUMN IF NOT EXISTS unit text NULL;

ALTER TABLE public.quote_line_items ALTER COLUMN unit_price DROP NOT NULL;
ALTER TABLE public.quote_line_items ALTER COLUMN unit_cost  DROP NOT NULL;
ALTER TABLE public.quote_line_items ALTER COLUMN line_total DROP NOT NULL;
ALTER TABLE public.quote_line_items ALTER COLUMN unit_price DROP DEFAULT;
ALTER TABLE public.quote_line_items ALTER COLUMN unit_cost  DROP DEFAULT;
ALTER TABLE public.quote_line_items ALTER COLUMN line_total DROP DEFAULT;

-- Customer write surface ---------------------------------------------------

CREATE POLICY quotes_insert_customer_intake ON public.quotes
  FOR INSERT TO authenticated
  WITH CHECK (
    customer_id = public.current_user_customer_id()
    AND status = 'draft'
    AND origin = 'customer_intake'
  );

CREATE POLICY quotes_update_customer_draft ON public.quotes
  FOR UPDATE TO authenticated
  USING (customer_id = public.current_user_customer_id() AND status = 'draft')
  WITH CHECK (customer_id = public.current_user_customer_id() AND status = 'draft');

CREATE POLICY qli_write_customer_draft ON public.quote_line_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotes q
     WHERE q.id = quote_line_items.quote_id
       AND q.customer_id = public.current_user_customer_id()
       AND q.status = 'draft'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.quotes q
     WHERE q.id = quote_line_items.quote_id
       AND q.customer_id = public.current_user_customer_id()
       AND q.status = 'draft'
  ));

COMMIT;
