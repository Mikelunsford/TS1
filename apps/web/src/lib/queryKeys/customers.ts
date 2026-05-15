/**
 * Customers query keys. Created here so ConvertLeadDialog can invalidate
 * the customers list after a lead -> opportunity + customer conversion.
 * FE-A's customers code uses this same key shape (Wave 2 dispatch ordered
 * us to import-only their files; we own the queryKeys for this entity
 * because nothing else has touched them yet).
 */
export const customerKeys = {
  all: ['crm', 'customers'] as const,
  list: () => [...customerKeys.all, 'list'] as const,
  detail: (id: string) => [...customerKeys.all, 'detail', id] as const,
};
