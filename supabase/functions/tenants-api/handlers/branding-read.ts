/**
 * GET /branding
 *
 * Authenticated (verify_jwt=true at the gateway). Returns the brand token
 * set for the caller's active org. RLS on `org_branding` enforces that the
 * caller can only see their own org's row. We DO NOT bypass RLS here — we
 * use the service-role client but scope the query by org_id from the JWT
 * claim (architecture §2.4: explicit scoping when bypassing RLS).
 *
 * Per the API contract §2.3 this read returns the public token surface only
 * (no PDF footer strings, no custom_css), so unauthenticated middleware
 * could safely cache it. invoice/quote_pdf_footer and custom_css live on a
 * separate admin endpoint shipped in a later wave.
 *
 * No idempotency: this is a GET.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { createAdminClient } from '../../_shared/supabase-admin.ts';
import { ApiError } from '../../_shared/responses.ts';
import { BrandingReadSchema } from '../../_shared/types.ts';

export async function brandingRead({ req }: Ctx): Promise<Response> {
  let caller;
  try {
    caller = requireCaller(req);
  } catch (e) {
    if (e instanceof ApiError) {
      return err(e.code, e.message, e.details, e.status, { req });
    }
    throw e;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('org_branding')
    .select(
      `org_id, logo_url, icon_url, email_logo_url, primary_color,
       accent_color, on_primary, font_family, app_name_override, support_url`,
    )
    .eq('org_id', caller.orgId)
    .maybeSingle();

  if (error) {
    return err('INTERNAL_ERROR', 'branding lookup failed', { detail: error.message }, 500, { req });
  }
  if (!data) {
    return err('NOT_FOUND', 'no branding row for the active org', undefined, 404, { req });
  }

  const payload = BrandingReadSchema.parse(data);
  return ok(payload, undefined, { req });
}
