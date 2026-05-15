/**
 * GET /me
 *
 * Authenticated. Returns the caller's profile + every active membership.
 * The SPA's AuthContext uses this on session boot to populate the workspace
 * switcher and the topbar.
 *
 * No idempotency: GET.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError } from '../../_shared/responses.ts';
import { requireOrgContext } from '../../_shared/tenant.ts';
import { createAdminClient } from '../../_shared/supabase-admin.ts';
import { AuthMeSchema, RoleSchema } from '../../_shared/types.ts';

export async function me({ req }: Ctx): Promise<Response> {
  const ctx = requireOrgContext(req);
  if (!ctx.userId) {
    return err('UNAUTHORIZED', 'Authentication required.', undefined, 401, { req });
  }

  const admin = createAdminClient();

  const [profileRes, membershipRes] = await Promise.all([
    admin
      .from('profiles')
      .select('user_id, email, display_name')
      .eq('user_id', ctx.userId)
      .maybeSingle(),
    admin
      .from('org_memberships')
      .select(
        `
        org_id, is_active,
        roles:role_id ( code ),
        organizations:org_id ( id, slug, display_name, status )
        `,
      )
      .eq('user_id', ctx.userId)
      .eq('is_active', true),
  ]);

  if (profileRes.error) {
    return err('INTERNAL_ERROR', 'profile lookup failed', { detail: profileRes.error.message }, 500, { req });
  }
  if (membershipRes.error) {
    return err('INTERNAL_ERROR', 'membership lookup failed', { detail: membershipRes.error.message }, 500, { req });
  }
  if (!profileRes.data) {
    return err('NOT_FOUND', 'profile not found for caller', undefined, 404, { req });
  }

  type MembershipRow = {
    org_id: string;
    is_active: boolean;
    roles: { code: string } | null;
    organizations: { id: string; slug: string; display_name: string; status: string } | null;
  };
  const rows = (membershipRes.data ?? []) as unknown as MembershipRow[];

  const memberships = rows
    .filter((m) => m.organizations?.status === 'active' && m.roles?.code)
    .map((m) => ({
      org_id: m.org_id,
      slug: m.organizations!.slug,
      display_name: m.organizations!.display_name,
      role: RoleSchema.parse(m.roles!.code),
    }));

  let activeOrgId = ctx.orgId;
  let activeRole = ctx.role;
  if (!activeOrgId && memberships.length === 1) {
    activeOrgId = memberships[0].org_id;
    activeRole = memberships[0].role;
  } else if (activeOrgId) {
    const found = memberships.find((m) => m.org_id === activeOrgId);
    if (!found) {
      activeOrgId = null;
      activeRole = null;
    } else {
      activeRole = found.role;
    }
  }

  try {
    const payload = AuthMeSchema.parse({
      user_id: profileRes.data.user_id,
      email: profileRes.data.email,
      display_name: profileRes.data.display_name,
      active_org_id: activeOrgId,
      active_role: activeRole,
      memberships,
    });
    return ok(payload, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) {
      return err(e.code, e.message, e.details, e.status, { req });
    }
    throw e;
  }
}
