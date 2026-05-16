/**
 * Purchase order query keys (Wave 7 / Phase 10).
 */
import type { PurchaseOrderListFilters } from '../services/purchaseOrdersService';

export const purchaseOrderKeys = {
  all: ['procurement', 'purchase_orders'] as const,
  list: (filters: PurchaseOrderListFilters = {}) =>
    [...purchaseOrderKeys.all, 'list', filters] as const,
  detail: (id: string) => [...purchaseOrderKeys.all, 'detail', id] as const,
};
