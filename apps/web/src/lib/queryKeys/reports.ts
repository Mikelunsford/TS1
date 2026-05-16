/**
 * Reports-domain query keys (Wave 8e + Wave 10 / Phase 18 polish).
 *
 * Per /03-workspace/01-NAMING-CONVENTIONS.md "Query keys", shape is
 * `[module, entity, ...args]`. Always construct keys via these objects so
 * downstream invalidation patterns stay consistent.
 */

export const reportKeys = {
  all: ['reports'] as const,

  // Wave 8e — core GL reports.
  trialBalance: (asOf: string, currency: string) =>
    [...reportKeys.all, 'trial-balance', asOf, currency] as const,
  profitLoss: (start: string, end: string, currency: string) =>
    [...reportKeys.all, 'profit-loss', start, end, currency] as const,
  balanceSheet: (asOf: string, currency: string) =>
    [...reportKeys.all, 'balance-sheet', asOf, currency] as const,

  // Wave 10 — polish reports.
  arAging: (asOf: string, currency: string) =>
    [...reportKeys.all, 'ar-aging', asOf, currency] as const,
  salesByCustomer: (start: string, end: string, currency: string) =>
    [...reportKeys.all, 'sales-by-customer', start, end, currency] as const,
  salesByItem: (start: string, end: string, currency: string) =>
    [...reportKeys.all, 'sales-by-item', start, end, currency] as const,
  cashPosition: (asOf: string, currency: string) =>
    [...reportKeys.all, 'cash-position', asOf, currency] as const,
  expenseByCategory: (start: string, end: string, currency: string) =>
    [...reportKeys.all, 'expense-by-category', start, end, currency] as const,
};

export const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: () => [...dashboardKeys.all, 'summary'] as const,
};
