/**
 * customer-portal-api — GET /portal/statements?as_of=&currency_code=
 *
 * Single-customer AR aging snapshot. Calls the SECURITY DEFINER
 * `ar_aging(org_id, as_of, currency_code)` RPC from 0067 and filters the
 * result down to caller.customerId (the RPC is org-wide; we slice).
 *
 * Defaults:
 *   - as_of         = today (UTC date)
 *   - currency_code = caller customer's default_currency_code OR 'USD'
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, requireCap, resolvePortalCaller } from '../_helpers.ts';

interface AgingRow {
  customer_id: string;
  customer_name: string;
  current_cents: number | string;
  days_1_30_cents: number | string;
  days_31_60_cents: number | string;
  days_61_90_cents: number | string;
  days_over_90_cents: number | string;
  total_cents: number | string;
}

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'string' ? Number.parseInt(v, 10) || 0 : v;
}

export async function getStatement({ req, url }: Ctx): Promise<Response> {
  try {
    const base = requireCaller(req);
    requireCap(base, 'portal.read');
    const caller = await resolvePortalCaller(base);

    const asOf =
      url.searchParams.get('as_of') ?? new Date().toISOString().slice(0, 10);

    // Resolve currency: explicit query → customer default → USD.
    let currency = url.searchParams.get('currency_code');
    if (!currency) {
      const { data: cust } = await admin()
        .from('customers')
        .select('default_currency_code')
        .eq('id', caller.customerId)
        .eq('org_id', caller.orgId)
        .maybeSingle();
      currency =
        (cust as { default_currency_code: string | null } | null)?.default_currency_code ?? 'USD';
    }

    const { data, error } = await admin().rpc('ar_aging', {
      p_org_id: caller.orgId,
      p_as_of: asOf,
      p_currency_code: currency,
    });
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'ar_aging rpc failed', 500, { detail: error.message });
    }
    const rows = (data ?? []) as AgingRow[];
    const mine = rows.find((r) => r.customer_id === caller.customerId);

    const snapshot = mine
      ? {
          customer_id: mine.customer_id,
          customer_name: mine.customer_name,
          current_cents: toNum(mine.current_cents),
          days_1_30_cents: toNum(mine.days_1_30_cents),
          days_31_60_cents: toNum(mine.days_31_60_cents),
          days_61_90_cents: toNum(mine.days_61_90_cents),
          days_over_90_cents: toNum(mine.days_over_90_cents),
          total_cents: toNum(mine.total_cents),
        }
      : {
          customer_id: caller.customerId,
          customer_name: '',
          current_cents: 0,
          days_1_30_cents: 0,
          days_31_60_cents: 0,
          days_61_90_cents: 0,
          days_over_90_cents: 0,
          total_cents: 0,
        };

    return ok(
      {
        as_of: asOf,
        currency_code: currency,
        aging: snapshot,
      },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}
