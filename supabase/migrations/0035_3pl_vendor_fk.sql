-- 0035_3pl_vendor_fk.sql
-- Purpose: vendors table + backfill from distinct bom_items.vendor text
--   values + add bom_items.vendor_id FK. Keep bom_items.vendor text column
--   for one release; dropped in 0044.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   ALTER TABLE public.bom_items DROP COLUMN vendor_id;
--   DROP TABLE public.vendors CASCADE;

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendors (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name               text NOT NULL,
  legal_name         text NULL,
  email              citext NULL,
  phone              text NULL,
  website            text NULL,
  tax_id             text NULL,
  currency_code      text NULL REFERENCES public.currencies(code),
  payment_terms_days int NOT NULL DEFAULT 30,
  billing_address    jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_ref       text NULL,
  notes              text NULL,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NULL REFERENCES auth.users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid NULL REFERENCES auth.users(id),
  deleted_at         timestamptz NULL,
  UNIQUE (org_id, name)
);
CREATE INDEX IF NOT EXISTS idx_vendors_org_active
  ON public.vendors (org_id) WHERE is_active AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendors_name_trgm
  ON public.vendors USING gin (name gin_trgm_ops);
CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Backfill: one vendor per distinct (org_id, vendor) tuple from bom_items.
INSERT INTO public.vendors (org_id, name, created_at)
SELECT DISTINCT bi.org_id, btrim(bi.vendor), now()
  FROM public.bom_items bi
 WHERE bi.vendor IS NOT NULL AND btrim(bi.vendor) <> ''
ON CONFLICT (org_id, name) DO NOTHING;

ALTER TABLE public.bom_items
  ADD COLUMN IF NOT EXISTS vendor_id uuid NULL REFERENCES public.vendors(id) ON DELETE SET NULL;

UPDATE public.bom_items bi
   SET vendor_id = v.id
  FROM public.vendors v
 WHERE v.name = btrim(bi.vendor)
   AND v.org_id = bi.org_id
   AND bi.vendor_id IS NULL
   AND bi.vendor IS NOT NULL;

DO $$
DECLARE drift int;
BEGIN
  SELECT count(*) INTO drift FROM public.bom_items
   WHERE vendor IS NOT NULL AND btrim(vendor) <> '' AND vendor_id IS NULL;
  IF drift > 0 THEN
    RAISE EXCEPTION 'vendor backfill drift: % rows still NULL', drift;
  END IF;
END $$;

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

COMMIT;
