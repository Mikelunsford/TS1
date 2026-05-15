/**
 * quotes-api — route table.
 *
 * Wave 4 ships the quotes workflow + line items per
 * TS1/09-api/00-API-CONTRACT.md §4. State-machine endpoints route through
 * `_shared/workflow.ts#assertTransition`; `send` and `accept` stamp activity
 * rows without changing `status` (R-W4-PF-01 reconcile).
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import {
  acceptQuote,
  approveQuote,
  convertQuoteToProject,
  createQuote,
  declineQuote,
  duplicateQuote,
  getQuote,
  getQuotePdf,
  listQuoteVersions,
  listQuotes,
  patchQuote,
  requestRevisionsQuote,
  sendQuote,
  submitQuote,
} from './handlers/quotes.ts';
import {
  appendQuoteLine,
  deleteQuoteLine,
  listQuoteLines,
  patchQuoteLine,
  reorderQuoteLines,
  replaceQuoteLines,
} from './handlers/line-items.ts';

const BUNDLE = 'quotes-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // Quotes
  { method: 'GET', path: '/quotes', handler: listQuotes },
  { method: 'POST', path: '/quotes', handler: createQuote },
  { method: 'GET', path: '/quotes/:id', handler: getQuote },
  { method: 'PATCH', path: '/quotes/:id', handler: patchQuote },
  { method: 'POST', path: '/quotes/:id/submit', handler: submitQuote },
  { method: 'POST', path: '/quotes/:id/approve', handler: approveQuote },
  { method: 'POST', path: '/quotes/:id/request-revisions', handler: requestRevisionsQuote },
  { method: 'POST', path: '/quotes/:id/decline', handler: declineQuote },
  { method: 'POST', path: '/quotes/:id/send', handler: sendQuote },
  { method: 'POST', path: '/quotes/:id/accept', handler: acceptQuote },
  { method: 'POST', path: '/quotes/:id/convert-to-project', handler: convertQuoteToProject },
  { method: 'POST', path: '/quotes/:id/duplicate', handler: duplicateQuote },
  { method: 'GET', path: '/quotes/:id/pdf', handler: getQuotePdf },
  { method: 'GET', path: '/quotes/:id/versions', handler: listQuoteVersions },

  // Quote line items
  { method: 'GET', path: '/quotes/:quote_id/line-items', handler: listQuoteLines },
  { method: 'POST', path: '/quotes/:quote_id/line-items', handler: replaceQuoteLines },
  { method: 'POST', path: '/quotes/:quote_id/line-items/append', handler: appendQuoteLine },
  { method: 'POST', path: '/quotes/:quote_id/line-items/reorder', handler: reorderQuoteLines },
  { method: 'PATCH', path: '/quotes/:quote_id/line-items/:line_id', handler: patchQuoteLine },
  { method: 'DELETE', path: '/quotes/:quote_id/line-items/:line_id', handler: deleteQuoteLine },
];
