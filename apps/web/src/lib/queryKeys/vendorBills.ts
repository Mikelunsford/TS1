/**
 * Vendor bills query keys (Wave 7 / Phase 10).
 */
import type { VendorBillListFilters } from '../services/vendorBillsService';

export const vendorBillKeys = {
  all: ['procurement', 'vendor_bills'] as const,
  list: (filters: VendorBillListFilters = {}) =>
    [...vendorBillKeys.all, 'list', filters] as const,
  detail: (id: string) => [...vendorBillKeys.all, 'detail', id] as const,
};
