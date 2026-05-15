/**
 * crm-api — handler helpers.
 *
 * Shared utilities used across every CRM handler:
 *  - `parseBody` — JSON parse + Zod validate at the boundary; throws
 *    `ApiError('VALIDATION_ERROR', ..., 422)` on parse failure with
 *    `details.fieldErrors`.
 *  - `respondWithIdempotency` — wraps a non-GET handler with the
 *    `_shared/idempotency.ts` machinery and returns the final `Response`
 *    (sets `Idempotent-Replay: true` on cache hit).
 *  - `encodeCursor` / `decodeCursor` — opaque cursor over `{created_at, id}`
 *    per API contract §0.5.
 *  - `parseLimit` — bounded `limit` query param (default 50, max 200).
 *
 * Service-role admin client is created here for every handler; we still ALWAYS
 * combine queries with explicit `.eq('org_id', caller.orgId)` per
 * TS1/03-workspace/00-SHARED-CONTEXT.md "RLS Defense-In-Depth" Pattern A.
 */

import { z, type ZodTypeAny } from 'https://esm.sh/zod@3.23.8';

import { ApiError } from '../_shared/responses.ts';
import { withIdempotency } from '../_shared/idempotency.ts';
import { createAdminClient, type SupabaseClient } from '../_shared/supabase-admin.ts';
import type { Role } from '../_shared/types.ts';

export interface Caller {
  userId: string;
  orgId: string;
  role: Role;
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

/**
 * Decode the `?limit=` query param. Defaults to 50, clamped to [1, 200] per
 * API contract §0.5.
 */
export function parseLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (!raw) return 50;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(n, 200);
}

/** Opaque cursor payload — pair of (created_at, id) for keyset pagination. */
export interface CursorPayload {
  created_at: string;
  id: string;
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
 * Build the standard `{ items, next_cursor }` shape for list endpoints. Given
 * `rows` returned by a query that ordered by `(created_at desc, id desc)` with
 * `limit + 1`, this slices the overflow row and computes the next cursor from
 * it.
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
 *
 * Caller is the only argument the inner handler needs from the outside; the
 * Zod-parsed body is hashed to detect IDEMPOTENCY_CONFLICT.
 */
export async function respondWithIdempotency(
  req: Request,
  caller: Caller,
  route: string,
  body: unknown,
  handler: () => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  const { response, replayed } = await withIdempotency(
    {
      req,
      org: { orgId: caller.orgId, userId: caller.userId, role: caller.role },
      bundle: 'crm-api',
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

/** Singleton admin client accessor — every handler uses the same factory. */
export function admin(): SupabaseClient {
  return createAdminClient();
}

/**
 * Capability check stub. Wave 1 capability matrix is not yet populated (see
 * `_shared/capabilities.ts`). Until then we enforce role-based access at the
 * handler level: `org_owner` and `org_admin` can do anything; `sales` can
 * write CRM resources; `viewer`/`customer_user` are read-only on tenant data
 * (and customer_user is further scoped by RLS).
 *
 * The dispatch spec calls for capability strings like `crm.customers.write`.
 * We accept those here, but the role gate is the real check; the cap string
 * is documentary until the full matrix lands.
 */
export function requireCap(caller: Caller, cap: string): void {
  const role = caller.role;
  const isWrite = cap.endsWith('.write');
  if (role === 'org_owner' || role === 'org_admin') return;
  if (role === 'sales') return; // sales can read+write CRM
  if (!isWrite && (role === 'ops' || role === 'accounting' || role === 'viewer')) return;
  // customer_user falls through to RLS scope; we still gate explicitly.
  if (!isWrite && role === 'customer_user') return;
  throw new ApiError('FORBIDDEN', `caller lacks capability: ${cap}`, 403);
}
