/**
 * Warehouses query keys (Wave 8f / Phase 13 SPA). Shape:
 * `[module, entity, ...args]`.
 */
import type { WarehouseListFilters } from '../services/warehousesService';

export const warehouseKeys = {
  all: ['inventory', 'warehouses'] as const,
  list: (filters: WarehouseListFilters = {}) =>
    [...warehouseKeys.all, 'list', filters] as const,
  detail: (id: string) => [...warehouseKeys.all, 'detail', id] as const,
};
