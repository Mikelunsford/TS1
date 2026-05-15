/**
 * tenants-api — route table.
 *
 * Wave 0: only `GET /` health is wired. The remaining routes are TODOs
 * mirroring TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.1.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

const BUNDLE = 'tenants-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // TODO Wave 1+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.1
  //   GET    /tenants/resolve-host?host=<host>   — public host-resolve (verify_jwt=false)
  //   GET    /tenants/me                          — return active org for caller
  //   POST   /tenants/:org_id/switch              — re-issue session with new active org
  //   GET    /tenants                             — returns caller's org row (org_admin)
  //   PATCH  /tenants/:org_id                     — update display_name, locale, currency
  //   GET    /branding                            — public token set (org.read)
  //   PUT    /branding                            — upsert brand tokens, logos, favicon
  //   GET    /branding/preview-tokens             — preview before commit
  //   GET    /domains                             — list vanity domains
  //   POST   /domains                             — add vanity domain
  //   DELETE /domains/:id                         — remove vanity domain
  //   POST   /domains/:id/verify                  — trigger DNS verification
];
