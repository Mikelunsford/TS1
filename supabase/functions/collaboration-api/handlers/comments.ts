/**
 * collaboration-api — comments handlers.
 * Phase 16 (Wave 10 Session 2) — B1 owns this block.
 *
 * RLS posture: service-role bypasses RLS, so every query combines with
 * explicit `.eq('org_id', caller.orgId)` per Pattern A. The DB-level
 * comments_select_staff_org policy is the second line of defense.
 *
 * Capability gates use the existing `comments.read` / `comments.write`
 * caps (declared in _shared/capabilities.ts at Wave 0 / pre-Phase-16).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, parseBody, requireCap, respondWithIdempotency } from '../_helpers.ts';
import { CommentCreateSchema, CommentPatchSchema } from '../schemas.ts';

export async function listComments({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'comments.read');

  const entityType = url.searchParams.get('entity_type');
  const entityId = url.searchParams.get('entity_id');
  if (!entityType || !entityId) {
    throw new ApiError('VALIDATION_ERROR', 'entity_type and entity_id are required', 422);
  }

  const sb = admin();
  const { data, error } = await sb
    .from('comments')
    .select(
      'id, org_id, entity_type, entity_id, parent_comment_id, author_user_id, body, mentions, created_at, edited_at, deleted_at',
    )
    .eq('org_id', caller.orgId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'comments list failed', 500, { detail: error.message });
  }

  // Join author display names from user_profiles for the SPA.
  const authorIds = Array.from(new Set((data ?? []).map((r) => r.author_user_id)));
  let authorsById: Record<string, { display_name: string | null; email: string | null }> = {};
  if (authorIds.length > 0) {
    const { data: authors } = await sb
      .from('user_profiles')
      .select('user_id, display_name, email')
      .in('user_id', authorIds);
    authorsById = Object.fromEntries(
      (authors ?? []).map((a) => [
        a.user_id,
        { display_name: a.display_name ?? null, email: a.email ?? null },
      ]),
    );
  }

  const items = (data ?? []).map((r) => ({
    ...r,
    author: authorsById[r.author_user_id] ?? { display_name: null, email: null },
  }));
  return ok({ items }, undefined, { req });
}

export async function createComment({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'comments.write');
  const body = await parseBody(req, CommentCreateSchema);

  return respondWithIdempotency(req, caller, 'POST /comments', body, async () => {
    const sb = admin();
    const row = {
      org_id: caller.orgId,
      entity_type: body.entity_type,
      entity_id: body.entity_id,
      author_user_id: caller.userId,
      body: body.body,
      mentions: body.mentions ?? [],
      parent_comment_id: body.parent_comment_id ?? null,
    };
    const { data, error } = await sb
      .from('comments')
      .insert(row)
      .select(
        'id, org_id, entity_type, entity_id, parent_comment_id, author_user_id, body, mentions, created_at, edited_at',
      )
      .single();
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'comment insert failed', 500, { detail: error.message });
    }
    return { status: 201, body: { data } };
  });
}

export async function patchComment({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'comments.write');
  const id = params.id;
  if (!id) throw new ApiError('VALIDATION_ERROR', 'id is required', 422);
  const body = await parseBody(req, CommentPatchSchema);

  return respondWithIdempotency(req, caller, `PATCH /comments/${id}`, body, async () => {
    const sb = admin();
    // Confirm author + org scope.
    const { data: existing, error: e1 } = await sb
      .from('comments')
      .select('id, author_user_id, org_id, deleted_at')
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .maybeSingle();
    if (e1) throw new ApiError('INTERNAL_ERROR', 'comment lookup failed', 500, { detail: e1.message });
    if (!existing) throw new ApiError('NOT_FOUND', 'comment not found', 404);
    if (existing.deleted_at) throw new ApiError('STATE_CONFLICT', 'comment deleted', 409);
    if (existing.author_user_id !== caller.userId) {
      throw new ApiError('FORBIDDEN', 'only the author can edit a comment', 403);
    }

    const patch: Record<string, unknown> = {
      body: body.body,
      edited_at: new Date().toISOString(),
    };
    if (body.mentions !== undefined) patch.mentions = body.mentions;

    const { data, error } = await sb
      .from('comments')
      .update(patch)
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .select(
        'id, org_id, entity_type, entity_id, parent_comment_id, author_user_id, body, mentions, created_at, edited_at',
      )
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'comment update failed', 500, { detail: error.message });
    return { status: 200, body: { data } };
  });
}

export async function softDeleteComment({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'comments.write');
  const id = params.id;
  if (!id) throw new ApiError('VALIDATION_ERROR', 'id is required', 422);

  return respondWithIdempotency(req, caller, `DELETE /comments/${id}`, { id }, async () => {
    const sb = admin();
    const { data: existing, error: e1 } = await sb
      .from('comments')
      .select('id, author_user_id, org_id, deleted_at')
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .maybeSingle();
    if (e1) throw new ApiError('INTERNAL_ERROR', 'comment lookup failed', 500, { detail: e1.message });
    if (!existing) throw new ApiError('NOT_FOUND', 'comment not found', 404);
    if (existing.deleted_at) return { status: 200, body: { data: { id, deleted_at: existing.deleted_at } } };
    if (
      existing.author_user_id !== caller.userId
      && caller.role !== 'org_owner' && caller.role !== 'org_admin'
    ) {
      throw new ApiError('FORBIDDEN', 'only the author or an admin can delete a comment', 403);
    }
    const now = new Date().toISOString();
    const { error } = await sb
      .from('comments')
      .update({ deleted_at: now })
      .eq('id', id)
      .eq('org_id', caller.orgId);
    if (error) throw new ApiError('INTERNAL_ERROR', 'comment delete failed', 500, { detail: error.message });
    return { status: 200, body: { data: { id, deleted_at: now } } };
  });
}
