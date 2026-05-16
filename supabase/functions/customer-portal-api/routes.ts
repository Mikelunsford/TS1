/**
 * customer-portal-api — route table.
 *
 * Phase 21 (Wave 10 Session 4) — 9 read-only GETs scoped to the caller's
 * customer_id. All routes pass through `requireCap(caller, 'portal.read')`
 * inside their handler before any data access.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import { getMe } from './handlers/me.ts';
import { listInvoices, getInvoice } from './handlers/invoices.ts';
import { listQuotes, getQuote } from './handlers/quotes.ts';
import { listProjects, getProject } from './handlers/projects.ts';
import { listPayments } from './handlers/payments.ts';
import { getStatement } from './handlers/statements.ts';

const BUNDLE = 'customer-portal-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  { method: 'GET', path: '/portal/me',               handler: getMe },
  { method: 'GET', path: '/portal/invoices',         handler: listInvoices },
  { method: 'GET', path: '/portal/invoices/:id',     handler: getInvoice },
  { method: 'GET', path: '/portal/quotes',           handler: listQuotes },
  { method: 'GET', path: '/portal/quotes/:id',       handler: getQuote },
  { method: 'GET', path: '/portal/projects',         handler: listProjects },
  { method: 'GET', path: '/portal/projects/:id',     handler: getProject },
  { method: 'GET', path: '/portal/payments',         handler: listPayments },
  { method: 'GET', path: '/portal/statements',       handler: getStatement },
];
