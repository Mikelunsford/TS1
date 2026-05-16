/**
 * invoicing-api — route table (Wave 5 / Phase 7 + Phase 8).
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §6 + Wave 5 dispatch, reconciled
 * DB-wins to the prod columns + CHECK constraints (verified 2026-05-15,
 * schema_migrations=0052). See handler file headers for the drift list.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import {
  convertFromProject,
  convertFromQuote,
  createInvoice,
  duplicateInvoice,
  getInvoice,
  getInvoicePdf,
  holdInvoice,
  listInvoiceVersions,
  listInvoices,
  patchInvoice,
  releaseInvoice,
  sendInvoice,
  submitInvoice,
  voidInvoice,
} from './handlers/invoices.ts';
import {
  appendInvoiceLine,
  deleteInvoiceLine,
  listInvoiceLines,
  patchInvoiceLine,
  reorderInvoiceLines,
  replaceInvoiceLines,
} from './handlers/line-items.ts';
import {
  createPayment,
  getPayment,
  listPayments,
  patchPayment,
  voidPayment,
} from './handlers/payments.ts';
import {
  applyCreditNote,
  createCreditNote,
  getCreditNote,
  issueCreditNote,
  listCreditNotes,
  voidCreditNote,
} from './handlers/credit-notes.ts';

const BUNDLE = 'invoicing-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // ---- Invoices ----
  { method: 'GET', path: '/invoices', handler: listInvoices },
  { method: 'POST', path: '/invoices', handler: createInvoice },
  { method: 'POST', path: '/invoices/from-quote', handler: convertFromQuote },
  { method: 'POST', path: '/invoices/from-project', handler: convertFromProject },
  { method: 'GET', path: '/invoices/:id', handler: getInvoice },
  { method: 'PATCH', path: '/invoices/:id', handler: patchInvoice },
  { method: 'POST', path: '/invoices/:id/submit', handler: submitInvoice },
  { method: 'POST', path: '/invoices/:id/send', handler: sendInvoice },
  { method: 'POST', path: '/invoices/:id/void', handler: voidInvoice },
  { method: 'POST', path: '/invoices/:id/hold', handler: holdInvoice },
  { method: 'POST', path: '/invoices/:id/release', handler: releaseInvoice },
  { method: 'POST', path: '/invoices/:id/duplicate', handler: duplicateInvoice },
  { method: 'GET', path: '/invoices/:id/pdf', handler: getInvoicePdf },
  { method: 'GET', path: '/invoices/:id/versions', handler: listInvoiceVersions },

  // ---- Invoice line items ----
  { method: 'GET', path: '/invoices/:invoice_id/line-items', handler: listInvoiceLines },
  { method: 'POST', path: '/invoices/:invoice_id/line-items', handler: replaceInvoiceLines },
  { method: 'POST', path: '/invoices/:invoice_id/line-items/append', handler: appendInvoiceLine },
  { method: 'POST', path: '/invoices/:invoice_id/line-items/reorder', handler: reorderInvoiceLines },
  { method: 'PATCH', path: '/invoices/:invoice_id/line-items/:line_id', handler: patchInvoiceLine },
  { method: 'DELETE', path: '/invoices/:invoice_id/line-items/:line_id', handler: deleteInvoiceLine },

  // ---- Payments ----
  { method: 'GET', path: '/payments', handler: listPayments },
  { method: 'POST', path: '/payments', handler: createPayment },
  { method: 'GET', path: '/payments/:id', handler: getPayment },
  { method: 'PATCH', path: '/payments/:id', handler: patchPayment },
  { method: 'POST', path: '/payments/:id/void', handler: voidPayment },

  // ---- Credit notes ----
  { method: 'GET', path: '/credit-notes', handler: listCreditNotes },
  { method: 'POST', path: '/credit-notes', handler: createCreditNote },
  { method: 'GET', path: '/credit-notes/:id', handler: getCreditNote },
  { method: 'POST', path: '/credit-notes/:id/issue', handler: issueCreditNote },
  { method: 'POST', path: '/credit-notes/:id/apply', handler: applyCreditNote },
  { method: 'POST', path: '/credit-notes/:id/void', handler: voidCreditNote },
];
