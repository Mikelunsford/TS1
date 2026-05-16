import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * R-W8D-INTEGRATION-01 — Stock-movement auto-emit triggers
 * (migration 0063).
 *
 * Tags: @wave8d @smoke
 *
 * Verifies that the 3 AFTER triggers introduced by 0063 emit
 * stock_movements rows when the corresponding op state transitions:
 *
 *   1. receiving_orders.status open → received (received_qty bumps) →
 *      ONE 'receipt' stock_movement against bom_items.item_id, qty =
 *      received_qty delta. Re-receiving against the same RO is
 *      idempotent (delta cleanly accumulates).
 *
 *   2. shipments.status scheduled/loading → shipped → ONE 'shipment'
 *      stock_movement against projects.finished_good_item_id, qty =
 *      qty_shipped.
 *
 *   3. production_runs.status in_progress → completed → N 'consumption'
 *      stock_movements (one per linked BOM row) + ONE 'production_output'
 *      stock_movement (finished good).
 *
 * Each event-emit reduces or increases the matching stock_levels row
 * via the 0061 AIUD recompute trigger.
 *
 * API path is direct DB (admin client) because:
 *   (a) the ops-api complete/receive/ship handlers only mutate status +
 *       qty fields; they don't write stock_movements (verified at PR
 *       time — no grep hits for 'stock_movements' in
 *       supabase/functions/ops-api/);
 *   (b) the triggers fire regardless of caller; testing via the DB
 *       proves the trigger contract without depending on the bundle
 *       gate or the ops-api SPA.
 *
 * Required env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Missing env → skip.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REQUIRED_ENV_PRESENT = Boolean(SUPABASE_URL && SERVICE_ROLE);

function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

interface Fixture {
  org_id: string;
  warehouse_id: string;
  project_id: string;
  finished_good_item_id: string;
  raw_material_item_id: string;
  bom_item_id: string;
}

async function makeFixture(): Promise<Fixture> {
  const admin = adminClient();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `wave8d-stock-${suffix}`.slice(0, 63).toLowerCase();

  // Org
  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .insert({ slug, display_name: 'Wave8d Stock Auto-Emit', default_currency_code: 'USD' })
    .select('id')
    .single();
  if (orgErr || !orgRow) throw new Error(`org create failed: ${orgErr?.message}`);
  const org_id = orgRow.id as string;

  // Default warehouse via seed fn.
  const { data: whSeed } = await admin.rpc('seed_org_default_warehouse', { p_org_id: org_id });
  const warehouse_id = whSeed as unknown as string;

  // Two items: a finished good + a raw material.
  const { data: fgItem, error: fgErr } = await admin
    .from('items')
    .insert({
      org_id,
      item_code: `FG-${suffix}`,
      description: 'Finished Good (Wave8d)',
      item_kind: 'inventory',
      unit_price_cents: 50000,
      unit_cost_cents: 30000,
      is_inventoried: true,
      is_active: true,
    })
    .select('id')
    .single();
  if (fgErr || !fgItem) throw new Error(`fg item create failed: ${fgErr?.message}`);

  const { data: rmItem, error: rmErr } = await admin
    .from('items')
    .insert({
      org_id,
      item_code: `RM-${suffix}`,
      description: 'Raw Material (Wave8d)',
      item_kind: 'inventory',
      unit_price_cents: 1000,
      unit_cost_cents: 500,
      is_inventoried: true,
      is_active: true,
    })
    .select('id')
    .single();
  if (rmErr || !rmItem) throw new Error(`rm item create failed: ${rmErr?.message}`);

  // Project with finished_good_item_id wired.
  const { data: projRow, error: projErr } = await admin
    .from('projects')
    .insert({
      org_id,
      project_number: `P-${suffix}`,
      name: 'Wave8d Stock Auto-Emit Project',
      status: 'in_progress',
      currency_code: 'USD',
      total_cents: 0,
      budget_cents: 0,
      finished_good_item_id: fgItem.id,
    })
    .select('id')
    .single();
  if (projErr || !projRow) throw new Error(`project create failed: ${projErr?.message}`);

  // BOM row linking the raw material.
  const { data: bomRow, error: bomErr } = await admin
    .from('bom_items')
    .insert({
      org_id,
      project_id: projRow.id,
      description: 'Raw material consumption',
      quantity: 5,
      source: 't1_purchase',
      position: 0,
      unit_cost_cents: 500,
      item_id: rmItem.id,
    })
    .select('id')
    .single();
  if (bomErr || !bomRow) throw new Error(`bom_items create failed: ${bomErr?.message}`);

  return {
    org_id,
    warehouse_id,
    project_id: projRow.id,
    finished_good_item_id: fgItem.id,
    raw_material_item_id: rmItem.id,
    bom_item_id: bomRow.id,
  };
}

async function teardown(fx: Fixture): Promise<void> {
  const admin = adminClient();
  // Order: stock_movements → stock_levels → shipments/production_runs/receiving_orders
  // → bom_items → projects → items → warehouses → org_*. stock_movements is
  // append-only with SELECT-only RLS, but service_role bypasses; we still
  // delete child rows first to satisfy FKs.
  await admin.from('shipments').delete().eq('org_id', fx.org_id);
  await admin.from('production_runs').delete().eq('org_id', fx.org_id);
  await admin.from('receiving_orders').delete().eq('org_id', fx.org_id);
  await admin.from('stock_movements').delete().eq('org_id', fx.org_id);
  await admin.from('stock_levels').delete().eq('org_id', fx.org_id);
  await admin.from('bom_items').delete().eq('org_id', fx.org_id);
  await admin.from('projects').delete().eq('org_id', fx.org_id);
  await admin.from('items').delete().eq('org_id', fx.org_id);
  await admin.from('warehouses').delete().eq('org_id', fx.org_id);
  await admin.from('org_feature_flags').delete().eq('org_id', fx.org_id);
  await admin.from('org_settings').delete().eq('org_id', fx.org_id);
  await admin.from('org_branding').delete().eq('org_id', fx.org_id);
  await admin.from('organizations').delete().eq('id', fx.org_id);
}

test.describe('@wave8d @smoke R-W8D-INTEGRATION-01 stock-movement auto-emit', () => {
  test.skip(
    !REQUIRED_ENV_PRESENT,
    'Required env not set: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY',
  );

  let fx: Fixture;

  test.beforeAll(async () => {
    fx = await makeFixture();
  });

  test.afterAll(async () => {
    if (fx) await teardown(fx).catch(() => undefined);
  });

  test('receiving_order partial → received emits delta receipts; idempotent on re-fire', async () => {
    const admin = adminClient();
    const suffix = Math.floor(Math.random() * 1e6);

    const { data: ro, error: roErr } = await admin
      .from('receiving_orders')
      .insert({
        org_id: fx.org_id,
        ro_number: `RO-${suffix}`,
        project_id: fx.project_id,
        bom_item_id: fx.bom_item_id,
        source: 't1_purchase',
        status: 'open',
        expected_qty: 10,
        received_qty: 0,
      })
      .select('id')
      .single();
    expect(roErr).toBeNull();
    expect(ro).toBeTruthy();

    // Partial receive 4 of 10.
    await admin
      .from('receiving_orders')
      .update({ status: 'partial', received_qty: 4 })
      .eq('id', ro!.id);

    let { data: sm1 } = await admin
      .from('stock_movements')
      .select('quantity, movement_type, reference_type, reference_id')
      .eq('reference_type', 'receiving_order')
      .eq('reference_id', ro!.id);
    expect(sm1?.length, 'one row emitted on partial').toBe(1);
    expect(Number(sm1![0].quantity)).toBe(4);
    expect(sm1![0].movement_type).toBe('receipt');

    // Final receive remaining 6.
    await admin
      .from('receiving_orders')
      .update({ status: 'received', received_qty: 10, received_at: new Date().toISOString() })
      .eq('id', ro!.id);

    const { data: sm2 } = await admin
      .from('stock_movements')
      .select('quantity, movement_type, reference_type, reference_id')
      .eq('reference_type', 'receiving_order')
      .eq('reference_id', ro!.id)
      .order('occurred_at', { ascending: true });
    expect(sm2?.length, 'two rows total — one per state-transition with delta').toBe(2);
    const totalReceived = sm2!.reduce((acc, r) => acc + Number(r.quantity), 0);
    expect(totalReceived).toBe(10);

    // stock_levels for raw_material should reflect +10.
    const { data: lvl } = await admin
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('org_id', fx.org_id)
      .eq('item_id', fx.raw_material_item_id)
      .eq('warehouse_id', fx.warehouse_id)
      .single();
    expect(Number(lvl?.quantity_on_hand)).toBe(10);
  });

  test('production_run completed emits N consumption + 1 production_output; idempotent on re-fire', async () => {
    const admin = adminClient();
    const suffix = Math.floor(Math.random() * 1e6);

    // Capture pre-completion finished-good level.
    const { data: lvlPre } = await admin
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('org_id', fx.org_id)
      .eq('item_id', fx.finished_good_item_id)
      .eq('warehouse_id', fx.warehouse_id)
      .maybeSingle();
    const fgPre = Number(lvlPre?.quantity_on_hand ?? 0);

    const { data: rmPre } = await admin
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('org_id', fx.org_id)
      .eq('item_id', fx.raw_material_item_id)
      .eq('warehouse_id', fx.warehouse_id)
      .maybeSingle();
    const rmPreQty = Number(rmPre?.quantity_on_hand ?? 0);

    const { data: pr, error: prErr } = await admin
      .from('production_runs')
      .insert({
        org_id: fx.org_id,
        run_number: `PR-${suffix}`,
        project_id: fx.project_id,
        status: 'in_progress',
        qty_target: 3,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    expect(prErr).toBeNull();
    expect(pr).toBeTruthy();

    // Complete the run.
    await admin
      .from('production_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', pr!.id);

    // Consumption rows (one per BOM row with item_id NOT NULL).
    const { data: cons } = await admin
      .from('stock_movements')
      .select('quantity, movement_type, reference_type, reference_id, item_id')
      .eq('reference_type', 'production_consumption')
      .eq('reference_id', fx.bom_item_id);
    expect(cons?.length, 'one consumption row per BOM line').toBe(1);
    expect(cons![0].movement_type).toBe('consumption');
    expect(Number(cons![0].quantity)).toBe(5);

    // Finished good receipt.
    const { data: fgRcv } = await admin
      .from('stock_movements')
      .select('quantity, movement_type, reference_type, reference_id, item_id')
      .eq('reference_type', 'production_run')
      .eq('reference_id', pr!.id);
    expect(fgRcv?.length, 'one production_output row').toBe(1);
    expect(fgRcv![0].movement_type).toBe('production_output');
    expect(Number(fgRcv![0].quantity)).toBe(3);
    expect(fgRcv![0].item_id).toBe(fx.finished_good_item_id);

    // Levels: FG += 3, RM -= 5.
    const { data: lvlPostFg } = await admin
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('org_id', fx.org_id)
      .eq('item_id', fx.finished_good_item_id)
      .eq('warehouse_id', fx.warehouse_id)
      .single();
    expect(Number(lvlPostFg!.quantity_on_hand)).toBe(fgPre + 3);

    const { data: lvlPostRm } = await admin
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('org_id', fx.org_id)
      .eq('item_id', fx.raw_material_item_id)
      .eq('warehouse_id', fx.warehouse_id)
      .single();
    expect(Number(lvlPostRm!.quantity_on_hand)).toBe(rmPreQty - 5);
  });

  test('shipment shipped emits one shipment movement against finished_good_item_id', async () => {
    const admin = adminClient();
    const suffix = Math.floor(Math.random() * 1e6);

    const { data: lvlPre } = await admin
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('org_id', fx.org_id)
      .eq('item_id', fx.finished_good_item_id)
      .eq('warehouse_id', fx.warehouse_id)
      .single();
    const fgPre = Number(lvlPre!.quantity_on_hand);

    const { data: shp, error: shpErr } = await admin
      .from('shipments')
      .insert({
        org_id: fx.org_id,
        shipment_number: `SH-${suffix}`,
        project_id: fx.project_id,
        status: 'loading',
        qty_shipped: 2,
        carrier_name: 'Wave8d Carrier',
        loading_started_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    expect(shpErr).toBeNull();
    expect(shp).toBeTruthy();

    await admin
      .from('shipments')
      .update({ status: 'shipped', shipped_at: new Date().toISOString() })
      .eq('id', shp!.id);

    const { data: sm } = await admin
      .from('stock_movements')
      .select('quantity, movement_type, reference_type, reference_id, item_id')
      .eq('reference_type', 'shipment')
      .eq('reference_id', shp!.id);
    expect(sm?.length, 'one shipment movement emitted').toBe(1);
    expect(sm![0].movement_type).toBe('shipment');
    expect(Number(sm![0].quantity)).toBe(2);
    expect(sm![0].item_id).toBe(fx.finished_good_item_id);

    const { data: lvlPost } = await admin
      .from('stock_levels')
      .select('quantity_on_hand')
      .eq('org_id', fx.org_id)
      .eq('item_id', fx.finished_good_item_id)
      .eq('warehouse_id', fx.warehouse_id)
      .single();
    expect(Number(lvlPost!.quantity_on_hand)).toBe(fgPre - 2);
  });

  test('production_run.complete with NULL finished_good_item_id raises (fail-loud)', async () => {
    const admin = adminClient();
    const suffix = Math.floor(Math.random() * 1e6);

    // Make a sibling project with NULL finished_good_item_id.
    const { data: proj, error: projErr } = await admin
      .from('projects')
      .insert({
        org_id: fx.org_id,
        project_number: `P-NIL-${suffix}`,
        name: 'Wave8d NIL FG',
        status: 'in_progress',
        currency_code: 'USD',
        total_cents: 0,
        budget_cents: 0,
        finished_good_item_id: null,
      })
      .select('id')
      .single();
    expect(projErr).toBeNull();

    const { data: pr, error: prErr } = await admin
      .from('production_runs')
      .insert({
        org_id: fx.org_id,
        run_number: `PR-NIL-${suffix}`,
        project_id: proj!.id,
        status: 'in_progress',
        qty_target: 1,
      })
      .select('id')
      .single();
    expect(prErr).toBeNull();

    const { error: completeErr } = await admin
      .from('production_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', pr!.id);
    expect(completeErr, 'complete must fail when finished_good_item_id is NULL').not.toBeNull();
    expect(completeErr?.message ?? '').toMatch(/finished_good_item_id/);

    // Cleanup the NIL project + run.
    await admin.from('production_runs').delete().eq('id', pr!.id);
    await admin.from('projects').delete().eq('id', proj!.id);
  });
});
