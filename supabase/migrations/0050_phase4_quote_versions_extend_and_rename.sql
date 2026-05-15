-- 0050_phase4_quote_versions_extend_and_rename.sql
-- Wave 4 / Phase 4 — Quoting harden. Reduced scope after Step-2 cloud verification.
--
-- Step-2 verification (2026-05-15) found:
--   * public.quotes already carries every Wave-4 target column (org_id NOT NULL,
--     currency_code NOT NULL DEFAULT 'USD', opportunity_id, exchange_rate,
--     subtotal_cents, tax_cents, discount_cents, total_cents, tax_id,
--     tax_rate_snapshot, deleted_at) from the Wave-0 chassis (0033_sales.sql)
--     plus Wave-3 reaffirmation.
--   * public.quote_line_items has the full cents money set (unit_price_cents,
--     unit_cost_cents, line_total_cents, tax_id, tax_amount_cents,
--     tax_rate_snapshot, discount_cents) but still carries the LEGACY column
--     name `pricing_item_id` instead of `item_id` (schema master §6.5 calls
--     for the rename).
--   * public.quote_versions exists with version_number, status, service_type,
--     subtotal_cents, total_cents, org_id, audit columns — but is MISSING
--     the new quote-level columns the mirror needs to copy (currency_code,
--     opportunity_id, exchange_rate, tax_cents, discount_cents, tax_id,
--     tax_rate_snapshot, deleted_at).
--   * public.projects + public.project_phases are fully populated; no DDL
--     needed for them in Wave 4.
--
-- This migration:
--   1. Renames quote_line_items.pricing_item_id -> item_id.
--   2. Adds the missing quote-level columns to quote_versions.
--   3. Regenerates the SECURITY DEFINER mirror trigger functions
--      (create_v1_for_quote, mirror_quote_to_current_version) so they
--      populate the new quote_versions columns on every quote INSERT/UPDATE.
--
-- Forward-only. Idempotent on re-run. DOWN block at the bottom of this header
-- for record only; production rollback would land as a new forward migration.
--
-- DOWN (record-only — do NOT execute directly on prod):
--   DROP TRIGGER trg_quotes_mirror_to_version_ins ON public.quotes;
--   DROP TRIGGER trg_quotes_mirror_to_version_upd ON public.quotes;
--   -- restore prior bodies of create_v1_for_quote + mirror_quote_to_current_version
--   --   (see git history of this migration for the pre-0050 source)
--   ALTER TABLE public.quote_line_items RENAME COLUMN item_id TO pricing_item_id;
--   ALTER TABLE public.quote_versions
--     DROP COLUMN IF EXISTS deleted_at,
--     DROP COLUMN IF EXISTS tax_rate_snapshot,
--     DROP COLUMN IF EXISTS tax_id,
--     DROP COLUMN IF EXISTS discount_cents,
--     DROP COLUMN IF EXISTS tax_cents,
--     DROP COLUMN IF EXISTS exchange_rate,
--     DROP COLUMN IF EXISTS opportunity_id,
--     DROP COLUMN IF EXISTS currency_code;

BEGIN;

-- 1) quote_line_items.pricing_item_id -> item_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'quote_line_items'
       AND column_name  = 'pricing_item_id'
  ) AND NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'quote_line_items'
       AND column_name  = 'item_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.quote_line_items RENAME COLUMN pricing_item_id TO item_id';
  END IF;
END $$;

-- 2) quote_versions — add the quote-header columns the mirror copies.
ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS currency_code    text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS opportunity_id   uuid NULL,
  ADD COLUMN IF NOT EXISTS exchange_rate    numeric(18,8) NULL,
  ADD COLUMN IF NOT EXISTS tax_cents        bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_cents   bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_id           uuid NULL,
  ADD COLUMN IF NOT EXISTS tax_rate_snapshot numeric(7,6) NULL,
  ADD COLUMN IF NOT EXISTS deleted_at       timestamptz NULL;

-- 2a) FK on opportunity_id (matches quotes.opportunity_id). Use a guarded
--     conditional add so re-running the migration is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'quote_versions_opportunity_id_fkey'
       AND conrelid = 'public.quote_versions'::regclass
  ) THEN
    ALTER TABLE public.quote_versions
      ADD CONSTRAINT quote_versions_opportunity_id_fkey
      FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2b) FK on tax_id (matches quotes.tax_id).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'quote_versions_tax_id_fkey'
       AND conrelid = 'public.quote_versions'::regclass
  ) THEN
    ALTER TABLE public.quote_versions
      ADD CONSTRAINT quote_versions_tax_id_fkey
      FOREIGN KEY (tax_id) REFERENCES public.taxes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2c) FK on currency_code.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'quote_versions_currency_code_fkey'
       AND conrelid = 'public.quote_versions'::regclass
  ) THEN
    ALTER TABLE public.quote_versions
      ADD CONSTRAINT quote_versions_currency_code_fkey
      FOREIGN KEY (currency_code) REFERENCES public.currencies(code);
  END IF;
END $$;

-- 2d) Backfill any pre-existing quote_versions rows from their parent quote so
--     historic v1 mirrors carry the new columns.
UPDATE public.quote_versions v
   SET currency_code     = q.currency_code,
       opportunity_id    = q.opportunity_id,
       exchange_rate     = q.exchange_rate,
       tax_cents         = q.tax_cents,
       discount_cents    = q.discount_cents,
       tax_id            = q.tax_id,
       tax_rate_snapshot = q.tax_rate_snapshot
  FROM public.quotes q
 WHERE v.quote_id = q.id
   -- only touch rows whose new cols still hold their column defaults
   AND v.currency_code = 'USD' AND v.tax_cents = 0 AND v.discount_cents = 0
   AND v.opportunity_id IS NULL AND v.exchange_rate IS NULL
   AND v.tax_id IS NULL AND v.tax_rate_snapshot IS NULL;

-- 3) Regenerate mirror trigger functions.
--    SECURITY DEFINER + locked search_path per the audit pattern
--    (TS1/00-audits/04-TS-BACKEND-AUDIT.md §2.6 pattern 10). REVOKE from
--    PUBLIC/anon/authenticated; GRANT TO service_role.

CREATE OR REPLACE FUNCTION public.create_v1_for_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  INSERT INTO public.quote_versions (
    quote_id, version_number, status, service_type,
    subtotal_cents, total_cents, notes, valid_until, created_by, job_type_id, inputs_json,
    requires_approval, mode, materials_only,
    -- Phase 4 / 0050 additions:
    org_id, currency_code, opportunity_id, exchange_rate,
    tax_cents, discount_cents, tax_id, tax_rate_snapshot
  ) VALUES (
    NEW.id, 1, NEW.status, NEW.service_type,
    NEW.subtotal_cents, NEW.total_cents, NEW.notes, NEW.valid_until, NEW.created_by, NEW.job_type_id, NEW.inputs_json,
    NEW.requires_approval, NEW.mode, NEW.materials_only,
    NEW.org_id, NEW.currency_code, NEW.opportunity_id, NEW.exchange_rate,
    NEW.tax_cents, NEW.discount_cents, NEW.tax_id, NEW.tax_rate_snapshot
  );
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.mirror_quote_to_current_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.quote_versions
    WHERE quote_id = NEW.id ORDER BY version_number DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.quote_versions (
      quote_id, version_number, status, service_type,
      subtotal_cents, total_cents, notes, valid_until, created_by, job_type_id, inputs_json,
      requires_approval, mode, materials_only,
      org_id, currency_code, opportunity_id, exchange_rate,
      tax_cents, discount_cents, tax_id, tax_rate_snapshot
    ) VALUES (
      NEW.id, 1, NEW.status, NEW.service_type,
      NEW.subtotal_cents, NEW.total_cents, NEW.notes, NEW.valid_until, NEW.created_by, NEW.job_type_id, NEW.inputs_json,
      NEW.requires_approval, NEW.mode, NEW.materials_only,
      NEW.org_id, NEW.currency_code, NEW.opportunity_id, NEW.exchange_rate,
      NEW.tax_cents, NEW.discount_cents, NEW.tax_id, NEW.tax_rate_snapshot
    );
  ELSE
    UPDATE public.quote_versions SET
      status = NEW.status, service_type = NEW.service_type,
      subtotal_cents = NEW.subtotal_cents, total_cents = NEW.total_cents,
      notes = NEW.notes, valid_until = NEW.valid_until,
      job_type_id = NEW.job_type_id, inputs_json = NEW.inputs_json,
      requires_approval = NEW.requires_approval,
      mode = NEW.mode, materials_only = NEW.materials_only,
      currency_code = NEW.currency_code,
      opportunity_id = NEW.opportunity_id,
      exchange_rate = NEW.exchange_rate,
      tax_cents = NEW.tax_cents,
      discount_cents = NEW.discount_cents,
      tax_id = NEW.tax_id,
      tax_rate_snapshot = NEW.tax_rate_snapshot
    WHERE id = v_id;
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.create_v1_for_quote()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mirror_quote_to_current_version() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_v1_for_quote()             TO service_role;
GRANT  EXECUTE ON FUNCTION public.mirror_quote_to_current_version() TO service_role;

COMMIT;

-- Post-state invariant check (runs after the COMMIT above; failures here
-- abort the migration via supabase-cli's per-migration transaction).
DO $$
BEGIN
  -- a) quote_line_items.item_id exists; pricing_item_id does not.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='quote_line_items'
       AND column_name='item_id'
  ) THEN
    RAISE EXCEPTION '0050 post-state: quote_line_items.item_id missing after rename';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='quote_line_items'
       AND column_name='pricing_item_id'
  ) THEN
    RAISE EXCEPTION '0050 post-state: quote_line_items.pricing_item_id still present after rename';
  END IF;

  -- b) quote_versions has every new column.
  FOR i IN 1..8 LOOP
    DECLARE
      v_cols text[] := ARRAY['currency_code','opportunity_id','exchange_rate',
                             'tax_cents','discount_cents','tax_id',
                             'tax_rate_snapshot','deleted_at'];
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='quote_versions'
           AND column_name = v_cols[i]
      ) THEN
        RAISE EXCEPTION '0050 post-state: quote_versions.% missing', v_cols[i];
      END IF;
    END;
  END LOOP;
END $$;
