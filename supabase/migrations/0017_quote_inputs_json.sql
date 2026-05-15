-- 0017_quote_inputs_json.sql
-- Purpose: quotes.inputs_json jsonb + mirror trigger update.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   ALTER TABLE public.quotes DROP COLUMN inputs_json;

BEGIN;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS inputs_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.create_v1_for_quote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
BEGIN
  INSERT INTO public.quote_versions (
    quote_id, version_number, status, service_type,
    subtotal, total, notes, valid_until, created_by, job_type_id, inputs_json
  ) VALUES (
    NEW.id, 1, NEW.status, NEW.service_type,
    NEW.subtotal, NEW.total, NEW.notes, NEW.valid_until, NEW.created_by, NEW.job_type_id, NEW.inputs_json
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.mirror_quote_to_current_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.quote_versions
    WHERE quote_id = NEW.id ORDER BY version_number DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.quote_versions (
      quote_id, version_number, status, service_type,
      subtotal, total, notes, valid_until, created_by, job_type_id, inputs_json
    ) VALUES (
      NEW.id, 1, NEW.status, NEW.service_type,
      NEW.subtotal, NEW.total, NEW.notes, NEW.valid_until, NEW.created_by, NEW.job_type_id, NEW.inputs_json
    );
  ELSE
    UPDATE public.quote_versions SET
      status = NEW.status, service_type = NEW.service_type,
      subtotal = NEW.subtotal, total = NEW.total,
      notes = NEW.notes, valid_until = NEW.valid_until,
      job_type_id = NEW.job_type_id, inputs_json = NEW.inputs_json
    WHERE id = v_id;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_v1_for_quote()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mirror_quote_to_current_version() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_v1_for_quote()             TO service_role;
GRANT  EXECUTE ON FUNCTION public.mirror_quote_to_current_version() TO service_role;

COMMIT;
