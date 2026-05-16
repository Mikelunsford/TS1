/**
 * TanStack Query key factory for collaboration-api (Phase 16 / Wave 10 S2).
 */
export const collaborationKeys = {
  all: ['collaboration'] as const,
  comments: (entityType: string, entityId: string) =>
    [...collaborationKeys.all, 'comments', entityType, entityId] as const,
  attachments: (entityType: string, entityId: string) =>
    [...collaborationKeys.all, 'attachments', entityType, entityId] as const,
  notifications: (unreadOnly: boolean) =>
    [...collaborationKeys.all, 'notifications', unreadOnly] as const,
  mentions: (q: string) =>
    [...collaborationKeys.all, 'mentions', q] as const,
};
