-- 0015_pricing_tiers_and_kinds.sql
-- Purpose: pricing_menu.item_kind text + markup_pct + pricing_tiers table.
--   item_kind is a plain text CHECK rather than an enum so future kinds can
--   land without a type rewrite.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.pricing_tiers CASCADE;
--   ALTER TABLE public.pricing_menu DROP COLUMN item_kind, DROP COLUMN markup_pct;

BEGIN;

ALTER TABLE public.pricing_menu
  ADD COLUMN IF NOT EXISTS item_kind text NOT NULL DEFAULT 'material'
    CHECK (item_kind IN ('labor','material','pass_through','fee','service'));
ALTER TABLE public.pricing_menu
  ADD COLUMN IF NOT EXISTS markup_pct numeric(5,4) NULL CHECK (markup_pct IS NULL OR markup_pct >= 0);

CREATE TABLE IF NOT EXISTS public.pricing_tiers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_item_id uuid NOT NULL REFERENCES public.pricing_menu(id) ON DELETE CASCADE,
  min_qty         numeric(12,3) NOT NULL CHECK (min_qty >= 0),
  max_qty         numeric(12,3) NULL CHECK (max_qty IS NULL OR max_qty > min_qty),
  unit_price      numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  unit_cost       numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
  label           text NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pricing_tiers_item_min
  ON public.pricing_tiers (pricing_item_id, min_qty);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_tiers_item_min_unique
  ON public.pricing_tiers (pricing_item_id, min_qty);

ALTER TABLE public.pricing_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY pricing_tiers_select_all ON public.pricing_tiers
  FOR SELECT TO authenticated USING (true);

COMMIT;
