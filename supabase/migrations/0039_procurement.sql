-- 0039_procurement.sql
-- Purpose: Procurement primitives. purchase_orders, po_line_items, vendor_bills.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.vendor_bills, public.po_line_items, public.purchase_orders CASCADE;

BEGIN;

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  po_number         text NOT NULL,
  vendor_id         uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  project_id        uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN
                      ('draft','submitted','approved','partial_received','received','cancelled','closed')),
  issue_date        date NOT NULL DEFAULT current_date,
  expected_date     date NULL,
  currency_code     text NOT NULL DEFAULT 'USD' REFERENCES public.currencies(code),
  subtotal_cents    bigint NOT NULL DEFAULT 0,
  tax_cents         bigint NOT NULL DEFAULT 0,
  shipping_cents    bigint NOT NULL DEFAULT 0,
  total_cents       bigint NOT NULL DEFAULT 0,
  notes             text NULL,
  state_changed_at  timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL REFERENCES auth.users(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid NULL REFERENCES auth.users(id),
  deleted_at        timestamptz NULL,
  UNIQUE (org_id, po_number)
);
CREATE INDEX IF NOT EXISTS idx_po_org_status ON public.purchase_orders (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_po_vendor ON public.purchase_orders (vendor_id);
CREATE TRIGGER trg_po_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_po_state_changed_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.set_state_changed_at();

CREATE TABLE IF NOT EXISTS public.po_line_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  po_id              uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  item_id            uuid NULL REFERENCES public.pricing_menu(id) ON DELETE SET NULL,
  description        text NOT NULL,
  quantity           numeric(14,4) NOT NULL CHECK (quantity > 0),
  quantity_received  numeric(14,4) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  unit               text NULL,
  unit_cost_cents    bigint NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  line_total_cents   bigint NOT NULL DEFAULT 0 CHECK (line_total_cents >= 0),
  position           int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_poli_po ON public.po_line_items (po_id);
CREATE TRIGGER trg_poli_updated_at
  BEFORE UPDATE ON public.po_line_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.vendor_bills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  bill_number     text NOT NULL,
  vendor_id       uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  po_id           uuid NULL REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  vendor_ref      text NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN
                    ('draft','pending','approved','partially_paid','paid','overdue','cancelled')),
  issue_date      date NOT NULL DEFAULT current_date,
  due_date        date NOT NULL,
  currency_code   text NOT NULL DEFAULT 'USD' REFERENCES public.currencies(code),
  subtotal_cents  bigint NOT NULL DEFAULT 0,
  tax_cents       bigint NOT NULL DEFAULT 0,
  total_cents     bigint NOT NULL DEFAULT 0,
  paid_cents      bigint NOT NULL DEFAULT 0,
  balance_cents   bigint GENERATED ALWAYS AS (total_cents - paid_cents) STORED,
  notes           text NULL,
  approved_at     timestamptz NULL,
  approved_by     uuid NULL REFERENCES auth.users(id),
  paid_at         timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL REFERENCES auth.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NULL REFERENCES auth.users(id),
  deleted_at      timestamptz NULL,
  UNIQUE (org_id, bill_number)
);
CREATE INDEX IF NOT EXISTS idx_vendor_bills_org_status ON public.vendor_bills (org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_bills_vendor ON public.vendor_bills (vendor_id);
CREATE TRIGGER trg_vendor_bills_updated_at
  BEFORE UPDATE ON public.vendor_bills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_line_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_bills    ENABLE ROW LEVEL SECURITY;

COMMIT;
