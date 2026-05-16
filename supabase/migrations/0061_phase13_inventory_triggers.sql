-- 0061_phase13_inventory_triggers.sql
-- Wave 8d / Phase 13 — Inventory + ops-api real-route prerequisites.
--
-- Sections:
--   1. seed_org_default_warehouse(p_org_id uuid) — idempotent default-warehouse
--      seed used by the BE bootstrap path and inlined here for Team1.
--   2. _default_warehouse_id(p_org_id uuid) — lookup helper for handlers.
--   3. recompute_stock_level(p_org_id, p_item_id, p_warehouse_id) — SUMs
--      stock_movements for one (org,item,warehouse) tuple and UPSERTs
--      stock_levels.quantity_on_hand. `quantity_available` is GENERATED
--      ALWAYS AS (on_hand - reserved) STORED — never write it.
--   4. tg_stock_movements_recompute_level — AIUD trigger on stock_movements
--      that fires recompute_stock_level for the affected (item,warehouse)
--      tuple(s). Cross-tuple UPDATEs recompute both old and new.
--   5. Flag flips: inventory.enabled=true for Team1.
--   6. Post-state DO-block invariants.
--
-- DEFERRED to next polish PR (R-W8D-INTEGRATION-01):
--   - Auto-emit stock_movements on receiving_orders.status transitions
--     (receipt), shipments.status transitions (shipment), and
--     production_runs.status transitions (consumption + production receipt).
--     Reason: bom_items lacks an `item_id` FK to items (only `sku` text +
--     `description`), and projects lack a "finished good" item linkage.
--     Cleanly resolving item_id from BOM rows or projects would require
--     additional schema not in scope for Wave 8d. Until then, the
--     receive / ship / complete ops-api handlers do NOT emit stock_movements
--     — only manual /stock-movements/adjustment writes do. The recompute
--     trigger in §4 still keeps stock_levels coherent with whatever
--     movements land.
--
-- Forward-only. All functions SECURITY INVOKER (or SECURITY DEFINER where
-- noted); RLS still applies on stock_movements / stock_levels in the
-- recompute path because the service-role bypasses it anyway.
--
-- Date:     2026-05-16
-- Sub-wave: 8.4
-- Closes:   activates R-W6-OPS-01 prerequisites (ops-api real routes go
--           live alongside this migration in PR #69).

BEGIN;

-- ============================================================================
-- 1. seed_org_default_warehouse(p_org_id uuid)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_org_default_warehouse(p_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.warehouses
   WHERE org_id = p_org_id
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.warehouses (org_id, code, label, is_default, is_active)
  VALUES (p_org_id, 'DEFAULT', 'Default Warehouse', true, true)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.seed_org_default_warehouse(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.seed_org_default_warehouse(uuid)
  TO service_role;

-- Apply inline for Team1.
SELECT public.seed_org_default_warehouse(id) FROM public.organizations WHERE slug = 'team1';

-- ============================================================================
-- 2. _default_warehouse_id(p_org_id uuid)
-- ============================================================================

CREATE OR REPLACE FUNCTION public._default_warehouse_id(p_org_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT id FROM public.warehouses
   WHERE org_id = p_org_id AND is_active AND is_default
   ORDER BY created_at ASC
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public._default_warehouse_id(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._default_warehouse_id(uuid)
  TO service_role;

-- ============================================================================
-- 3. recompute_stock_level(p_org_id, p_item_id, p_warehouse_id)
-- ============================================================================
--
-- Movement-type sign convention (matches the 0038 CHECK):
--   +qty : receipt, transfer_in, return
--   +qty (sign-bearing): adjustment   (handlers send positive=increase,
--                                       negative=decrease)
--   -qty : shipment, transfer_out, consumption
--
-- `quantity_available` is a GENERATED column (on_hand - reserved). We touch
-- only `quantity_on_hand`; the DB derives availability.

CREATE OR REPLACE FUNCTION public.recompute_stock_level(
  p_org_id uuid,
  p_item_id uuid,
  p_warehouse_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_on_hand numeric(14,4);
BEGIN
  IF p_org_id IS NULL OR p_item_id IS NULL OR p_warehouse_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN movement_type IN ('receipt','transfer_in','return') THEN quantity
      WHEN movement_type IN ('shipment','transfer_out','consumption') THEN -quantity
      WHEN movement_type = 'adjustment' THEN quantity
      ELSE 0
    END
  ), 0)
    INTO v_on_hand
    FROM public.stock_movements
   WHERE org_id = p_org_id
     AND item_id = p_item_id
     AND warehouse_id = p_warehouse_id;

  INSERT INTO public.stock_levels (org_id, item_id, warehouse_id, quantity_on_hand)
  VALUES (p_org_id, p_item_id, p_warehouse_id, v_on_hand)
  ON CONFLICT (item_id, warehouse_id) DO UPDATE
     SET quantity_on_hand = EXCLUDED.quantity_on_hand,
         updated_at       = now();
END $$;

REVOKE EXECUTE ON FUNCTION public.recompute_stock_level(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_stock_level(uuid, uuid, uuid)
  TO service_role;

-- ============================================================================
-- 4. tg_stock_movements_recompute_level — AIUD on stock_movements
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_stock_movements_recompute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_stock_level(OLD.org_id, OLD.item_id, OLD.warehouse_id);
    RETURN OLD;
  END IF;

  PERFORM public.recompute_stock_level(NEW.org_id, NEW.item_id, NEW.warehouse_id);

  IF TG_OP = 'UPDATE' AND (
        OLD.org_id        IS DISTINCT FROM NEW.org_id
     OR OLD.item_id       IS DISTINCT FROM NEW.item_id
     OR OLD.warehouse_id  IS DISTINCT FROM NEW.warehouse_id
  ) THEN
    PERFORM public.recompute_stock_level(OLD.org_id, OLD.item_id, OLD.warehouse_id);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_stock_movements_recompute_level ON public.stock_movements;
CREATE TRIGGER tg_stock_movements_recompute_level
AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW
EXECUTE FUNCTION public.tg_stock_movements_recompute();

-- ============================================================================
-- 5. Flag flips: inventory.enabled=true for Team1
-- ============================================================================

UPDATE public.org_feature_flags off
   SET is_enabled = true,
       updated_at = now()
  FROM public.organizations o
 WHERE off.org_id = o.id
   AND o.slug = 'team1'
   AND off.flag_key IN ('inventory.enabled');

-- ============================================================================
-- 6. Post-state invariants
-- ============================================================================

DO $$
DECLARE
  v_seed_fn_count    integer;
  v_default_fn_count integer;
  v_recompute_count  integer;
  v_trg_count        integer;
  v_team1_wh_count   integer;
  v_team1_flag       boolean;
BEGIN
  SELECT COUNT(*) INTO v_seed_fn_count
    FROM pg_proc WHERE proname = 'seed_org_default_warehouse';
  IF v_seed_fn_count = 0 THEN
    RAISE EXCEPTION '0061 post-state: seed_org_default_warehouse function missing';
  END IF;

  SELECT COUNT(*) INTO v_default_fn_count
    FROM pg_proc WHERE proname = '_default_warehouse_id';
  IF v_default_fn_count = 0 THEN
    RAISE EXCEPTION '0061 post-state: _default_warehouse_id function missing';
  END IF;

  SELECT COUNT(*) INTO v_recompute_count
    FROM pg_proc WHERE proname = 'recompute_stock_level';
  IF v_recompute_count = 0 THEN
    RAISE EXCEPTION '0061 post-state: recompute_stock_level function missing';
  END IF;

  SELECT COUNT(*) INTO v_trg_count
    FROM pg_trigger WHERE tgname = 'tg_stock_movements_recompute_level';
  IF v_trg_count = 0 THEN
    RAISE EXCEPTION '0061 post-state: tg_stock_movements_recompute_level trigger missing';
  END IF;

  SELECT COUNT(*) INTO v_team1_wh_count
    FROM public.warehouses w
    JOIN public.organizations o ON o.id = w.org_id
   WHERE o.slug = 'team1';
  IF v_team1_wh_count = 0 THEN
    RAISE EXCEPTION '0061 post-state: Team1 has no warehouse row';
  END IF;

  SELECT off.is_enabled INTO v_team1_flag
    FROM public.org_feature_flags off
    JOIN public.organizations o ON o.id = off.org_id
   WHERE o.slug = 'team1' AND off.flag_key = 'inventory.enabled';
  IF NOT COALESCE(v_team1_flag, false) THEN
    RAISE EXCEPTION '0061 post-state: inventory.enabled is not true for Team1';
  END IF;
END $$;

COMMIT;
