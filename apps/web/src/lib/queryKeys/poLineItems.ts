/**
 * PO line items query keys (Wave 7 / Phase 10). Lines are returned inline
 * via `GET /purchase-orders/:id`, so the `lines(poId)` key is shared with
 * the PO detail invalidation set.
 */
export const poLineItemKeys = {
  all: ['procurement', 'po_line_items'] as const,
  lines: (poId: string) => [...poLineItemKeys.all, 'lines', poId] as const,
};
