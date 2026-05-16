/**
 * GET /portal/me — caller's customer profile.
 *
 * Returns the row from `customers` keyed by the caller's
 * org_memberships.customer_id, plus the caller's display profile.
 * Read-only — no idempotency.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, requireCap, resolvePortalCaller } from '../_helpers.ts';

const CUSTOMER_COLS =
  'id, org_id, customer_number, display_name, kind, client_status, ' +
  'primary_email, primary_phone, tax_id, billing_address, shipping_address, ' +
  'default_currency_code, is_archived, created_at, updated_at';

export async function getMe({ req }: Ctx): Promise<Response> {
  try {
    const base = requireCaller(req);
    requireCap(base, 'portal.read');
    const caller = await resolvePortalCaller(base);

    const [{ data: customer, error: cErr }, { data: profile, error: pErr }] = await Promise.all([
      admin()
        .from('customers')
        .select(CUSTOMER_COLS)
        .eq('id', caller.customerId)
        .eq('org_id', caller.orgId)
        .maybeSingle(),
      admin()
        .from('profiles')
        .select('user_id, email, display_name')
        .eq('user_id', caller.userId)
        .maybeSingle(),
    ]);

    if (cErr) throw new ApiError('INTERNAL_ERROR', 'customer lookup failed', 500, { detail: cErr.message });
    if (pErr) throw new ApiError('INTERNAL_ERROR', 'profile lookup failed', 500, { detail: pErr.message });
    if (!customer) throw new ApiError('NOT_FOUND', 'customer not found', 404);

    return ok(
      {
        customer,
        profile: profile ?? { user_id: caller.userId, email: null, display_name: null },
      },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}
