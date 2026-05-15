/**
 * Quote line items service. See TS1/09-api/00-API-CONTRACT.md §4.2.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  QuoteLineSchema,
  type QuoteLine,
  type QuoteLineReorder,
  type QuoteLineReplace,
  type QuoteLineUpsert,
} from '../types';

const QuoteLineListSchema = z.object({
  items: z.array(QuoteLineSchema),
  next_cursor: z.string().nullable(),
});

export function listQuoteLines(quoteId: string) {
  return apiRequest({
    method: 'GET',
    path: `/quotes-api/quotes/${quoteId}/line-items`,
    schema: QuoteLineListSchema,
  });
}

export function replaceQuoteLines(quoteId: string, body: QuoteLineReplace) {
  return apiRequest({
    method: 'POST',
    path: `/quotes-api/quotes/${quoteId}/line-items`,
    body,
    schema: QuoteLineListSchema,
  });
}

export function appendQuoteLine(quoteId: string, body: QuoteLineUpsert): Promise<QuoteLine> {
  return apiRequest({
    method: 'POST',
    path: `/quotes-api/quotes/${quoteId}/line-items/append`,
    body,
    schema: QuoteLineSchema,
  });
}

export function patchQuoteLine(
  quoteId: string,
  lineId: string,
  body: Partial<QuoteLineUpsert>,
): Promise<QuoteLine> {
  return apiRequest({
    method: 'PATCH',
    path: `/quotes-api/quotes/${quoteId}/line-items/${lineId}`,
    body,
    schema: QuoteLineSchema,
  });
}

export function deleteQuoteLine(quoteId: string, lineId: string) {
  return apiRequest({
    method: 'DELETE',
    path: `/quotes-api/quotes/${quoteId}/line-items/${lineId}`,
    schema: z.object({ ok: z.literal(true) }),
  });
}

export function reorderQuoteLines(quoteId: string, body: QuoteLineReorder) {
  return apiRequest({
    method: 'POST',
    path: `/quotes-api/quotes/${quoteId}/line-items/reorder`,
    body,
    schema: QuoteLineListSchema,
  });
}
