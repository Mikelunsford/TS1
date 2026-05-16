-- 0054_customers_rename_name_to_display_name.sql
-- Wave 6 / F-Wave6-03 — closes R-W1-08 / R-W2-09 / F-Wave4-09.
--
-- Renames the TS-era `customers.name` column to `customers.display_name` to
-- match the wire contract (and the Zod canon, which has always called the
-- field `display_name`). Eliminates the boundary mapping in the customers
-- handler and the defensive `display_name ?? name` fallback in quotes.ts +
-- invoices.ts ensureCustomerInOrg.
--
-- Step-2 verification (MCP 2026-05-16):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='customers'
--      AND column_name IN ('name','display_name');
--   -- → only `name` (display_name absent; this migration adds it via rename).
--
-- The wire contract is unchanged — the SPA + Zod schemas have always used
-- `display_name`. Handler `rowToCustomer` mappings collapse from
-- `display_name: row.name` to `display_name: row.display_name`. The
-- `quotes-api/handlers/quotes.ts#ensureCustomerInOrg` and
-- `invoicing-api/handlers/invoices.ts#ensureCustomerInOrg` SELECTs simplify
-- from `select('id, display_name, name')` to `select('id, display_name')`
-- (the dual-select was forward-compat-ready for this rename).
--
-- Forward-only. The companion code-wide rename ships in the same PR so
-- main never sees a half-renamed state.
--
-- Pattern model: Wave 4 PR #37 / migration 0050 renamed
-- `quote_line_items.pricing_item_id → item_id` in the same shape (single-
-- column ALTER TABLE … RENAME; no view; handlers updated in the same PR).
--
-- Date:     2026-05-16
-- Sub-wave: 6.0b
-- Closes:   R-W1-08 (column-naming inconsistency), R-W2-09 (CRM-extend
--           carryover), F-Wave4-09 (Wave 4 deferral).
--
-- DOWN MIGRATION:
--   ALTER TABLE public.customers RENAME COLUMN display_name TO name;

BEGIN;

-- Pre-rename invariant: target column absent, source column present.
DO $$
DECLARE
  v_name_count integer;
  v_display_count integer;
BEGIN
  SELECT COUNT(*) INTO v_name_count
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='customers' AND column_name='name';
  SELECT COUNT(*) INTO v_display_count
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='customers' AND column_name='display_name';

  IF v_name_count <> 1 OR v_display_count <> 0 THEN
    RAISE EXCEPTION
      '0054 pre-rename assertion failed: name_count=% display_name_count=% (expected 1 / 0).',
      v_name_count, v_display_count;
  END IF;
END $$;

ALTER TABLE public.customers RENAME COLUMN name TO display_name;

-- Post-rename invariant: source column gone, target column present.
DO $$
DECLARE
  v_name_count integer;
  v_display_count integer;
BEGIN
  SELECT COUNT(*) INTO v_name_count
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='customers' AND column_name='name';
  SELECT COUNT(*) INTO v_display_count
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='customers' AND column_name='display_name';

  IF v_name_count <> 0 OR v_display_count <> 1 THEN
    RAISE EXCEPTION
      '0054 post-rename assertion failed: name_count=% display_name_count=% (expected 0 / 1).',
      v_name_count, v_display_count;
  END IF;
END $$;

COMMIT;
