/**
 * Stock (levels + movements) query keys (Wave 8f / Phase 13 SPA).
 */
import type {
  StockLevelListFilters,
  StockMovementListFilters,
} from '../services/stockService';

export const stockLevelKeys = {
  all: ['inventory', 'stock-levels'] as const,
  list: (filters: StockLevelListFilters = {}) =>
    [...stockLevelKeys.all, 'list', filters] as const,
};

export const stockMovementKeys = {
  all: ['inventory', 'stock-movements'] as const,
  list: (filters: StockMovementListFilters = {}) =>
    [...stockMovementKeys.all, 'list', filters] as const,
};
