-- 0030_money_to_cents.sql
-- Purpose: Convert every money-bearing column on TS-era tables from
--   numeric(12,2) to integer-cents bigint. Per /03-workspace/00-SHARED-CONTEXT.md
--   the money model is constitutional: bigint cents, _cents suffix,
--   half-even rounding on the final cent.
-- Date:    2026-05-14
--
-- DOWN MIGRATION (operator-only):
--   ALTER TABLE public.quotes ADD COLUMN subtotal numeric(12,2), ADD COLUMN total numeric(12,2);
--   UPDATE public.quotes SET subtotal = subtotal_cents / 100.0, total = total_cents / 100.0;
--   ALTER TABLE public.quotes DROP COLUMN subtotal_cents, DROP COLUMN total_cents;
--   (...repeat for every table below)

BEGIN;

-- Drop triggers that bind to soon-to-be-removed numeric columns; rebound to
-- *_cents columns at the bottom of this migration.
DROP TRIGGER IF EXISTS trg_quotes_requires_approval_upd ON public.quotes;
DROP TRIGGER IF EXISTS trg_quotes_requires_approval_ins ON public.quotes;

-- Quotes -------------------------------------------------------------------
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS subtotal_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS total_cents    bigint NOT NULL DEFAULT 0;
UPDATE public.quotes
   SET subtotal_cents = (round(COALESCE(subtotal, 0) * 100))::bigint,
       total_cents    = (round(COALESCE(total, 0)    * 100))::bigint;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.quotes
     WHERE (subtotal_cents / 100.0)::numeric(12,2) <> COALESCE(subtotal, 0)
        OR (total_cents    / 100.0)::numeric(12,2) <> COALESCE(total, 0)
  ) THEN
    RAISE EXCEPTION 'quotes cents backfill drift';
  END IF;
END $$;
ALTER TABLE public.quotes DROP COLUMN IF EXISTS subtotal;
ALTER TABLE public.quotes DROP COLUMN IF EXISTS total;

-- Quote line items --------------------------------------------------------
ALTER TABLE public.quote_line_items ADD COLUMN IF NOT EXISTS unit_price_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE public.quote_line_items ADD COLUMN IF NOT EXISTS unit_cost_cents  bigint NOT NULL DEFAULT 0;
ALTER TABLE public.quote_line_items ADD COLUMN IF NOT EXISTS line_total_cents bigint NOT NULL DEFAULT 0;
UPDATE public.quote_line_items
   SET unit_price_cents = (round(COALESCE(unit_price, 0) * 100))::bigint,
       unit_cost_cents  = (round(COALESCE(unit_cost,  0) * 100))::bigint,
       line_total_cents = (round(COALESCE(line_total, 0) * 100))::bigint;
ALTER TABLE public.quote_line_items DROP COLUMN IF EXISTS unit_price;
ALTER TABLE public.quote_line_items DROP COLUMN IF EXISTS unit_cost;
ALTER TABLE public.quote_line_items DROP COLUMN IF EXISTS line_total;

-- Quote versions ---------------------------------------------------------
ALTER TABLE public.quote_versions ADD COLUMN IF NOT EXISTS subtotal_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE public.quote_versions ADD COLUMN IF NOT EXISTS total_cents    bigint NOT NULL DEFAULT 0;
UPDATE public.quote_versions
   SET subtotal_cents = (round(COALESCE(subtotal, 0) * 100))::bigint,
       total_cents    = (round(COALESCE(total, 0)    * 100))::bigint;
ALTER TABLE public.quote_versions DROP COLUMN IF EXISTS subtotal;
ALTER TABLE public.quote_versions DROP COLUMN IF EXISTS total;

-- Quote value-added items ------------------------------------------------
ALTER TABLE public.quote_value_added_items ADD COLUMN IF NOT EXISTS computed_total_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE public.quote_value_added_items ADD COLUMN IF NOT EXISTS computed_cost_cents  bigint NOT NULL DEFAULT 0;
UPDATE public.quote_value_added_items
   SET computed_total_cents = (round(COALESCE(computed_total, 0) * 100))::bigint,
       computed_cost_cents  = (round(COALESCE(computed_cost,  0) * 100))::bigint;
ALTER TABLE public.quote_value_added_items DROP COLUMN IF EXISTS computed_total;
ALTER TABLE public.quote_value_added_items DROP COLUMN IF EXISTS computed_cost;

-- Pricing menu (becomes 'items' in 0033/0038) -----------------------------
ALTER TABLE public.pricing_menu ADD COLUMN IF NOT EXISTS unit_price_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE public.pricing_menu ADD COLUMN IF NOT EXISTS unit_cost_cents  bigint NOT NULL DEFAULT 0;
UPDATE public.pricing_menu
   SET unit_price_cents = (round(COALESCE(unit_price, 0) * 100))::bigint,
       unit_cost_cents  = (round(COALESCE(unit_cost,  0) * 100))::bigint;
ALTER TABLE public.pricing_menu DROP COLUMN IF EXISTS unit_price;
ALTER TABLE public.pricing_menu DROP COLUMN IF EXISTS unit_cost;

-- Pricing tiers ----------------------------------------------------------
ALTER TABLE public.pricing_tiers ADD COLUMN IF NOT EXISTS unit_price_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE public.pricing_tiers ADD COLUMN IF NOT EXISTS unit_cost_cents  bigint NOT NULL DEFAULT 0;
UPDATE public.pricing_tiers
   SET unit_price_cents = (round(COALESCE(unit_price, 0) * 100))::bigint,
       unit_cost_cents  = (round(COALESCE(unit_cost,  0) * 100))::bigint;
ALTER TABLE public.pricing_tiers DROP COLUMN IF EXISTS unit_price;
ALTER TABLE public.pricing_tiers DROP COLUMN IF EXISTS unit_cost;

-- Customer pricing overrides --------------------------------------------
ALTER TABLE public.customer_pricing_overrides
  ADD COLUMN IF NOT EXISTS override_unit_price_cents bigint NULL;
UPDATE public.customer_pricing_overrides
   SET override_unit_price_cents = (round(override_unit_price * 100))::bigint
 WHERE override_unit_price IS NOT NULL;
ALTER TABLE public.customer_pricing_overrides DROP COLUMN IF EXISTS override_unit_price;
-- Restore the XOR CHECK using the new cents column.
ALTER TABLE public.customer_pricing_overrides DROP CONSTRAINT IF EXISTS cpo_price_or_markup_xor;
ALTER TABLE public.customer_pricing_overrides
  ADD CONSTRAINT cpo_price_or_markup_xor
  CHECK ((override_unit_price_cents IS NOT NULL)::int + (override_markup_pct IS NOT NULL)::int = 1);

-- BOM items unit cost ---------------------------------------------------
ALTER TABLE public.bom_items ADD COLUMN IF NOT EXISTS unit_cost_cents bigint NOT NULL DEFAULT 0;
UPDATE public.bom_items
   SET unit_cost_cents = (round(COALESCE(unit_cost, 0) * 100))::bigint
 WHERE unit_cost IS NOT NULL;
ALTER TABLE public.bom_items DROP COLUMN IF EXISTS unit_cost;

-- Projects total --------------------------------------------------------
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS total_cents bigint NOT NULL DEFAULT 0;
UPDATE public.projects
   SET total_cents = (round(COALESCE(total, 0) * 100))::bigint;
ALTER TABLE public.projects DROP COLUMN IF EXISTS total;

-- Rewire triggers that referenced the numeric columns to the cents columns.

CREATE OR REPLACE FUNCTION public.create_v1_for_quote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
BEGIN
  INSERT INTO public.quote_versions (
    quote_id, version_number, status, service_type,
    subtotal_cents, total_cents, notes, valid_until, created_by, job_type_id, inputs_json,
    requires_approval, mode, materials_only
  ) VALUES (
    NEW.id, 1, NEW.status, NEW.service_type,
    NEW.subtotal_cents, NEW.total_cents, NEW.notes, NEW.valid_until, NEW.created_by, NEW.job_type_id, NEW.inputs_json,
    NEW.requires_approval, NEW.mode, NEW.materials_only
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.mirror_quote_to_current_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.quote_versions
    WHERE quote_id = NEW.id ORDER BY version_number DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.quote_versions (
      quote_id, version_number, status, service_type,
      subtotal_cents, total_cents, notes, valid_until, created_by, job_type_id, inputs_json,
      requires_approval, mode, materials_only
    ) VALUES (
      NEW.id, 1, NEW.status, NEW.service_type,
      NEW.subtotal_cents, NEW.total_cents, NEW.notes, NEW.valid_until, NEW.created_by, NEW.job_type_id, NEW.inputs_json,
      NEW.requires_approval, NEW.mode, NEW.materials_only
    );
  ELSE
    UPDATE public.quote_versions SET
      status = NEW.status, service_type = NEW.service_type,
      subtotal_cents = NEW.subtotal_cents, total_cents = NEW.total_cents,
      notes = NEW.notes, valid_until = NEW.valid_until,
      job_type_id = NEW.job_type_id, inputs_json = NEW.inputs_json,
      requires_approval = NEW.requires_approval,
      mode = NEW.mode, materials_only = NEW.materials_only
    WHERE id = v_id;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_v1_for_quote()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mirror_quote_to_current_version() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_v1_for_quote()             TO service_role;
GRANT  EXECUTE ON FUNCTION public.mirror_quote_to_current_version() TO service_role;

-- VA totals recompute trigger updated to use cents.
CREATE OR REPLACE FUNCTION public.recompute_quote_totals_from_va()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_quote_id uuid;
  v_va_total bigint;
  v_li_total bigint;
  v_subtotal bigint;
BEGIN
  SELECT q.id INTO v_quote_id
    FROM public.quote_versions v
    JOIN public.quotes q ON q.id = v.quote_id
   WHERE v.id = COALESCE(NEW.quote_version_id, OLD.quote_version_id);

  IF v_quote_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT COALESCE(SUM(vai.computed_total_cents), 0)
    INTO v_va_total
    FROM public.quote_value_added_items vai
    JOIN public.quote_versions v ON v.id = vai.quote_version_id
   WHERE v.quote_id = v_quote_id;

  SELECT COALESCE(SUM(line_total_cents), 0)
    INTO v_li_total
    FROM public.quote_line_items WHERE quote_id = v_quote_id;

  v_subtotal := v_li_total + v_va_total;

  UPDATE public.quotes
     SET subtotal_cents = v_subtotal,
         total_cents    = v_subtotal
   WHERE id = v_quote_id;

  RETURN COALESCE(NEW, OLD);
END $$;

REVOKE EXECUTE ON FUNCTION public.recompute_quote_totals_from_va() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_quote_totals_from_va() TO service_role;

-- requires_approval threshold trigger now uses cents (2,500,000 = $25k).
CREATE OR REPLACE FUNCTION public.set_quote_requires_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.requires_approval := COALESCE(NEW.total_cents, 0) > 2500000;
  RETURN NEW;
END $$;

-- Rebind the BEFORE INSERT and BEFORE UPDATE OF triggers to the cents column.
DROP TRIGGER IF EXISTS trg_quotes_requires_approval_ins ON public.quotes;
CREATE TRIGGER trg_quotes_requires_approval_ins
  BEFORE INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_quote_requires_approval();

DROP TRIGGER IF EXISTS trg_quotes_requires_approval_upd ON public.quotes;
CREATE TRIGGER trg_quotes_requires_approval_upd
  BEFORE UPDATE OF total_cents ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_quote_requires_approval();

COMMIT;
