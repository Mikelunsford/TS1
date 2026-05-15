/**
 * finance-api — route table.
 *
 * Wave 3 / Phase 3 sales chassis: currencies, exchange rates, taxes,
 * payment methods. Expenses, COA, journal entries land in later waves.
 * See TS1/09-api/00-API-CONTRACT.md §7.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import {
  listCurrencies,
  patchCurrency,
  upsertCurrency,
} from './handlers/currencies.ts';
import {
  createExchangeRate,
  listExchangeRates,
} from './handlers/exchange-rates.ts';
import {
  archiveTax,
  createTax,
  getTax,
  listTaxes,
  patchTax,
} from './handlers/taxes.ts';
import {
  createPaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  patchPaymentMethod,
} from './handlers/payment-methods.ts';

const BUNDLE = 'finance-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // Currencies (global table; no org scoping in queries)
  { method: 'GET', path: '/currencies', handler: listCurrencies },
  { method: 'POST', path: '/currencies', handler: upsertCurrency },
  { method: 'PATCH', path: '/currencies/:code', handler: patchCurrency },

  // Exchange rates (global table)
  { method: 'GET', path: '/exchange-rates', handler: listExchangeRates },
  { method: 'POST', path: '/exchange-rates', handler: createExchangeRate },

  // Taxes (org-scoped)
  { method: 'GET', path: '/taxes', handler: listTaxes },
  { method: 'POST', path: '/taxes', handler: createTax },
  { method: 'GET', path: '/taxes/:id', handler: getTax },
  { method: 'PATCH', path: '/taxes/:id', handler: patchTax },
  { method: 'POST', path: '/taxes/:id/archive', handler: archiveTax },

  // Payment methods (org-scoped)
  { method: 'GET', path: '/payment-methods', handler: listPaymentMethods },
  { method: 'POST', path: '/payment-methods', handler: createPaymentMethod },
  { method: 'PATCH', path: '/payment-methods/:id', handler: patchPaymentMethod },
  { method: 'DELETE', path: '/payment-methods/:id', handler: deletePaymentMethod },
];
