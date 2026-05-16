/**
 * pdf-worker — Zod schemas at the wire boundary.
 * Phase 19 (Wave 10 Session 3).
 */
import { z } from 'https://esm.sh/zod@3.23.8';

export const RENDER_ENTITY_TYPES = ['invoice', 'quote', 'payment'] as const;
export type RenderEntityType = (typeof RENDER_ENTITY_TYPES)[number];

export const RenderPdfSchema = z.object({
  entity_type: z.enum(RENDER_ENTITY_TYPES),
  entity_id: z.string().uuid(),
});
export type RenderPdfInput = z.infer<typeof RenderPdfSchema>;
