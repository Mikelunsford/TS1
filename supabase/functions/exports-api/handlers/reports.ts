/**
 * exports-api — report CSV handlers (Wave 10 Session 3 / R-W10-RPT-01).
 *
 * The 5 report RPCs from migration 0067 are read directly and streamed as
 * CSV (header + body rows). These are non-paginated single-shot reports —
 * the RPCs return finite result sets — so we skip the keyset-paginated
 * factory and emit a single page.
 *
 * All gated by `finance.reports.read` capability. No feature-flag (the
 * pre-Phase-19 SPA flag `reports.csv_export` is now always-on).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, requireCap } from '../../_shared/handler-helpers.ts';
import { csvRow, type CsvCellValue } from '../../_shared/csv.ts';

interface RpcArAging {
  customer_id: string;
  customer_name: string;
  current_cents: number | string;
  days_1_30_cents: number | string;
  days_31_60_cents: number | string;
  days_61_90_cents: number | string;
  days_over_90_cents: number | string;
  total_cents: number | string;
}
interface RpcSalesByCustomer {
  customer_id: string;
  customer_name: string;
  invoice_count: number | string;
  subtotal_cents: number | string;
  tax_cents: number | string;
  total_cents: number | string;
}
interface RpcSalesByItem {
  item_id: string | null;
  item_code: string | null;
  item_name: string;
  quantity: number | string;
  subtotal_cents: number | string;
  total_cents: number | string;
}
interface RpcCashPosition {
  account_id: string;
  account_code: string;
  account_name: string;
  balance_cents: number | string;
}
interface RpcExpenseByCategory {
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

function csvResponse(filename: string, headers: string[], rows: ReadonlyArray<CsvCellValue[]>, extra: Record<string, string>): Response {
  const chunks: string[] = [csvRow(headers)];
  for (const r of rows) chunks.push(csvRow(r));
  return new Response(chunks.join(''), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      ...extra,
    },
  });
}

function requireParam(url: URL, key: string): string {
  const v = url.searchParams.get(key);
  if (!v) throw new ApiError('VALIDATION_ERROR', `missing query param: ${key}`, 422);
  return v;
}

function commonHeaders(orgId: string, req: Request): Record<string, string> {
  return {
    'x-org-id': orgId,
    'x-request-id': req.headers.get('x-request-id') ?? crypto.randomUUID(),
  };
}

const today = (): string => new Date().toISOString().slice(0, 10);

// --- /exports/reports/ar-aging ---------------------------------------------
export async function exportArAging({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');
    const as_of = requireParam(url, 'as_of');
    const currency = requireParam(url, 'currency');
    const { data, error } = await admin().rpc('ar_aging', {
      p_org_id: caller.orgId,
      p_as_of: as_of,
      p_currency_code: currency,
    });
    if (error) throw new ApiError('INTERNAL_ERROR', 'ar_aging rpc failed', 500, { detail: error.message });
    const rows = ((data ?? []) as RpcArAging[]).map((r): CsvCellValue[] => [
      r.customer_id,
      r.customer_name,
      toNum(r.current_cents),
      toNum(r.days_1_30_cents),
      toNum(r.days_31_60_cents),
      toNum(r.days_61_90_cents),
      toNum(r.days_over_90_cents),
      toNum(r.total_cents),
    ]);
    return csvResponse(
      `ar-aging-${today()}.csv`,
      ['customer_id', 'customer_name', 'current_cents', 'days_1_30_cents', 'days_31_60_cents', 'days_61_90_cents', 'days_over_90_cents', 'total_cents'],
      rows,
      commonHeaders(caller.orgId, req),
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// --- /exports/reports/sales-by-customer ------------------------------------
export async function exportSalesByCustomer({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');
    const start = requireParam(url, 'start');
    const end = requireParam(url, 'end');
    const currency = requireParam(url, 'currency');
    const { data, error } = await admin().rpc('sales_by_customer', {
      p_org_id: caller.orgId,
      p_period_start: start,
      p_period_end: end,
      p_currency_code: currency,
    });
    if (error) throw new ApiError('INTERNAL_ERROR', 'sales_by_customer rpc failed', 500, { detail: error.message });
    const rows = ((data ?? []) as RpcSalesByCustomer[]).map((r): CsvCellValue[] => [
      r.customer_id,
      r.customer_name,
      toNum(r.invoice_count),
      toNum(r.subtotal_cents),
      toNum(r.tax_cents),
      toNum(r.total_cents),
    ]);
    return csvResponse(
      `sales-by-customer-${today()}.csv`,
      ['customer_id', 'customer_name', 'invoice_count', 'subtotal_cents', 'tax_cents', 'total_cents'],
      rows,
      commonHeaders(caller.orgId, req),
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// --- /exports/reports/sales-by-item ----------------------------------------
export async function exportSalesByItem({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');
    const start = requireParam(url, 'start');
    const end = requireParam(url, 'end');
    const currency = requireParam(url, 'currency');
    const { data, error } = await admin().rpc('sales_by_item', {
      p_org_id: caller.orgId,
      p_period_start: start,
      p_period_end: end,
      p_currency_code: currency,
    });
    if (error) throw new ApiError('INTERNAL_ERROR', 'sales_by_item rpc failed', 500, { detail: error.message });
    const rows = ((data ?? []) as RpcSalesByItem[]).map((r): CsvCellValue[] => [
      r.item_id,
      r.item_code,
      r.item_name,
      toNum(r.quantity),
      toNum(r.subtotal_cents),
      toNum(r.total_cents),
    ]);
    return csvResponse(
      `sales-by-item-${today()}.csv`,
      ['item_id', 'item_code', 'item_name', 'quantity', 'subtotal_cents', 'total_cents'],
      rows,
      commonHeaders(caller.orgId, req),
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// --- /exports/reports/cash-position ----------------------------------------
export async function exportCashPosition({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');
    const as_of = requireParam(url, 'as_of');
    const currency = requireParam(url, 'currency');
    const { data, error } = await admin().rpc('cash_position', {
      p_org_id: caller.orgId,
      p_as_of: as_of,
      p_currency_code: currency,
    });
    if (error) throw new ApiError('INTERNAL_ERROR', 'cash_position rpc failed', 500, { detail: error.message });
    const rows = ((data ?? []) as RpcCashPosition[]).map((r): CsvCellValue[] => [
      r.account_id,
      r.account_code,
      r.account_name,
      toNum(r.balance_cents),
    ]);
    return csvResponse(
      `cash-position-${today()}.csv`,
      ['account_id', 'account_code', 'account_name', 'balance_cents'],
      rows,
      commonHeaders(caller.orgId, req),
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// --- /exports/reports/expense-by-category ----------------------------------
export async function exportExpenseByCategory({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');
    const start = requireParam(url, 'start');
    const end = requireParam(url, 'end');
    const currency = requireParam(url, 'currency');
    const { data, error } = await admin().rpc('expense_by_category', {
      p_org_id: caller.orgId,
      p_period_start: start,
      p_period_end: end,
      p_currency_code: currency,
    });
    if (error) throw new ApiError('INTERNAL_ERROR', 'expense_by_category rpc failed', 500, { detail: error.message });
    const rows = ((data ?? []) as RpcExpenseByCategory[]).map((r): CsvCellValue[] => [
      r.category_id,
      r.category_name,
      toNum(r.expense_count),
      toNum(r.total_cents),
    ]);
    return csvResponse(
      `expense-by-category-${today()}.csv`,
      ['category_id', 'category_name', 'expense_count', 'total_cents'],
      rows,
      commonHeaders(caller.orgId, req),
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}
