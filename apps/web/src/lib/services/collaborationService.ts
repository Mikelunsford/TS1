/**
 * Collaboration service (Phase 16 / Wave 10 Session 2). Talks to
 * collaboration-api. Wraps comments, attachments, notifications, and
 * @mention autocomplete.
 */
import { z } from 'zod';

import { apiRequest } from '../apiClient';
import { supabase } from '../supabase';

export const COLLAB_ENTITY_TYPES = [
  'quote','project','customer','contact','lead','opportunity',
  'invoice','payment','credit_note','expense','purchase_order','vendor_bill',
  'vendor','item','journal_entry',
  'receiving_order','production_run','shipment',
] as const;

export type CollabEntityType = (typeof COLLAB_ENTITY_TYPES)[number];

// -------- Comments --------

const CommentSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid().nullable().optional(),
  entity_type: z.string(),
  entity_id: z.string().uuid(),
  parent_comment_id: z.string().uuid().nullable().optional(),
  author_user_id: z.string().uuid(),
  body: z.string(),
  mentions: z.array(z.string().uuid()).default([]),
  created_at: z.string(),
  edited_at: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
  author: z
    .object({
      display_name: z.string().nullable(),
      email: z.string().nullable(),
    })
    .optional(),
});
const CommentsListResponse = z.object({ items: z.array(CommentSchema) });

export type Comment = z.infer<typeof CommentSchema>;

export function listComments(entityType: CollabEntityType, entityId: string) {
  return apiRequest({
    method: 'GET',
    path: `/collaboration-api/comments?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
    schema: CommentsListResponse,
  });
}

export function createComment(input: {
  entity_type: CollabEntityType;
  entity_id: string;
  body: string;
  mentions?: string[];
  parent_comment_id?: string | null;
}) {
  return apiRequest({
    method: 'POST',
    path: '/collaboration-api/comments',
    body: input,
    schema: CommentSchema,
  });
}

export function patchComment(id: string, patch: { body: string; mentions?: string[] }) {
  return apiRequest({
    method: 'PATCH',
    path: `/collaboration-api/comments/${encodeURIComponent(id)}`,
    body: patch,
    schema: CommentSchema,
  });
}

export function softDeleteComment(id: string) {
  return apiRequest({
    method: 'DELETE',
    path: `/collaboration-api/comments/${encodeURIComponent(id)}`,
    schema: z.object({ id: z.string(), deleted_at: z.string() }),
  });
}

// -------- Attachments --------

const AttachmentSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  entity_type: z.string(),
  entity_id: z.string().uuid(),
  file_name: z.string(),
  file_path: z.string(),
  bucket: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  size_bytes: z.number().int().nullable().optional(),
  category: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  uploaded_by: z.string().uuid().nullable().optional(),
  created_at: z.string(),
});
const AttachmentsListResponse = z.object({ items: z.array(AttachmentSchema) });

export type Attachment = z.infer<typeof AttachmentSchema>;

export function listAttachments(entityType: CollabEntityType, entityId: string) {
  return apiRequest({
    method: 'GET',
    path: `/collaboration-api/attachments?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
    schema: AttachmentsListResponse,
  });
}

const SignUploadResponse = z.object({
  bucket: z.string(),
  file_path: z.string(),
  signed_url: z.string(),
  token: z.string(),
});

export function signUpload(input: {
  entity_type: CollabEntityType;
  entity_id: string;
  file_name: string;
  mime_type?: string;
}) {
  return apiRequest({
    method: 'POST',
    path: '/collaboration-api/attachments/sign-upload',
    body: input,
    schema: SignUploadResponse,
  });
}

export function createAttachment(input: {
  entity_type: CollabEntityType;
  entity_id: string;
  file_name: string;
  file_path: string;
  mime_type?: string | null;
  size_bytes?: number | null;
}) {
  return apiRequest({
    method: 'POST',
    path: '/collaboration-api/attachments',
    body: input,
    schema: AttachmentSchema,
  });
}

const SignDownloadResponse = z.object({
  signed_url: z.string(),
  expires_in_seconds: z.number().int(),
});

export function signDownload(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/collaboration-api/attachments/${encodeURIComponent(id)}/download`,
    schema: SignDownloadResponse,
  });
}

export function softDeleteAttachment(id: string) {
  return apiRequest({
    method: 'DELETE',
    path: `/collaboration-api/attachments/${encodeURIComponent(id)}`,
    schema: z.object({ id: z.string(), deleted_at: z.string() }),
  });
}

/** Upload a File blob via the signed URL flow + persist metadata. */
export async function uploadAttachment(input: {
  entity_type: CollabEntityType;
  entity_id: string;
  file: File;
}): Promise<Attachment> {
  const mime = input.file.type || '';
  const signUploadArgs: {
    entity_type: CollabEntityType;
    entity_id: string;
    file_name: string;
    mime_type?: string;
  } = {
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    file_name: input.file.name,
  };
  if (mime) signUploadArgs.mime_type = mime;
  const signed = await signUpload(signUploadArgs);

  // Use the supabase-js client to upload with the token returned from sign-upload.
  const uploadOpts: { contentType?: string } = {};
  if (mime) uploadOpts.contentType = mime;
  const { error } = await supabase.storage
    .from(signed.bucket)
    .uploadToSignedUrl(signed.file_path, signed.token, input.file, uploadOpts);
  if (error) throw new Error(`upload failed: ${error.message}`);

  return createAttachment({
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    file_name: input.file.name,
    file_path: signed.file_path,
    mime_type: input.file.type || null,
    size_bytes: input.file.size,
  });
}

// -------- Notifications --------

const NotificationSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid().nullable().optional(),
  event_type: z.string(),
  recipient_user_id: z.string().uuid(),
  channel: z.string(),
  entity_type: z.string().nullable().optional(),
  entity_id: z.string().uuid().nullable().optional(),
  actor_user_id: z.string().uuid().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string(),
  read_at: z.string().nullable().optional(),
});
const NotificationsResponse = z.object({
  items: z.array(NotificationSchema),
  unread_count: z.number().int(),
});

export type AppNotification = z.infer<typeof NotificationSchema>;

export function listNotifications(opts?: { unreadOnly?: boolean; limit?: number }) {
  const sp = new URLSearchParams();
  if (opts?.unreadOnly) sp.set('unread_only', 'true');
  if (opts?.limit) sp.set('limit', String(opts.limit));
  const qs = sp.toString();
  return apiRequest({
    method: 'GET',
    path: `/collaboration-api/notifications${qs ? `?${qs}` : ''}`,
    schema: NotificationsResponse,
  });
}

export function markNotificationRead(id: string) {
  return apiRequest({
    method: 'PATCH',
    path: `/collaboration-api/notifications/${encodeURIComponent(id)}/read`,
    schema: z.object({ id: z.string(), read_at: z.string() }),
  });
}

export function markAllNotificationsRead() {
  return apiRequest({
    method: 'POST',
    path: '/collaboration-api/notifications/read-all',
    body: {},
    schema: z.object({ marked: z.number().int(), read_at: z.string() }),
  });
}

// -------- Mentions --------

const MentionUserSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
});
const MentionsResponse = z.object({ items: z.array(MentionUserSchema) });

export type MentionUser = z.infer<typeof MentionUserSchema>;

export function autocompleteMentions(q: string) {
  return apiRequest({
    method: 'GET',
    path: `/collaboration-api/mentions/autocomplete${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    schema: MentionsResponse,
  });
}
