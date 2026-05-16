/**
 * Search query keys (Phase 17 — Wave 10 Session 2 / Agent B2).
 */

export const searchKeys = {
  all: ['search'] as const,
  global: (q: string, types?: string[]) =>
    [...searchKeys.all, 'global', q, (types ?? []).join(',')] as const,
  auditTimeline: (entityType: string, entityId: string) =>
    [...searchKeys.all, 'audit-timeline', entityType, entityId] as const,
};
