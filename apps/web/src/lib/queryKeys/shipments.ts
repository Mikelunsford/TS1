/**
 * Shipments query keys (Wave 8f / Phase 13 SPA).
 */
import type { ShipmentListFilters } from '../services/shipmentsService';

export const shipmentKeys = {
  all: ['ops', 'shipments'] as const,
  list: (filters: ShipmentListFilters = {}) =>
    [...shipmentKeys.all, 'list', filters] as const,
  detail: (id: string) => [...shipmentKeys.all, 'detail', id] as const,
};
