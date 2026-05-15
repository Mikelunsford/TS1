-- 0028_drop_dead_phase_scaffolding.sql
-- Purpose: Final TS cleanup. Drops scaffolding that proved unused:
--   - quote_approvals table (added by 0018; replaced by the
--     requires_approval boolean which remains)
--   - quote_versions placeholder columns (total_cost, margin_pct,
--     scenario_of, scenario_label)
--   - user_profiles.is_approver column
--   - PM-XD-STOR-PLT pricing-menu row and its tiers
--   - Acme corrugated override (legacy demo row)
--   - rush_surcharge value_added_kind row
--   - customer.contact_name / contact_email columns
--   - customer trigram email index
-- Per the TS audit §1.1 this is the *only* migration in the 0001-0028 range
-- that performs destructive drops; everything else is additive.
-- Date:    2026-05-14
--
-- DOWN MIGRATION:
--   (operator-only; this set of drops is intentionally non-reversible)

BEGIN;

DROP TABLE IF EXISTS public.quote_approvals CASCADE;

ALTER TABLE public.quote_versions
  DROP COLUMN IF EXISTS total_cost,
  DROP COLUMN IF EXISTS margin_pct,
  DROP COLUMN IF EXISTS scenario_of,
  DROP COLUMN IF EXISTS scenario_label;

ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS is_approver;

-- Drop PM-XD-STOR-PLT and any pricing tiers tied to it.
DELETE FROM public.pricing_tiers
 WHERE pricing_item_id IN (SELECT id FROM public.pricing_menu WHERE item_code = 'PM-XD-STOR-PLT');
DELETE FROM public.pricing_menu WHERE item_code = 'PM-XD-STOR-PLT';

-- Drop the legacy Acme demo override if present.
DELETE FROM public.customer_pricing_overrides
 WHERE customer_id IN (SELECT id FROM public.customers WHERE name LIKE 'Acme%');

-- Drop the rush_surcharge VA kind.
DELETE FROM public.value_added_kinds WHERE code = 'rush_surcharge';

-- Drop dead customer columns.
ALTER TABLE public.customers DROP COLUMN IF EXISTS contact_name;
ALTER TABLE public.customers DROP COLUMN IF EXISTS contact_email;

-- Drop legacy trigram email index if it ever existed.
DROP INDEX IF EXISTS public.idx_customers_email_trgm;

-- Drop job_types approval_threshold and default_margin_floor columns if they
-- were ever created in a now-defunct intermediate state.
ALTER TABLE public.job_types DROP COLUMN IF EXISTS approval_threshold;
ALTER TABLE public.job_types DROP COLUMN IF EXISTS default_margin_floor;

COMMIT;
