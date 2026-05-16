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
import {
  archiveExpenseCategory,
  createExpenseCategory,
  listExpenseCategories,
  patchExpenseCategory,
} from './handlers/expense-categories.ts';
import {
  approveExpense,
  createExpense,
  getExpense,
  listExpenses,
  patchExpense,
  payExpense,
  rejectExpense,
  reimburseExpense,
  submitExpense,
} from './handlers/expenses.ts';

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

  // Expense categories (Wave 7 / Phase 11)
  { method: 'GET', path: '/expense-categories', handler: listExpenseCategories },
  { method: 'POST', path: '/expense-categories', handler: createExpenseCategory },
  { method: 'PATCH', path: '/expense-categories/:id', handler: patchExpenseCategory },
  { method: 'POST', path: '/expense-categories/:id/archive', handler: archiveExpenseCategory },

  // Expenses (Wave 7 / Phase 11)
  { method: 'GET', path: '/expenses', handler: listExpenses },
  { method: 'POST', path: '/expenses', handler: createExpense },
  { method: 'GET', path: '/expenses/:id', handler: getExpense },
  { method: 'PATCH', path: '/expenses/:id', handler: patchExpense },
  { method: 'POST', path: '/expenses/:id/submit', handler: submitExpense },
  { method: 'POST', path: '/expenses/:id/approve', handler: approveExpense },
  { method: 'POST', path: '/expenses/:id/reject', handler: rejectExpense },
  { method: 'POST', path: '/expenses/:id/reimburse', handler: reimburseExpense },
  { method: 'POST', path: '/expenses/:id/pay', handler: payExpense },
];
