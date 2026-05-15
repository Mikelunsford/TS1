/**
 * Auth service. Wraps the auth-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §2.2.
 */

import { apiRequest } from '../apiClient';
import {
  AuthMeSchema,
  SwitchOrgResponseSchema,
  type AuthMe,
  type SwitchOrgResponse,
} from '../types';

/**
 * GET /auth-api/me
 * Returns the caller's profile + every active membership + the active
 * org/role resolved from JWT claims (or sole-membership fallback).
 */
export async function getMe(): Promise<AuthMe> {
  return apiRequest({
    method: 'GET',
    path: '/auth-api/me',
    schema: AuthMeSchema,
  });
}

/**
 * POST /auth-api/sessions/switch-org
 * Idempotent. Stamps the app_metadata claim and updates last_org_id.
 * Caller MUST call `supabase.auth.refreshSession()` after this to pick up
 * the new JWT, and then invalidate the TanStack Query cache.
 */
export async function switchOrg(orgId: string): Promise<SwitchOrgResponse> {
  return apiRequest({
    method: 'POST',
    path: '/auth-api/sessions/switch-org',
    body: { org_id: orgId },
    schema: SwitchOrgResponseSchema,
  });
}
