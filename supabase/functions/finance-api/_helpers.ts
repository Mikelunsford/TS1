/**
 * finance-api — handler helpers.
 *
 * Wave 3 / Phase 3 sales chassis. Borrowed verbatim from crm-api/_helpers.ts
 * (only the `bundle` string in `respondWithIdempotency` differs). F-Wave3-03
 * will hoist these utilities into `_shared/` once the capability matrix is
 * populated in `_shared/capabilities.ts`.
 *
 *  - `parseBody` — JSON parse + Zod validate at the boundary; throws
 *    `ApiError('VALIDATION_ERROR', ..., 422)` on parse failure.
 *  - `respondWithIdempotency` — wraps non-GET handlers with
 *    `_shared/idempotency.ts` (sets `Idempotent-Replay: true` on replay).
 *  - `encodeCursor` / `decodeCursor` — opaque cursor over `{created_at, id}`
 *    per API contract §0.5.
 *  - `parseLimit` — bounded `limit` query param (default 50, max 200).
 *  - `requireCap` — role-based stop-gap (capability matrix lives in
 *    F-Wave3-03 backlog).
 *
 * Service-role admin client is created here; we still ALWAYS combine
 * queries with explicit `.eq('org_id', caller.orgId)` per the
 * "RLS Defense-In-Depth" Pattern A.
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

export function parseLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (!raw) return 50;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(n, 200);
}

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
      bundle: 'finance-api',
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

export function admin(): SupabaseClient {
  return createAdminClient();
}

/**
 * Capability check stub — see crm-api/_helpers.ts. Until F-Wave3-03 lands
 * the cap-string matrix, we enforce role gates: org_owner/org_admin do
 * anything; accounting can read+write finance resources; sales/ops can
 * read; viewer/customer_user are read-only.
 */
export function requireCap(caller: Caller, cap: string): void {
  const role = caller.role;
  const isWrite = cap.endsWith('.write');
  if (role === 'org_owner' || role === 'org_admin') return;
  if (role === 'accounting') return;
  if (!isWrite && (role === 'sales' || role === 'ops' || role === 'viewer')) return;
  if (!isWrite && role === 'customer_user') return;
  throw new ApiError('FORBIDDEN', `caller lacks capability: ${cap}`, 403);
}
