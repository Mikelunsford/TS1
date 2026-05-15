-- 0038_inventory.sql
-- Purpose: Inventory primitives. item_categories, units, warehouses,
--   stock_levels, stock_movements. Backfill nothing (net-new). Link
--   pricing_menu (the legacy items table) to unit_id, category_id, tax_id,
--   and add inventory flags.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.stock_movements, public.stock_levels, public.warehouses,
--              public.units, public.item_categories CASCADE;
--   ALTER TABLE public.pricing_menu DROP COLUMN unit_id, ...;

BEGIN;

CREATE TABLE IF NOT EXISTS public.item_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  code       text NOT NULL,
  label      text NOT NULL,
  parent_id  uuid NULL REFERENCES public.item_categories(id) ON DELETE SET NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users(id),
  UNIQUE (org_id, code)
);
CREATE TRIGGER trg_item_categories_updated_at
  BEFORE UPDATE ON public.item_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.units (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  code       text NOT NULL,
  label      text NOT NULL,
  family     text NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users(id),
  UNIQUE (org_id, code)
);
CREATE TRIGGER trg_units_updated_at
  BEFORE UPDATE ON public.units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.warehouses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  code       text NOT NULL,
  label      text NOT NULL,
  address    jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users(id),
  UNIQUE (org_id, code)
);
CREATE TRIGGER trg_warehouses_updated_at
  BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.stock_levels (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  item_id            uuid NOT NULL REFERENCES public.pricing_menu(id) ON DELETE CASCADE,
  warehouse_id       uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  quantity_on_hand   numeric(14,4) NOT NULL DEFAULT 0,
  quantity_reserved  numeric(14,4) NOT NULL DEFAULT 0,
  quantity_available numeric(14,4) GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) STORED,
  last_counted_at    timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  item_id         uuid NOT NULL REFERENCES public.pricing_menu(id) ON DELETE RESTRICT,
  warehouse_id    uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  movement_type   text NOT NULL CHECK (movement_type IN
                    ('receipt','shipment','adjustment','transfer_in','transfer_out','consumption','return')),
  quantity        numeric(14,4) NOT NULL,
  unit_cost_cents bigint NOT NULL DEFAULT 0,
  reference_type  text NULL CHECK (reference_type IS NULL OR reference_type IN
                    ('receiving_order','shipment','production_consumption','purchase_order','manual')),
  reference_id    uuid NULL,
  notes           text NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_date
  ON public.stock_movements (item_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_reference
  ON public.stock_movements (reference_type, reference_id) WHERE reference_id IS NOT NULL;

-- Link items (pricing_menu) to unit/category/tax + inventory flags.
ALTER TABLE public.pricing_menu
  ADD COLUMN IF NOT EXISTS unit_id        uuid NULL REFERENCES public.units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_id    uuid NULL REFERENCES public.item_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_id         uuid NULL REFERENCES public.taxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_inventoried boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reorder_point  numeric(14,4) NULL,
  ADD COLUMN IF NOT EXISTS created_by     uuid NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_by     uuid NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS deleted_at     timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_items_org_active ON public.pricing_menu (org_id) WHERE is_active AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_items_category ON public.pricing_menu (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_inventoried ON public.pricing_menu (org_id) WHERE is_inventoried;

ALTER TABLE public.item_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_levels     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements  ENABLE ROW LEVEL SECURITY;

COMMIT;
