/**
 * projects-api — /projects/:project_id/phases handlers.
 *
 * Per TS1/09-api/00-API-CONTRACT.md §5.2, reconciled to the prod
 * `project_phases` shape (migration 0042; status is text CHECK in
 * {pending, active, completed, cancelled}, planned_*_at / actual_*_at are
 * timestamptz).
 *
 *   GET    /projects/:project_id/phases
 *   POST   /projects/:project_id/phases
 *   PATCH  /projects/:project_id/phases/:phase_id
 *   DELETE /projects/:project_id/phases/:phase_id
 *   POST   /projects/:project_id/phases/reorder
 *   PUT    /projects/:project_id/phases/:phase_id/status   — workflow transition
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  ProjectPhaseCreateSchema,
  ProjectPhasePatchSchema,
  ProjectPhaseReorderSchema,
  ProjectPhaseSchema,
  ProjectPhaseStatusUpdateSchema,
  type ProjectPhase,
} from '../../_shared/types.ts';
import { assertTransition, WorkflowError } from '../../_shared/workflow.ts';
import {
  admin,
  parseBody,
  requireCap,
  respondWithIdempotency,
  type Caller,
} from '../../_shared/handler-helpers.ts';

const PHASE_COLS =
  'id, org_id, project_id, position, name, description, status, ' +
  'planned_start_at, planned_end_at, actual_start_at, actual_end_at, ' +
  'budget_cents, notes, created_at, updated_at';

interface PhaseRow {
  id: string;
  org_id: string;
  project_id: string;
  position: number;
  name: string;
  description: string | null;
  status: string;
  planned_start_at: string | null;
  planned_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  budget_cents: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPhase(row: PhaseRow): ProjectPhase {
  return ProjectPhaseSchema.parse(row);
}

async function ensureProjectInOrg(caller: Caller, projectId: string): Promise<void> {
  const { data, error } = await admin()
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'project lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'project not found', 404);
}

async function fetchPhase(
  caller: Caller,
  projectId: string,
  phaseId: string,
): Promise<PhaseRow> {
  const { data, error } = await admin()
    .from('project_phases')
    .select(PHASE_COLS)
    .eq('id', phaseId)
    .eq('project_id', projectId)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'phase lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'phase not found', 404);
  return data as PhaseRow;
}

function workflowToApiError(e: unknown): never {
  if (e instanceof WorkflowError) {
    throw new ApiError('STATE_CONFLICT', e.message, 409, {
      machine: e.machine,
      from: e.from,
      to: e.to,
    });
  }
  throw e;
}

// =========================================================================
// GET /projects/:project_id/phases
// =========================================================================
export async function listPhases({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'projects.read');
    await ensureProjectInOrg(caller, params.project_id);

    const { data, error } = await admin()
      .from('project_phases')
      .select(PHASE_COLS)
      .eq('project_id', params.project_id)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      return err('INTERNAL_ERROR', 'phase list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const items = ((data ?? []) as PhaseRow[]).map(rowToPhase);
    return ok({ items, next_cursor: null }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /projects/:project_id/phases
// =========================================================================
export async function createPhase({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'projects.write');
    const body = await parseBody(req, ProjectPhaseCreateSchema);
    const projectId = params.project_id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /projects/:project_id/phases',
      body,
      async () => {
        await ensureProjectInOrg(caller, projectId);
        const { data, error } = await admin()
          .from('project_phases')
          .insert({
            org_id: caller.orgId,
            project_id: projectId,
            name: body.name,
            description: body.description ?? null,
            position: body.position,
            status: 'pending',
            planned_start_at: body.planned_start_at ?? null,
            planned_end_at: body.planned_end_at ?? null,
            budget_cents: body.budget_cents,
            notes: body.notes ?? null,
            created_by: caller.userId,
            updated_by: caller.userId,
          })
          .select(PHASE_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'phase insert failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 201, body: { data: rowToPhase(data as PhaseRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// PATCH /projects/:project_id/phases/:phase_id
// =========================================================================
export async function patchPhase({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'projects.write');
    const body = await parseBody(req, ProjectPhasePatchSchema);
    const projectId = params.project_id;
    const phaseId = params.phase_id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /projects/:project_id/phases/:phase_id',
      body,
      async () => {
        await fetchPhase(caller, projectId, phaseId);
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: new Date().toISOString(),
        };
        if (body.name !== undefined) patch.name = body.name;
        if (body.description !== undefined) patch.description = body.description;
        if (body.position !== undefined) patch.position = body.position;
        if (body.planned_start_at !== undefined) patch.planned_start_at = body.planned_start_at;
        if (body.planned_end_at !== undefined) patch.planned_end_at = body.planned_end_at;
        if (body.budget_cents !== undefined) patch.budget_cents = body.budget_cents;
        if (body.notes !== undefined) patch.notes = body.notes;

        const { data, error } = await admin()
          .from('project_phases')
          .update(patch)
          .eq('id', phaseId)
          .eq('project_id', projectId)
          .eq('org_id', caller.orgId)
          .select(PHASE_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'phase update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToPhase(data as PhaseRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// DELETE /projects/:project_id/phases/:phase_id
// =========================================================================
export async function deletePhase({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'projects.write');
    const projectId = params.project_id;
    const phaseId = params.phase_id;

    return await respondWithIdempotency(
      req,
      caller,
      'DELETE /projects/:project_id/phases/:phase_id',
      { phaseId },
      async () => {
        await fetchPhase(caller, projectId, phaseId);
        const { error } = await admin()
          .from('project_phases')
          .update({ deleted_at: new Date().toISOString(), updated_by: caller.userId })
          .eq('id', phaseId)
          .eq('project_id', projectId)
          .eq('org_id', caller.orgId);
        if (error) {
          throw new ApiError('INTERNAL_ERROR', 'phase soft-delete failed', 500, {
            detail: error.message,
          });
        }
        return { status: 200, body: { data: { ok: true } } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /projects/:project_id/phases/reorder
// =========================================================================
export async function reorderPhases({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'projects.write');
    const body = await parseBody(req, ProjectPhaseReorderSchema);
    const projectId = params.project_id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /projects/:project_id/phases/reorder',
      body,
      async () => {
        await ensureProjectInOrg(caller, projectId);
        // Two-pass shift: negatives first to avoid any future uniqueness collision.
        for (let i = 0; i < body.phase_ids.length; i++) {
          const { error } = await admin()
            .from('project_phases')
            .update({ position: -(i + 1) })
            .eq('id', body.phase_ids[i])
            .eq('project_id', projectId)
            .eq('org_id', caller.orgId);
          if (error) {
            throw new ApiError('INTERNAL_ERROR', 'phase reorder shift failed', 500, {
              detail: error.message,
            });
          }
        }
        for (let i = 0; i < body.phase_ids.length; i++) {
          const { error } = await admin()
            .from('project_phases')
            .update({ position: i })
            .eq('id', body.phase_ids[i])
            .eq('project_id', projectId)
            .eq('org_id', caller.orgId);
          if (error) {
            throw new ApiError('INTERNAL_ERROR', 'phase reorder final failed', 500, {
              detail: error.message,
            });
          }
        }
        const { data } = await admin()
          .from('project_phases')
          .select(PHASE_COLS)
          .eq('project_id', projectId)
          .eq('org_id', caller.orgId)
          .is('deleted_at', null)
          .order('position', { ascending: true });
        const items = ((data ?? []) as PhaseRow[]).map(rowToPhase);
        return { status: 200, body: { data: { items, next_cursor: null } } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// PUT /projects/:project_id/phases/:phase_id/status
// =========================================================================
export async function updatePhaseStatus({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'projects.write');
    const body = await parseBody(req, ProjectPhaseStatusUpdateSchema);
    const projectId = params.project_id;
    const phaseId = params.phase_id;

    return await respondWithIdempotency(
      req,
      caller,
      'PUT /projects/:project_id/phases/:phase_id/status',
      body,
      async () => {
        const existing = await fetchPhase(caller, projectId, phaseId);
        try {
          assertTransition('phase', existing.status, body.status);
        } catch (e) {
          workflowToApiError(e);
        }
        const now = new Date().toISOString();
        const patch: Record<string, unknown> = {
          status: body.status,
          updated_by: caller.userId,
          updated_at: now,
        };
        if (body.status === 'active' && !existing.actual_start_at) patch.actual_start_at = now;
        if (body.status === 'completed' && !existing.actual_end_at) patch.actual_end_at = now;

        const { data, error } = await admin()
          .from('project_phases')
          .update(patch)
          .eq('id', phaseId)
          .eq('project_id', projectId)
          .eq('org_id', caller.orgId)
          .select(PHASE_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'phase status update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToPhase(data as PhaseRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}
