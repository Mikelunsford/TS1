/**
 * Vendor portal query keys (Phase 22 / Wave 10 Session 4 / C2).
 * Shape: `[module, entity, ...args]`.
 */
import type { PortalListFilters } from '../services/vendorPortalService';

export const vendorPortalKeys = {
  all: ['vendor-portal'] as const,
  me: () => [...vendorPortalKeys.all, 'me'] as const,
  poList: (filters: PortalListFilters = {}) =>
    [...vendorPortalKeys.all, 'purchase-orders', 'list', filters] as const,
  poDetail: (id: string) =>
    [...vendorPortalKeys.all, 'purchase-orders', 'detail', id] as const,
  billsList: (filters: PortalListFilters = {}) =>
    [...vendorPortalKeys.all, 'vendor-bills', 'list', filters] as const,
  billDetail: (id: string) =>
    [...vendorPortalKeys.all, 'vendor-bills', 'detail', id] as const,
  payments: (filters: PortalListFilters = {}) =>
    [...vendorPortalKeys.all, 'payments', filters] as const,
  statement: (asOf?: string) =>
    [...vendorPortalKeys.all, 'statement', asOf ?? 'today'] as const,
};
