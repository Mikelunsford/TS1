/**
 * customer-portal-api — entry point.
 *
 * Phase 21 (Wave 10 Session 4). Read-only surface exposed to portal users
 * (role = `customer_user`). Every endpoint is gated on `portal.read` (a
 * cap granted to customer_user only) and applies an explicit
 * `customer_id = caller.customer_id` filter on top of the customer-scoped
 * RLS in 0029 + 0043 (Pattern C defense-in-depth).
 *
 * verify_jwt = true (config.toml).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCorsPreflight } from '../_shared/cors.ts';
import { fromApiError, err, ApiError } from '../_shared/responses.ts';
import { route } from '../_shared/route.ts';
import { routes } from './routes.ts';
import { error as logError } from '../_shared/logger.ts';

const BUNDLE = 'customer-portal-api';

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
