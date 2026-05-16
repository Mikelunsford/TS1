/**
 * Journal-entries query keys (Wave 8 / Phase 12).
 */
import type { JournalEntryListFilters } from '../services/journalEntriesService';

export const journalEntryKeys = {
  all: ['finance', 'journal-entries'] as const,
  list: (filters: JournalEntryListFilters = {}) =>
    [...journalEntryKeys.all, 'list', filters] as const,
  detail: (id: string) => [...journalEntryKeys.all, 'detail', id] as const,
  /** Sub-key used by SourceJETimeline. */
  bySource: (sourceType: string, sourceId: string) =>
    [...journalEntryKeys.all, 'by-source', sourceType, sourceId] as const,
};
