/**
 * ops-api — /production-runs handlers (Wave 8d / Phase 13).
 *
 * Routes:
 *   GET    /production-runs                  — list (cursor; filters: status,
 *                                                 project_id)
 *   POST   /production-runs                  — create (status='scheduled');
 *                                                 run_number := next_doc_number
 *                                                 (org, 'production_run')
 *   GET    /production-runs/:id              — detail
 *   PATCH  /production-runs/:id              — patch (scheduled-only)
 *   POST   /production-runs/:id/start        — scheduled → in_progress; stamps
 *                                                 started_at
 *   POST   /production-runs/:id/complete     — in_progress → completed; stamps
 *                                                 completed_at
 *   POST   /production-runs/:id/cancel       — any non-terminal → cancelled;
 *                                                 stamps cancelled_at
 *
 * State machine: PRODUCTION_RUN_TRANSITIONS. The DB has a partial unique
 * index `uniq_active_run_per_project` enforcing at most one non-terminal run
 * per project — collisions surface as 23P01/23505 mapped to 409.
 *
 * Stock movement auto-emit on complete is DEFERRED per R-W8D-INTEGRATION-01.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  ProductionRunCreateSchema,
  ProductionRunPatchSchema,
  ProductionRunSchema,
  type ProductionRun,
} from '../../_shared/types.ts';
import { assertTransition, WorkflowError } from '../../_shared/workflow.ts';
import {
  admin,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  requireCap,
  respondWithIdempotency,
  type Caller,
} from '../../_shared/handler-helpers.ts';
import { getNextDocNumber, NumberingError } from '../../_shared/numbering.ts';

const BUNDLE = 'ops-api';
const PR_COLS =
  'id, org_id, run_number, project_id, status, scheduled_for, started_at, ' +
  'completed_at, cancelled_at, qty_target, notes, created_at, updated_at';

interface PrRow {
  id: string;
  org_id: string;
  run_number: string;
  project_id: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  qty_target: string | number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPr(row: PrRow): ProductionRun {
  return ProductionRunSchema.parse(row);
}

// =========================================================== GET /production-runs
export async function listProductionRuns({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'production.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');
  const projectId = url.searchParams.get('project_id');

  let qb = admin()
    .from('production_runs')
    .select(PR_COLS)
    .eq('org_id', caller.orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (status) qb = qb.eq('status', status);
  if (projectId) qb = qb.eq('project_id', projectId);
  if (cursor) {
    qb = qb.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await qb;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'production_runs list failed', 500, { detail: error.message });
  }
  const rows = (data ?? []) as PrRow[];
  const { items, next_cursor } = paginate(rows, limit);
  return ok({ items: items.map(rowToPr), next_cursor }, undefined, { req });
}

// ========================================================== POST /production-runs
export async function createProductionRun({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'production.write');
  const body = await parseBody(req, ProductionRunCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, 'POST /production-runs', body, async () => {
    const { data: project, error: projErr } = await admin()
      .from('projects')
      .select('id')
      .eq('id', body.project_id)
      .eq('org_id', caller.orgId)
      .maybeSingle();
    if (projErr) {
      throw new ApiError('INTERNAL_ERROR', 'project lookup failed', 500, { detail: projErr.message });
    }
    if (!project) throw new ApiError('NOT_FOUND', 'project not found in org', 404);

    let runNumber: string;
    try {
      runNumber = await getNextDocNumber(admin(), caller.orgId, 'production_run');
    } catch (e) {
      if (e instanceof NumberingError) {
        throw new ApiError('INTERNAL_ERROR', 'next_doc_number production_run failed', 500, {
          detail: e.message,
        });
      }
      throw e;
    }

    const insertRow = {
      org_id: caller.orgId,
      run_number: runNumber,
      project_id: body.project_id,
      status: 'scheduled' as const,
      qty_target: body.qty_target,
      scheduled_for: body.scheduled_for ?? null,
      notes: body.notes ?? null,
    };
    const { data, error } = await admin()
      .from('production_runs')
      .insert(insertRow)
      .select(PR_COLS)
      .single();
    if (error || !data) {
      if (error?.code === '23505') {
        throw new ApiError('STATE_CONFLICT', 'a non-terminal production run already exists for this project', 409);
      }
      throw new ApiError('INTERNAL_ERROR', 'production_run insert failed', 500, {
        detail: error?.message,
      });
    }
    return { status: 201, body: { data: rowToPr(data as PrRow) } };
  });
}

// ====================================================== GET /production-runs/:id
export async function getProductionRun({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'production.read');
  const row = await fetchPrRow(caller, params.id);
  return ok(rowToPr(row), undefined, { req });
}

// ==================================================== PATCH /production-runs/:id
export async function patchProductionRun({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'production.write');
  const body = await parseBody(req, ProductionRunPatchSchema);
  const id = params.id;

  return respondWithIdempotency(req, caller, BUNDLE, `PATCH /production-runs/${id}`, body, async () => {
    const existing = await fetchPrRow(caller, id);
    if (existing.status !== 'scheduled') {
      throw new ApiError('STATE_CONFLICT', `cannot edit production_run in status=${existing.status}`, 409);
    }
    const patch: Record<string, unknown> = {};
    for (const k of ['qty_target', 'scheduled_for', 'notes'] as const) {
      if (k in body) patch[k] = (body as Record<string, unknown>)[k];
    }
    const { data, error } = await admin()
      .from('production_runs')
      .update(patch)
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .select(PR_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 'production_run update failed', 500, {
        detail: error?.message,
      });
    }
    return { status: 200, body: { data: rowToPr(data as PrRow) } };
  });
}

// --------- workflow transitions ----------

async function transitionPr(
  req: Request,
  id: string,
  to: 'in_progress' | 'completed' | 'cancelled',
  stampCol: 'started_at' | 'completed_at' | 'cancelled_at',
  routeName: string,
): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'production.write');

  return respondWithIdempotency(req, caller, BUNDLE, routeName, {}, async () => {
    const existing = await fetchPrRow(caller, id);
    try {
      assertTransition('production_run', existing.status, to);
    } catch (e) {
      if (e instanceof WorkflowError) throw new ApiError('STATE_CONFLICT', e.message, 409);
      throw e;
    }
    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = { status: to };
    patch[stampCol] = nowIso;
    const { data, error } = await admin()
      .from('production_runs')
      .update(patch)
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .select(PR_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', `production_run ${to} failed`, 500, { detail: error?.message });
    }
    return { status: 200, body: { data: rowToPr(data as PrRow) } };
  });
}

export const startProductionRun = ({ req, params }: Ctx) =>
  transitionPr(req, params.id, 'in_progress', 'started_at', `POST /production-runs/${params.id}/start`);

export const completeProductionRun = ({ req, params }: Ctx) =>
  transitionPr(req, params.id, 'completed', 'completed_at', `POST /production-runs/${params.id}/complete`);

export const cancelProductionRun = ({ req, params }: Ctx) =>
  transitionPr(req, params.id, 'cancelled', 'cancelled_at', `POST /production-runs/${params.id}/cancel`);

// ---- helpers ----

async function fetchPrRow(caller: Caller, id: string): Promise<PrRow> {
  const { data, error } = await admin()
    .from('production_runs')
    .select(PR_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'production_run lookup failed', 500, { detail: error.message });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'production_run not found', 404);
  return data as PrRow;
}
