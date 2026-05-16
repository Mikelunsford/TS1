/**
 * Invoice line items service. See TS1/09-api/00-API-CONTRACT.md §6.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  InvoiceLineSchema,
  type InvoiceLine,
  type InvoiceLineReorder,
  type InvoiceLineReplace,
  type InvoiceLineUpsert,
} from '../types';

const InvoiceLineListSchema = z.object({
  items: z.array(InvoiceLineSchema),
  next_cursor: z.string().nullable(),
});

export function listInvoiceLines(invoiceId: string) {
  return apiRequest({
    method: 'GET',
    path: `/invoicing-api/invoices/${invoiceId}/line-items`,
    schema: InvoiceLineListSchema,
  });
}

export function replaceInvoiceLines(invoiceId: string, body: InvoiceLineReplace) {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/invoices/${invoiceId}/line-items`,
    body,
    schema: InvoiceLineListSchema,
  });
}

export function appendInvoiceLine(
  invoiceId: string,
  body: InvoiceLineUpsert,
): Promise<InvoiceLine> {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/invoices/${invoiceId}/line-items/append`,
    body,
    schema: InvoiceLineSchema,
  });
}

export function patchInvoiceLine(
  invoiceId: string,
  lineId: string,
  body: Partial<InvoiceLineUpsert>,
): Promise<InvoiceLine> {
  return apiRequest({
    method: 'PATCH',
    path: `/invoicing-api/invoices/${invoiceId}/line-items/${lineId}`,
    body,
    schema: InvoiceLineSchema,
  });
}

export function deleteInvoiceLine(invoiceId: string, lineId: string) {
  return apiRequest({
    method: 'DELETE',
    path: `/invoicing-api/invoices/${invoiceId}/line-items/${lineId}`,
    schema: z.object({ ok: z.literal(true) }),
  });
}

export function reorderInvoiceLines(invoiceId: string, body: InvoiceLineReorder) {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/invoices/${invoiceId}/line-items/reorder`,
    body,
    schema: InvoiceLineListSchema,
  });
}
