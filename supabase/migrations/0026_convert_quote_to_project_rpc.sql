-- 0026_convert_quote_to_project_rpc.sql
-- Purpose: Atomic convert_quote_to_project RPC. Allocates a project_number,
--   inserts a projects row from the quote header, and pivots the quote
--   status to 'project_pending'. Service-role only. Amended in 0033 to
--   route numbering through next_doc_number() and stamp org_id.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP FUNCTION public.convert_quote_to_project(uuid, text, timestamptz);

BEGIN;

CREATE OR REPLACE FUNCTION public.convert_quote_to_project(
  p_quote_id uuid, p_project_name text, p_due_date timestamptz
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_project_id uuid; v_number text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.quotes WHERE id = p_quote_id) THEN
    RAISE EXCEPTION 'quote % not found', p_quote_id;
  END IF;
  v_number := public.next_project_number();

  INSERT INTO public.projects (
    id, project_number, quote_id, customer_id, customer_name, name,
    status, total, due_date
  )
  SELECT gen_random_uuid(), v_number, q.id, q.customer_id, q.customer_name,
         p_project_name, 'pending', q.total, p_due_date
    FROM public.quotes q
   WHERE q.id = p_quote_id
  RETURNING id INTO v_project_id;

  UPDATE public.quotes
     SET project_id = v_project_id,
         status     = 'project_pending'
   WHERE id = p_quote_id;

  RETURN v_project_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.convert_quote_to_project(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.convert_quote_to_project(uuid, text, timestamptz) TO service_role;

COMMIT;
