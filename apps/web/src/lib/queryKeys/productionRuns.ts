/**
 * Production runs query keys (Wave 8f / Phase 13 SPA).
 */
import type { ProductionRunListFilters } from '../services/productionRunsService';

export const productionRunKeys = {
  all: ['ops', 'production-runs'] as const,
  list: (filters: ProductionRunListFilters = {}) =>
    [...productionRunKeys.all, 'list', filters] as const,
  detail: (id: string) => [...productionRunKeys.all, 'detail', id] as const,
};
