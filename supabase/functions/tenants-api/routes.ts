/**
 * tenants-api — route table.
 *
 * Wave 1: ships the public host-resolve and the authenticated branding read.
 * Remaining routes (tenant patch, domains CRUD, brand write) stay TODOs.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import { resolveHost } from './handlers/resolve-host.ts';
import { brandingRead } from './handlers/branding-read.ts';

const BUNDLE = 'tenants-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // Public — verify_jwt=false at the gateway. See supabase/config.toml.
  { method: 'GET', path: '/tenants/resolve-host', handler: resolveHost },
  // Authenticated — RLS-scoped by caller's active org claim.
  { method: 'GET', path: '/branding', handler: brandingRead },
  // TODO Wave 2+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.1
  //   GET    /tenants/me                          — return active org for caller
  //   POST   /tenants/:org_id/switch              — alias of auth/sessions/switch-org
  //   GET    /tenants                             — returns caller's org row (org_admin)
  //   PATCH  /tenants/:org_id                     — update display_name, locale, currency
  //   PUT    /branding                            — upsert brand tokens, logos, favicon
  //   GET    /branding/preview-tokens             — preview before commit
  //   GET    /domains                             — list vanity domains
  //   POST   /domains                             — add vanity domain
  //   DELETE /domains/:id                         — remove vanity domain
  //   POST   /domains/:id/verify                  — trigger DNS verification
];
