/**
 * settings-api — /settings/numbering handlers.
 *
 * Reads/writes `numbering_sequences` (Wave 0 / migration 0034, hardened by
 * Wave 9 / 0065). Prod columns:
 *   id, org_id, doc_type, prefix, pad_width, current_value,
 *   reset_period('never'|'yearly'|'monthly'), last_reset_at,
 *   current_year, current_month, created_at, created_by, updated_at, updated_by
 *
 * The handler's request/response field names mirror the DB column names
 * (doc_type / pad_width / reset_period) — the Phase-15 dispatch's original
 * kind/pad/auto_reset shape never matched what migration 0034 actually
 * shipped, which 500'd every /settings/numbering load for any non-Team1
 * tenant (surfaced by KitStak first sign-in, R-W11-NUMBERING-01).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, parseBody, requireCap, respondWithIdempotency } from '../_helpers.ts';
import { NumberingPutSchema } from '../schemas.ts';

const NUMBERING_COLS =
  'doc_type, prefix, pad_width, reset_period, current_value, created_at, updated_at';

export async function listNumberingForMe({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'org.settings.read');

  const { data, error } = await admin()
    .from('numbering_sequences')
    .select(NUMBERING_COLS)
    .eq('org_id', caller.orgId)
    .order('doc_type');
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'numbering list failed', 500, { detail: error.message });
  }
  return ok({ items: data ?? [] }, undefined, { req });
}

export async function updateNumberingForKind({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'org.settings.write');
  const docType = params.doc_type;
  if (!docType) throw new ApiError('VALIDATION_ERROR', 'doc_type required', 422);
  const body = await parseBody(req, NumberingPutSchema);

  return respondWithIdempotency(req, caller, `PUT /settings/numbering/${docType}`, body, async () => {
    const patch: Record<string, unknown> = { updated_by: caller.userId };
    if (body.prefix !== undefined) patch.prefix = body.prefix;
    if (body.pad_width !== undefined) patch.pad_width = body.pad_width;
    if (body.reset_period !== undefined) patch.reset_period = body.reset_period;

    const { data, error } = await admin()
      .from('numbering_sequences')
      .update(patch)
      .eq('org_id', caller.orgId)
      .eq('doc_type', docType)
      .select(NUMBERING_COLS)
      .maybeSingle();
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'numbering update failed', 500, { detail: error.message });
    }
    if (!data) throw new ApiError('NOT_FOUND', `no numbering sequence for doc_type=${docType}`, 404);
    return { status: 200, body: { data } };
  });
}
