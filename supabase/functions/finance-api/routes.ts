/**
 * finance-api — route table.
 *
 * Wave 3 / Phase 3 sales chassis: currencies, exchange rates, taxes,
 * payment methods. Expenses, COA, journal entries land in later waves.
 * See TS1/09-api/00-API-CONTRACT.md §7.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import { withFlag } from '../_shared/withFlag.ts';
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
import {
  archiveChartOfAccount,
  createChartOfAccount,
  getChartOfAccount,
  listChartOfAccounts,
  patchChartOfAccount,
} from './handlers/chart-of-accounts.ts';
import {
  createJournalEntry,
  getJournalEntry,
  listJournalEntries,
  patchJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
} from './handlers/journal-entries.ts';
import {
  closePeriodClose,
  createPeriodClose,
  getPeriodClose,
  listPeriodCloses,
  patchPeriodClose,
  reopenPeriodClose,
} from './handlers/period-close.ts';
import {
  getArAging,
  getBalanceSheet,
  getCashPosition,
  getExpenseByCategory,
  getProfitLoss,
  getSalesByCustomer,
  getSalesByItem,
  getTrialBalance,
} from './handlers/reports.ts';

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

  // Expense categories (Wave 7 / Phase 11) — Phase 15 gated on finance.expenses
  { method: 'GET', path: '/expense-categories', handler: withFlag('finance.expenses', listExpenseCategories) },
  { method: 'POST', path: '/expense-categories', handler: withFlag('finance.expenses', createExpenseCategory) },
  { method: 'PATCH', path: '/expense-categories/:id', handler: withFlag('finance.expenses', patchExpenseCategory) },
  { method: 'POST', path: '/expense-categories/:id/archive', handler: withFlag('finance.expenses', archiveExpenseCategory) },

  // Expenses (Wave 7 / Phase 11) — Phase 15 gated on finance.expenses
  { method: 'GET', path: '/expenses', handler: withFlag('finance.expenses', listExpenses) },
  { method: 'POST', path: '/expenses', handler: withFlag('finance.expenses', createExpense) },
  { method: 'GET', path: '/expenses/:id', handler: withFlag('finance.expenses', getExpense) },
  { method: 'PATCH', path: '/expenses/:id', handler: withFlag('finance.expenses', patchExpense) },
  { method: 'POST', path: '/expenses/:id/submit', handler: withFlag('finance.expenses', submitExpense) },
  { method: 'POST', path: '/expenses/:id/approve', handler: withFlag('finance.expenses', approveExpense) },
  { method: 'POST', path: '/expenses/:id/reject', handler: withFlag('finance.expenses', rejectExpense) },
  { method: 'POST', path: '/expenses/:id/reimburse', handler: withFlag('finance.expenses', reimburseExpense) },
  { method: 'POST', path: '/expenses/:id/pay', handler: withFlag('finance.expenses', payExpense) },

  // Chart of accounts (Wave 8 / Phase 12) — Phase 15 gated on finance.chart_of_accounts
  { method: 'GET', path: '/chart-of-accounts', handler: withFlag('finance.chart_of_accounts', listChartOfAccounts) },
  { method: 'POST', path: '/chart-of-accounts', handler: withFlag('finance.chart_of_accounts', createChartOfAccount) },
  { method: 'GET', path: '/chart-of-accounts/:id', handler: withFlag('finance.chart_of_accounts', getChartOfAccount) },
  { method: 'PATCH', path: '/chart-of-accounts/:id', handler: withFlag('finance.chart_of_accounts', patchChartOfAccount) },
  { method: 'POST', path: '/chart-of-accounts/:id/archive', handler: withFlag('finance.chart_of_accounts', archiveChartOfAccount) },

  // Journal entries (Wave 8 / Phase 12)
  { method: 'GET', path: '/journal-entries', handler: listJournalEntries },
  { method: 'POST', path: '/journal-entries', handler: createJournalEntry },
  { method: 'GET', path: '/journal-entries/:id', handler: getJournalEntry },
  { method: 'PATCH', path: '/journal-entries/:id', handler: patchJournalEntry },
  { method: 'POST', path: '/journal-entries/:id/post', handler: postJournalEntry },
  { method: 'POST', path: '/journal-entries/:id/reverse', handler: reverseJournalEntry },

  // Period close (Wave 8e / Phase 18)
  { method: 'GET', path: '/period-closes', handler: listPeriodCloses },
  { method: 'POST', path: '/period-closes', handler: createPeriodClose },
  { method: 'GET', path: '/period-closes/:id', handler: getPeriodClose },
  { method: 'PATCH', path: '/period-closes/:id', handler: patchPeriodClose },
  { method: 'POST', path: '/period-closes/:id/close', handler: closePeriodClose },
  { method: 'POST', path: '/period-closes/:id/reopen', handler: reopenPeriodClose },

  // Financial reports (Wave 8e / Phase 18)
  { method: 'GET', path: '/reports/trial-balance', handler: getTrialBalance },
  { method: 'GET', path: '/reports/profit-loss', handler: getProfitLoss },
  { method: 'GET', path: '/reports/balance-sheet', handler: getBalanceSheet },

  // Reports polish (Wave 10) — A1 owns this block.
  { method: 'GET', path: '/reports/ar-aging', handler: getArAging },
  { method: 'GET', path: '/reports/sales-by-customer', handler: getSalesByCustomer },
  { method: 'GET', path: '/reports/sales-by-item', handler: getSalesByItem },
  { method: 'GET', path: '/reports/cash-position', handler: getCashPosition },
  { method: 'GET', path: '/reports/expense-by-category', handler: getExpenseByCategory },
  // End Reports polish (Wave 10).
];
