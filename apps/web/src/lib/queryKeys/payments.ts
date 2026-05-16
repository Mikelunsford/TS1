/**
 * Payments query keys. Shape: `[module, entity, ...args]`.
 */
import type { PaymentListFilters } from '../services/paymentsService';

export const paymentKeys = {
  all: ['invoicing', 'payments'] as const,
  list: (filters: PaymentListFilters = {}) => [...paymentKeys.all, 'list', filters] as const,
  detail: (id: string) => [...paymentKeys.all, 'detail', id] as const,
};
