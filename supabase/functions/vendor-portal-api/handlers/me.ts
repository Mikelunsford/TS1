/**
 * GET /vendor-portal/me — caller's vendor profile.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { admin, requireCap, resolveVendorCaller } from '../_helpers.ts';

const VENDOR_COLS =
  'id, org_id, name, legal_name, email, phone, website, currency_code, ' +
  'payment_terms_days, billing_address, is_active, created_at, updated_at';

export async function getMe({ req }: Ctx): Promise<Response> {
  const caller = await resolveVendorCaller(req);
  requireCap(caller, 'vendor_portal.read');

  const { data, error } = await admin()
    .from('vendors')
    .select(VENDOR_COLS)
    .eq('org_id', caller.orgId)
    .eq('id', caller.vendorId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'failed to load vendor profile', 500, {
      db: error.message,
    });
  }
  if (!data) {
    throw new ApiError('NOT_FOUND', 'vendor profile not found', 404);
  }
  return ok(
    {
      vendor: data,
      user_id: caller.userId,
      org_id: caller.orgId,
      role: caller.role,
    },
    undefined,
    { req },
  );
}
