-- 0044_drop_legacy_columns.sql
-- Purpose: Final cleanup AFTER one safe release with both old and new in
--   place. Drops bom_items.vendor (free-text), the legacy
--   quote_attachments_legacy table, and any leftover legacy numeric money
--   columns that may have escaped 0030. The TS sequences themselves stay
--   (they cost ~0 and the legacy next_*_number() helpers reference them).
-- Date:    2026-05-14
--
-- Per /03-workspace/00-SHARED-CONTEXT.md "Forbidden Patterns": this file
-- is the ONLY place we drop columns. It assumes 0029-0043 shipped, the
-- app has been routing through the new tables for a full release cycle,
-- and no callers depend on the legacy column shapes.
--
-- DOWN MIGRATION:
--   (operator-only; restoring dropped columns requires restoring from a
--    pre-0044 snapshot. Do not attempt automated revert.)

BEGIN;

ALTER TABLE public.bom_items DROP COLUMN IF EXISTS vendor;

DROP TABLE IF EXISTS public.quote_attachments_legacy CASCADE;

-- Any legacy numeric money columns the audit can prove still linger.
-- (Most were dropped in 0030; the IF EXISTS guard keeps this idempotent.)
ALTER TABLE public.quotes               DROP COLUMN IF EXISTS subtotal;
ALTER TABLE public.quotes               DROP COLUMN IF EXISTS total;
ALTER TABLE public.quote_line_items     DROP COLUMN IF EXISTS unit_price;
ALTER TABLE public.quote_line_items     DROP COLUMN IF EXISTS unit_cost;
ALTER TABLE public.quote_line_items     DROP COLUMN IF EXISTS line_total;
ALTER TABLE public.quote_versions       DROP COLUMN IF EXISTS subtotal;
ALTER TABLE public.quote_versions       DROP COLUMN IF EXISTS total;
ALTER TABLE public.quote_value_added_items DROP COLUMN IF EXISTS computed_total;
ALTER TABLE public.quote_value_added_items DROP COLUMN IF EXISTS computed_cost;
ALTER TABLE public.pricing_menu         DROP COLUMN IF EXISTS unit_price;
ALTER TABLE public.pricing_menu         DROP COLUMN IF EXISTS unit_cost;
ALTER TABLE public.pricing_tiers        DROP COLUMN IF EXISTS unit_price;
ALTER TABLE public.pricing_tiers        DROP COLUMN IF EXISTS unit_cost;
ALTER TABLE public.customer_pricing_overrides DROP COLUMN IF EXISTS override_unit_price;
ALTER TABLE public.bom_items            DROP COLUMN IF EXISTS unit_cost;
ALTER TABLE public.projects             DROP COLUMN IF EXISTS total;

COMMIT;
