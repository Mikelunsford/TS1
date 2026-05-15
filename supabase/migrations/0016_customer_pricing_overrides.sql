-- 0016_customer_pricing_overrides.sql
-- Purpose: Per-customer price-or-markup override with XOR CHECK.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.customer_pricing_overrides CASCADE;

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_pricing_overrides (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  pricing_item_id       uuid NOT NULL REFERENCES public.pricing_menu(id) ON DELETE CASCADE,
  override_unit_price   numeric(12,2) NULL CHECK (override_unit_price IS NULL OR override_unit_price >= 0),
  override_markup_pct   numeric(5,4) NULL CHECK (override_markup_pct IS NULL OR override_markup_pct >= 0),
  effective_from        timestamptz NOT NULL DEFAULT now(),
  effective_until       timestamptz NULL,
  notes                 text NULL,
  created_by            uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cpo_price_or_markup_xor
    CHECK ((override_unit_price IS NOT NULL)::int + (override_markup_pct IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS idx_customer_pricing_overrides_customer_item
  ON public.customer_pricing_overrides (customer_id, pricing_item_id);

ALTER TABLE public.customer_pricing_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY cpo_select_management ON public.customer_pricing_overrides
  FOR SELECT TO authenticated USING (public.current_user_role() = 'management');
CREATE POLICY cpo_select_customer ON public.customer_pricing_overrides
  FOR SELECT TO authenticated
  USING (customer_id = public.current_user_customer_id());

COMMIT;
