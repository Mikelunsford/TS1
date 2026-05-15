-- 0005_shipments.sql
-- Purpose: shipments + project_dispositions + shipment numbering + project
--   lifecycle ready_to_ship / shipping_completed timestamps. Extends
--   workflow_transitions CHECK with 'shipment'.
-- Date:    2026-05-14
-- Idempotent.
--
-- DOWN MIGRATION:
--   DROP TABLE public.project_dispositions, public.shipments CASCADE;
--   DROP TYPE  public.shipment_state, public.disposition_reason CASCADE;
--   DROP SEQUENCE public.shipment_number_seq;
--   DROP FUNCTION public.next_shipment_number();

BEGIN;

DO $$ BEGIN
  CREATE TYPE public.shipment_state AS ENUM ('scheduled','loading','shipped','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.disposition_reason AS ENUM (
    'scrap','restock','return_to_customer_credit','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SEQUENCE IF NOT EXISTS public.shipment_number_seq;

CREATE OR REPLACE FUNCTION public.next_shipment_number()
RETURNS text LANGUAGE sql AS $$
  SELECT 'T1-SH-' || extract(year FROM now())::text || '-' ||
         lpad(nextval('public.shipment_number_seq')::text, 4, '0')
$$;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS ready_to_ship_at        timestamptz NULL,
  ADD COLUMN IF NOT EXISTS shipping_completed_at   timestamptz NULL;

CREATE TABLE IF NOT EXISTS public.shipments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_number      text NOT NULL UNIQUE,
  project_id           uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status               public.shipment_state NOT NULL DEFAULT 'scheduled',
  qty_shipped          numeric(12,3) NOT NULL CHECK (qty_shipped > 0),
  carrier_name         text NOT NULL CHECK (length(btrim(carrier_name)) > 0),
  tracking_number      text NULL,
  scheduled_pickup_at  timestamptz NULL,
  loading_started_at   timestamptz NULL,
  shipped_at           timestamptz NULL,
  cancelled_at         timestamptz NULL,
  cancellation_reason  text NULL,
  notes                text NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shipments_project ON public.shipments (project_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON public.shipments (status);
CREATE INDEX IF NOT EXISTS idx_shipments_scheduled_pickup ON public.shipments (scheduled_pickup_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_shipment_per_project
  ON public.shipments (project_id)
  WHERE status NOT IN ('shipped','cancelled');

CREATE TRIGGER trg_shipments_updated_at
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.project_dispositions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  qty_remaining       numeric(12,3) NOT NULL CHECK (qty_remaining >= 0),
  disposition_reason  public.disposition_reason NOT NULL,
  disposition_note    text NULL,
  disposed_at         timestamptz NOT NULL DEFAULT now(),
  disposed_by         uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispositions_project ON public.project_dispositions (project_id);

ALTER TABLE public.workflow_transitions DROP CONSTRAINT IF EXISTS workflow_transitions_entity_type_check;
ALTER TABLE public.workflow_transitions
  ADD CONSTRAINT workflow_transitions_entity_type_check
  CHECK (entity_type IN ('quote','project','receiving_order','production_run','shipment'));

ALTER TABLE public.shipments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_dispositions   ENABLE ROW LEVEL SECURITY;

CREATE POLICY shipments_select_management ON public.shipments
  FOR SELECT TO authenticated USING (public.current_user_role() = 'management');
CREATE POLICY shipments_select_customer ON public.shipments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = shipments.project_id
      AND p.customer_id = public.current_user_customer_id()
  ));

CREATE POLICY pdisp_select_management ON public.project_dispositions
  FOR SELECT TO authenticated USING (public.current_user_role() = 'management');

COMMIT;
