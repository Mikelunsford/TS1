/**
 * imports-api — Zod schemas for upload + commit payloads.
 *
 * Two routes per entity:
 *   POST /imports/:entity         body { csv_b64, dry_run: true }
 *   POST /imports/:entity/commit  body { csv_b64 }  (re-submitted; server re-validates)
 *
 * The pass-it-again approach (no Storage staging file) keeps the bundle
 * dependency-free at the cost of one extra base64 upload. See PR body for
 * rationale.
 */

import { z } from 'https://esm.sh/zod@3.23.8';

export const ImportPreviewRequestSchema = z.object({
  csv_b64: z.string().min(1),
  dry_run: z.literal(true).default(true),
});
export type ImportPreviewRequest = z.infer<typeof ImportPreviewRequestSchema>;

export const ImportCommitRequestSchema = z.object({
  csv_b64: z.string().min(1),
});
export type ImportCommitRequest = z.infer<typeof ImportCommitRequestSchema>;

export const ImportRowErrorSchema = z.object({
  row: z.number().int().nonnegative(),
  field: z.string(),
  message: z.string(),
});
export type ImportRowError = z.infer<typeof ImportRowErrorSchema>;

export const ImportPreviewResponseSchema = z.object({
  import_id: z.string().uuid(),
  errors: z.array(ImportRowErrorSchema),
  preview: z.array(z.record(z.unknown())),
  stats: z.object({
    total_rows: z.number().int().nonnegative(),
    valid_rows: z.number().int().nonnegative(),
    error_rows: z.number().int().nonnegative(),
  }),
});
export type ImportPreviewResponse = z.infer<typeof ImportPreviewResponseSchema>;

export const ImportCommitResponseSchema = z.object({
  inserted_count: z.number().int().nonnegative(),
  failed_rows: z.array(ImportRowErrorSchema),
});
export type ImportCommitResponse = z.infer<typeof ImportCommitResponseSchema>;
