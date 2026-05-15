-- 0018_quote_approvals.sql
-- Purpose: requires_approval boolean on quotes and quote_versions, plus the
--   set_quote_requires_approval trigger ($25k threshold). The
--   quote_approvals table this migration originally added is dropped by
--   0028, so we do NOT recreate it here.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TRIGGER trg_quotes_requires_approval_ins ON public.quotes;
--   DROP TRIGGER trg_quotes_requires_approval_upd ON public.quotes;
--   DROP FUNCTION public.set_quote_requires_approval();
--   ALTER TABLE public.quote_versions DROP COLUMN requires_approval;
--   ALTER TABLE public.quotes DROP COLUMN requires_approval;

BEGIN;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;
ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_quote_requires_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.requires_approval := COALESCE(NEW.total, 0) > 25000;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_quote_requires_approval() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_quote_requires_approval() TO service_role;

CREATE TRIGGER trg_quotes_requires_approval_ins
  BEFORE INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_quote_requires_approval();
CREATE TRIGGER trg_quotes_requires_approval_upd
  BEFORE UPDATE OF total ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_quote_requires_approval();

-- Mirror trigger update to copy requires_approval into quote_versions.

CREATE OR REPLACE FUNCTION public.create_v1_for_quote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
BEGIN
  INSERT INTO public.quote_versions (
    quote_id, version_number, status, service_type,
    subtotal, total, notes, valid_until, created_by, job_type_id, inputs_json, requires_approval
  ) VALUES (
    NEW.id, 1, NEW.status, NEW.service_type,
    NEW.subtotal, NEW.total, NEW.notes, NEW.valid_until, NEW.created_by, NEW.job_type_id, NEW.inputs_json, NEW.requires_approval
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
      subtotal, total, notes, valid_until, created_by, job_type_id, inputs_json, requires_approval
    ) VALUES (
      NEW.id, 1, NEW.status, NEW.service_type,
      NEW.subtotal, NEW.total, NEW.notes, NEW.valid_until, NEW.created_by, NEW.job_type_id, NEW.inputs_json, NEW.requires_approval
    );
  ELSE
    UPDATE public.quote_versions SET
      status = NEW.status, service_type = NEW.service_type,
      subtotal = NEW.subtotal, total = NEW.total,
      notes = NEW.notes, valid_until = NEW.valid_until,
      job_type_id = NEW.job_type_id, inputs_json = NEW.inputs_json,
      requires_approval = NEW.requires_approval
    WHERE id = v_id;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_v1_for_quote()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mirror_quote_to_current_version() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_v1_for_quote()             TO service_role;
GRANT  EXECUTE ON FUNCTION public.mirror_quote_to_current_version() TO service_role;

COMMIT;
