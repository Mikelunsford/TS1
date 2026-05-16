/**
 * pdf-worker — handler helpers (thin re-export).
 * Phase 19 (Wave 10 Session 3).
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
  return shared(req, caller, 'pdf-worker', route, body, handler);
}
