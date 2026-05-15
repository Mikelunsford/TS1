/**
 * Tenancy helpers.
 *
 * `requireOrgContext(req)` reads the Authorization header, decodes the JWT
 * (the platform gateway already verified the signature when
 * `verify_jwt = true` in config.toml), pulls `app_metadata.team1_org_id` and
 * `app_metadata.team1_org_role`, and returns the call context.
 *
 * Wave 0 contract:
 *  - If the header is missing or the claim is absent, return null fields
 *    rather than throwing. Health endpoints must respond even when called
 *    by tooling that does not pass a JWT.
 *  - Wave 1+ will tighten this: every non-public route will call a
 *    stricter `requireCaller` that throws ApiError('UNAUTHORIZED', ...).
 *
 * Per TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §2 the JWT is the
 * load-bearing org claim. RLS reads it via `current_org_id()`.
 */

import { ApiError } from './responses.ts';
import type { Role } from './types.ts';

export interface OrgContext {
  orgId: string | null;
  userId: string | null;
  role: Role | null;
}

/**
 * Decode the base64url payload of a JWT without verifying the signature.
 * The Supabase gateway has already verified before invoking us; this is
 * just for claim extraction inside the handler.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url -> base64
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = atob(b64 + pad);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractToken(req: Request): string | null {
  const h = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

/**
 * Wave 0 lenient context resolver. Returns nulls instead of throwing when
 * the JWT or claims are absent so the health endpoints stay responsive.
 *
 * Waves 1+ should call `requireCaller` (to be added) which throws
 * ApiError('UNAUTHORIZED', ...) on missing JWT, and ApiError('NO_ACTIVE_ORG', ...)
 * on missing org claim.
 */
export function requireOrgContext(req: Request): OrgContext {
  const token = extractToken(req);
  if (!token) {
    return { orgId: null, userId: null, role: null };
  }
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return { orgId: null, userId: null, role: null };
  }
  const userId =
    typeof payload.sub === 'string' ? (payload.sub as string) : null;
  const appMeta =
    (payload.app_metadata as Record<string, unknown> | undefined) ?? {};
  const orgId =
    typeof appMeta.team1_org_id === 'string'
      ? (appMeta.team1_org_id as string)
      : null;
  const role =
    typeof appMeta.team1_org_role === 'string'
      ? (appMeta.team1_org_role as Role)
      : null;
  return { orgId, userId, role };
}

/**
 * Strict variant for Wave 1+ handlers that demand an authenticated caller.
 * Wave 0 doesn't call it but exporting the surface keeps imports stable.
 */
export function requireCaller(req: Request): { userId: string; orgId: string; role: Role } {
  const ctx = requireOrgContext(req);
  if (!ctx.userId) {
    throw new ApiError('UNAUTHORIZED', 'Authentication required.', 401);
  }
  if (!ctx.orgId) {
    throw new ApiError('NO_ACTIVE_ORG', 'No active organization claim.', 401);
  }
  if (!ctx.role) {
    throw new ApiError('FORBIDDEN', 'Role missing from claims.', 403);
  }
  return { userId: ctx.userId, orgId: ctx.orgId, role: ctx.role };
}

export {};
