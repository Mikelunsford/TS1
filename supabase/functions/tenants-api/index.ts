/**
 * tenants-api — entry point.
 *
 * This bundle is the ONLY one with `verify_jwt = false` in
 * supabase/config.toml. Per TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §3
 * and §7, the host-resolve flow runs before any user has authenticated:
 * Vercel middleware calls `GET /tenants/resolve-host?host=...` on a cold
 * page request to translate a tenant subdomain (or verified vanity domain)
 * into an `org_id` before the SPA boots. Therefore the gateway cannot
 * require a JWT to reach this bundle.
 *
 * All routes other than the public host-resolve will run their own
 * `requireCaller` check (Wave 1+); Wave 0 only ships the health endpoint
 * (`GET /`) and stubs everything else.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCorsPreflight } from '../_shared/cors.ts';
import { fromApiError, err, ApiError } from '../_shared/responses.ts';
import { route } from '../_shared/route.ts';
import { routes } from './routes.ts';
import { error as logError } from '../_shared/logger.ts';

const BUNDLE = 'tenants-api';

serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    return await route(req, routes, { bundle: BUNDLE });
  } catch (e) {
    if (e instanceof ApiError) {
      return fromApiError(e, req);
    }
    logError('Unhandled error in bundle handler', {
      bundle: BUNDLE,
      route: new URL(req.url).pathname,
      err: e instanceof Error ? e.message : String(e),
    });
    return err('INTERNAL_ERROR', 'An unexpected error occurred.', undefined, 500, { req });
  }
});
