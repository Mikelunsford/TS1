/**
 * Reports service (Wave 8e + Wave 10 / Phase 18 polish).
 *
 * Wraps finance-api `/reports/*` and dashboard-api `/dashboard/summary`.
 * Each function takes filters, builds a query string, and parses the
 * `{ ok, data }` envelope with the canonical Zod schema.
 */

import { apiRequest } from '../apiClient';
import {
  ArAgingReportSchema,
  BalanceSheetReportSchema,
  CashPositionReportSchema,
  DashboardSummarySchema,
  ExpenseByCategoryReportSchema,
  ProfitLossReportSchema,
  SalesByCustomerReportSchema,
  SalesByItemReportSchema,
  TrialBalanceReportSchema,
  type ArAgingReport,
  type BalanceSheetReport,
  type CashPositionReport,
  type DashboardSummary,
  type ExpenseByCategoryReport,
  type ProfitLossReport,
  type SalesByCustomerReport,
  type SalesByItemReport,
  type TrialBalanceReport,
} from '../types';

function qs(params: Record<string, string>): string {
  const sp = new URLSearchParams(params);
  return sp.toString();
}

// ---------- Wave 8e core reports ----------

export function getTrialBalance(asOf: string, currency: string): Promise<TrialBalanceReport> {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/reports/trial-balance?${qs({ as_of: asOf, currency })}`,
    schema: TrialBalanceReportSchema,
  });
}

export function getProfitLoss(
  start: string,
  end: string,
  currency: string,
): Promise<ProfitLossReport> {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/reports/profit-loss?${qs({ start, end, currency })}`,
    schema: ProfitLossReportSchema,
  });
}

export function getBalanceSheet(asOf: string, currency: string): Promise<BalanceSheetReport> {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/reports/balance-sheet?${qs({ as_of: asOf, currency })}`,
    schema: BalanceSheetReportSchema,
  });
}

// ---------- Wave 10 polish reports ----------

export function getArAgingReport(asOf: string, currency: string): Promise<ArAgingReport> {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/reports/ar-aging?${qs({ as_of: asOf, currency })}`,
    schema: ArAgingReportSchema,
  });
}

export function getSalesByCustomerReport(
  start: string,
  end: string,
  currency: string,
): Promise<SalesByCustomerReport> {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/reports/sales-by-customer?${qs({ start, end, currency })}`,
    schema: SalesByCustomerReportSchema,
  });
}

export function getSalesByItemReport(
  start: string,
  end: string,
  currency: string,
): Promise<SalesByItemReport> {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/reports/sales-by-item?${qs({ start, end, currency })}`,
    schema: SalesByItemReportSchema,
  });
}

export function getCashPositionReport(
  asOf: string,
  currency: string,
): Promise<CashPositionReport> {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/reports/cash-position?${qs({ as_of: asOf, currency })}`,
    schema: CashPositionReportSchema,
  });
}

export function getExpenseByCategoryReport(
  start: string,
  end: string,
  currency: string,
): Promise<ExpenseByCategoryReport> {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/reports/expense-by-category?${qs({ start, end, currency })}`,
    schema: ExpenseByCategoryReportSchema,
  });
}

// ---------- Dashboard summary ----------

export function getDashboardSummary(): Promise<DashboardSummary> {
  return apiRequest({
    method: 'GET',
    path: '/dashboard-api/dashboard/summary',
    schema: DashboardSummarySchema,
  });
}
