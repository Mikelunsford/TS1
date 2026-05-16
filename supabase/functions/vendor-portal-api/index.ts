/**
 * vendor-portal-api — entry point (Phase 22 / Wave 10 Session 4 / Agent C2).
 *
 * External vendor-facing read API + a single state-change endpoint
 * (PO acknowledge). All routes require the caller to hold the
 * `vendor_user` role and a resolved `vendor_id` on their org_memberships
 * row. RLS is defense-in-depth: handlers query the service-role admin
 * client with an explicit `vendor_id = caller.vendorId` filter, AND the
 * vendor-scoped SELECT policies added in 0071 cover the row-level
 * authorization a second time via is_vendor_member(org_id, vendor_id).
 *
 * verify_jwt = true.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCorsPreflight } from '../_shared/cors.ts';
import { fromApiError, err, ApiError } from '../_shared/responses.ts';
import { route } from '../_shared/route.ts';
import { routes } from './routes.ts';
import { error as logError } from '../_shared/logger.ts';

const BUNDLE = 'vendor-portal-api';

serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    return await route(req, routes, { bundle: BUNDLE });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    logError('Unhandled error in bundle handler', {
      bundle: BUNDLE,
      route: new URL(req.url).pathname,
      err: e instanceof Error ? e.message : String(e),
    });
    return err('INTERNAL_ERROR', 'An unexpected error occurred.', undefined, 500, { req });
  }
});
