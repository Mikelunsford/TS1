-- 0023_menu_expansion_and_value_added.sql
-- Purpose: Expand pricing menu with co-pack and pallet-storage SKUs.
--   Create pallet_size_kinds and value_added_kinds catalogs.
--   Create quote_value_added_items linked to quote_versions. Add the 13th
--   job_type (pallet_storage_standalone). One value-added kind
--   (rush_surcharge) seeded here is dropped by 0028.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   DROP TABLE public.quote_value_added_items CASCADE;
--   DROP TABLE public.value_added_kinds CASCADE;
--   DROP TABLE public.pallet_size_kinds CASCADE;

BEGIN;

CREATE TABLE IF NOT EXISTS public.pallet_size_kinds (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  multiplier  numeric(8,4) NOT NULL DEFAULT 1.0,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.pallet_size_kinds (code, label, multiplier, sort_order) VALUES
  ('standard',  'Standard 48x40',    1.00, 10),
  ('oversized', 'Oversized 48x48',   1.25, 20),
  ('xl',        'XL 60x48',          1.50, 30),
  ('jumbo',     'Jumbo 72x48',       2.00, 40)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.value_added_kinds (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  description text NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.value_added_kinds (code, label, description) VALUES
  ('pallet_storage', 'Pallet Storage',  'Per-month-per-pallet storage charge'),
  ('rush_surcharge', 'Rush Surcharge',  'Surcharge for rush turnaround') -- dropped in 0028
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.quote_value_added_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_version_id uuid NOT NULL REFERENCES public.quote_versions(id) ON DELETE CASCADE,
  kind             text NOT NULL REFERENCES public.value_added_kinds(code) ON DELETE RESTRICT,
  inputs_json      jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_total   numeric(12,2) NOT NULL DEFAULT 0 CHECK (computed_total >= 0),
  computed_cost    numeric(12,2) NOT NULL DEFAULT 0 CHECK (computed_cost >= 0),
  notes            text NULL,
  position         int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qvai_version ON public.quote_value_added_items (quote_version_id);

-- Pricing menu expansion (23 new SKUs).
INSERT INTO public.pricing_menu (item_code, description, category, unit_price, unit_cost, item_kind) VALUES
  ('PM-CP-INSPECT',        'Inspection per unit',           'co_pack',    0.25, 0.10, 'service'),
  ('PM-CP-RELABEL',        'Relabel per unit',              'co_pack',    0.18, 0.07, 'labor'),
  ('PM-CP-SHRINK',         'Shrink wrap per multipack',     'co_pack',    0.32, 0.12, 'labor'),
  ('PM-CP-CASE-SEAL',      'Case sealing per case',         'co_pack',    0.15, 0.05, 'labor'),
  ('PM-CP-CASE-MAT',       'Case insert material',          'co_pack',    0.45, 0.20, 'material'),
  ('PM-CP-PARTITION',      'Partition material',            'co_pack',    0.85, 0.40, 'material'),
  ('PM-CP-VOIDFILL',       'Void fill material',            'co_pack',    0.55, 0.25, 'material'),
  ('PM-CP-DESICCANT',      'Desiccant pouch (each)',        'co_pack',    0.12, 0.05, 'material'),
  ('PM-CP-SLEEVE',         'Sleeve material',               'co_pack',    0.65, 0.30, 'material'),
  ('PM-CP-TOPSHEET',       'Top sheet per pallet',          'co_pack',    1.40, 0.65, 'material'),
  ('PM-XD-FREIGHT',        'Inbound freight pass-through',  'cross_dock', 1.00, 1.00, 'pass_through'),
  ('PM-XD-LIFT-FEE',       'Liftgate fee',                  'cross_dock', 75.00,35.00, 'fee'),
  ('PM-XD-DETENTION',      'Driver detention surcharge',    'cross_dock', 60.00,28.00, 'fee'),
  ('PM-XD-RECLASS',        'Pallet reclassification',       'cross_dock', 25.00,10.00, 'labor'),
  ('PM-XD-WAREHOUSE-HR',   'Warehouse labor per hour',      'cross_dock', 65.00,32.00, 'labor'),
  ('PM-XD-STOR-PLT',       'Pallet storage per day',        'cross_dock',  1.40, 0.55, 'fee'),
  ('PM-CP-EQUIP-RENTAL',   'Equipment rental day',          'co_pack',    250.00,120.00,'fee'),
  ('PM-CP-OVERTIME',       'Overtime premium per hour',     'co_pack',    20.00,10.00, 'labor'),
  ('PM-FEE-PROGRAM-MGMT',  'Program management fee',        'fee',        450.00,200.00,'fee'),
  ('PM-CP-PHOTO',          'Photo documentation per lot',   'co_pack',    35.00,15.00, 'service'),
  ('PM-CP-SAMPLE-PULL',    'Quality sample pull',           'co_pack',    18.00, 7.00, 'service'),
  ('PM-CP-RECALL-PREP',    'Recall preparation per lot',    'co_pack',    125.00,55.00,'service'),
  ('PM-CP-SCRAP-OUT',      'Scrap haul-out per pallet',     'co_pack',    45.00,18.00, 'fee')
ON CONFLICT (item_code) DO NOTHING;

-- 13th job type (per audit).
INSERT INTO public.job_types (code, label, sort_order, default_service_type, required_inputs, description)
VALUES ('pallet_storage_standalone', 'Pallet Storage (Standalone)', 130, 'cross_dock',
        '["pallets","duration_days"]'::jsonb, 'Standalone pallet storage program')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.pallet_size_kinds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.value_added_kinds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_value_added_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY pallet_size_kinds_select_active ON public.pallet_size_kinds
  FOR SELECT TO authenticated USING (is_active);
CREATE POLICY value_added_kinds_select_active ON public.value_added_kinds
  FOR SELECT TO authenticated USING (is_active);

CREATE POLICY qvai_select_management ON public.quote_value_added_items
  FOR SELECT TO authenticated USING (public.current_user_role() = 'management');
CREATE POLICY qvai_select_customer ON public.quote_value_added_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quote_versions v
    JOIN public.quotes q ON q.id = v.quote_id
    WHERE v.id = quote_value_added_items.quote_version_id
      AND q.customer_id = public.current_user_customer_id()
  ));

COMMIT;
