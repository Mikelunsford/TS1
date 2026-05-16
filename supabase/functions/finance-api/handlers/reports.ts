/**
 * finance-api — /reports handlers (Wave 8e / Phase 18).
 *
 * Endpoints:
 *   GET /reports/trial-balance?as_of=YYYY-MM-DD&currency=USD
 *   GET /reports/profit-loss?start=YYYY-MM-DD&end=YYYY-MM-DD&currency=USD
 *   GET /reports/balance-sheet?as_of=YYYY-MM-DD&currency=USD
 *
 * All three are pure-read aggregations over `journal_entry_lines` joined
 * to `journal_entries` filtered by org_id + status='posted' + currency_code.
 * The heavy SQL lives in migration 0062 SECURITY DEFINER RPCs
 * (trial_balance / profit_loss / balance_sheet).
 *
 * Wire envelope: `{ ok: true, data: { ...report } }`.
 * The data block enriches the raw RPC rows with computed totals and an
 * `is_balanced` flag so the SPA can render the summary without re-summing.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  TrialBalanceQuerySchema,
  ProfitLossQuerySchema,
  BalanceSheetQuerySchema,
  TrialBalanceRowSchema,
  ProfitLossRowSchema,
  BalanceSheetRowSchema,
  ArAgingQuerySchema,
  ArAgingRowSchema,
  SalesByCustomerQuerySchema,
  SalesByCustomerRowSchema,
  SalesByItemQuerySchema,
  SalesByItemRowSchema,
  CashPositionQuerySchema,
  CashPositionRowSchema,
  ExpenseByCategoryQuerySchema,
  ExpenseByCategoryRowSchema,
  type TrialBalanceRow,
  type ProfitLossRow,
  type BalanceSheetRow,
  type ArAgingRow,
  type SalesByCustomerRow,
  type SalesByItemRow,
  type CashPositionRow,
  type ExpenseByCategoryRow,
} from '../../_shared/types.ts';
import { admin, requireCap } from '../_helpers.ts';

interface TrialBalanceRpcRow {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  debit_total_cents: number | string;
  credit_total_cents: number | string;
  balance_cents: number | string;
}

interface ProfitLossRpcRow {
  account_id: string | null;
  account_code: string;
  account_name: string;
  account_type: string;
  revenue_cents: number | string;
  expense_cents: number | string;
  net_income_cents: number | string;
  is_total: boolean;
}

interface BalanceSheetRpcRow {
  account_id: string | null;
  account_code: string;
  account_name: string;
  account_type: string;
  balance_cents: number | string;
  is_total: boolean;
}

function toInt(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function parseQuery<T>(url: URL, schema: { parse: (x: unknown) => T }): T {
  const obj: Record<string, string> = {};
  for (const [k, v] of url.searchParams) obj[k] = v;
  try {
    return schema.parse(obj);
  } catch (e) {
    throw new ApiError(
      'VALIDATION_ERROR',
      'invalid query parameters',
      422,
      { detail: (e as Error).message },
    );
  }
}

// =========================================================================
// GET /reports/trial-balance
// =========================================================================
export async function getTrialBalance({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');
    const q = parseQuery(url, TrialBalanceQuerySchema);

    const { data, error } = await admin().rpc('trial_balance', {
      p_org_id: caller.orgId,
      p_as_of: q.as_of,
      p_currency_code: q.currency,
    });
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'trial_balance RPC failed', 500, {
        detail: error.message,
      });
    }

    const raw = (data ?? []) as TrialBalanceRpcRow[];
    const rows: TrialBalanceRow[] = raw.map((r) =>
      TrialBalanceRowSchema.parse({
        account_id: r.account_id,
        account_code: r.account_code,
        account_name: r.account_name,
        account_type: r.account_type,
        debit_total_cents: toInt(r.debit_total_cents),
        credit_total_cents: toInt(r.credit_total_cents),
        balance_cents: toInt(r.balance_cents),
      }),
    );

    let total_debit_cents = 0;
    let total_credit_cents = 0;
    for (const r of rows) {
      total_debit_cents += r.debit_total_cents;
      total_credit_cents += r.credit_total_cents;
    }

    return ok(
      {
        as_of: q.as_of,
        currency: q.currency,
        rows,
        total_debit_cents,
        total_credit_cents,
        is_balanced: total_debit_cents === total_credit_cents,
      },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /reports/profit-loss
// =========================================================================
export async function getProfitLoss({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');
    const q = parseQuery(url, ProfitLossQuerySchema);

    if (q.end < q.start) {
      throw new ApiError(
        'VALIDATION_ERROR',
        'end must be on or after start',
        422,
      );
    }

    const { data, error } = await admin().rpc('profit_loss', {
      p_org_id: caller.orgId,
      p_period_start: q.start,
      p_period_end: q.end,
      p_currency_code: q.currency,
    });
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'profit_loss RPC failed', 500, {
        detail: error.message,
      });
    }

    const raw = (data ?? []) as ProfitLossRpcRow[];
    const rows: ProfitLossRow[] = raw.map((r) =>
      ProfitLossRowSchema.parse({
        account_id: r.account_id,
        account_code: r.account_code,
        account_name: r.account_name,
        account_type: r.account_type,
        revenue_cents: toInt(r.revenue_cents),
        expense_cents: toInt(r.expense_cents),
        net_income_cents: toInt(r.net_income_cents),
        is_total: r.is_total,
      }),
    );

    const totalRow = rows.find((r) => r.is_total);
    const total_revenue_cents = totalRow?.revenue_cents ?? 0;
    const total_expense_cents = totalRow?.expense_cents ?? 0;
    const net_income_cents = totalRow?.net_income_cents ?? total_revenue_cents - total_expense_cents;

    return ok(
      {
        period_start: q.start,
        period_end: q.end,
        currency: q.currency,
        rows,
        total_revenue_cents,
        total_expense_cents,
        net_income_cents,
      },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// Wave 10 / Phase 18 polish handlers — Wave10-A1 owns this block.
// SECURITY DEFINER RPCs ship in migration 0067 (Agent A3): ar_aging,
// sales_by_customer, sales_by_item, cash_position, expense_by_category.
// =========================================================================

interface ArAgingRpcRow {
  customer_id: string;
  customer_name: string;
  current_cents: number | string;
  days_1_30_cents: number | string;
  days_31_60_cents: number | string;
  days_61_90_cents: number | string;
  days_over_90_cents: number | string;
  total_cents: number | string;
}

interface SalesByCustomerRpcRow {
  customer_id: string;
  customer_name: string;
  invoice_count: number | string;
  subtotal_cents: number | string;
  tax_cents: number | string;
  total_cents: number | string;
}

interface SalesByItemRpcRow {
  item_id: string | null;
  item_code: string | null;
  item_name: string;
  quantity: number | string;
  subtotal_cents: number | string;
  total_cents: number | string;
}

interface CashPositionRpcRow {
  account_id: string;
  account_code: string;
  account_name: string;
  balance_cents: number | string;
}

interface ExpenseByCategoryRpcRow {
  category_id: string | null;
  category_name: string;
  expense_count: number | string;
  total_cents: number | string;
}

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

// =========================================================================
// GET /reports/ar-aging
// =========================================================================
export async function getArAging({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');
    const q = parseQuery(url, ArAgingQuerySchema);

    const { data, error } = await admin().rpc('ar_aging', {
      p_org_id: caller.orgId,
      p_as_of: q.as_of,
      p_currency_code: q.currency,
    });
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'ar_aging RPC failed', 500, {
        detail: error.message,
      });
    }

    const raw = (data ?? []) as ArAgingRpcRow[];
    const rows: ArAgingRow[] = raw.map((r) =>
      ArAgingRowSchema.parse({
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        current_cents: toInt(r.current_cents),
        days_1_30_cents: toInt(r.days_1_30_cents),
        days_31_60_cents: toInt(r.days_31_60_cents),
        days_61_90_cents: toInt(r.days_61_90_cents),
        days_over_90_cents: toInt(r.days_over_90_cents),
        total_cents: toInt(r.total_cents),
      }),
    );

    let total_current_cents = 0;
    let total_days_1_30_cents = 0;
    let total_days_31_60_cents = 0;
    let total_days_61_90_cents = 0;
    let total_days_over_90_cents = 0;
    let total_outstanding_cents = 0;
    for (const r of rows) {
      total_current_cents += r.current_cents;
      total_days_1_30_cents += r.days_1_30_cents;
      total_days_31_60_cents += r.days_31_60_cents;
      total_days_61_90_cents += r.days_61_90_cents;
      total_days_over_90_cents += r.days_over_90_cents;
      total_outstanding_cents += r.total_cents;
    }

    return ok(
      {
        as_of: q.as_of,
        currency: q.currency,
        rows,
        total_current_cents,
        total_days_1_30_cents,
        total_days_31_60_cents,
        total_days_61_90_cents,
        total_days_over_90_cents,
        total_outstanding_cents,
      },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /reports/sales-by-customer
// =========================================================================
export async function getSalesByCustomer({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');
    const q = parseQuery(url, SalesByCustomerQuerySchema);

    if (q.end < q.start) {
      throw new ApiError(
        'VALIDATION_ERROR',
        'end must be on or after start',
        422,
      );
    }

    const { data, error } = await admin().rpc('sales_by_customer', {
      p_org_id: caller.orgId,
      p_period_start: q.start,
      p_period_end: q.end,
      p_currency_code: q.currency,
    });
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'sales_by_customer RPC failed', 500, {
        detail: error.message,
      });
    }

    const raw = (data ?? []) as SalesByCustomerRpcRow[];
    const rows: SalesByCustomerRow[] = raw.map((r) =>
      SalesByCustomerRowSchema.parse({
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        invoice_count: toInt(r.invoice_count),
        subtotal_cents: toInt(r.subtotal_cents),
        tax_cents: toInt(r.tax_cents),
        total_cents: toInt(r.total_cents),
      }),
    );

    let total_invoice_count = 0;
    let total_subtotal_cents = 0;
    let total_tax_cents = 0;
    let total_sales_cents = 0;
    for (const r of rows) {
      total_invoice_count += r.invoice_count;
      total_subtotal_cents += r.subtotal_cents;
      total_tax_cents += r.tax_cents;
      total_sales_cents += r.total_cents;
    }

    return ok(
      {
        period_start: q.start,
        period_end: q.end,
        currency: q.currency,
        rows,
        total_invoice_count,
        total_subtotal_cents,
        total_tax_cents,
        total_sales_cents,
      },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /reports/sales-by-item
// =========================================================================
export async function getSalesByItem({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');
    const q = parseQuery(url, SalesByItemQuerySchema);

    if (q.end < q.start) {
      throw new ApiError(
        'VALIDATION_ERROR',
        'end must be on or after start',
        422,
      );
    }

    const { data, error } = await admin().rpc('sales_by_item', {
      p_org_id: caller.orgId,
      p_period_start: q.start,
      p_period_end: q.end,
      p_currency_code: q.currency,
    });
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'sales_by_item RPC failed', 500, {
        detail: error.message,
      });
    }

    const raw = (data ?? []) as SalesByItemRpcRow[];
    const rows: SalesByItemRow[] = raw.map((r) =>
      SalesByItemRowSchema.parse({
        item_id: r.item_id,
        item_code: r.item_code,
        item_name: r.item_name,
        quantity: toNum(r.quantity),
        subtotal_cents: toInt(r.subtotal_cents),
        total_cents: toInt(r.total_cents),
      }),
    );

    let total_quantity = 0;
    let total_subtotal_cents = 0;
    let total_sales_cents = 0;
    for (const r of rows) {
      total_quantity += r.quantity;
      total_subtotal_cents += r.subtotal_cents;
      total_sales_cents += r.total_cents;
    }

    return ok(
      {
        period_start: q.start,
        period_end: q.end,
        currency: q.currency,
        rows,
        total_quantity,
        total_subtotal_cents,
        total_sales_cents,
      },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /reports/cash-position
// =========================================================================
export async function getCashPosition({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');
    const q = parseQuery(url, CashPositionQuerySchema);

    const { data, error } = await admin().rpc('cash_position', {
      p_org_id: caller.orgId,
      p_as_of: q.as_of,
      p_currency_code: q.currency,
    });
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'cash_position RPC failed', 500, {
        detail: error.message,
      });
    }

    const raw = (data ?? []) as CashPositionRpcRow[];
    const rows: CashPositionRow[] = raw.map((r) =>
      CashPositionRowSchema.parse({
        account_id: r.account_id,
        account_code: r.account_code,
        account_name: r.account_name,
        balance_cents: toInt(r.balance_cents),
      }),
    );

    let total_cash_cents = 0;
    for (const r of rows) total_cash_cents += r.balance_cents;

    return ok(
      {
        as_of: q.as_of,
        currency: q.currency,
        rows,
        total_cash_cents,
      },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /reports/expense-by-category
// =========================================================================
export async function getExpenseByCategory({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');
    const q = parseQuery(url, ExpenseByCategoryQuerySchema);

    if (q.end < q.start) {
      throw new ApiError(
        'VALIDATION_ERROR',
        'end must be on or after start',
        422,
      );
    }

    const { data, error } = await admin().rpc('expense_by_category', {
      p_org_id: caller.orgId,
      p_period_start: q.start,
      p_period_end: q.end,
      p_currency_code: q.currency,
    });
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'expense_by_category RPC failed', 500, {
        detail: error.message,
      });
    }

    const raw = (data ?? []) as ExpenseByCategoryRpcRow[];
    const rows: ExpenseByCategoryRow[] = raw.map((r) =>
      ExpenseByCategoryRowSchema.parse({
        category_id: r.category_id,
        category_name: r.category_name,
        expense_count: toInt(r.expense_count),
        total_cents: toInt(r.total_cents),
      }),
    );

    let total_expense_count = 0;
    let total_expenses_cents = 0;
    for (const r of rows) {
      total_expense_count += r.expense_count;
      total_expenses_cents += r.total_cents;
    }

    return ok(
      {
        period_start: q.start,
        period_end: q.end,
        currency: q.currency,
        rows,
        total_expense_count,
        total_expenses_cents,
      },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// End Wave 10 / Phase 18 polish handlers.
// =========================================================================

// =========================================================================
// GET /reports/balance-sheet
// =========================================================================
export async function getBalanceSheet({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');
    const q = parseQuery(url, BalanceSheetQuerySchema);

    const { data, error } = await admin().rpc('balance_sheet', {
      p_org_id: caller.orgId,
      p_as_of: q.as_of,
      p_currency_code: q.currency,
    });
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'balance_sheet RPC failed', 500, {
        detail: error.message,
      });
    }

    const raw = (data ?? []) as BalanceSheetRpcRow[];
    const rows: BalanceSheetRow[] = raw.map((r) =>
      BalanceSheetRowSchema.parse({
        account_id: r.account_id,
        account_code: r.account_code,
        account_name: r.account_name,
        account_type: r.account_type,
        balance_cents: toInt(r.balance_cents),
        is_total: r.is_total,
      }),
    );

    let total_assets_cents = 0;
    let total_liabilities_cents = 0;
    let total_equity_cents = 0;
    let retained_earnings_cents = 0;
    for (const r of rows) {
      if (r.is_total && r.account_code === 'RETAINED_EARNINGS') {
        retained_earnings_cents = r.balance_cents;
      } else if (!r.is_total) {
        if (r.account_type === 'asset') total_assets_cents += r.balance_cents;
        else if (r.account_type === 'liability') total_liabilities_cents += r.balance_cents;
        else if (r.account_type === 'equity') total_equity_cents += r.balance_cents;
      }
    }

    return ok(
      {
        as_of: q.as_of,
        currency: q.currency,
        rows,
        total_assets_cents,
        total_liabilities_cents,
        total_equity_cents,
        retained_earnings_cents,
        is_balanced:
          total_assets_cents ===
          total_liabilities_cents + total_equity_cents + retained_earnings_cents,
      },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}
