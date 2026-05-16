/**
 * ops-api — entry point.
 * Receiving orders, production runs, shipments (the "do-side" of a project, 3PL surface).
 * verify_jwt = true.
 *
 * Wave 6 / Phase 6 gating: every non-health route is guarded by the
 * `plugins.3pl` feature flag. Orgs without the flag receive 404 NOT_FOUND
 * (never 403; envelope §RLS rule disallows information disclosure via
 * 403 on plugin boundaries — orgs that don't have the plugin shouldn't
 * be able to enumerate its routes). The `GET /` health route is exempt
 * so monitoring stays responsive regardless of flag state.
 *
 * Per per-wave DoD: "org with flag off returns 404 on
 * /ops-api/receiving-orders; org with flag on passes all TS regressions."
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCorsPreflight } from '../_shared/cors.ts';
import { fromApiError, err, ApiError } from '../_shared/responses.ts';
import { route } from '../_shared/route.ts';
import { routes } from './routes.ts';
import { error as logError } from '../_shared/logger.ts';
import { requireCaller } from '../_shared/tenant.ts';
import { isFeatureEnabled } from '../_shared/feature-flags.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';

const BUNDLE = 'ops-api';
const FLAG_KEY = 'plugins.3pl';

function isHealthPath(pathname: string): boolean {
  // The router strips the function-name prefix; both '/' and '/ops-api'
  // (when the request lands with the full path) are treated as health.
  return pathname === '/' || pathname === '' || pathname === `/${BUNDLE}`;
}

serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    if (!isHealthPath(url.pathname)) {
      // Plugin gate: require caller (UNAUTHORIZED if no JWT) + flag check.
      const caller = requireCaller(req);
      const enabled = await isFeatureEnabled(createAdminClient(), caller.orgId, FLAG_KEY);
      if (!enabled) {
        throw new ApiError(
          'NOT_FOUND',
          `feature not available`,
          404,
        );
      }
    }
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
