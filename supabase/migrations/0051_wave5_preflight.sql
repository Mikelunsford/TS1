-- 0051_wave5_preflight.sql
--
-- Wave 5 pre-flight: drop the dormant `replace_quote_line_items` RPC and add
-- two atomic-shuffle RPCs needed for Phase 8 + the carry-over R-W3-05 close.
--
-- Closes:
--   F-Wave5-04 / R-W4-CO-03 — drop `replace_quote_line_items(uuid, jsonb)`.
--     Wave 4 PR #38 handlers bypassed this RPC (F-Wave4-13). The function
--     still references `quote_line_items.pricing_item_id` which was renamed
--     to `item_id` in migration 0050; calling it would 500 at runtime.
--   F-Wave5-05 (partial) / R-W3-05 — `set_default_tax(p_org_id, p_tax_id)`
--     and `set_default_payment_method(p_org_id, p_method_id)` SECURITY DEFINER
--     RPCs that flip `is_default` atomically within a single transaction.
--     The Wave 3 BE handlers do a two-step UPDATE which races with concurrent
--     writes; these RPCs replace that surface in Wave 6 finance-api refactor.
--     The `convert_lead` RPC stays open as a Wave 6 follow-up (the
--     transactional shuffle that closes R-W2-04 / F-Wave4-04) — it depends on
--     CRM activity-row insert semantics that aren't part of the Wave 5 dispatch.
--
-- Forward-only. No data backfill (the RPCs operate on existing rows live).

BEGIN;

-- ----------------------------------------------------------------------------
-- F-Wave5-04: drop dormant replace_quote_line_items
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.replace_quote_line_items(uuid, jsonb);

-- ----------------------------------------------------------------------------
-- F-Wave5-05 (partial): set_default_tax atomic shuffle
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_default_tax(p_org_id uuid, p_tax_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.taxes
     WHERE id = p_tax_id AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'tax % not found in org %', p_tax_id, p_org_id
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.taxes
     SET is_default = false,
         updated_at = now()
   WHERE org_id = p_org_id
     AND is_default
     AND id <> p_tax_id;

  UPDATE public.taxes
     SET is_default = true,
         updated_at = now()
   WHERE id = p_tax_id;
END $$;

COMMENT ON FUNCTION public.set_default_tax(uuid, uuid) IS
  'F-Wave5-05: atomically flip the org-default tax. Clears prior default '
  'and stamps the new one inside a single transaction; replaces the two-step '
  'UPDATE pattern in finance-api/handlers/taxes.ts that races under concurrent writes.';

REVOKE EXECUTE ON FUNCTION public.set_default_tax(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_default_tax(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- F-Wave5-05 (partial): set_default_payment_method atomic shuffle
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_default_payment_method(p_org_id uuid, p_method_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_methods
     WHERE id = p_method_id AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'payment_method % not found in org %', p_method_id, p_org_id
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.payment_methods
     SET is_default = false,
         updated_at = now()
   WHERE org_id = p_org_id
     AND is_default
     AND id <> p_method_id;

  UPDATE public.payment_methods
     SET is_default = true,
         updated_at = now()
   WHERE id = p_method_id;
END $$;

COMMENT ON FUNCTION public.set_default_payment_method(uuid, uuid) IS
  'F-Wave5-05: atomically flip the org-default payment method. Phase 8 '
  'payments-api consumes this when an admin marks a different method as '
  'default; the uq_payment_methods_default_per_org partial unique index '
  'requires the prior default to be cleared first.';

REVOKE EXECUTE ON FUNCTION public.set_default_payment_method(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_default_payment_method(uuid, uuid) TO service_role;

COMMIT;
