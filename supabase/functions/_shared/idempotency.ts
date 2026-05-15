/**
 * Idempotency helper — DB-backed.
 *
 * Per TS1/03-workspace/00-SHARED-CONTEXT.md "Idempotency" and
 * TS1/09-api/00-API-CONTRACT.md §0.4:
 *
 *   POST/PATCH/DELETE must include `Idempotency-Key: <uuid v4>`.
 *   Server stores (key, user_id, org_id) -> (route_hash, body_hash,
 *   status_code, response_body) in `idempotency_keys` (migration 0036).
 *   Replay returns the cached response with `Idempotent-Replay: true`.
 *   Same key + different body_hash returns 409 IDEMPOTENCY_CONFLICT.
 *   Cache lifetime: 24 hours (records older than 7 days are GC'd
 *   by the `idempotency-gc` scheduled function — TBD wave).
 */

import { ApiError } from './responses.ts';
import { createAdminClient } from './supabase-admin.ts';
import type { OrgContext } from './tenant.ts';

export interface IdempotencyCtx {
  req: Request;
  org: OrgContext;
  bundle: string;
  route: string; // e.g. 'POST /sessions/switch-org'
}

export interface CachedResponse {
  status: number;
  body: unknown;
}

/** UUID v4 shape — case-insensitive. */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** SHA-256 hash of a string, hex-encoded. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Canonical JSON (sorted keys, no whitespace) for body-hash stability.
 * Per RFC 8785 JCS; sufficient for our shape (objects, arrays, primitives).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) =>
      JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]),
  );
  return '{' + parts.join(',') + '}';
}

/**
 * Extract and validate the `Idempotency-Key` header.
 * Returns the key (lowercased) or throws ApiError on invalid / missing.
 */
export function readIdempotencyKey(req: Request): string {
  const raw =
    req.headers.get('idempotency-key') ?? req.headers.get('Idempotency-Key');
  if (!raw) {
    throw new ApiError(
      'BAD_REQUEST',
      'Idempotency-Key header required on state-changing requests.',
      400,
    );
  }
  if (!UUID_V4_RE.test(raw)) {
    throw new ApiError(
      'BAD_REQUEST',
      'Idempotency-Key must be a UUID v4.',
      400,
    );
  }
  return raw.toLowerCase();
}

/**
 * Run a handler with full idempotency semantics. Used by every non-GET route.
 *
 * Behavior:
 *  1. Read & validate `Idempotency-Key` from the request.
 *  2. Compute route_hash = sha256(method + ' ' + path).
 *  3. Compute body_hash = sha256(canonicalJson(parsedBody)).
 *  4. Lookup (key, user_id, org_id) in idempotency_keys:
 *     - hit + same body_hash + same route_hash within 24h
 *         → replay cached response with `Idempotent-Replay: true`.
 *     - hit + different body_hash
 *         → ApiError('IDEMPOTENCY_CONFLICT', 409).
 *     - miss
 *         → run handler, persist (key, user, org, hashes, status, body), return.
 *
 * Errors thrown by the handler are NOT cached; only successful 2xx and
 * deliberate ApiError responses are. Network/DB exceptions propagate.
 *
 * Caller must pass parsedBody (the same shape used by Zod) so the body_hash
 * is canonical regardless of incoming whitespace.
 */
export async function withIdempotency(
  ctx: IdempotencyCtx,
  parsedBody: unknown,
  handler: () => Promise<CachedResponse>,
): Promise<{ response: CachedResponse; replayed: boolean }> {
  if (!ctx.org.userId || !ctx.org.orgId) {
    // Idempotency requires an identified caller + active org. Routes that need
    // idempotency on an unauthenticated path do not currently exist.
    throw new ApiError(
      'UNAUTHORIZED',
      'Idempotency requires an authenticated caller with an active org.',
      401,
    );
  }

  const key = readIdempotencyKey(ctx.req);
  const url = new URL(ctx.req.url);
  const routeHash = await sha256Hex(`${ctx.req.method} ${url.pathname}`);
  const bodyHash = await sha256Hex(canonicalJson(parsedBody));

  const admin = createAdminClient();

  // The on-cloud `idempotency_keys` shape carries legacy NOT-NULL columns
  // (`endpoint`, `request_hash`, `response`) alongside the Wave-1 `route_hash`,
  // `body_hash`, `response_jsonb` columns added for the architecture-spec
  // semantics. PK is (key, user_id); org_id is enforced via RLS. We populate
  // both column sets on insert until a future migration drops the legacy
  // shape.
  const { data: existing, error: lookupErr } = await admin
    .from('idempotency_keys')
    .select('org_id, route_hash, body_hash, status_code, response_jsonb, created_at')
    .eq('key', key)
    .eq('user_id', ctx.org.userId)
    .maybeSingle();

  if (lookupErr) {
    throw new Error(`idempotency lookup failed: ${lookupErr.message}`);
  }

  if (existing) {
    if (existing.org_id !== ctx.org.orgId) {
      // Same key + user but different active org: treat as a new request, no
      // collision (different scopes per architecture §0.4).
    } else {
      const ageMs = Date.now() - new Date(existing.created_at as string).getTime();
      const expired = ageMs > 24 * 60 * 60 * 1000;
      if (!expired) {
        if (
          existing.body_hash !== bodyHash ||
          existing.route_hash !== routeHash
        ) {
          throw new ApiError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency-Key reused with a different request body or route.',
            409,
          );
        }
        return {
          replayed: true,
          response: {
            status: existing.status_code as number,
            body: existing.response_jsonb,
          },
        };
      }
      // Expired: fall through and overwrite below.
    }
  }

  const fresh = await handler();

  const url2 = new URL(ctx.req.url);
  const upsertRow = {
    key,
    user_id: ctx.org.userId,
    org_id: ctx.org.orgId,
    // Legacy NOT-NULL columns (filled with the same semantic value):
    endpoint: `${ctx.req.method} ${url2.pathname}`,
    request_hash: bodyHash,
    response: fresh.body as Record<string, unknown>,
    // Architecture-spec columns:
    route_hash: routeHash,
    body_hash: bodyHash,
    response_jsonb: fresh.body as Record<string, unknown>,
    status_code: fresh.status,
  };

  const { error: upsertErr } = await admin
    .from('idempotency_keys')
    .upsert(upsertRow, { onConflict: 'key,user_id' });

  if (upsertErr) {
    // Persist failure is non-fatal to the response — log and continue.
    // (The handler ran; the user already saw it succeed semantically.)
    console.warn('idempotency persist failed', upsertErr.message);
  }

  return { replayed: false, response: fresh };
}

export {};
