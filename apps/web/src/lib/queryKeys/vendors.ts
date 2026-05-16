/**
 * Vendors query keys (Wave 7 / Phase 10). Shape: `[module, entity, ...args]`.
 */
import type { VendorListFilters } from '../services/vendorsService';

export const vendorKeys = {
  all: ['procurement', 'vendors'] as const,
  list: (filters: VendorListFilters = {}) => [...vendorKeys.all, 'list', filters] as const,
  detail: (id: string) => [...vendorKeys.all, 'detail', id] as const,
};
