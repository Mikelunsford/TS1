-- 0003_projects_bom_ro.sql
-- Purpose: BOM + receiving orders + project state machine extension.
--   Adds project state values, bom_items, receiving_orders, and the
--   receiving-order numbering sequence/function. Extends workflow_transitions
--   CHECK to cover the receiving_order entity type.
-- Date:    2026-05-14
-- Idempotent: ADD VALUE IF NOT EXISTS; CREATE IF NOT EXISTS where possible.
--
-- DOWN MIGRATION:
--   DROP TABLE public.receiving_orders, public.bom_items CASCADE;
--   DROP TYPE  public.receiving_order_state, public.bom_source CASCADE;
--   DROP SEQUENCE public.receiving_order_number_seq;
--   DROP FUNCTION public.next_receiving_order_number();
--   ALTER TYPE public.project_state DROP VALUE 'ready_to_build';
--   ALTER TYPE public.project_state DROP VALUE 'ready_to_ship';

BEGIN;

-- Project state extension (Postgres allows ADD VALUE outside transaction in
-- newer versions; here we commit the type first; we use IF NOT EXISTS).
COMMIT;
BEGIN;

ALTER TYPE public.project_state ADD VALUE IF NOT EXISTS 'ready_to_build';
ALTER TYPE public.project_state ADD VALUE IF NOT EXISTS 'ready_to_ship';

COMMIT;
BEGIN;

DO $$ BEGIN
  CREATE TYPE public.bom_source AS ENUM ('customer_supplied','t1_purchase','from_inventory');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.receiving_order_state AS ENUM ('open','partial','received','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SEQUENCE IF NOT EXISTS public.receiving_order_number_seq;

CREATE OR REPLACE FUNCTION public.next_receiving_order_number()
RETURNS text LANGUAGE sql AS $$
  SELECT 'T1-RO-' || extract(year FROM now())::text || '-' ||
         lpad(nextval('public.receiving_order_number_seq')::text, 4, '0')
$$;

-- Project lifecycle timestamps
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS bom_finalized_at        timestamptz NULL,
  ADD COLUMN IF NOT EXISTS bom_finalized_by        uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ready_to_build_at       timestamptz NULL,
  ADD COLUMN IF NOT EXISTS sent_to_production_at   timestamptz NULL;

-- BOM items ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bom_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  sku          text NULL,
  description  text NOT NULL,
  quantity     numeric(12,3) NOT NULL CHECK (quantity > 0),
  source       public.bom_source NOT NULL,
  vendor       text NULL,
  unit_cost    numeric(12,2) NULL,
  notes        text NULL,
  position     int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bom_items_project ON public.bom_items (project_id);
CREATE TRIGGER trg_bom_items_updated_at
  BEFORE UPDATE ON public.bom_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Receiving orders ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.receiving_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ro_number     text NOT NULL UNIQUE,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  bom_item_id   uuid NULL REFERENCES public.bom_items(id) ON DELETE SET NULL,
  source        public.bom_source NOT NULL
                CHECK (source IN ('customer_supplied','t1_purchase')),
  status        public.receiving_order_state NOT NULL DEFAULT 'open',
  expected_qty  numeric(12,3) NOT NULL CHECK (expected_qty > 0),
  received_qty  numeric(12,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  pallets_in    int NULL,
  vendor        text NULL,
  expected_at   timestamptz NULL,
  notes         text NULL,
  received_at   timestamptz NULL,
  cancelled_at  timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ro_project ON public.receiving_orders (project_id);
CREATE INDEX IF NOT EXISTS idx_ro_status ON public.receiving_orders (status);
CREATE INDEX IF NOT EXISTS idx_ro_expected_at ON public.receiving_orders (expected_at);
CREATE INDEX IF NOT EXISTS idx_ro_bom_item ON public.receiving_orders (bom_item_id);

CREATE TRIGGER trg_receiving_orders_updated_at
  BEFORE UPDATE ON public.receiving_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Extend workflow_transitions to cover the new entity type.
ALTER TABLE public.workflow_transitions DROP CONSTRAINT IF EXISTS workflow_transitions_entity_type_check;
ALTER TABLE public.workflow_transitions
  ADD CONSTRAINT workflow_transitions_entity_type_check
  CHECK (entity_type IN ('quote','project','receiving_order'));

-- RLS
ALTER TABLE public.bom_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receiving_orders  ENABLE ROW LEVEL SECURITY;

CREATE POLICY bom_select_management ON public.bom_items
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'management');

CREATE POLICY ro_select_management ON public.receiving_orders
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'management');

COMMIT;
