/**
 * Idempotency helper.
 *
 * Per TS1/03-workspace/00-SHARED-CONTEXT.md "Idempotency" and
 * TS1/09-api/00-API-CONTRACT.md §0.4:
 *
 *   POST/PATCH/DELETE must include `Idempotency-Key: <uuid v4>`.
 *   The server stores (key, user_id, org_id, route_hash, body_hash) -> response.
 *   Replay returns the cached response with `Idempotent-Replay: true`.
 *   Same key + different body_hash returns 409 IDEMPOTENCY_CONFLICT.
 *
 * Wave 0: this is a stub. The DB calls are TODO; the helper exists so the
 * Wave 1+ handlers can wire it in without changing call sites. For now the
 * helper just runs the handler.
 */

import type { OrgContext } from './tenant.ts';

export interface IdempotencyCtx {
  req: Request;
  org: OrgContext;
  bundle: string;
  route: string; // e.g. 'POST /customers'
}

export interface CachedResult {
  status: number;
  body: unknown;
}

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
    (k) => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]),
  );
  return '{' + parts.join(',') + '}';
}

/**
 * Run a handler with idempotency semantics. Wave 0: passes through; the DB
 * cache is not consulted. The signature is the one Wave 1+ handlers will
 * adopt verbatim.
 *
 * TODO Wave 1: implement the lookup/persist against `idempotency_keys`:
 *   1. read `Idempotency-Key` header; if missing on a state-changing route,
 *      return ApiError('BAD_REQUEST', 'Idempotency-Key required.').
 *   2. compute route_hash = sha256(method + ' ' + path).
 *   3. compute body_hash = sha256(canonicalJson(parsed_body)).
 *   4. select from idempotency_keys where (key, user_id, org_id) = (...).
 *      - match + same body_hash + same route_hash -> return cached response
 *        with header `Idempotent-Replay: true`.
 *      - match + different body_hash -> return 409 IDEMPOTENCY_CONFLICT.
 *      - no match -> run handler, persist (key, status, response_body), return.
 *   5. cache lifetime 24h; gc sweeps rows older than 7 days.
 */
export async function withIdempotency<T extends Response>(
  _ctx: IdempotencyCtx,
  handler: () => Promise<T>,
): Promise<T> {
  // TODO Wave 1: integrate the DB-backed cache. See header comment.
  return await handler();
}

export {};
