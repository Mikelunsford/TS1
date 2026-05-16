/**
 * Receiving orders query keys (Wave 8f / Phase 13 SPA).
 */
import type { ReceivingOrderListFilters } from '../services/receivingOrdersService';

export const receivingOrderKeys = {
  all: ['ops', 'receiving-orders'] as const,
  list: (filters: ReceivingOrderListFilters = {}) =>
    [...receivingOrderKeys.all, 'list', filters] as const,
  detail: (id: string) => [...receivingOrderKeys.all, 'detail', id] as const,
};
