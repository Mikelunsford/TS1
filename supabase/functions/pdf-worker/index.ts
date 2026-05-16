/**
 * pdf-worker — entry point.
 * Phase 19 (Wave 10 Session 3).
 *
 * On-demand PDF render service. Uses pdf-lib (per architecture §0 lock-in
 * and the Wave-0 placeholder at `_shared/pdf.ts`). Templates ship for
 * invoice / quote / payment-receipt; org_branding (logo, brand color,
 * footer) is applied at render time.
 *
 * Cold-start risk (R-35): pdf-lib first-load + font embed adds ~3-5s on
 * a fresh isolate. We wrap the render in a 30s timeout and return HTTP 504
 * with `{retryable: true}` if hit — the SPA's TanStack mutation reruns.
 *
 * verify_jwt = true (config.toml); cap-gate is `pdf.render`.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCorsPreflight } from '../_shared/cors.ts';
import { fromApiError, err, ApiError } from '../_shared/responses.ts';
import { route } from '../_shared/route.ts';
import { routes } from './routes.ts';
import { error as logError } from '../_shared/logger.ts';

const BUNDLE = 'pdf-worker';

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
