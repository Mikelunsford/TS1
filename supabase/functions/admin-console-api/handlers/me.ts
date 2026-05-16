/**
 * GET /admin/me
 * Returns confirmation that the caller is a platform admin + grant metadata.
 * Used by the SPA <AdminShell> to verify before mounting admin routes.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { admin } from '../_helpers.ts';
import { requirePlatformAdmin } from '../platform-admin.ts';

export async function adminMe({ req }: Ctx): Promise<Response> {
  const caller = await requirePlatformAdmin(req);
  const sb = admin();

  const { data, error } = await sb
    .from('platform_admins')
    .select('user_id, granted_at, granted_by')
    .eq('user_id', caller.userId)
    .is('revoked_at', null)
    .single();

  if (error || !data) {
    throw new ApiError('FORBIDDEN', 'platform admin row not found', 403);
  }

  return ok(
    {
      user_id: data.user_id,
      is_platform_admin: true as const,
      granted_at: data.granted_at,
      granted_by: data.granted_by,
    },
    undefined,
    { req },
  );
}
