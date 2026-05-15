-- 0012_quote_versions.sql
-- Purpose: Quote v1 mirror table + mirror triggers. The trigger pair catches
--   every write path uniformly (per TS audit §2.6). Trigger bodies are
--   CREATE OR REPLACEd in later migrations to add columns.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TRIGGER trg_quotes_mirror_to_version_ins ON public.quotes;
--   DROP TRIGGER trg_quotes_mirror_to_version_upd ON public.quotes;
--   DROP TRIGGER trg_qli_fill_version_id ON public.quote_line_items;
--   DROP FUNCTION public.create_v1_for_quote(),
--                 public.mirror_quote_to_current_version(),
--                 public.fill_line_item_version_id();
--   DROP TABLE public.quote_versions CASCADE;
--   ALTER TABLE public.quote_line_items DROP COLUMN quote_version_id;

BEGIN;

CREATE TABLE IF NOT EXISTS public.quote_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id       uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  status         public.quote_state NOT NULL,
  service_type   public.service_type NOT NULL,
  subtotal       numeric(12,2) NOT NULL DEFAULT 0,
  total          numeric(12,2) NOT NULL DEFAULT 0,
  notes          text NULL,
  valid_until    timestamptz NULL,
  inputs_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by     uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_qv_quote_version
  ON public.quote_versions (quote_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_qv_status ON public.quote_versions (status);

ALTER TABLE public.quote_line_items
  ADD COLUMN IF NOT EXISTS quote_version_id uuid NULL REFERENCES public.quote_versions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_qli_quote_version
  ON public.quote_line_items (quote_version_id) WHERE quote_version_id IS NOT NULL;

-- Mirror trigger functions (SECURITY DEFINER per TS pattern) --------------

CREATE OR REPLACE FUNCTION public.create_v1_for_quote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.quote_versions (
    quote_id, version_number, status, service_type,
    subtotal, total, notes, valid_until, created_by
  ) VALUES (
    NEW.id, 1, NEW.status, NEW.service_type,
    NEW.subtotal, NEW.total, NEW.notes, NEW.valid_until, NEW.created_by
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.mirror_quote_to_current_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id
    FROM public.quote_versions
   WHERE quote_id = NEW.id
   ORDER BY version_number DESC
   LIMIT 1;
  IF v_id IS NULL THEN
    -- safety net: create v1
    INSERT INTO public.quote_versions (
      quote_id, version_number, status, service_type,
      subtotal, total, notes, valid_until, created_by
    ) VALUES (
      NEW.id, 1, NEW.status, NEW.service_type,
      NEW.subtotal, NEW.total, NEW.notes, NEW.valid_until, NEW.created_by
    );
  ELSE
    UPDATE public.quote_versions SET
      status = NEW.status,
      service_type = NEW.service_type,
      subtotal = NEW.subtotal,
      total = NEW.total,
      notes = NEW.notes,
      valid_until = NEW.valid_until
    WHERE id = v_id;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fill_line_item_version_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NEW.quote_version_id IS NULL THEN
    SELECT id INTO v_id FROM public.quote_versions
      WHERE quote_id = NEW.quote_id
      ORDER BY version_number DESC LIMIT 1;
    NEW.quote_version_id := v_id;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_v1_for_quote() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mirror_quote_to_current_version() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fill_line_item_version_id() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_v1_for_quote() TO service_role;
GRANT  EXECUTE ON FUNCTION public.mirror_quote_to_current_version() TO service_role;
GRANT  EXECUTE ON FUNCTION public.fill_line_item_version_id() TO service_role;

CREATE TRIGGER trg_quotes_mirror_to_version_ins
  AFTER INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.create_v1_for_quote();
CREATE TRIGGER trg_quotes_mirror_to_version_upd
  AFTER UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.mirror_quote_to_current_version();
CREATE TRIGGER trg_qli_fill_version_id
  BEFORE INSERT ON public.quote_line_items
  FOR EACH ROW EXECUTE FUNCTION public.fill_line_item_version_id();

-- Invariant: every existing quote gets v1 backfilled if missing.
INSERT INTO public.quote_versions (quote_id, version_number, status, service_type, subtotal, total, notes, valid_until, created_by)
SELECT q.id, 1, q.status, q.service_type, q.subtotal, q.total, q.notes, q.valid_until, q.created_by
  FROM public.quotes q
 WHERE NOT EXISTS (SELECT 1 FROM public.quote_versions v WHERE v.quote_id = q.id);

DO $$
DECLARE q_count int; v_count int;
BEGIN
  SELECT count(*) INTO q_count FROM public.quotes;
  SELECT count(DISTINCT quote_id) INTO v_count FROM public.quote_versions;
  IF q_count <> v_count THEN
    RAISE EXCEPTION 'quote_versions backfill drift: quotes=%, versions=%', q_count, v_count;
  END IF;
END $$;

ALTER TABLE public.quote_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY qv_select_management ON public.quote_versions
  FOR SELECT TO authenticated USING (public.current_user_role() = 'management');
CREATE POLICY qv_select_customer ON public.quote_versions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotes q
     WHERE q.id = quote_versions.quote_id
       AND q.customer_id = public.current_user_customer_id()
       AND q.status IN ('submitted','approved','project_pending','cancelled')
  ));

COMMIT;
