/**
 * finance-api — /period-closes handlers (Wave 8e / Phase 18).
 *
 * Endpoints:
 *   GET    /period-closes              — list (filters: status,
 *                                          period_start_gte, period_end_lte)
 *   POST   /period-closes              — create row at status='open'
 *   GET    /period-closes/:id          — detail
 *   PATCH  /period-closes/:id          — state-stamp (open <-> in_review)
 *                                          + notes editing
 *   POST   /period-closes/:id/close    — calls close_period RPC
 *                                          (422 on draft JEs in range)
 *   POST   /period-closes/:id/reopen   — calls reopen_period RPC
 *                                          (reason required)
 *
 * State machine: PERIOD_CLOSE_TRANSITIONS in _shared/workflow.ts.
 *   open <-> in_review  → handled by PATCH
 *   in_review -> closed → handled by /close (and the close_period RPC)
 *   closed -> reopened  → handled by /reopen (and the reopen_period RPC)
 *   reopened -> in_review → handled by PATCH
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  PeriodCloseCreateInputSchema,
  PeriodClosePatchInputSchema,
  PeriodCloseClosePayloadSchema,
  PeriodCloseReopenPayloadSchema,
  PeriodCloseSchema,
  type PeriodClose,
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
} from '../_helpers.ts';
import { writeAudit } from '../../_shared/audit.ts';

// ─── Wave 11B audit sweep — Sub-agent B owns this block (R-W10-AUDIT-01). ───
// Skip state-change paths — DB triggers handle those (0041/0047/0058/0060).
// For period_close: /close + /reopen go through close_period / reopen_period
// RPCs which stamp closed_at / reopened_at; those are covered by DB audit.
// PATCH only handles open ↔ in_review + notes editing — we instrument
// create + the PATCH path.

const PC_COLS =
  'id, org_id, period_start, period_end, status, closed_at, closed_by_user_id, ' +
  'reopened_at, reopened_by_user_id, notes, created_at, updated_at';

interface PcRow {
  id: string;
  org_id: string;
  period_start: string;
  period_end: string;
  status: string;
  closed_at: string | null;
  closed_by_user_id: string | null;
  reopened_at: string | null;
  reopened_by_user_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPc(row: PcRow): PeriodClose {
  return PeriodCloseSchema.parse(row);
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

async function fetchPcRow(caller: Caller, id: string): Promise<PcRow> {
  const { data, error } = await admin()
    .from('period_close')
    .select(PC_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'period_close lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'period_close row not found', 404);
  return data as PcRow;
}

// =========================================================================
// GET /period-closes
// =========================================================================
export async function listPeriodCloses({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.period_close.read');
    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const status = url.searchParams.get('status');
    const psGte = url.searchParams.get('period_start_gte');
    const peLte = url.searchParams.get('period_end_lte');

    let query = admin()
      .from('period_close')
      .select(PC_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('period_end', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (status) query = query.eq('status', status);
    if (psGte) query = query.gte('period_start', psGte);
    if (peLte) query = query.lte('period_end', peLte);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return err(
        'INTERNAL_ERROR',
        'period_close list query failed',
        { detail: error.message },
        500,
        { req },
      );
    }
    const rows = (data ?? []) as PcRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToPc), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /period-closes/:id
// =========================================================================
export async function getPeriodClose({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.period_close.read');
    const row = await fetchPcRow(caller, params.id);
    return ok(rowToPc(row), undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /period-closes
// =========================================================================
export async function createPeriodClose({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.period_close.create');
    const body = await parseBody(req, PeriodCloseCreateInputSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /period-closes',
      body,
      async () => {
        if (body.period_end < body.period_start) {
          throw new ApiError(
            'VALIDATION_ERROR',
            'period_end must be on or after period_start',
            422,
          );
        }

        const insertRow = {
          org_id: caller.orgId,
          period_start: body.period_start,
          period_end: body.period_end,
          status: 'open' as const,
          notes: body.notes ?? null,
          created_by: caller.userId,
          updated_by: caller.userId,
        };

        const { data, error } = await admin()
          .from('period_close')
          .insert(insertRow)
          .select(PC_COLS)
          .single();
        if (error || !data) {
          // 23505 = unique violation on (org, start, end, deleted_at).
          if (error?.code === '23505') {
            throw new ApiError(
              'STATE_CONFLICT',
              'a period_close row already exists for this org and date range',
              409,
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'period_close insert failed', 500, {
            detail: error?.message,
          });
        }
        const pc = rowToPc(data as PcRow);
        // Phase 17 step-8: audit_log write (Wave 11B sweep).
        await writeAudit({
          actor_user_id: caller.userId,
          org_id: caller.orgId,
          entity_type: 'period_close',
          entity_id: pc.id,
          action: 'create',
          after: pc as unknown as Record<string, unknown>,
        });
        return { status: 201, body: { data: pc } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// PATCH /period-closes/:id
// =========================================================================
export async function patchPeriodClose({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.period_close.update');
    const body = await parseBody(req, PeriodClosePatchInputSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /period-closes/:id',
      body,
      async () => {
        const existing = await fetchPcRow(caller, id);

        if (body.status !== undefined && body.status !== existing.status) {
          try {
            assertTransition('period_close', existing.status, body.status);
          } catch (e) {
            workflowToApiError(e);
          }
          // /close + /reopen are the only legal paths into closed / reopened.
          // PATCH only handles open ↔ in_review.
          if (body.status !== 'open' && body.status !== 'in_review') {
            throw new ApiError(
              'STATE_CONFLICT',
              `PATCH cannot transition to ${body.status}; use /close or /reopen`,
              409,
            );
          }
        }

        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.status !== undefined) patch.status = body.status;
        if (body.notes !== undefined) patch.notes = body.notes;

        const { data, error } = await admin()
          .from('period_close')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(PC_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'period_close update failed', 500, {
            detail: error?.message,
          });
        }
        const after = rowToPc(data as PcRow);
        // Phase 17 step-8: audit_log write (Wave 11B sweep — non-close edits).
        // /close + /reopen routes are NOT instrumented here — they fire the
        // close_period / reopen_period RPCs which audit at the DB layer.
        await writeAudit({
          actor_user_id: caller.userId,
          org_id: caller.orgId,
          entity_type: 'period_close',
          entity_id: id,
          action: 'update',
          before: rowToPc(existing) as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
        });
        return { status: 200, body: { data: after } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /period-closes/:id/close
// =========================================================================
export async function closePeriodClose({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.period_close.close');
    const body = await parseBody(req, PeriodCloseClosePayloadSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /period-closes/:id/close',
      body,
      async () => {
        const existing = await fetchPcRow(caller, id);
        try {
          assertTransition('period_close', existing.status, 'closed');
        } catch (e) {
          workflowToApiError(e);
        }

        // close_period RPC enforces:
        //   - period_end >= period_start (already gated on insert; defensive)
        //   - zero draft journal_entries in range (else RAISE -> we map to 422)
        // It inserts a NEW row; we then delete the original row that the user
        // navigated to. Because the UNIQUE is on (org,start,end,deleted_at),
        // we soft-delete the old row first so the RPC's INSERT can succeed.
        const nowIso = new Date().toISOString();
        const { error: dErr } = await admin()
          .from('period_close')
          .update({
            deleted_at: nowIso,
            updated_at: nowIso,
            updated_by: caller.userId,
          })
          .eq('id', id)
          .eq('org_id', caller.orgId);
        if (dErr) {
          throw new ApiError('INTERNAL_ERROR', 'period_close pre-close soft delete failed', 500, {
            detail: dErr.message,
          });
        }

        const notesIn = body.notes ?? existing.notes ?? null;
        const { data: rpcData, error: rpcErr } = await admin().rpc('close_period', {
          p_org_id: caller.orgId,
          p_period_start: existing.period_start,
          p_period_end: existing.period_end,
          p_actor_user_id: caller.userId,
          p_notes: notesIn,
        });
        if (rpcErr) {
          // Restore the soft-deleted row so the user can retry.
          await admin()
            .from('period_close')
            .update({ deleted_at: null, updated_by: caller.userId })
            .eq('id', id)
            .eq('org_id', caller.orgId);
          // check_violation -> 422; everything else -> 500.
          const msg = rpcErr.message || '';
          if (rpcErr.code === '23514' || msg.includes('draft journal')) {
            throw new ApiError(
              'VALIDATION_ERROR',
              'cannot close period while draft journal entries exist in range',
              422,
              { detail: msg },
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'close_period RPC failed', 500, {
            detail: msg,
          });
        }

        const newId = rpcData as unknown as string;
        const { data: refreshed, error: fErr } = await admin()
          .from('period_close')
          .select(PC_COLS)
          .eq('id', newId)
          .eq('org_id', caller.orgId)
          .single();
        if (fErr || !refreshed) {
          throw new ApiError('INTERNAL_ERROR', 'period_close refresh after close failed', 500, {
            detail: fErr?.message,
          });
        }
        return { status: 200, body: { data: rowToPc(refreshed as PcRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /period-closes/:id/reopen
// =========================================================================
export async function reopenPeriodClose({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.period_close.reopen');
    const body = await parseBody(req, PeriodCloseReopenPayloadSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /period-closes/:id/reopen',
      body,
      async () => {
        const existing = await fetchPcRow(caller, id);
        try {
          assertTransition('period_close', existing.status, 'reopened');
        } catch (e) {
          workflowToApiError(e);
        }

        const { error: rpcErr } = await admin().rpc('reopen_period', {
          p_period_close_id: id,
          p_actor_user_id: caller.userId,
          p_reason: body.reason,
        });
        if (rpcErr) {
          const msg = rpcErr.message || '';
          if (rpcErr.code === '23514' || msg.includes('only closed')) {
            throw new ApiError(
              'STATE_CONFLICT',
              `cannot reopen — row is ${existing.status}, expected 'closed'`,
              409,
              { detail: msg },
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'reopen_period RPC failed', 500, {
            detail: msg,
          });
        }

        const refreshed = await fetchPcRow(caller, id);
        return { status: 200, body: { data: rowToPc(refreshed) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}
