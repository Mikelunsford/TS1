/**
 * collaboration-api — entry point.
 * Phase 16 (Wave 10 Session 2) — B1 owns this block.
 *
 * Comments + attachments + notifications + @mention autocomplete. The
 * universal cross-cutting UX surface that every entity detail page taps.
 *
 * Bundle-level gating: every non-health route is guarded by the
 * `collaboration.enabled` feature flag. Orgs with the flag off receive
 * 404 NOT_FOUND on every route (envelope rule: never 403 on plugin
 * boundaries — avoids information disclosure). Health GET / bypasses.
 *
 * verify_jwt = true.
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

const BUNDLE = 'collaboration-api';
const FLAG_KEY = 'collaboration.enabled';

function isHealthPath(pathname: string): boolean {
  return pathname === '/' || pathname === '' || pathname === `/${BUNDLE}`;
}

serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  try {
    const url = new URL(req.url);
    if (!isHealthPath(url.pathname)) {
      const caller = requireCaller(req);
      const enabled = await isFeatureEnabled(createAdminClient(), caller.orgId, FLAG_KEY);
      if (!enabled) {
        throw new ApiError('NOT_FOUND', 'feature not available', 404);
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
