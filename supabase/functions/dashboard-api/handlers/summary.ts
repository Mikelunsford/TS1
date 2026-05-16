/**
 * dashboard-api — /dashboard/summary handler (Wave 10 / Phase 18).
 *
 * Aggregates 4 KPI tiles for the home dashboard:
 *   - ar_aging_summary  (current/1-30/31-60/61-90/over-90 buckets in cents)
 *   - cash_on_hand_cents
 *   - mtd_revenue_cents
 *   - mtd_expense_cents
 *
 * Source RPCs:
 *   - ar_aging          (migration 0067, Agent A3)
 *   - cash_position     (migration 0067, Agent A3)
 *   - profit_loss       (migration 0062, Wave 8e)
 *
 * Wire envelope: `{ ok: true, data: DashboardSummary }`. The SPA
 * <DashboardPage> renders the 4 tiles directly off this payload.
 *
 * Capability: finance.reports.read (mirrors the underlying RPC gate).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, requireCap } from '../../_shared/handler-helpers.ts';

interface ArAgingRpcRow {
  current_cents: number | string;
  days_1_30_cents: number | string;
  days_31_60_cents: number | string;
  days_61_90_cents: number | string;
  days_over_90_cents: number | string;
}

interface CashPositionRpcRow {
  balance_cents: number | string;
}

interface ProfitLossRpcRow {
  account_type: string;
  revenue_cents: number | string;
  expense_cents: number | string;
  is_total: boolean;
}

function toInt(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso(today: string): string {
  return `${today.slice(0, 8)}01`;
}

export async function getDashboardSummary({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.reports.read');

    // Resolve the org's default currency for downstream RPC calls.
    const ad = admin();
    const { data: orgRow, error: orgErr } = await ad
      .from('organizations')
      .select('default_currency_code')
      .eq('id', caller.orgId)
      .single();
    if (orgErr || !orgRow) {
      throw new ApiError(
        'INTERNAL_ERROR',
        'org default currency lookup failed',
        500,
        { detail: orgErr?.message },
      );
    }
    const currency = (orgRow.default_currency_code as string | null) ?? 'USD';

    const as_of = todayIso();
    const period_start = firstOfMonthIso(as_of);

    const [agingRes, cashRes, plRes] = await Promise.all([
      ad.rpc('ar_aging', {
        p_org_id: caller.orgId,
        p_as_of: as_of,
        p_currency_code: currency,
      }),
      ad.rpc('cash_position', {
        p_org_id: caller.orgId,
        p_as_of: as_of,
        p_currency_code: currency,
      }),
      ad.rpc('profit_loss', {
        p_org_id: caller.orgId,
        p_period_start: period_start,
        p_period_end: as_of,
        p_currency_code: currency,
      }),
    ]);

    if (agingRes.error) {
      throw new ApiError('INTERNAL_ERROR', 'ar_aging RPC failed', 500, {
        detail: agingRes.error.message,
      });
    }
    if (cashRes.error) {
      throw new ApiError('INTERNAL_ERROR', 'cash_position RPC failed', 500, {
        detail: cashRes.error.message,
      });
    }
    if (plRes.error) {
      throw new ApiError('INTERNAL_ERROR', 'profit_loss RPC failed', 500, {
        detail: plRes.error.message,
      });
    }

    // Roll up AR aging buckets across all customers.
    let current_cents = 0;
    let days_1_30_cents = 0;
    let days_31_60_cents = 0;
    let days_61_90_cents = 0;
    let days_over_90_cents = 0;
    for (const r of (agingRes.data ?? []) as ArAgingRpcRow[]) {
      current_cents += toInt(r.current_cents);
      days_1_30_cents += toInt(r.days_1_30_cents);
      days_31_60_cents += toInt(r.days_31_60_cents);
      days_61_90_cents += toInt(r.days_61_90_cents);
      days_over_90_cents += toInt(r.days_over_90_cents);
    }

    // Cash on hand: sum of cash/bank account balances.
    let cash_on_hand_cents = 0;
    for (const r of (cashRes.data ?? []) as CashPositionRpcRow[]) {
      cash_on_hand_cents += toInt(r.balance_cents);
    }

    // MTD revenue + expense from the profit_loss totals row.
    let mtd_revenue_cents = 0;
    let mtd_expense_cents = 0;
    const totalRow = ((plRes.data ?? []) as ProfitLossRpcRow[]).find(
      (r) => r.is_total,
    );
    if (totalRow) {
      mtd_revenue_cents = toInt(totalRow.revenue_cents);
      mtd_expense_cents = toInt(totalRow.expense_cents);
    } else {
      // Fall back to summing non-total rows by type if the RPC didn't emit a totals row.
      for (const r of (plRes.data ?? []) as ProfitLossRpcRow[]) {
        if (r.is_total) continue;
        if (r.account_type === 'revenue') mtd_revenue_cents += toInt(r.revenue_cents);
        else if (r.account_type === 'expense' || r.account_type === 'cogs') {
          mtd_expense_cents += toInt(r.expense_cents);
        }
      }
    }

    return ok(
      {
        as_of,
        currency,
        period_start,
        period_end: as_of,
        ar_aging_summary: {
          current_cents,
          days_1_30_cents,
          days_31_60_cents,
          days_61_90_cents,
          days_over_90_cents,
        },
        cash_on_hand_cents,
        mtd_revenue_cents,
        mtd_expense_cents,
      },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}
