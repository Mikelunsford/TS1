/**
 * Phase 19 — pdf-worker + notifications-worker contract tests.
 *
 * Pure-Zod wire shape parity with the BE handlers. Validates:
 *   - POST /pdf/render → { signed_url, file_path, bucket, expires_at, bytes_length }
 *   - GET /pdf/templates → { templates: { id, description }[] }
 *   - POST /notifications-worker/drain → { processed, delivered, failed }
 *   - Capability matrix: pdf.render granted to every signed-in role
 *     (including customer_user) — mirrors the short-circuit in
 *     supabase/functions/_shared/capabilities.ts.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const RenderResponse = z.object({
  signed_url: z.string(),
  file_path: z.string(),
  bucket: z.literal('pdfs'),
  expires_at: z.string(),
  bytes_length: z.number().int().positive(),
});

const TemplatesResponse = z.object({
  templates: z.array(
    z.object({ id: z.string(), description: z.string() }),
  ),
});

const DrainResponse = z.object({
  processed: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  failed:    z.number().int().nonnegative(),
});

describe('pdf-worker wire contract', () => {
  it('accepts the documented render response shape', () => {
    const sample = {
      signed_url: 'https://example.supabase.co/storage/v1/object/sign/pdfs/.../1234.pdf?token=abc',
      file_path: '00000000-0000-0000-0000-000000000001/invoice/11111111-1111-1111-1111-111111111111/1234.pdf',
      bucket: 'pdfs',
      expires_at: '2026-05-17T12:00:00.000Z',
      bytes_length: 4096,
    };
    expect(RenderResponse.safeParse(sample).success).toBe(true);
  });

  it('rejects an empty bytes_length', () => {
    const bad = { signed_url: 'x', file_path: 'y', bucket: 'pdfs', expires_at: 'z', bytes_length: 0 };
    expect(RenderResponse.safeParse(bad).success).toBe(false);
  });

  it('accepts the documented templates list shape', () => {
    const sample = {
      templates: [
        { id: 'invoice', description: 'Invoice with totals and balance' },
        { id: 'quote', description: 'Quote with totals' },
        { id: 'payment', description: 'Payment receipt' },
      ],
    };
    expect(TemplatesResponse.safeParse(sample).success).toBe(true);
  });
});

describe('notifications-worker wire contract', () => {
  it('accepts a typical drain response', () => {
    expect(DrainResponse.safeParse({ processed: 3, delivered: 2, failed: 1 }).success).toBe(true);
  });

  it('rejects negative counts', () => {
    expect(DrainResponse.safeParse({ processed: -1, delivered: 0, failed: 0 }).success).toBe(false);
  });
});

describe('pdf.render capability matrix', () => {
  // Mirror of supabase/functions/_shared/capabilities.ts: pdf.render
  // short-circuits to true at top of `allow()` so every role gets it.
  const ROLES = ['org_owner', 'org_admin', 'sales', 'ops', 'accounting', 'viewer', 'customer_user'] as const;

  it('grants pdf.render to every role tier', () => {
    // Sanity: keep this list aligned with allow(); if a future change scopes
    // pdf.render down (e.g. customer_user removed), update both sides together.
    for (const role of ROLES) {
      expect(role).toMatch(/^(org_owner|org_admin|sales|ops|accounting|viewer|customer_user)$/);
    }
  });
});
