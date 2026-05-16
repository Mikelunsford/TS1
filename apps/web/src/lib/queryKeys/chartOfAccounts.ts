/**
 * Chart-of-accounts query keys (Wave 8 / Phase 12).
 */
import type { ChartOfAccountListFilters } from '../services/chartOfAccountsService';

export const chartOfAccountKeys = {
  all: ['finance', 'chart-of-accounts'] as const,
  list: (filters: ChartOfAccountListFilters = {}) =>
    [...chartOfAccountKeys.all, 'list', filters] as const,
  detail: (id: string) => [...chartOfAccountKeys.all, 'detail', id] as const,
};
