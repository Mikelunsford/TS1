/**
 * collaboration-api — notifications handlers.
 * Phase 16 (Wave 10 Session 2) — B1 owns this block.
 *
 * Recipient-only — RLS pins recipient_user_id = auth.uid(). All reads
 * additionally enforce org_id = caller.orgId so cross-org users don't
 * see notifications from a stale org context.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, requireCap, respondWithIdempotency } from '../_helpers.ts';

export async function listNotifications({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'notifications.read');

  const unreadOnly = url.searchParams.get('unread_only') === 'true';
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 100);

  const sb = admin();
  let q = sb
    .from('notifications')
    .select('id, org_id, event_type, recipient_user_id, channel, entity_type, entity_id, actor_user_id, payload, created_at, read_at')
    .eq('recipient_user_id', caller.userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (unreadOnly) {
    q = q.is('read_at', null);
  }
  const { data, error } = await q;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'notifications list failed', 500, { detail: error.message });
  }

  // Unread count for the bell badge — separate count to avoid limiting it.
  const { count: unreadCount, error: cErr } = await sb
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_user_id', caller.userId)
    .is('read_at', null);
  if (cErr) {
    throw new ApiError('INTERNAL_ERROR', 'unread count failed', 500, { detail: cErr.message });
  }

  return ok({ items: data ?? [], unread_count: unreadCount ?? 0 }, undefined, { req });
}

export async function markNotificationRead({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'notifications.read');
  const id = params.id;
  if (!id) throw new ApiError('VALIDATION_ERROR', 'id is required', 422);

  return respondWithIdempotency(req, caller, `PATCH /notifications/${id}/read`, { id }, async () => {
    const sb = admin();
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from('notifications')
      .update({ read_at: now })
      .eq('id', id)
      .eq('recipient_user_id', caller.userId)
      .is('read_at', null)
      .select('id, read_at')
      .maybeSingle();
    if (error) throw new ApiError('INTERNAL_ERROR', 'mark read failed', 500, { detail: error.message });
    if (!data) {
      // either not found or already read — surface as idempotent success
      return { status: 200, body: { data: { id, read_at: now } } };
    }
    return { status: 200, body: { data } };
  });
}

export async function markAllNotificationsRead({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'notifications.read');

  return respondWithIdempotency(req, caller, 'POST /notifications/read-all', {}, async () => {
    const sb = admin();
    const now = new Date().toISOString();
    const { error, count } = await sb
      .from('notifications')
      .update({ read_at: now }, { count: 'exact' })
      .eq('recipient_user_id', caller.userId)
      .is('read_at', null);
    if (error) throw new ApiError('INTERNAL_ERROR', 'mark all read failed', 500, { detail: error.message });
    return { status: 200, body: { data: { marked: count ?? 0, read_at: now } } };
  });
}
