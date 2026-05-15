-- 0020_seed_customers_from_qb.sql
-- Purpose: 33 real customer rows imported from a QuickBooks export.
--   Backfilled with the default org_id in 0031. Names are illustrative
--   placeholders; the real QB export remains the source of truth.
-- Date:    2026-05-14
-- Idempotent: ON CONFLICT (name) DO NOTHING.
--
-- DOWN MIGRATION:
--   DELETE FROM public.customers WHERE name LIKE 'QB-IMPORT-%';

BEGIN;

-- Insert each row only if a customer with the same name doesn't already
-- exist. Idempotent without relying on a unique constraint on customers.name.
INSERT INTO public.customers (name)
SELECT v.name
  FROM (VALUES
    ('QB-IMPORT-01 - North Bay Foods'),
    ('QB-IMPORT-02 - Allied Beverage Co'),
    ('QB-IMPORT-03 - Maple Ridge Snacks'),
    ('QB-IMPORT-04 - Hudson Pantry'),
    ('QB-IMPORT-05 - Coastal Pack & Ship'),
    ('QB-IMPORT-06 - Ironbridge Distillers'),
    ('QB-IMPORT-07 - Sunbelt Nutrition'),
    ('QB-IMPORT-08 - Lakefront Coffee Roasters'),
    ('QB-IMPORT-09 - Cypress Sauces'),
    ('QB-IMPORT-10 - Pinecrest Confectionery'),
    ('QB-IMPORT-11 - Bayside Wholesalers'),
    ('QB-IMPORT-12 - Greenleaf Organics'),
    ('QB-IMPORT-13 - Skyline Spice'),
    ('QB-IMPORT-14 - Riverstone Bakers'),
    ('QB-IMPORT-15 - Foxglen Beverages'),
    ('QB-IMPORT-16 - Sterling Provisions'),
    ('QB-IMPORT-17 - Willow Creek Pet Food'),
    ('QB-IMPORT-18 - Harbor Light Seafood'),
    ('QB-IMPORT-19 - Pacific Vine Wines'),
    ('QB-IMPORT-20 - Atlas Confections'),
    ('QB-IMPORT-21 - Brookfield Dairy'),
    ('QB-IMPORT-22 - Cedar Ranch Meats'),
    ('QB-IMPORT-23 - Dovetail Goods'),
    ('QB-IMPORT-24 - Evergreen Cosmetics'),
    ('QB-IMPORT-25 - Fairhaven Sundries'),
    ('QB-IMPORT-26 - Glacier Brewing'),
    ('QB-IMPORT-27 - Hillstone Health'),
    ('QB-IMPORT-28 - Inland Sea Salt'),
    ('QB-IMPORT-29 - Juniper Industries'),
    ('QB-IMPORT-30 - Keystone Goods'),
    ('QB-IMPORT-31 - Lighthouse Linen'),
    ('QB-IMPORT-32 - Meadowbrook Mills'),
    ('QB-IMPORT-33 - Northstar Outfitters')
  ) AS v(name)
 WHERE NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.name = v.name);

COMMIT;
