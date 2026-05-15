-- 0025_quote_modes_and_flags.sql
-- Purpose: quote_mode enum + quotes.mode + quotes.materials_only flag.
--   Mirror trigger body bumped to copy the new columns into quote_versions.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   ALTER TABLE public.quote_versions DROP COLUMN mode, DROP COLUMN materials_only;
--   ALTER TABLE public.quotes DROP COLUMN mode, DROP COLUMN materials_only;
--   DROP TYPE public.quote_mode CASCADE;

BEGIN;

DO $$ BEGIN
  CREATE TYPE public.quote_mode AS ENUM (
    'new_quote','revision','reorder','feasibility_only','scope_shift'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS mode public.quote_mode NOT NULL DEFAULT 'new_quote',
  ADD COLUMN IF NOT EXISTS materials_only boolean NOT NULL DEFAULT false;

ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS mode public.quote_mode NOT NULL DEFAULT 'new_quote',
  ADD COLUMN IF NOT EXISTS materials_only boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.create_v1_for_quote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
BEGIN
  INSERT INTO public.quote_versions (
    quote_id, version_number, status, service_type,
    subtotal, total, notes, valid_until, created_by, job_type_id, inputs_json,
    requires_approval, mode, materials_only
  ) VALUES (
    NEW.id, 1, NEW.status, NEW.service_type,
    NEW.subtotal, NEW.total, NEW.notes, NEW.valid_until, NEW.created_by, NEW.job_type_id, NEW.inputs_json,
    NEW.requires_approval, NEW.mode, NEW.materials_only
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
      subtotal, total, notes, valid_until, created_by, job_type_id, inputs_json,
      requires_approval, mode, materials_only
    ) VALUES (
      NEW.id, 1, NEW.status, NEW.service_type,
      NEW.subtotal, NEW.total, NEW.notes, NEW.valid_until, NEW.created_by, NEW.job_type_id, NEW.inputs_json,
      NEW.requires_approval, NEW.mode, NEW.materials_only
    );
  ELSE
    UPDATE public.quote_versions SET
      status = NEW.status, service_type = NEW.service_type,
      subtotal = NEW.subtotal, total = NEW.total,
      notes = NEW.notes, valid_until = NEW.valid_until,
      job_type_id = NEW.job_type_id, inputs_json = NEW.inputs_json,
      requires_approval = NEW.requires_approval,
      mode = NEW.mode, materials_only = NEW.materials_only
    WHERE id = v_id;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_v1_for_quote()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mirror_quote_to_current_version() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_v1_for_quote()             TO service_role;
GRANT  EXECUTE ON FUNCTION public.mirror_quote_to_current_version() TO service_role;

COMMIT;
