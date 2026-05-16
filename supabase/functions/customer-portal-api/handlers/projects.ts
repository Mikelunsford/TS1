/**
 * customer-portal-api — /portal/projects handlers.
 *
 *   GET /portal/projects?status=&page=&page_size=
 *   GET /portal/projects/:id   (with phases array)
 *
 * Project-level cost fields (`budget_cents`) and per-phase budget are
 * stripped — the customer sees timeline + status only, not costs.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  admin,
  paginate,
  parseLimit,
  decodeCursor,
  requireCap,
  resolvePortalCaller,
} from '../_helpers.ts';

// budget_cents intentionally NOT selected.
const PROJECT_COLS =
  'id, org_id, project_number, quote_id, customer_id, customer_name, ' +
  'name, status, currency_code, total_cents, due_date, invoice_id, ' +
  'bom_finalized_at, ready_to_build_at, sent_to_production_at, ' +
  'production_started_at, production_completed_at, ready_to_ship_at, ' +
  'shipping_completed_at, created_at, updated_at';

const PHASE_COLS =
  'id, project_id, position, name, description, status, ' +
  'planned_start_at, planned_end_at, actual_start_at, actual_end_at, ' +
  'notes, created_at, updated_at';

export async function listProjects({ req, url }: Ctx): Promise<Response> {
  try {
    const base = requireCaller(req);
    requireCap(base, 'portal.read');
    const caller = await resolvePortalCaller(base);

    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const status = url.searchParams.get('status');

    let query = admin()
      .from('projects')
      .select(PROJECT_COLS)
      .eq('org_id', caller.orgId)
      .eq('customer_id', caller.customerId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (status) query = query.eq('status', status);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'project list failed', 500, { detail: error.message });
    }
    const rows = (data ?? []) as Array<Record<string, unknown> & { id: string; created_at: string }>;
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items, next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

export async function getProject({ req, params }: Ctx): Promise<Response> {
  try {
    const base = requireCaller(req);
    requireCap(base, 'portal.read');
    const caller = await resolvePortalCaller(base);

    const { data: project, error: pErr } = await admin()
      .from('projects')
      .select(PROJECT_COLS)
      .eq('id', params.id)
      .eq('org_id', caller.orgId)
      .eq('customer_id', caller.customerId)
      .is('deleted_at', null)
      .maybeSingle();
    if (pErr) {
      throw new ApiError('INTERNAL_ERROR', 'project lookup failed', 500, { detail: pErr.message });
    }
    if (!project) throw new ApiError('NOT_FOUND', 'project not found', 404);

    const { data: phases, error: phErr } = await admin()
      .from('project_phases')
      .select(PHASE_COLS)
      .eq('project_id', params.id)
      .is('deleted_at', null)
      .order('position', { ascending: true });
    if (phErr) {
      throw new ApiError('INTERNAL_ERROR', 'project phases lookup failed', 500, {
        detail: phErr.message,
      });
    }

    return ok({ project, phases: phases ?? [] }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}
