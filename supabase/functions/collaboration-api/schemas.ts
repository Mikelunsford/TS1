/**
 * collaboration-api — Zod schemas for body validation.
 * Phase 16 (Wave 10 Session 2) — B1 owns this block.
 */

import { z } from 'https://esm.sh/zod@3.23.8';

export const ENTITY_TYPES = [
  'quote','project','customer','contact','lead','opportunity',
  'invoice','payment','credit_note','expense','purchase_order','vendor_bill',
  'vendor','item','journal_entry',
  'receiving_order','production_run','shipment',
] as const;

export const EntityTypeSchema = z.enum(ENTITY_TYPES);

export const CommentCreateSchema = z.object({
  entity_type: EntityTypeSchema,
  entity_id: z.string().uuid(),
  body: z.string().min(1).max(4000),
  mentions: z.array(z.string().uuid()).default([]),
  parent_comment_id: z.string().uuid().nullable().optional(),
});

export const CommentPatchSchema = z.object({
  body: z.string().min(1).max(4000),
  mentions: z.array(z.string().uuid()).optional(),
});

export const AttachmentCreateSchema = z.object({
  entity_type: EntityTypeSchema,
  entity_id: z.string().uuid(),
  file_name: z.string().min(1).max(512),
  file_path: z.string().min(1).max(1024),
  mime_type: z.string().min(1).max(255).nullable().optional(),
  size_bytes: z.number().int().min(0).nullable().optional(),
  category: z.string().max(64).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const SignUploadSchema = z.object({
  entity_type: EntityTypeSchema,
  entity_id: z.string().uuid(),
  file_name: z.string().min(1).max(512),
  mime_type: z.string().min(1).max(255).optional(),
});

export type EntityType = (typeof ENTITY_TYPES)[number];
