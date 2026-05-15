-- 0008_audit_indexes_and_rpc.sql
-- Purpose: Indexes on workflow_transitions; replace_quote_line_items
--   SECURITY DEFINER RPC; quote_line_items non-negative line_total CHECK.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP FUNCTION public.replace_quote_line_items(uuid, jsonb);
--   DROP INDEX public.idx_transitions_triggered_at,
--              public.idx_transitions_triggered_by,
--              public.idx_transitions_entity_time,
--              public.idx_idempotency_created_at;

BEGIN;

CREATE INDEX IF NOT EXISTS idx_transitions_triggered_at
  ON public.workflow_transitions (triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_transitions_triggered_by
  ON public.workflow_transitions (triggered_by) WHERE triggered_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transitions_entity_time
  ON public.workflow_transitions (entity_type, entity_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_idempotency_created_at
  ON public.idempotency_keys (created_at);

-- Non-negative invariant on quote_line_items.line_total.
ALTER TABLE public.quote_line_items
  DROP CONSTRAINT IF EXISTS quote_line_items_line_total_nonneg;
ALTER TABLE public.quote_line_items
  ADD CONSTRAINT quote_line_items_line_total_nonneg
  CHECK (line_total IS NULL OR line_total >= 0);

-- Atomic line-item replacement RPC. Snapshots fields from the JSONB input.
CREATE OR REPLACE FUNCTION public.replace_quote_line_items(
  p_quote_id uuid, p_lines jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'p_lines must be a JSON array';
  END IF;

  DELETE FROM public.quote_line_items WHERE quote_id = p_quote_id;

  FOR r IN SELECT jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.quote_line_items (
      quote_id, pricing_item_id, description, quantity,
      unit, unit_price, unit_cost, line_total, position
    ) VALUES (
      p_quote_id,
      NULLIF(r->>'pricing_item_id','')::uuid,
      r->>'description',
      (r->>'quantity')::numeric,
      r->>'unit',
      NULLIF(r->>'unit_price','')::numeric,
      NULLIF(r->>'unit_cost','')::numeric,
      NULLIF(r->>'line_total','')::numeric,
      COALESCE((r->>'position')::int, 0)
    );
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.replace_quote_line_items(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.replace_quote_line_items(uuid, jsonb) TO service_role;

COMMIT;
