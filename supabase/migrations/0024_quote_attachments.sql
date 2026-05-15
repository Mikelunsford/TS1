-- 0024_quote_attachments.sql
-- Purpose: Dedicated quote_attachments table. Storage bucket
--   'quote-attachments' is created lazily by the Edge Function on first
--   upload (not in this migration). The table is preserved through 0036
--   where it is migrated to rows in the new generic 'attachments' table
--   plus a view of the same name.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.quote_attachments CASCADE;

BEGIN;

CREATE TABLE IF NOT EXISTS public.quote_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id     uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  uploaded_by  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name    text NOT NULL,
  file_path    text NOT NULL,
  mime_type    text NULL,
  size_bytes   bigint NULL CHECK (size_bytes IS NULL OR size_bytes >= 0),
  category     text NULL,
  notes        text NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_attachments_quote
  ON public.quote_attachments (quote_id);

ALTER TABLE public.quote_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY qatt_select_management ON public.quote_attachments
  FOR SELECT TO authenticated USING (public.current_user_role() = 'management');
CREATE POLICY qatt_select_customer ON public.quote_attachments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_attachments.quote_id
      AND q.customer_id = public.current_user_customer_id()
  ));

COMMIT;
