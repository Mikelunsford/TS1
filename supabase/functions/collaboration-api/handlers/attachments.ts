/**
 * collaboration-api — attachments handlers.
 * Phase 16 (Wave 10 Session 2) — B1 owns this block.
 *
 * Upload flow (SPA-side):
 *   1. POST /attachments/sign-upload { entity_type, entity_id, file_name, mime_type }
 *      -> { signed_url, file_path, token } — uses storage.createSignedUploadUrl.
 *   2. SPA PUTs the file bytes to signed_url.
 *   3. POST /attachments { entity_type, entity_id, file_name, file_path, mime_type, size_bytes }
 *      -> persists the metadata row (entity-scoped under attachments table).
 *
 * Download flow:
 *   GET /attachments/:id/download -> { signed_url } (60s expiry).
 *
 * Soft-delete: DELETE /attachments/:id flips deleted_at + removes the Storage
 * object via admin client (best-effort; if Storage removal fails we still
 * mark the metadata row soft-deleted because that's what RLS reads from).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, parseBody, requireCap, respondWithIdempotency } from '../_helpers.ts';
import { AttachmentCreateSchema, SignUploadSchema } from '../schemas.ts';

const BUCKET = 'attachments';
const SIGN_EXPIRY_SECONDS = 60;

function sanitizeFileName(name: string): string {
  // Strip path separators + control chars. Keep dots, dashes, underscores.
  return name.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 255);
}

function makePath(orgId: string, entityType: string, entityId: string, fileName: string): string {
  const stamp = Date.now();
  return `${orgId}/${entityType}/${entityId}/${stamp}-${sanitizeFileName(fileName)}`;
}

export async function listAttachments({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'attachments.read');

  const entityType = url.searchParams.get('entity_type');
  const entityId = url.searchParams.get('entity_id');
  if (!entityType || !entityId) {
    throw new ApiError('VALIDATION_ERROR', 'entity_type and entity_id are required', 422);
  }

  const sb = admin();
  const { data, error } = await sb
    .from('attachments')
    .select(
      'id, org_id, entity_type, entity_id, file_name, file_path, bucket, mime_type, size_bytes, category, notes, uploaded_by, created_at',
    )
    .eq('org_id', caller.orgId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'attachments list failed', 500, { detail: error.message });
  }
  return ok({ items: data ?? [] }, undefined, { req });
}

export async function signUpload({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'attachments.write');
  const body = await parseBody(req, SignUploadSchema);

  // Idempotency is unnecessary for sign-upload (no DB state); call directly.
  const sb = admin();
  const filePath = makePath(caller.orgId, body.entity_type, body.entity_id, body.file_name);

  // createSignedUploadUrl is the standard Storage API; it returns
  // { signedUrl, token, path }.
  const storageAny = (sb.storage.from(BUCKET) as unknown) as {
    createSignedUploadUrl: (path: string) => Promise<{
      data: { signedUrl: string; token: string; path: string } | null;
      error: { message: string } | null;
    }>;
  };
  const { data, error } = await storageAny.createSignedUploadUrl(filePath);
  if (error || !data) {
    throw new ApiError('INTERNAL_ERROR', 'signed upload failed', 500, {
      detail: error?.message ?? 'unknown',
    });
  }
  return ok(
    {
      bucket: BUCKET,
      file_path: filePath,
      signed_url: data.signedUrl,
      token: data.token,
    },
    undefined,
    { req },
  );
}

export async function createAttachment({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'attachments.write');
  const body = await parseBody(req, AttachmentCreateSchema);

  return respondWithIdempotency(req, caller, 'POST /attachments', body, async () => {
    const sb = admin();
    const row = {
      org_id: caller.orgId,
      entity_type: body.entity_type,
      entity_id: body.entity_id,
      file_name: body.file_name,
      file_path: body.file_path,
      bucket: BUCKET,
      mime_type: body.mime_type ?? null,
      size_bytes: body.size_bytes ?? null,
      category: body.category ?? null,
      notes: body.notes ?? null,
      uploaded_by: caller.userId,
      created_by: caller.userId,
    };
    const { data, error } = await sb
      .from('attachments')
      .insert(row)
      .select(
        'id, org_id, entity_type, entity_id, file_name, file_path, bucket, mime_type, size_bytes, category, notes, uploaded_by, created_at',
      )
      .single();
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'attachment insert failed', 500, { detail: error.message });
    }

    // Emit attachment.added notification — to the uploader's-org "everyone"
    // is too noisy at scale; for Phase 16 we only notify when the entity has
    // an assignee column. Defer cross-entity assignee lookup to Phase 19; for
    // now we don't emit (notifications still work via mentions / replies).
    return { status: 201, body: { data } };
  });
}

export async function signDownload({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'attachments.read');
  const id = params.id;
  if (!id) throw new ApiError('VALIDATION_ERROR', 'id is required', 422);

  const sb = admin();
  const { data: row, error: e1 } = await sb
    .from('attachments')
    .select('id, bucket, file_path, deleted_at, org_id')
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (e1) throw new ApiError('INTERNAL_ERROR', 'attachment lookup failed', 500, { detail: e1.message });
  if (!row) throw new ApiError('NOT_FOUND', 'attachment not found', 404);
  if (row.deleted_at) throw new ApiError('STATE_CONFLICT', 'attachment deleted', 409);

  const { data, error } = await sb.storage.from(row.bucket ?? BUCKET).createSignedUrl(row.file_path, SIGN_EXPIRY_SECONDS);
  if (error || !data) {
    throw new ApiError('INTERNAL_ERROR', 'signed download failed', 500, {
      detail: error?.message ?? 'unknown',
    });
  }
  return ok({ signed_url: data.signedUrl, expires_in_seconds: SIGN_EXPIRY_SECONDS }, undefined, { req });
}

export async function softDeleteAttachment({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'attachments.write');
  const id = params.id;
  if (!id) throw new ApiError('VALIDATION_ERROR', 'id is required', 422);

  return respondWithIdempotency(req, caller, `DELETE /attachments/${id}`, { id }, async () => {
    const sb = admin();
    const { data: existing, error: e1 } = await sb
      .from('attachments')
      .select('id, uploaded_by, bucket, file_path, deleted_at, org_id')
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .maybeSingle();
    if (e1) throw new ApiError('INTERNAL_ERROR', 'attachment lookup failed', 500, { detail: e1.message });
    if (!existing) throw new ApiError('NOT_FOUND', 'attachment not found', 404);
    if (existing.deleted_at) {
      return { status: 200, body: { data: { id, deleted_at: existing.deleted_at } } };
    }
    if (
      existing.uploaded_by !== caller.userId
      && caller.role !== 'org_owner' && caller.role !== 'org_admin'
    ) {
      throw new ApiError('FORBIDDEN', 'only the uploader or an admin can delete', 403);
    }

    const now = new Date().toISOString();
    const { error } = await sb
      .from('attachments')
      .update({ deleted_at: now })
      .eq('id', id)
      .eq('org_id', caller.orgId);
    if (error) throw new ApiError('INTERNAL_ERROR', 'attachment delete failed', 500, { detail: error.message });

    // Best-effort Storage removal — failure is logged but not surfaced because
    // RLS now hides the row.
    await sb.storage.from(existing.bucket ?? BUCKET).remove([existing.file_path]).catch(() => undefined);

    return { status: 200, body: { data: { id, deleted_at: now } } };
  });
}
