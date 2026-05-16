/**
 * search-api — entry point (Phase 17 — Wave 10 Session 2 / Agent B2).
 *
 * Federated global search across the headline entities. Single endpoint:
 *   GET /search?q=<query>&types=customer,vendor,invoice&limit=20
 *
 * Returns up to `limit` results across the requested `types` (default: all).
 * Each row carries `{type, id, display_name, snippet, url_path}` for the
 * SPA's <GlobalSearchBar> Cmd+K dropdown.
 *
 * verify_jwt = true (config.toml). Capability gate: `search.global` (already
 * granted to org_owner / org_admin / sales / ops / accounting / viewer in
 * _shared/capabilities.ts).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCorsPreflight } from '../_shared/cors.ts';
import { fromApiError, err, ApiError } from '../_shared/responses.ts';
import { route } from '../_shared/route.ts';
import { routes } from './routes.ts';
import { error as logError } from '../_shared/logger.ts';

const BUNDLE = 'search-api';

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
