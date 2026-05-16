/**
 * vendor-portal-api — bundle-local helpers (Phase 22 / Wave 10 Session 4).
 *
 * `resolveVendorCaller(req)` is the canonical entry point for every
 * vendor-portal handler. It:
 *   1. Asserts the caller is authenticated and carries a `vendor_user`
 *      role JWT claim.
 *   2. Reads the caller's `org_memberships.vendor_id` (the JWT does not
 *      carry vendor_id today — see auth-api switch-org flow).
 *   3. Returns `{ userId, orgId, role, vendorId }` for the handler to
 *      use as the row-scope filter.
 *
 * If the caller is not a vendor_user, returns FORBIDDEN. If they ARE a
 * vendor_user but `vendor_id` is unset (impossible past the post-0071
 * CHECK trigger but defended here anyway), returns FORBIDDEN.
 */

import { ApiError } from '../_shared/responses.ts';
import { requireCaller, type Caller } from '../_shared/handler-helpers.ts';
import { requireCaller as requireOrgCaller } from '../_shared/tenant.ts';
import { admin } from '../_shared/handler-helpers.ts';

export interface VendorCaller extends Caller {
  vendorId: string;
}

// Re-export so handlers can keep one import location.
export { requireOrgCaller as requireCaller };
export { admin };

/**
 * Resolve the calling vendor_user into `{ orgId, userId, role, vendorId }`.
 * Throws FORBIDDEN if the role isn't `vendor_user` or no vendor membership
 * is found in the active org.
 */
export async function resolveVendorCaller(req: Request): Promise<VendorCaller> {
  const c = requireOrgCaller(req);
  if (c.role !== 'vendor_user') {
    throw new ApiError('FORBIDDEN', 'caller is not a vendor portal user', 403);
  }
  const { data, error } = await admin()
    .from('org_memberships')
    .select('vendor_id')
    .eq('user_id', c.userId)
    .eq('org_id', c.orgId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'vendor membership lookup failed', 500, {
      db: error.message,
    });
  }
  const vendorId = (data?.vendor_id ?? null) as string | null;
  if (!vendorId) {
    throw new ApiError('FORBIDDEN', 'no vendor scope for this caller', 403);
  }
  return { ...c, vendorId };
}

// Re-export common helpers for handler ergonomics.
export {
  decodeCursor,
  encodeCursor,
  paginate,
  parseBody,
  parseLimit,
  requireCap,
  respondWithIdempotency,
} from '../_shared/handler-helpers.ts';
