/**
 * customer-portal-api — bundle-local helpers.
 *
 * Re-exports the shared handler utilities and adds the customer-scope
 * resolver: every portal handler must know which `customers.id` the caller
 * is bound to. The mapping lives on `org_memberships.customer_id`, NOT on
 * the JWT claims (the JWT only carries org_id + role).
 *
 * The check_membership_customer_scope trigger in 0029 guarantees that any
 * row with role=customer_user has customer_id NOT NULL, so a missing
 * lookup here is a real INTERNAL_ERROR not a UX path.
 */

export {
  admin,
  decodeCursor,
  encodeCursor,
  paginate,
  parseBody,
  parseLimit,
  requireCap,
  respondWithIdempotency,
  type Caller,
  type CursorPayload,
} from '../_shared/handler-helpers.ts';

import { admin } from '../_shared/handler-helpers.ts';
import { ApiError } from '../_shared/responses.ts';
import type { Caller } from '../_shared/handler-helpers.ts';

/**
 * Caller + the customer_id their membership is bound to. Throws FORBIDDEN
 * when no membership row exists for (orgId, userId) or the membership
 * resolved to a staff role with NULL customer_id (which means the caller
 * passed portal.read by routing accident — fail closed).
 */
export interface PortalCaller extends Caller {
  customerId: string;
}

export async function resolvePortalCaller(base: Caller): Promise<PortalCaller> {
  const { data, error } = await admin()
    .from('org_memberships')
    .select('customer_id')
    .eq('org_id', base.orgId)
    .eq('user_id', base.userId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'membership lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data || !data.customer_id) {
    // Either no membership (RLS / data drift) or staff membership leaked in.
    // Either way the caller cannot use the portal.
    throw new ApiError('FORBIDDEN', 'no customer scope for caller', 403);
  }
  return { ...base, customerId: data.customer_id as string };
}
