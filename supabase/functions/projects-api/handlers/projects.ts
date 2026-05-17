/**
 * projects-api — /projects handlers (Wave 4 / Phase 5).
 *
 * Endpoints per TS1/09-api/00-API-CONTRACT.md §5.1, reconciled to the prod
 * `projects` shape + `project_state` enum (verified 2026-05-15,
 * schema_migrations=0050). Prod column names are `name` (not `display_name`)
 * and `quote_id` (not `source_quote_id`); lifecycle stamps already exist on
 * the table (bom_finalized_at, ready_to_build_at, ..., shipping_completed_at).
 *
 *   GET    /projects                  — list (filters: q, status, customer_id)
 *   GET    /projects/:id              — detail (header + phases inline)
 *   POST   /projects                  — direct create (rare; usually
 *                                        quote-convert RPC)
 *   PATCH  /projects/:id              — update header
 *   POST   /projects/:id/close        — → completed; stamps shipping_completed_at
 *                                        if not already set
 *   POST   /projects/:id/reopen       — completed → in_production|ready_to_ship
 *
 * The forward `project_state` lifecycle (pending → ready_to_build →
 * in_production → ready_to_ship → completed) is driven by phase progression
 * + ops events (Phase 10+ scope); Wave 4 only exposes close / reopen here.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  ProjectCloseSchema,
  ProjectCreateSchema,
  ProjectPatchSchema,
  ProjectReopenSchema,
  ProjectSchema,
  type Project,
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
import { writeAudit } from '../../_shared/audit.ts';

// ─── Wave 11B audit sweep — Sub-agent B owns this block (R-W10-AUDIT-01). ───
// Skip state-change paths — DB triggers handle those (0041/0047/0058/0060).
// For projects: close/reopen flip status + stamp shipping_completed_at and
// are covered by the state trigger. We instrument create + non-state PATCH.

const PROJECT_COLS =
  'id, org_id, project_number, quote_id, customer_id, customer_name, name, status, ' +
  'currency_code, total_cents, budget_cents, due_date, invoice_id, ' +
  'bom_finalized_at, bom_finalized_by, ready_to_build_at, sent_to_production_at, ' +
  'production_started_at, production_completed_at, ready_to_ship_at, ' +
  'shipping_completed_at, created_at, updated_at';

interface ProjectRow {
  id: string;
  org_id: string;
  project_number: string;
  quote_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  name: string;
  status: string;
  currency_code: string;
  total_cents: number;
  budget_cents: number;
  due_date: string | null;
  invoice_id: string | null;
  bom_finalized_at: string | null;
  bom_finalized_by: string | null;
  ready_to_build_at: string | null;
  sent_to_production_at: string | null;
  production_started_at: string | null;
  production_completed_at: string | null;
  ready_to_ship_at: string | null;
  shipping_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return ProjectSchema.parse(row);
}

async function fetchProjectRow(caller: Caller, id: string): Promise<ProjectRow> {
  const { data, error } = await admin()
    .from('projects')
    .select(PROJECT_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'project lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'project not found', 404);
  return data as ProjectRow;
}

async function nextProjectNumber(orgId: string): Promise<string> {
  try {
    return await getNextDocNumber(admin(), orgId, 'project');
  } catch (e) {
    if (e instanceof NumberingError) {
      throw new ApiError('INTERNAL_ERROR', 'next_doc_number project failed', 500, {
        detail: e.message,
      });
    }
    throw e;
  }
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
// GET /projects
// =========================================================================
export async function listProjects({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'projects.read');
    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const status = url.searchParams.get('status');
    const customerId = url.searchParams.get('customer_id');
    const q = url.searchParams.get('q');

    let query = admin()
      .from('projects')
      .select(PROJECT_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (status) query = query.eq('status', status);
    if (customerId) query = query.eq('customer_id', customerId);
    if (q) {
      const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      query = query.or(`project_number.ilike.${like},name.ilike.${like},customer_name.ilike.${like}`);
    }
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return err('INTERNAL_ERROR', 'project list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const rows = (data ?? []) as ProjectRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToProject), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /projects/:id
// =========================================================================
export async function getProject({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'projects.read');
    const row = await fetchProjectRow(caller, params.id);
    return ok(rowToProject(row), undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /projects
// =========================================================================
export async function createProject({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'projects.write');
    const body = await parseBody(req, ProjectCreateSchema);

    return await respondWithIdempotency(req, caller, 'POST /projects', body, async () => {
      const projectNumber = await nextProjectNumber(caller.orgId);
      const { data, error } = await admin()
        .from('projects')
        .insert({
          org_id: caller.orgId,
          project_number: projectNumber,
          name: body.name,
          customer_id: body.customer_id ?? null,
          customer_name: body.customer_name ?? null,
          quote_id: body.quote_id ?? null,
          currency_code: body.currency_code ?? 'USD',
          total_cents: body.total_cents,
          budget_cents: body.budget_cents,
          due_date: body.due_date ?? null,
          status: 'pending',
          created_by: caller.userId,
          updated_by: caller.userId,
        })
        .select(PROJECT_COLS)
        .single();
      if (error || !data) {
        throw new ApiError('INTERNAL_ERROR', 'project insert failed', 500, {
          detail: error?.message,
        });
      }
      const project = rowToProject(data as ProjectRow);
      // Phase 17 step-8: audit_log write (Wave 11B sweep).
      await writeAudit({
        actor_user_id: caller.userId,
        org_id: caller.orgId,
        entity_type: 'project',
        entity_id: project.id,
        action: 'create',
        after: project as unknown as Record<string, unknown>,
      });
      return { status: 201, body: { data: project } };
    });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// PATCH /projects/:id
// =========================================================================
export async function patchProject({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'projects.write');
    const body = await parseBody(req, ProjectPatchSchema);
    const id = params.id;

    return await respondWithIdempotency(req, caller, 'PATCH /projects/:id', body, async () => {
      const beforeRow = await fetchProjectRow(caller, id);
      const patch: Record<string, unknown> = {
        updated_by: caller.userId,
        updated_at: new Date().toISOString(),
      };
      if (body.name !== undefined) patch.name = body.name;
      if (body.customer_id !== undefined) patch.customer_id = body.customer_id;
      if (body.customer_name !== undefined) patch.customer_name = body.customer_name;
      if (body.quote_id !== undefined) patch.quote_id = body.quote_id;
      if (body.currency_code !== undefined) patch.currency_code = body.currency_code;
      if (body.total_cents !== undefined) patch.total_cents = body.total_cents;
      if (body.budget_cents !== undefined) patch.budget_cents = body.budget_cents;
      if (body.due_date !== undefined) patch.due_date = body.due_date;

      const { data, error } = await admin()
        .from('projects')
        .update(patch)
        .eq('id', id)
        .eq('org_id', caller.orgId)
        .select(PROJECT_COLS)
        .single();
      if (error || !data) {
        throw new ApiError('INTERNAL_ERROR', 'project update failed', 500, {
          detail: error?.message,
        });
      }
      const after = rowToProject(data as ProjectRow);
      // Phase 17 step-8: audit_log write (Wave 11B sweep — non-state edit).
      await writeAudit({
        actor_user_id: caller.userId,
        org_id: caller.orgId,
        entity_type: 'project',
        entity_id: id,
        action: 'update',
        before: rowToProject(beforeRow) as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return { status: 200, body: { data: after } };
    });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /projects/:id/close   — → completed
// =========================================================================
export async function closeProject({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'projects.close');
    const body = await parseBody(req, ProjectCloseSchema);
    const id = params.id;

    return await respondWithIdempotency(req, caller, 'POST /projects/:id/close', body, async () => {
      const existing = await fetchProjectRow(caller, id);
      try {
        assertTransition('project', existing.status, 'completed');
      } catch (e) {
        workflowToApiError(e);
      }
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        status: 'completed',
        updated_by: caller.userId,
        updated_at: now,
      };
      if (!existing.shipping_completed_at) patch.shipping_completed_at = now;

      const { data, error } = await admin()
        .from('projects')
        .update(patch)
        .eq('id', id)
        .eq('org_id', caller.orgId)
        .select(PROJECT_COLS)
        .single();
      if (error || !data) {
        throw new ApiError('INTERNAL_ERROR', 'project close failed', 500, {
          detail: error?.message,
        });
      }
      if (body.reason) {
        const { error: actErr } = await admin().from('activities').insert({
          org_id: caller.orgId,
          entity_type: 'project',
          entity_id: id,
          kind: 'note',
          subject: 'Project closed',
          body: body.reason,
          status: 'completed',
          completed_at: now,
          created_by: caller.userId,
        });
        if (actErr) {
          throw new ApiError('INTERNAL_ERROR', 'activity write failed', 500, {
            detail: actErr.message,
          });
        }
      }
      return { status: 200, body: { data: rowToProject(data as ProjectRow) } };
    });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /projects/:id/reopen  — completed → in_production | ready_to_ship
// =========================================================================
export async function reopenProject({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'projects.close');
    const body = await parseBody(req, ProjectReopenSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /projects/:id/reopen',
      body,
      async () => {
        const existing = await fetchProjectRow(caller, id);
        try {
          assertTransition('project', existing.status, body.to);
        } catch (e) {
          workflowToApiError(e);
        }
        const patch: Record<string, unknown> = {
          status: body.to,
          shipping_completed_at: null,
          updated_by: caller.userId,
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await admin()
          .from('projects')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(PROJECT_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'project reopen failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToProject(data as ProjectRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}
