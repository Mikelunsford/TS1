/**
 * Shared handler helpers — single source for the per-bundle utilities that
 * crm-api, finance-api, inventory-api, quotes-api, projects-api, and every
 * forward-looking bundle reuse byte-for-byte.
 *
 * Consolidates the previously-duplicated `_helpers.ts` files (see
 * TS1/03-workspace/journal/2026-05-15-wave-3-closeout.md R-W3-04 / F-Wave4-03).
 * Each bundle's `_helpers.ts` is now a thin re-export, so adding a new bundle
 * means importing from here, not copy-pasting.
 *
 * Surface:
 *  - `parseBody(req, schema)`           — JSON parse + Zod validate at boundary
 *  - `parseLimit(url)`                  — `?limit=` query param, clamped [1, 200]
 *  - `encodeCursor` / `decodeCursor`    — opaque keyset cursor over (created_at, id)
 *  - `paginate(rows, limit)`            — `{ items, next_cursor }` slicer
 *  - `respondWithIdempotency(...)`      — wraps non-GET handlers; emits Idempotent-Replay
 *  - `admin()`                          — service-role Supabase client factory
 *  - `requireCap(caller, capability)`   — capability check using the real matrix
 *                                          in `_shared/capabilities.ts`
 *  - `Caller` / `CursorPayload`         — exported types
 *
 * RLS posture: service-role bypasses RLS, so every query in a handler MUST
 * still combine with explicit `.eq('org_id', caller.orgId)` (Pattern A) per
 * TS1/03-workspace/00-SHARED-CONTEXT.md "RLS Defense-In-Depth".
 */

import { z, type ZodTypeAny } from 'https://esm.sh/zod@3.23.8';

import { ApiError } from './responses.ts';
import { withIdempotency } from './idempotency.ts';
import { createAdminClient, type SupabaseClient } from './supabase-admin.ts';
import { can, type Capability } from './capabilities.ts';
import type { Role } from './types.ts';

export interface Caller {
  userId: string;
  orgId: string;
  role: Role;
}

export interface CursorPayload {
  created_at: string;
  id: string;
}

/**
 * Parse JSON body and validate with the given Zod schema. Throws a
 * VALIDATION_ERROR ApiError carrying `fieldErrors` on failure.
 */
export async function parseBody<S extends ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (_e) {
    throw new ApiError('VALIDATION_ERROR', 'request body is not valid JSON', 422);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', 'request body failed schema validation', 422, {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }
  return parsed.data;
}

/** Decode the `?limit=` query param. Defaults to 50, clamped to [1, 200] per API contract §0.5. */
export function parseLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (!raw) return 50;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(n, 200);
}

export function encodeCursor(p: CursorPayload): string {
  return btoa(JSON.stringify(p));
}

export function decodeCursor(raw: string | null): CursorPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(atob(raw)) as Partial<CursorPayload>;
    if (typeof parsed.created_at !== 'string' || typeof parsed.id !== 'string') {
      throw new ApiError('VALIDATION_ERROR', 'invalid cursor', 422);
    }
    return { created_at: parsed.created_at, id: parsed.id };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('VALIDATION_ERROR', 'invalid cursor', 422);
  }
}

/**
 * Build the standard `{ items, next_cursor }` shape. Caller passes a query result
 * ordered by `(created_at desc, id desc)` with `limit + 1` rows; this slices the
 * overflow row and computes the next cursor from it.
 */
export function paginate<T extends { id: string; created_at: string }>(
  rows: T[],
  limit: number,
): { items: T[]; next_cursor: string | null } {
  if (rows.length <= limit) {
    return { items: rows, next_cursor: null };
  }
  const items = rows.slice(0, limit);
  const overflow = rows[limit];
  return {
    items,
    next_cursor: encodeCursor({ created_at: overflow.created_at, id: overflow.id }),
  };
}

/**
 * Wrap a state-changing handler with idempotency. The inner handler returns
 * `{ status, body }`; this helper:
 *  1. Reads + validates the `Idempotency-Key` header.
 *  2. Looks up cached response; replays on hit.
 *  3. On miss, runs the handler, persists, and returns the response.
 */
export async function respondWithIdempotency(
  req: Request,
  caller: Caller,
  bundle: string,
  route: string,
  body: unknown,
  handler: () => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  const { response, replayed } = await withIdempotency(
    {
      req,
      org: { orgId: caller.orgId, userId: caller.userId, role: caller.role },
      bundle,
      route,
    },
    body,
    handler,
  );

  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'x-request-id': req.headers.get('x-request-id') ?? crypto.randomUUID(),
    'x-org-id': caller.orgId,
  };
  if (replayed) headers['idempotent-replay'] = 'true';

  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers,
  });
}

/** Singleton-style admin client accessor — every handler uses the same factory. */
export function admin(): SupabaseClient {
  return createAdminClient();
}

/**
 * Capability check using the real matrix in `_shared/capabilities.ts`. Throws
 * `FORBIDDEN` on denial. Customer-scoped reads still flow through here; the
 * row-level filter is enforced by the explicit `.eq('org_id', caller.orgId)`
 * combined with the customer-scope predicate in each handler (Pattern C per
 * TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §2.3).
 */
export function requireCap(caller: Caller, cap: Capability): void {
  if (can(caller.role, cap)) return;
  throw new ApiError('FORBIDDEN', `caller lacks capability: ${cap}`, 403);
}
