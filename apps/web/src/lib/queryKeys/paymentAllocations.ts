/**
 * Payment-allocations query keys (Wave 8 / Phase 12).
 *
 * Allocations are always scoped to a parent payment in the SPA, so the
 * primary key shape is `[finance, payment-allocations, payment_id]`.
 */
export const paymentAllocationKeys = {
  all: ['finance', 'payment-allocations'] as const,
  byPayment: (paymentId: string) =>
    [...paymentAllocationKeys.all, 'by-payment', paymentId] as const,
};
