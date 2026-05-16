/**
 * Invoices service. Wraps the invoicing-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §6 (DB-wins reconcile pending in 5.4).
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  InvoiceSchema,
  InvoiceVersionSchema,
  type Invoice,
  type InvoiceConvertFromProject,
  type InvoiceConvertFromQuote,
  type InvoiceCreate,
  type InvoiceDuplicate,
  type InvoiceHold,
  type InvoicePatch,
  type InvoiceRelease,
  type InvoiceSend,
  type InvoiceSubmit,
  type InvoiceVersion,
  type InvoiceVoid,
} from '../types';

const InvoiceListSchema = z.object({
  items: z.array(InvoiceSchema),
  next_cursor: z.string().nullable(),
});

const InvoiceVersionListSchema = z.object({
  items: z.array(InvoiceVersionSchema),
});

export interface InvoiceListFilters {
  q?: string;
  status?: string;
  payment_status?: string;
  customer_id?: string;
  currency_code?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: InvoiceListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.q) sp.set('q', filters.q);
  if (filters.status) sp.set('status', filters.status);
  if (filters.payment_status) sp.set('payment_status', filters.payment_status);
  if (filters.customer_id) sp.set('customer_id', filters.customer_id);
  if (filters.currency_code) sp.set('currency_code', filters.currency_code);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listInvoices(filters?: InvoiceListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/invoicing-api/invoices${toQuery(filters)}`,
    schema: InvoiceListSchema,
  });
}

export function getInvoice(id: string): Promise<Invoice> {
  return apiRequest({
    method: 'GET',
    path: `/invoicing-api/invoices/${id}`,
    schema: InvoiceSchema,
  });
}

export function createInvoice(body: InvoiceCreate): Promise<Invoice> {
  return apiRequest({
    method: 'POST',
    path: '/invoicing-api/invoices',
    body,
    schema: InvoiceSchema,
  });
}

export function updateInvoice(id: string, body: InvoicePatch): Promise<Invoice> {
  return apiRequest({
    method: 'PATCH',
    path: `/invoicing-api/invoices/${id}`,
    body,
    schema: InvoiceSchema,
  });
}

export function submitInvoice(id: string, body: InvoiceSubmit = {}): Promise<Invoice> {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/invoices/${id}/submit`,
    body,
    schema: InvoiceSchema,
  });
}

export function sendInvoice(id: string, body: InvoiceSend = {}): Promise<Invoice> {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/invoices/${id}/send`,
    body,
    schema: InvoiceSchema,
  });
}

export function voidInvoice(id: string, body: InvoiceVoid): Promise<Invoice> {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/invoices/${id}/void`,
    body,
    schema: InvoiceSchema,
  });
}

export function holdInvoice(id: string, body: InvoiceHold = {}): Promise<Invoice> {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/invoices/${id}/hold`,
    body,
    schema: InvoiceSchema,
  });
}

export function releaseInvoice(id: string, body: InvoiceRelease = {}): Promise<Invoice> {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/invoices/${id}/release`,
    body,
    schema: InvoiceSchema,
  });
}

export function duplicateInvoice(id: string, body: InvoiceDuplicate = {}): Promise<Invoice> {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/invoices/${id}/duplicate`,
    body,
    schema: InvoiceSchema,
  });
}

export function listInvoiceVersions(id: string): Promise<{ items: InvoiceVersion[] }> {
  return apiRequest({
    method: 'GET',
    path: `/invoicing-api/invoices/${id}/versions`,
    schema: InvoiceVersionListSchema,
  });
}

export function getInvoicePdf(id: string) {
  // Reserved Phase 19 endpoint — server returns 501 PDF_NOT_YET_AVAILABLE.
  return apiRequest({
    method: 'GET',
    path: `/invoicing-api/invoices/${id}/pdf`,
    schema: z.unknown(),
  });
}

export function convertFromQuote(body: InvoiceConvertFromQuote): Promise<Invoice> {
  return apiRequest({
    method: 'POST',
    path: '/invoicing-api/invoices/from-quote',
    body,
    schema: InvoiceSchema,
  });
}

export function convertFromProject(body: InvoiceConvertFromProject): Promise<Invoice> {
  return apiRequest({
    method: 'POST',
    path: '/invoicing-api/invoices/from-project',
    body,
    schema: InvoiceSchema,
  });
}
