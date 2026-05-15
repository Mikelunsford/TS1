-- 0027_va_totals_fold_into_quote.sql
-- Purpose: AFTER INSERT/UPDATE/DELETE trigger on quote_value_added_items that
--   recomputes the parent quotes.subtotal / total by summing line items and
--   value-added items. Updated in 0033 to operate on the cents columns.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TRIGGER trg_qvai_recompute_quote_totals ON public.quote_value_added_items;
--   DROP FUNCTION public.recompute_quote_totals_from_va();

BEGIN;

CREATE OR REPLACE FUNCTION public.recompute_quote_totals_from_va()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_quote_id uuid;
  v_va_total numeric(12,2);
  v_li_total numeric(12,2);
  v_subtotal numeric(12,2);
BEGIN
  SELECT q.id INTO v_quote_id
    FROM public.quote_versions v
    JOIN public.quotes q ON q.id = v.quote_id
   WHERE v.id = COALESCE(NEW.quote_version_id, OLD.quote_version_id);

  IF v_quote_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(computed_total), 0)
    INTO v_va_total
    FROM public.quote_value_added_items vai
    JOIN public.quote_versions v ON v.id = vai.quote_version_id
   WHERE v.quote_id = v_quote_id;

  SELECT COALESCE(SUM(line_total), 0)
    INTO v_li_total
    FROM public.quote_line_items WHERE quote_id = v_quote_id;

  v_subtotal := v_li_total + v_va_total;

  UPDATE public.quotes
     SET subtotal = v_subtotal,
         total    = v_subtotal
   WHERE id = v_quote_id;

  RETURN COALESCE(NEW, OLD);
END $$;

REVOKE EXECUTE ON FUNCTION public.recompute_quote_totals_from_va() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_quote_totals_from_va() TO service_role;

CREATE TRIGGER trg_qvai_recompute_quote_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.quote_value_added_items
  FOR EACH ROW EXECUTE FUNCTION public.recompute_quote_totals_from_va();

COMMIT;
