/**
 * Higher-order handler wrapper that runs `requireFlag` before delegating.
 * Lets route tables stay declarative: `withFlag('flag.key', handler)`.
 */

import type { Ctx } from './route.ts';
import { requireCaller } from './tenant.ts';
import { admin } from './handler-helpers.ts';
import { requireFlag } from './requireFlag.ts';

export function withFlag(
  flagKey: string,
  handler: (ctx: Ctx) => Promise<Response> | Response,
): (ctx: Ctx) => Promise<Response> {
  return async (ctx: Ctx): Promise<Response> => {
    const caller = requireCaller(ctx.req);
    await requireFlag(admin(), caller.orgId, flagKey);
    return await handler(ctx);
  };
}
