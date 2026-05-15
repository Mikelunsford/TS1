/**
 * Quotes service. Wraps the quotes-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §4.1.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  QuoteSchema,
  QuoteVersionSchema,
  type Quote,
  type QuoteAccept,
  type QuoteApprove,
  type QuoteConvert,
  type QuoteCreate,
  type QuoteDecline,
  type QuoteDuplicate,
  type QuotePatch,
  type QuoteRequestRevisions,
  type QuoteSend,
  type QuoteSubmit,
  type QuoteVersion,
} from '../types';

const QuoteListSchema = z.object({
  items: z.array(QuoteSchema),
  next_cursor: z.string().nullable(),
});

const QuoteVersionListSchema = z.object({
  items: z.array(QuoteVersionSchema),
});

const ConvertResponseSchema = z.object({
  quote_id: z.string().uuid(),
  project: z.unknown(),
});

export interface QuoteListFilters {
  q?: string;
  status?: string;
  customer_id?: string;
  currency_code?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: QuoteListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.q) sp.set('q', filters.q);
  if (filters.status) sp.set('status', filters.status);
  if (filters.customer_id) sp.set('customer_id', filters.customer_id);
  if (filters.currency_code) sp.set('currency_code', filters.currency_code);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listQuotes(filters?: QuoteListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/quotes-api/quotes${toQuery(filters)}`,
    schema: QuoteListSchema,
  });
}

export function getQuote(id: string): Promise<Quote> {
  return apiRequest({
    method: 'GET',
    path: `/quotes-api/quotes/${id}`,
    schema: QuoteSchema,
  });
}

export function createQuote(body: QuoteCreate): Promise<Quote> {
  return apiRequest({ method: 'POST', path: '/quotes-api/quotes', body, schema: QuoteSchema });
}

export function updateQuote(id: string, body: QuotePatch): Promise<Quote> {
  return apiRequest({
    method: 'PATCH',
    path: `/quotes-api/quotes/${id}`,
    body,
    schema: QuoteSchema,
  });
}

export function submitQuote(id: string, body: QuoteSubmit = {}): Promise<Quote> {
  return apiRequest({
    method: 'POST',
    path: `/quotes-api/quotes/${id}/submit`,
    body,
    schema: QuoteSchema,
  });
}

export function approveQuote(id: string, body: QuoteApprove = {}): Promise<Quote> {
  return apiRequest({
    method: 'POST',
    path: `/quotes-api/quotes/${id}/approve`,
    body,
    schema: QuoteSchema,
  });
}

export function requestRevisionsQuote(id: string, body: QuoteRequestRevisions): Promise<Quote> {
  return apiRequest({
    method: 'POST',
    path: `/quotes-api/quotes/${id}/request-revisions`,
    body,
    schema: QuoteSchema,
  });
}

export function declineQuote(id: string, body: QuoteDecline): Promise<Quote> {
  return apiRequest({
    method: 'POST',
    path: `/quotes-api/quotes/${id}/decline`,
    body,
    schema: QuoteSchema,
  });
}

export function sendQuote(id: string, body: QuoteSend = {}): Promise<Quote> {
  return apiRequest({
    method: 'POST',
    path: `/quotes-api/quotes/${id}/send`,
    body,
    schema: QuoteSchema,
  });
}

export function acceptQuote(id: string, body: QuoteAccept = {}): Promise<Quote> {
  return apiRequest({
    method: 'POST',
    path: `/quotes-api/quotes/${id}/accept`,
    body,
    schema: QuoteSchema,
  });
}

export function convertQuoteToProject(id: string, body: QuoteConvert) {
  return apiRequest({
    method: 'POST',
    path: `/quotes-api/quotes/${id}/convert-to-project`,
    body,
    schema: ConvertResponseSchema,
  });
}

export function duplicateQuote(id: string, body: QuoteDuplicate = {}): Promise<Quote> {
  return apiRequest({
    method: 'POST',
    path: `/quotes-api/quotes/${id}/duplicate`,
    body,
    schema: QuoteSchema,
  });
}

export function listQuoteVersions(id: string): Promise<{ items: QuoteVersion[] }> {
  return apiRequest({
    method: 'GET',
    path: `/quotes-api/quotes/${id}/versions`,
    schema: QuoteVersionListSchema,
  });
}
