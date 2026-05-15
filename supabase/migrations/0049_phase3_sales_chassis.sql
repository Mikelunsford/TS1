-- 0049_phase3_sales_chassis.sql
-- Wave 3, Sub-wave 3.1 — Phase 3 (Items / Taxes / Currencies / FX).
--
-- SIGNIFICANT SCOPE DEVIATION FROM THE WAVE-3 DISPATCH TEXT (intentional):
-- The dispatch as authored expected three separate migrations
-- (0050_sales_chassis_currencies_taxes, 0051_inventory_partial,
-- 0052_items_extend_from_pricing_menu) on the assumption that
-- `currencies`, `exchange_rates`, `taxes`, `payment_methods`,
-- `item_categories`, `units`, and the new `items` columns did not yet
-- exist. Step-2 cloud verification proved otherwise: Wave 0's chassis
-- migrations (0033_sales, 0038_inventory, 0040_finance) already created
-- every Phase-3 target table with the columns Phase 3 needs, RLS enabled
-- with Pattern A policies, and 8 of the 10 ISO 4217 currencies seeded.
--
-- The only remaining Phase-3 schema work is:
--   1. Rename `pricing_menu` -> `items` (the schema-master §6.1 rename
--      that the Wave 0 chassis deferred).
--   2. Create the backwards-compat view `pricing_menu` over `items`
--      filtered by `item_kind` (per schema master §6.1; future-proofs
--      callers against future item_kind additions).
--   3. Seed the two missing ISO 4217 currencies (BRL, INR) so the
--      currency catalog matches the dispatch target of 10.
--   4. Seed one default 0% tax per existing org (idempotent guard).
--   5. Seed default payment_methods per existing org (7 codes: cash,
--      check, ach, card, wire, stripe, manual).
--   6. Seed default units per existing org (5 codes: each, hour, pallet,
--      kg, lb).
--
-- This is forward-only. Every seed is `ON CONFLICT DO NOTHING` so a
-- re-run is a no-op and a fresh-DB rebuild gets the same end state.
--
-- The 7 inbound FK constraints on `pricing_menu` (from
-- customer_pricing_overrides, invoice_line_items, po_line_items,
-- pricing_tiers, quote_line_items, stock_levels, stock_movements) all
-- reference the table by OID, so the rename does not invalidate any of
-- them. Constraint names that include "pricing_menu_*" stay as-is for
-- cosmetic reasons; the only ones that would conflict on a fresh DB
-- rebuild are `pricing_menu_pkey` / `pricing_menu_item_code_key`, which
-- live in pg_constraint and are referenced nowhere by name. Skipping the
-- constraint rename keeps the migration small.
--
-- Index `idx_pricing_menu_org` is renamed to `idx_items_org` for
-- consistency with the existing `idx_items_*` indexes already on the
-- table. The remaining three already use the items_* convention.
--
-- Trigger `trg_pricing_menu_updated_at` keeps its name (it still works
-- against the renamed table; cosmetic-only).
--
-- Date:    2026-05-15
--
-- DOWN MIGRATION:
--   DROP VIEW IF EXISTS public.pricing_menu;
--   ALTER TABLE public.items RENAME TO pricing_menu;
--   ALTER INDEX public.idx_items_org RENAME TO idx_pricing_menu_org;
--   -- Seed deletes (best-effort — only delete what 0049 inserted):
--   DELETE FROM public.units            WHERE code IN ('each','hour','pallet','kg','lb');
--   DELETE FROM public.payment_methods  WHERE code IN ('cash','check','ach','card','wire','stripe','manual');
--   DELETE FROM public.taxes            WHERE code = 'TAX-0' AND rate = 0 AND is_default;
--   DELETE FROM public.currencies       WHERE code IN ('BRL','INR');

BEGIN;

-- 1. Rename pricing_menu -> items.
ALTER TABLE public.pricing_menu RENAME TO items;

-- 2. Rename the org index to match the other items_* indexes.
ALTER INDEX public.idx_pricing_menu_org RENAME TO idx_items_org;

-- 3. Backwards-compat view per schema master §6.1.
CREATE VIEW public.pricing_menu AS
  SELECT *
    FROM public.items
   WHERE item_kind IN ('labor', 'material', 'pass_through', 'fee', 'service');

COMMENT ON VIEW public.pricing_menu IS
  'Backwards-compat view over items, filtered to the original 5 item_kinds. Deprecated; callers should target items directly. View targeted for drop in Wave 4 after zero-caller telemetry.';

-- The view inherits RLS from `items` via SECURITY INVOKER (PG default).
-- No additional GRANT needed; SELECT permissions on the view flow from
-- SELECT permissions on the base table.

-- 4. Seed missing ISO 4217 currencies (BRL, INR) — guard via ON CONFLICT.
INSERT INTO public.currencies (code, label, symbol, symbol_position, decimal_sep, thousand_sep, cent_precision, zero_format, is_active)
VALUES
  ('BRL', 'Brazilian Real',   'R$', 'before', ',', '.', 2, false, true),
  ('INR', 'Indian Rupee',     '₹',  'before', '.', ',', 2, false, true)
ON CONFLICT (code) DO NOTHING;

-- 5. Seed one default 0% tax per existing org. The partial unique index
--    `uq_taxes_default_per_org WHERE is_default` enforces at most one
--    default tax per org; the ON CONFLICT below catches re-runs that
--    might try to re-insert the same code.
INSERT INTO public.taxes (org_id, code, label, rate, jurisdiction, is_compound, is_inclusive, is_default, is_active)
SELECT o.id, 'TAX-0', 'Tax 0%', 0::numeric(7,6), NULL, false, false, true, true
  FROM public.organizations o
 WHERE NOT EXISTS (
   SELECT 1 FROM public.taxes t WHERE t.org_id = o.id AND t.is_default
 )
ON CONFLICT (org_id, code) DO NOTHING;

-- 6. Seed default payment_methods per existing org.
INSERT INTO public.payment_methods (org_id, code, label, description, is_default, is_active)
SELECT o.id, pm.code, pm.label, pm.description, pm.is_default, true
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('cash',   'Cash',           'Physical currency receipt',                    true),
    ('check',  'Check',          'Paper check; manually reconciled',             false),
    ('ach',    'ACH transfer',   'Bank-to-bank automated clearing house',        false),
    ('card',   'Card',           'Credit or debit card (offline / manual key-in)', false),
    ('wire',   'Wire transfer',  'Same-day wire (domestic or international)',    false),
    ('stripe', 'Stripe',         'Stripe-hosted checkout / payment intent',      false),
    ('manual', 'Manual entry',   'Catch-all for offline payments not covered above', false)
  ) AS pm(code, label, description, is_default)
ON CONFLICT (org_id, code) DO NOTHING;

-- 7. Seed default units per existing org.
INSERT INTO public.units (org_id, code, label, family, is_active)
SELECT o.id, u.code, u.label, u.family, true
  FROM public.organizations o
  CROSS JOIN (VALUES
    ('each',   'Each',           'count'),
    ('hour',   'Hour',           'time'),
    ('pallet', 'Pallet',         'count'),
    ('kg',     'Kilogram',       'weight'),
    ('lb',     'Pound',          'weight')
  ) AS u(code, label, family)
ON CONFLICT (org_id, code) DO NOTHING;

-- 8. Idempotent invariant check on the post-state. Asserts the rename
--    landed and the seeds inserted the expected counts on the team1 org.
DO $$
DECLARE
  v_items_exists       boolean;
  v_view_exists        boolean;
  v_currency_count     int;
  v_tax_count          int;
  v_payment_method_cnt int;
  v_unit_count         int;
  v_org_count          int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='items'
  ) INTO v_items_exists;
  IF NOT v_items_exists THEN
    RAISE EXCEPTION '0049 post-state assertion failed: items table missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
     WHERE table_schema='public' AND table_name='pricing_menu'
  ) INTO v_view_exists;
  IF NOT v_view_exists THEN
    RAISE EXCEPTION '0049 post-state assertion failed: pricing_menu view missing';
  END IF;

  SELECT COUNT(*) INTO v_currency_count FROM public.currencies WHERE is_active;
  IF v_currency_count < 10 THEN
    RAISE EXCEPTION '0049 post-state assertion failed: currencies count = % (expected >= 10)', v_currency_count;
  END IF;

  SELECT COUNT(*) INTO v_org_count FROM public.organizations;
  SELECT COUNT(*) INTO v_tax_count           FROM public.taxes           WHERE is_default;
  SELECT COUNT(*) INTO v_payment_method_cnt  FROM public.payment_methods;
  SELECT COUNT(*) INTO v_unit_count          FROM public.units;
  IF v_tax_count          < v_org_count           THEN RAISE EXCEPTION '0049 default-tax count = %  expected >= %', v_tax_count,          v_org_count;          END IF;
  IF v_payment_method_cnt < (v_org_count * 7)     THEN RAISE EXCEPTION '0049 payment_methods cnt= %  expected >= %', v_payment_method_cnt, (v_org_count * 7);    END IF;
  IF v_unit_count         < (v_org_count * 5)     THEN RAISE EXCEPTION '0049 units count = %  expected >= %', v_unit_count,         (v_org_count * 5);    END IF;
END $$;

COMMIT;
