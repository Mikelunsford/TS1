/**
 * Quotes query keys. Per /03-workspace/01-NAMING-CONVENTIONS.md "Query
 * keys", shape is `[module, entity, ...args]`.
 */
import type { QuoteListFilters } from '../services/quotesService';

export const quoteKeys = {
  all: ['quotes', 'quotes'] as const,
  list: (filters: QuoteListFilters = {}) => [...quoteKeys.all, 'list', filters] as const,
  detail: (id: string) => [...quoteKeys.all, 'detail', id] as const,
  versions: (id: string) => [...quoteKeys.all, 'versions', id] as const,
  lines: (quoteId: string) => [...quoteKeys.all, 'lines', quoteId] as const,
};
