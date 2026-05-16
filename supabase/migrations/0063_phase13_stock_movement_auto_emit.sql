-- 0063_phase13_stock_movement_auto_emit.sql
-- R-W8D-INTEGRATION-01 — Stock-movement auto-emit triggers
-- Constitutional rule (00-SHARED-CONTEXT.md → Allowed Patterns:
-- "Triggers for audit log and journal entry generation, not application
-- code") applied to stock-movement generation. Handlers continue to
-- mutate receiving_orders / production_runs / shipments status/quantity
-- columns; triggers in this migration emit the corresponding
-- stock_movements rows. ops-api handlers contain no stock_movements
-- writes today (verified via grep at PR time) — no handler edits.
--
-- ------------------------------------------------------------------
-- Schema reality reconciled with original dispatch brief (Step-2 MCP
-- verification, 2026-05-16):
--   - receiving_orders / production_runs / shipments are HEADER-ONLY
--     (no *_lines tables). The header carries the single item link:
--       receiving_orders.bom_item_id (FK to bom_items)
--       production_runs.project_id  (BOM resolved via bom_items.project_id)
--       shipments.project_id        (finished good via projects.finished_good_item_id)
--   - stock_movements columns are `reference_type` / `reference_id`
--     (NOT source_type / source_id) and `quantity` is sign-bearing-by-
--     movement_type (NOT a signed `quantity_delta`).
--   - movement_type is a `text` CHECK (NOT an enum). Existing values:
--     receipt / shipment / adjustment / transfer_in / transfer_out /
--     consumption / return. We add 'production_output' for the
--     finished-good receipt half of a production_run completion.
--   - reference_type is a `text` CHECK. Existing values:
--     receiving_order / shipment / production_consumption /
--     purchase_order / manual. We add 'production_run' (finished-good
--     receipt half) so the BOM-consumption rows can keep using
--     'production_consumption' while the finished-good row uses
--     'production_run' (avoids ambiguity).
--   - state enums (USER-DEFINED): receiving_order_state /
--     production_run_state / shipment_state — values match the
--     dispatch brief.
--
-- ------------------------------------------------------------------
-- Schema additions
--
--   1. bom_items.item_id   uuid REFERENCES items(id)   — nullable.
--      Index idx_bom_items_item_id (org_id, item_id) WHERE item_id IS
--      NOT NULL. No backfill — bom_items currently keys by free-form
--      `sku` text + `description`; fuzzy backfill could mis-link
--      inventory. Orgs adopt this as they wire their BOM rows to
--      catalog items. Trigger raises 422 when production_run.complete
--      fires against unlinked BOM rows (fail-loud-by-design).
--
--   2. projects.finished_good_item_id uuid REFERENCES items(id)
--      — nullable. Index idx_projects_finished_good_item_id
--      (org_id, finished_good_item_id) WHERE finished_good_item_id IS
--      NOT NULL. No backfill. Trigger raises 422 when
--      production_run.complete or shipment.shipped fires against a
--      project without it.
--
--   3. stock_movements movement_type CHECK extended: adds
--      'production_output'.
--
--   4. stock_movements reference_type CHECK extended: adds
--      'production_run'.
--
--   5. CHECK trigger refusing stock_movements INSERT where quantity=0
--      (defense-in-depth — zero-quantity movements pollute the audit
--      log and waste recompute cycles).
--
-- ------------------------------------------------------------------
-- Trigger functions (all SECURITY DEFINER, search_path=public,
-- service_role-only EXECUTE):
--
--   tg_receiving_orders_emit_movements
--     AFTER UPDATE OF received_qty, status ON receiving_orders
--     FIRES WHEN received_qty increases AND status IN ('partial','received').
--     Resolves item_id from bom_items via NEW.bom_item_id;
--     raises 422 if bom_items.item_id is NULL.
--     Idempotency: emits a row of quantity = (NEW.received_qty -
--     SUM(quantity stock_movements WHERE reference_type='receiving_order'
--     AND reference_id=NEW.id)). If delta <= 0 → no-op. This allows
--     multiple partial-receive events to cleanly accumulate without
--     duplicate-emission.
--
--   tg_production_runs_emit_movements
--     AFTER UPDATE OF status ON production_runs
--     FIRES WHEN NEW.status='completed' AND OLD.status <> 'completed'.
--     Resolves finished good from projects.finished_good_item_id
--     (NEW.project_id) — raises 422 if NULL.
--     For each bom_items row (org_id, project_id) with item_id IS NOT
--     NULL, emits a 'consumption' movement (positive quantity; sign
--     carried by movement_type per 0061 §3 convention) of bom.quantity
--     — reference_type='production_consumption', reference_id=bom.id.
--     For the finished good, emits a 'production_output' movement of
--     NEW.qty_target — reference_type='production_run',
--     reference_id=NEW.id.
--     Idempotency: SKIP if a stock_movement already exists with
--     matching (reference_type, reference_id) tuple. Consumption rows
--     keyed by bom_items.id make this fully re-run safe.
--     Fail-loud: any unlinked bom_items row (item_id IS NULL) on a
--     project that has finished_good_item_id set raises 422 —
--     forces the org to finish wiring before completing the run.
--
--   tg_shipments_emit_movements
--     AFTER UPDATE OF status ON shipments
--     FIRES WHEN NEW.status='shipped' AND OLD.status <> 'shipped'.
--     Resolves finished good via NEW.project_id → projects.finished_good_item_id.
--     Raises 422 if NULL.
--     Emits a single 'shipment' movement of NEW.qty_shipped —
--     reference_type='shipment', reference_id=NEW.id. Idempotent on
--     (reference_type, reference_id).
--
-- All emit triggers route via service_role EXECUTE because the
-- recompute_stock_level call (tg_stock_movements_recompute from 0061)
-- writes to stock_levels and stock_levels RLS is service_role-only.
--
-- ------------------------------------------------------------------
-- Forward-only. No DML edits to existing tables.
--
-- Date:     2026-05-16
-- Sub-wave: 8d.1 (R-W8D-INTEGRATION-01 polish)
-- Closes:   R-W8D-INTEGRATION-01.

BEGIN;

-- ============================================================================
-- 1. bom_items.item_id
-- ============================================================================

ALTER TABLE public.bom_items
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.items(id);

CREATE INDEX IF NOT EXISTS idx_bom_items_item_id
  ON public.bom_items (org_id, item_id)
  WHERE item_id IS NOT NULL;

COMMENT ON COLUMN public.bom_items.item_id IS
  'R-W8D-INTEGRATION-01 (0063): optional FK to items(id). When set, '
  'production_runs.complete will emit stock_movements consumption rows '
  'against this item. NULL bom rows on a complete-attempted run raise '
  '422 — fail-loud-by-design.';

-- ============================================================================
-- 2. projects.finished_good_item_id
-- ============================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS finished_good_item_id uuid REFERENCES public.items(id);

CREATE INDEX IF NOT EXISTS idx_projects_finished_good_item_id
  ON public.projects (org_id, finished_good_item_id)
  WHERE finished_good_item_id IS NOT NULL;

COMMENT ON COLUMN public.projects.finished_good_item_id IS
  'R-W8D-INTEGRATION-01 (0063): optional FK to items(id) — the item '
  'representing the finished product of this project. Required before '
  'shipping or completing a production_run; both triggers raise 422 '
  'if NULL at fire-time.';

-- ============================================================================
-- 3. Extend stock_movements movement_type CHECK (adds 'production_output')
-- ============================================================================

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type = ANY (ARRAY[
    'receipt'::text,
    'shipment'::text,
    'adjustment'::text,
    'transfer_in'::text,
    'transfer_out'::text,
    'consumption'::text,
    'return'::text,
    'production_output'::text
  ]));

-- ============================================================================
-- 4. Extend stock_movements reference_type CHECK (adds 'production_run')
-- ============================================================================

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_reference_type_check
  CHECK (
    reference_type IS NULL OR reference_type = ANY (ARRAY[
      'receiving_order'::text,
      'shipment'::text,
      'production_consumption'::text,
      'production_run'::text,
      'purchase_order'::text,
      'manual'::text
    ])
  );

-- ============================================================================
-- 5. Update recompute_stock_level to recognize 'production_output' as +qty
-- ============================================================================
--
-- 0061 §3 hard-coded the movement-type → sign map. 'production_output'
-- is new in this migration and must count as +qty (a receipt of the
-- finished good).

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
      WHEN movement_type IN ('receipt','transfer_in','return','production_output') THEN quantity
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
-- 6. CHECK trigger: refuse stock_movements INSERT where quantity = 0
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_stock_movements_reject_zero()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.quantity, 0) = 0 THEN
    RAISE EXCEPTION 'stock_movements: quantity must be non-zero (got 0 for movement_type=%)', NEW.movement_type
      USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_stock_movements_reject_zero ON public.stock_movements;
CREATE TRIGGER tg_stock_movements_reject_zero
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_stock_movements_reject_zero();

-- ============================================================================
-- 7. tg_receiving_orders_emit_movements
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_receiving_orders_emit_movements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id      uuid;
  v_warehouse_id uuid;
  v_already      numeric(14,4);
  v_delta        numeric(14,4);
BEGIN
  -- Only act on state machine transitions that move qty into stock.
  IF NEW.status NOT IN ('partial','received') THEN
    RETURN NEW;
  END IF;
  -- Only fire when received_qty actually increased.
  IF COALESCE(NEW.received_qty, 0) <= COALESCE(OLD.received_qty, 0) THEN
    RETURN NEW;
  END IF;

  -- Resolve item via bom_items.item_id.
  IF NEW.bom_item_id IS NULL THEN
    RAISE EXCEPTION
      'tg_receiving_orders_emit_movements: receiving_order % has NULL bom_item_id — cannot emit stock receipt',
      NEW.id
      USING ERRCODE='check_violation';
  END IF;

  SELECT item_id INTO v_item_id
    FROM public.bom_items
   WHERE id = NEW.bom_item_id;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION
      'tg_receiving_orders_emit_movements: bom_items.% has NULL item_id — set bom_items.item_id before receiving against receiving_order %',
      NEW.bom_item_id, NEW.id
      USING ERRCODE='check_violation';
  END IF;

  v_warehouse_id := public._default_warehouse_id(NEW.org_id);
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION
      'tg_receiving_orders_emit_movements: org % has no default warehouse',
      NEW.org_id
      USING ERRCODE='check_violation';
  END IF;

  -- Idempotency: receiving can be partial-then-final. SUM existing
  -- emissions for this RO; emit only the incremental delta.
  SELECT COALESCE(SUM(quantity), 0)
    INTO v_already
    FROM public.stock_movements
   WHERE org_id         = NEW.org_id
     AND reference_type = 'receiving_order'
     AND reference_id   = NEW.id;

  v_delta := COALESCE(NEW.received_qty, 0) - v_already;

  IF v_delta <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.stock_movements (
    org_id, item_id, warehouse_id, movement_type,
    quantity, unit_cost_cents, reference_type, reference_id,
    notes, occurred_at
  ) VALUES (
    NEW.org_id, v_item_id, v_warehouse_id, 'receipt',
    v_delta, 0, 'receiving_order', NEW.id,
    'Auto-emit: receiving_order ' || NEW.ro_number || ' status ' || NEW.status::text,
    COALESCE(NEW.received_at, now())
  );

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_receiving_orders_emit_movements() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_receiving_orders_emit_movements() TO service_role;

DROP TRIGGER IF EXISTS tg_receiving_orders_emit_movements ON public.receiving_orders;
CREATE TRIGGER tg_receiving_orders_emit_movements
  AFTER UPDATE OF received_qty, status ON public.receiving_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_receiving_orders_emit_movements();

-- ============================================================================
-- 8. tg_shipments_emit_movements
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_shipments_emit_movements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id      uuid;
  v_warehouse_id uuid;
BEGIN
  -- Only fire on transition INTO shipped.
  IF NEW.status <> 'shipped' THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Idempotency: skip if shipment row already emitted.
  IF EXISTS (
    SELECT 1 FROM public.stock_movements
     WHERE org_id         = NEW.org_id
       AND reference_type = 'shipment'
       AND reference_id   = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  -- Resolve finished good via projects.
  SELECT finished_good_item_id INTO v_item_id
    FROM public.projects
   WHERE id = NEW.project_id;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION
      'tg_shipments_emit_movements: shipment %.shipped requires projects.finished_good_item_id to be set on project %',
      NEW.id, NEW.project_id
      USING ERRCODE='check_violation';
  END IF;

  v_warehouse_id := public._default_warehouse_id(NEW.org_id);
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION
      'tg_shipments_emit_movements: org % has no default warehouse',
      NEW.org_id
      USING ERRCODE='check_violation';
  END IF;

  IF COALESCE(NEW.qty_shipped, 0) = 0 THEN
    -- Zero-qty shipment is a logical no-op; skip silently rather than
    -- tripping the reject_zero CHECK trigger (the reject trigger
    -- defends against manual writes, not auto-emit edge cases).
    RETURN NEW;
  END IF;

  INSERT INTO public.stock_movements (
    org_id, item_id, warehouse_id, movement_type,
    quantity, unit_cost_cents, reference_type, reference_id,
    notes, occurred_at
  ) VALUES (
    NEW.org_id, v_item_id, v_warehouse_id, 'shipment',
    NEW.qty_shipped, 0, 'shipment', NEW.id,
    'Auto-emit: shipment ' || NEW.shipment_number || ' shipped',
    COALESCE(NEW.shipped_at, now())
  );

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_shipments_emit_movements() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_shipments_emit_movements() TO service_role;

DROP TRIGGER IF EXISTS tg_shipments_emit_movements ON public.shipments;
CREATE TRIGGER tg_shipments_emit_movements
  AFTER UPDATE OF status ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_shipments_emit_movements();

-- ============================================================================
-- 9. tg_production_runs_emit_movements
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_production_runs_emit_movements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_finished_item uuid;
  v_warehouse_id  uuid;
  v_unlinked      integer;
  v_bom           record;
BEGIN
  -- Only fire on transition INTO completed.
  IF NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Resolve finished good.
  SELECT finished_good_item_id INTO v_finished_item
    FROM public.projects
   WHERE id = NEW.project_id;

  IF v_finished_item IS NULL THEN
    RAISE EXCEPTION
      'tg_production_runs_emit_movements: production_run %.complete requires projects.finished_good_item_id to be set on project %',
      NEW.id, NEW.project_id
      USING ERRCODE='check_violation';
  END IF;

  v_warehouse_id := public._default_warehouse_id(NEW.org_id);
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION
      'tg_production_runs_emit_movements: org % has no default warehouse',
      NEW.org_id
      USING ERRCODE='check_violation';
  END IF;

  -- Fail-loud: any unlinked BOM rows (item_id IS NULL) on this project
  -- block completion. Forces the org to wire bom_items.item_id before
  -- consuming inventory.
  SELECT COUNT(*) INTO v_unlinked
    FROM public.bom_items
   WHERE org_id     = NEW.org_id
     AND project_id = NEW.project_id
     AND item_id IS NULL
     AND COALESCE(quantity, 0) > 0;

  IF v_unlinked > 0 THEN
    RAISE EXCEPTION
      'tg_production_runs_emit_movements: project % has % bom_items row(s) with NULL item_id — set bom_items.item_id before completing production_run %',
      NEW.project_id, v_unlinked, NEW.id
      USING ERRCODE='check_violation';
  END IF;

  -- Emit consumption rows, one per bom_items row. Idempotent per-row
  -- via (reference_type='production_consumption', reference_id=bom.id).
  FOR v_bom IN
    SELECT id, item_id, quantity
      FROM public.bom_items
     WHERE org_id     = NEW.org_id
       AND project_id = NEW.project_id
       AND item_id IS NOT NULL
       AND COALESCE(quantity, 0) > 0
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.stock_movements
       WHERE org_id         = NEW.org_id
         AND reference_type = 'production_consumption'
         AND reference_id   = v_bom.id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.stock_movements (
      org_id, item_id, warehouse_id, movement_type,
      quantity, unit_cost_cents, reference_type, reference_id,
      notes, occurred_at
    ) VALUES (
      NEW.org_id, v_bom.item_id, v_warehouse_id, 'consumption',
      v_bom.quantity, 0, 'production_consumption', v_bom.id,
      'Auto-emit: production_run ' || NEW.run_number || ' consumed bom_item ' || v_bom.id::text,
      COALESCE(NEW.completed_at, now())
    );
  END LOOP;

  -- Emit finished-good receipt. Idempotent on (production_run, NEW.id).
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_movements
     WHERE org_id         = NEW.org_id
       AND reference_type = 'production_run'
       AND reference_id   = NEW.id
  ) THEN
    IF COALESCE(NEW.qty_target, 0) > 0 THEN
      INSERT INTO public.stock_movements (
        org_id, item_id, warehouse_id, movement_type,
        quantity, unit_cost_cents, reference_type, reference_id,
        notes, occurred_at
      ) VALUES (
        NEW.org_id, v_finished_item, v_warehouse_id, 'production_output',
        NEW.qty_target, 0, 'production_run', NEW.id,
        'Auto-emit: production_run ' || NEW.run_number || ' completed (finished good)',
        COALESCE(NEW.completed_at, now())
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.tg_production_runs_emit_movements() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tg_production_runs_emit_movements() TO service_role;

DROP TRIGGER IF EXISTS tg_production_runs_emit_movements ON public.production_runs;
CREATE TRIGGER tg_production_runs_emit_movements
  AFTER UPDATE OF status ON public.production_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_production_runs_emit_movements();

-- ============================================================================
-- 10. Post-state invariants
-- ============================================================================

DO $$
DECLARE
  v_col_bom    integer;
  v_col_proj   integer;
  v_trg_recv   integer;
  v_trg_ship   integer;
  v_trg_prod   integer;
  v_trg_zero   integer;
  v_mv_check   text;
  v_rt_check   text;
BEGIN
  SELECT COUNT(*) INTO v_col_bom
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='bom_items' AND column_name='item_id';
  IF v_col_bom = 0 THEN
    RAISE EXCEPTION '0063 post-state: bom_items.item_id missing';
  END IF;

  SELECT COUNT(*) INTO v_col_proj
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='projects' AND column_name='finished_good_item_id';
  IF v_col_proj = 0 THEN
    RAISE EXCEPTION '0063 post-state: projects.finished_good_item_id missing';
  END IF;

  SELECT COUNT(*) INTO v_trg_recv FROM pg_trigger
   WHERE tgname='tg_receiving_orders_emit_movements';
  IF v_trg_recv = 0 THEN
    RAISE EXCEPTION '0063 post-state: tg_receiving_orders_emit_movements missing';
  END IF;

  SELECT COUNT(*) INTO v_trg_ship FROM pg_trigger
   WHERE tgname='tg_shipments_emit_movements';
  IF v_trg_ship = 0 THEN
    RAISE EXCEPTION '0063 post-state: tg_shipments_emit_movements missing';
  END IF;

  SELECT COUNT(*) INTO v_trg_prod FROM pg_trigger
   WHERE tgname='tg_production_runs_emit_movements';
  IF v_trg_prod = 0 THEN
    RAISE EXCEPTION '0063 post-state: tg_production_runs_emit_movements missing';
  END IF;

  SELECT COUNT(*) INTO v_trg_zero FROM pg_trigger
   WHERE tgname='tg_stock_movements_reject_zero';
  IF v_trg_zero = 0 THEN
    RAISE EXCEPTION '0063 post-state: tg_stock_movements_reject_zero missing';
  END IF;

  -- Confirm CHECK constraints carry the new values.
  SELECT pg_get_constraintdef(oid) INTO v_mv_check
    FROM pg_constraint
   WHERE conrelid='public.stock_movements'::regclass
     AND conname='stock_movements_movement_type_check';
  IF v_mv_check NOT LIKE '%production_output%' THEN
    RAISE EXCEPTION '0063 post-state: movement_type CHECK missing production_output (got %)', v_mv_check;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_rt_check
    FROM pg_constraint
   WHERE conrelid='public.stock_movements'::regclass
     AND conname='stock_movements_reference_type_check';
  IF v_rt_check NOT LIKE '%production_run%' THEN
    RAISE EXCEPTION '0063 post-state: reference_type CHECK missing production_run (got %)', v_rt_check;
  END IF;
END $$;

COMMIT;
