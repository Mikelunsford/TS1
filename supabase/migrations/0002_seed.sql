-- 0002_seed.sql
-- Purpose: Three demo customers + twelve baseline pricing-menu rows.
--   These rows are rebadged to the default org during 0031.
-- Date:    2026-05-14
-- Idempotent: ON CONFLICT DO NOTHING on natural keys.
--
-- DOWN MIGRATION:
--   DELETE FROM public.pricing_menu WHERE item_code LIKE 'PM-%';
--   DELETE FROM public.customers WHERE id IN
--     ('11111111-1111-1111-1111-111111111111',
--      '22222222-2222-2222-2222-222222222222',
--      '33333333-3333-3333-3333-333333333333');

BEGIN;

INSERT INTO public.customers (id, name, contact_name, contact_email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Acme Foods',         'Alice Acme',   'alice@acme.example.com'),
  ('22222222-2222-2222-2222-222222222222', 'Northwind Beverages','Nina North',   'nina@northwind.example.com'),
  ('33333333-3333-3333-3333-333333333333', 'Globex Industrial',  'Gary Globex',  'gary@globex.example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pricing_menu (item_code, description, category, unit_price, unit_cost) VALUES
  ('PM-CP-LABOR-STD',  'Co-pack labor, standard',         'co_pack',    35.00, 18.00),
  ('PM-CP-LABOR-PRM',  'Co-pack labor, premium',          'co_pack',    55.00, 28.00),
  ('PM-CP-MAT-BOX',    'Corrugated case (each)',          'co_pack',     1.85, 1.10),
  ('PM-CP-MAT-LABEL',  'Adhesive label (each)',           'co_pack',     0.18, 0.08),
  ('PM-XD-LABOR-STD',  'Cross-dock labor, standard',      'cross_dock', 22.00, 11.00),
  ('PM-XD-PALLET-IN',  'Inbound pallet handling',         'cross_dock', 14.00, 6.00),
  ('PM-XD-PALLET-OUT', 'Outbound pallet handling',        'cross_dock', 14.00, 6.00),
  ('PM-CP-PALLETIZE',  'Palletize and stretch wrap',      'co_pack',    18.00, 8.00),
  ('PM-CP-QC',         'Quality control inspection',      'co_pack',    45.00, 22.00),
  ('PM-CP-RUSH',       'Rush turnaround surcharge',       'co_pack',    75.00, 35.00),
  ('PM-XD-STORAGE',    'Short-term cross-dock storage',   'cross_dock',  6.00, 2.00),
  ('PM-FEE-SETUP',     'Project setup fee',               'fee',       250.00,100.00)
ON CONFLICT (item_code) DO NOTHING;

COMMIT;
