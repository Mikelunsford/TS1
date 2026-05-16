/**
 * Phase 16 — collaboration-api contract test.
 *
 * Inline-mirrors the wire shapes the BE handlers return (see
 * supabase/functions/collaboration-api/handlers/*.ts). Validates:
 *   - GET /comments → { items: Comment[] } with author join
 *   - POST/PATCH /comments → single Comment
 *   - GET /attachments → { items: Attachment[] }
 *   - POST /attachments/sign-upload → { bucket, file_path, signed_url, token }
 *   - GET /attachments/:id/download → { signed_url, expires_in_seconds }
 *   - GET /notifications → { items, unread_count }
 *   - GET /mentions/autocomplete → { items: MentionUser[] }
 *   - Cap matrix: comments.* + attachments.* + notifications.read parity
 *     with the matrix in supabase/functions/_shared/capabilities.ts.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const Comment = z.object({
  id: z.string().uuid(),
  entity_type: z.string(),
  entity_id: z.string().uuid(),
  parent_comment_id: z.string().uuid().nullable().optional(),
  author_user_id: z.string().uuid(),
  body: z.string(),
  mentions: z.array(z.string().uuid()),
  created_at: z.string(),
  edited_at: z.string().nullable().optional(),
  author: z
    .object({ display_name: z.string().nullable(), email: z.string().nullable() })
    .optional(),
});
const CommentsList = z.object({ items: z.array(Comment) });

const Attachment = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  entity_type: z.string(),
  entity_id: z.string().uuid(),
  file_name: z.string(),
  file_path: z.string(),
  mime_type: z.string().nullable().optional(),
  size_bytes: z.number().int().nullable().optional(),
  uploaded_by: z.string().uuid().nullable().optional(),
  created_at: z.string(),
});
const AttachmentsList = z.object({ items: z.array(Attachment) });

const SignUpload = z.object({
  bucket: z.string(),
  file_path: z.string(),
  signed_url: z.string(),
  token: z.string(),
});

const SignDownload = z.object({
  signed_url: z.string(),
  expires_in_seconds: z.number().int(),
});

const Notification = z.object({
  id: z.string().uuid(),
  event_type: z.string(),
  recipient_user_id: z.string().uuid(),
  channel: z.string(),
  entity_type: z.string().nullable().optional(),
  entity_id: z.string().uuid().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  read_at: z.string().nullable().optional(),
});
const NotifList = z.object({ items: z.array(Notification), unread_count: z.number().int() });

const MentionUser = z.object({
  user_id: z.string().uuid(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
});
const MentionsList = z.object({ items: z.array(MentionUser) });

describe('collaboration-api Phase 16 — response shapes', () => {
  it('parses GET /comments envelope with author join', () => {
    const v = CommentsList.parse({
      items: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          entity_type: 'invoice',
          entity_id: '11111111-1111-1111-1111-111111111111',
          author_user_id: '22222222-2222-2222-2222-222222222222',
          body: 'hi',
          mentions: [],
          created_at: new Date().toISOString(),
          author: { display_name: 'Alice', email: 'alice@example.com' },
        },
      ],
    });
    expect(v.items[0]?.author?.display_name).toBe('Alice');
  });

  it('parses POST /comments single shape', () => {
    const v = Comment.parse({
      id: '00000000-0000-0000-0000-000000000002',
      entity_type: 'project',
      entity_id: '11111111-1111-1111-1111-111111111111',
      author_user_id: '22222222-2222-2222-2222-222222222222',
      body: 'first',
      mentions: ['33333333-3333-3333-3333-333333333333'],
      created_at: new Date().toISOString(),
    });
    expect(v.mentions).toHaveLength(1);
  });

  it('parses GET /attachments', () => {
    const v = AttachmentsList.parse({
      items: [
        {
          id: '00000000-0000-0000-0000-000000000003',
          org_id: '99999999-9999-9999-9999-999999999999',
          entity_type: 'quote',
          entity_id: '11111111-1111-1111-1111-111111111111',
          file_name: 'spec.pdf',
          file_path: '99/quote/11/spec.pdf',
          mime_type: 'application/pdf',
          size_bytes: 1024,
          uploaded_by: '22222222-2222-2222-2222-222222222222',
          created_at: new Date().toISOString(),
        },
      ],
    });
    expect(v.items[0]?.file_name).toBe('spec.pdf');
  });

  it('parses POST /attachments/sign-upload', () => {
    const v = SignUpload.parse({
      bucket: 'attachments',
      file_path: 'org/entity/id/file.pdf',
      signed_url: 'https://example.supabase.co/storage/v1/upload/sign?token=abc',
      token: 'abc',
    });
    expect(v.bucket).toBe('attachments');
  });

  it('parses GET /attachments/:id/download', () => {
    const v = SignDownload.parse({
      signed_url: 'https://example.supabase.co/storage/v1/object/sign?token=xyz',
      expires_in_seconds: 60,
    });
    expect(v.expires_in_seconds).toBe(60);
  });

  it('parses GET /notifications', () => {
    const v = NotifList.parse({
      items: [
        {
          id: '00000000-0000-0000-0000-000000000004',
          event_type: 'comment.mention',
          recipient_user_id: '22222222-2222-2222-2222-222222222222',
          channel: 'in_app',
          entity_type: 'invoice',
          entity_id: '11111111-1111-1111-1111-111111111111',
          payload: { body_excerpt: 'hi' },
          created_at: new Date().toISOString(),
          read_at: null,
        },
      ],
      unread_count: 1,
    });
    expect(v.unread_count).toBe(1);
  });

  it('parses GET /mentions/autocomplete', () => {
    const v = MentionsList.parse({
      items: [
        { user_id: '22222222-2222-2222-2222-222222222222', display_name: 'Alice', email: 'alice@example.com' },
      ],
    });
    expect(v.items[0]?.display_name).toBe('Alice');
  });
});

import { can } from '@/lib/capabilities';

describe('collaboration-api Phase 16 — cap matrix parity', () => {
  it('every staff role can read + write comments', () => {
    for (const r of ['org_owner', 'org_admin', 'sales', 'ops', 'accounting'] as const) {
      expect(can(r, 'comments.read')).toBe(true);
      expect(can(r, 'comments.write')).toBe(true);
    }
  });

  it('every staff role can read + write attachments', () => {
    for (const r of ['org_owner', 'org_admin', 'sales', 'ops', 'accounting'] as const) {
      expect(can(r, 'attachments.read')).toBe(true);
      expect(can(r, 'attachments.write')).toBe(true);
    }
  });

  it('every staff + viewer + customer_user role can read notifications', () => {
    for (const r of ['org_owner', 'org_admin', 'sales', 'ops', 'accounting', 'viewer', 'customer_user'] as const) {
      expect(can(r, 'notifications.read')).toBe(true);
    }
  });

  it('viewer cannot write comments or attachments', () => {
    expect(can('viewer', 'comments.write')).toBe(false);
    expect(can('viewer', 'attachments.write')).toBe(false);
  });
});
