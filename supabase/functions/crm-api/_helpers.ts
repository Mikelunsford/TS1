/**
 * crm-api — handler helpers (thin re-export).
 *
 * Wave 4 pre-flight 4.0b consolidated the per-bundle helpers into
 * `_shared/handler-helpers.ts` (closes R-W3-04 + F-Wave4-03). The capability
 * matrix moved to `_shared/capabilities.ts` (closes F-Wave4-08). Bundles
 * import from here so the existing call sites stay byte-stable.
 */

export {
  parseBody,
  parseLimit,
  encodeCursor,
  decodeCursor,
  paginate,
  admin,
  requireCap,
  type Caller,
  type CursorPayload,
} from '../_shared/handler-helpers.ts';

import { respondWithIdempotency as shared } from '../_shared/handler-helpers.ts';
import type { Caller } from '../_shared/handler-helpers.ts';

/** Bundle-bound `respondWithIdempotency` — stamps `bundle: 'crm-api'`. */
export function respondWithIdempotency(
  req: Request,
  caller: Caller,
  route: string,
  body: unknown,
  handler: () => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  return shared(req, caller, 'crm-api', route, body, handler);
}
