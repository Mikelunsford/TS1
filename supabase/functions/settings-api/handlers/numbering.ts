/**
 * settings-api — /settings/numbering handlers (Phase 15).
 *
 * Reads/writes `numbering_sequences` (Phase 14, migration 0064). Phase 14
 * may ship before or after this PR — the BE side is guarded by table-existence
 * try/catch so this bundle deploys cleanly either way. If the table is
 * missing, list returns [] and PUT throws NOT_FOUND.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, parseBody, requireCap, respondWithIdempotency } from '../_helpers.ts';
import { NumberingPutSchema } from '../schemas.ts';

const NUMBERING_MISSING_CODES = new Set(['42P01']); // undefined_table

export async function listNumberingForMe({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'org.settings.read');

  try {
    const { data, error } = await admin()
      .from('numbering_sequences')
      .select('kind, prefix, pad, auto_reset, current_value, created_at, updated_at')
      .eq('org_id', caller.orgId);
    if (error) {
      if (NUMBERING_MISSING_CODES.has((error as { code?: string }).code ?? '')) {
        return ok({ items: [] }, { phase14_pending: true }, { req });
      }
      throw new ApiError('INTERNAL_ERROR', 'numbering list failed', 500, { detail: error.message });
    }
    return ok({ items: data ?? [] }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    return ok({ items: [] }, { phase14_pending: true }, { req });
  }
}

export async function updateNumberingForKind({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'org.settings.write');
  const kind = params.kind;
  if (!kind) throw new ApiError('VALIDATION_ERROR', 'kind required', 422);
  const body = await parseBody(req, NumberingPutSchema);

  return respondWithIdempotency(req, caller, `PUT /settings/numbering/${kind}`, body, async () => {
    try {
      const patch: Record<string, unknown> = { updated_by: caller.userId };
      if (body.prefix !== undefined) patch.prefix = body.prefix;
      if (body.pad !== undefined) patch.pad = body.pad;
      if (body.auto_reset !== undefined) patch.auto_reset = body.auto_reset;

      const { data, error } = await admin()
        .from('numbering_sequences')
        .update(patch)
        .eq('org_id', caller.orgId)
        .eq('kind', kind)
        .select('kind, prefix, pad, auto_reset, current_value, updated_at')
        .maybeSingle();
      if (error) {
        if (NUMBERING_MISSING_CODES.has((error as { code?: string }).code ?? '')) {
          throw new ApiError('NOT_FOUND', 'numbering not yet available', 404);
        }
        throw new ApiError('INTERNAL_ERROR', 'numbering update failed', 500, { detail: error.message });
      }
      if (!data) throw new ApiError('NOT_FOUND', `no numbering sequence for kind=${kind}`, 404);
      return { status: 200, body: { data } };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('INTERNAL_ERROR', 'numbering update failed', 500, {
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
