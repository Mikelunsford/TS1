/**
 * Tenants service. Wraps the tenants-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §2.
 */

import { apiRequest } from '../apiClient';
import { BrandingReadSchema, HostResolveSchema, type BrandingRead, type HostResolve } from '../types';

/**
 * GET /tenants-api/tenants/resolve-host?host=<host>
 * Public — no JWT required. Used by Vercel middleware on cold page boot
 * and by the SPA when it needs the org for the current host.
 */
export async function resolveHost(host: string): Promise<HostResolve> {
  return apiRequest({
    method: 'GET',
    path: `/tenants-api/tenants/resolve-host?host=${encodeURIComponent(host)}`,
    schema: HostResolveSchema,
  });
}

/**
 * GET /tenants-api/branding
 * Authenticated. Returns the brand token set for the caller's active org.
 */
export async function getBranding(): Promise<BrandingRead> {
  return apiRequest({
    method: 'GET',
    path: '/tenants-api/branding',
    schema: BrandingReadSchema,
  });
}
