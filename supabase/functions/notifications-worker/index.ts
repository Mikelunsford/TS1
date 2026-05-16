/**
 * notifications-worker — entry point.
 * Phase 19 (Wave 10 Session 3).
 *
 * pg_cron job 'notifications-worker-drain' (migration 0070) POSTs to
 * /drain every minute with the X-Worker-Secret header. Handler verifies
 * the shared secret against NOTIFICATIONS_WORKER_SECRET env.
 *
 * verify_jwt = false (config.toml) because pg_cron can't sign JWTs.
 * Auth is the shared secret instead.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCorsPreflight } from '../_shared/cors.ts';
import { fromApiError, err, ApiError } from '../_shared/responses.ts';
import { route } from '../_shared/route.ts';
import { routes } from './routes.ts';
import { error as logError } from '../_shared/logger.ts';

const BUNDLE = 'notifications-worker';

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
