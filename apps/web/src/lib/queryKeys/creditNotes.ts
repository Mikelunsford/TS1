/**
 * Credit notes query keys. Shape: `[module, entity, ...args]`.
 */
import type { CreditNoteListFilters } from '../services/creditNotesService';

export const creditNoteKeys = {
  all: ['invoicing', 'creditNotes'] as const,
  list: (filters: CreditNoteListFilters = {}) =>
    [...creditNoteKeys.all, 'list', filters] as const,
  detail: (id: string) => [...creditNoteKeys.all, 'detail', id] as const,
};
