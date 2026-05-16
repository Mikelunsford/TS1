/**
 * Credit notes service. See TS1/09-api/00-API-CONTRACT.md §6.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  CreditNoteSchema,
  type CreditNote,
  type CreditNoteApply,
  type CreditNoteCreate,
  type CreditNoteIssue,
  type CreditNoteVoid,
} from '../types';

const CreditNoteListSchema = z.object({
  items: z.array(CreditNoteSchema),
  next_cursor: z.string().nullable(),
});

export interface CreditNoteListFilters {
  status?: string;
  customer_id?: string;
  invoice_id?: string;
  currency_code?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: CreditNoteListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.status) sp.set('status', filters.status);
  if (filters.customer_id) sp.set('customer_id', filters.customer_id);
  if (filters.invoice_id) sp.set('invoice_id', filters.invoice_id);
  if (filters.currency_code) sp.set('currency_code', filters.currency_code);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listCreditNotes(filters?: CreditNoteListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/invoicing-api/credit-notes${toQuery(filters)}`,
    schema: CreditNoteListSchema,
  });
}

export function getCreditNote(id: string): Promise<CreditNote> {
  return apiRequest({
    method: 'GET',
    path: `/invoicing-api/credit-notes/${id}`,
    schema: CreditNoteSchema,
  });
}

export function createCreditNote(body: CreditNoteCreate): Promise<CreditNote> {
  return apiRequest({
    method: 'POST',
    path: '/invoicing-api/credit-notes',
    body,
    schema: CreditNoteSchema,
  });
}

export function issueCreditNote(id: string, body: CreditNoteIssue = {}): Promise<CreditNote> {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/credit-notes/${id}/issue`,
    body,
    schema: CreditNoteSchema,
  });
}

export function applyCreditNote(id: string, body: CreditNoteApply): Promise<CreditNote> {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/credit-notes/${id}/apply`,
    body,
    schema: CreditNoteSchema,
  });
}

export function voidCreditNote(id: string, body: CreditNoteVoid): Promise<CreditNote> {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/credit-notes/${id}/void`,
    body,
    schema: CreditNoteSchema,
  });
}
