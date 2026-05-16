/**
 * admin-console-api — handler helpers (thin re-export).
 * Mirrors settings-api/_helpers.ts and finance-api/_helpers.ts.
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

export function respondWithIdempotency(
  req: Request,
  caller: Caller,
  route: string,
  body: unknown,
  handler: () => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  return shared(req, caller, 'admin-console-api', route, body, handler);
}
