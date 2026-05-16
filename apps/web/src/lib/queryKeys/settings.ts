/**
 * TanStack Query key factory for settings + flags + numbering (Phase 15).
 */
export const settingsKeys = {
  all: ['settings'] as const,
  flags: () => [...settingsKeys.all, 'flags'] as const,
  allGroups: () => [...settingsKeys.all, 'me-all'] as const,
  group: (group: string) => [...settingsKeys.all, 'group', group] as const,
  numbering: () => [...settingsKeys.all, 'numbering'] as const,
};
