/**
 * Invoices query keys. Shape: `[module, entity, ...args]`.
 */
import type { InvoiceListFilters } from '../services/invoicesService';

export const invoiceKeys = {
  all: ['invoicing', 'invoices'] as const,
  list: (filters: InvoiceListFilters = {}) => [...invoiceKeys.all, 'list', filters] as const,
  detail: (id: string) => [...invoiceKeys.all, 'detail', id] as const,
  versions: (id: string) => [...invoiceKeys.all, 'versions', id] as const,
  lines: (invoiceId: string) => [...invoiceKeys.all, 'lines', invoiceId] as const,
};
