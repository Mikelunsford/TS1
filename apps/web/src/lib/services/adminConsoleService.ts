/**
 * adminConsoleService — typed wrappers around the admin-console-api edge
 * bundle. Phase 23 (Wave 10 Session 4).
 *
 * SECURITY: every call here is gated server-side by an active
 * `platform_admins` row. The SPA additionally hides admin nav entries when
 * `useIsPlatformAdmin()` returns false, but the server is the authority.
 */

import { z } from 'zod';
import { apiRequest } from '../apiClient';

const AdminMeSchema = z.object({
  user_id: z.string().uuid(),
  is_platform_admin: z.literal(true),
  granted_at: z.string(),
  granted_by: z.string().uuid(),
  // Wave 11 (R-W10-P23-OBS-02) — added so the SPA can route to
  // /admin/enroll-mfa before the user hits MFA_REQUIRED on a real handler.
  // Optional for backward compat with stale workers during rollout.
  mfa_verified: z.boolean().optional(),
});
export type AdminMe = z.infer<typeof AdminMeSchema>;

const OrgRowSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  display_name: z.string(),
  status: z.string(),
  suspended_at: z.string().nullable(),
  suspended_by: z.string().uuid().nullable(),
  created_at: z.string(),
  member_count: z.number().int().nonnegative(),
});
export type AdminOrgRow = z.infer<typeof OrgRowSchema>;

const OrgListResponseSchema = z.object({
  items: z.array(OrgRowSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
});
export type AdminOrgList = z.infer<typeof OrgListResponseSchema>;

const OrgDetailResponseSchema = z.object({
  org: OrgRowSchema,
  memberships: z.array(
    z.object({
      user_id: z.string().uuid(),
      email: z.string().nullable(),
      display_name: z.string().nullable(),
      role: z.string(),
      is_active: z.boolean(),
      created_at: z.string(),
    }),
  ),
  feature_flags: z.array(z.object({ flag_key: z.string(), enabled: z.boolean() })),
  domains: z.array(
    z.object({
      id: z.string().uuid(),
      hostname: z.string(),
      is_primary: z.boolean(),
      verified_at: z.string().nullable(),
      ssl_status: z.string(),
    }),
  ),
});
export type AdminOrgDetail = z.infer<typeof OrgDetailResponseSchema>;

const ImpersonateResponseSchema = z.object({
  session_id: z.string().uuid(),
  access_token: z.string(),
  refresh_token: z.string().nullable(),
  expires_in: z.number().int().positive(),
  // Wave 11 (R-W10-P23-OBS-01) — ISO timestamp the SPA banner uses to
  // enforce the 15-minute TTL.
  expires_at: z.string().optional(),
  impersonated_user_id: z.string().uuid(),
  impersonated_email: z.string().nullable().optional(),
  org_id: z.string().uuid(),
  action_link: z.string().nullable().optional(),
});
export type ImpersonateResponse = z.infer<typeof ImpersonateResponseSchema>;

const ImpersonationHistorySchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      admin_user_id: z.string().uuid(),
      impersonated_user_id: z.string().uuid(),
      org_id: z.string().uuid(),
      reason: z.string(),
      started_at: z.string(),
      ended_at: z.string().nullable(),
    }),
  ),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
});
export type ImpersonationHistory = z.infer<typeof ImpersonationHistorySchema>;

const ProvisionResponseSchema = z.object({
  org: OrgRowSchema.partial({ member_count: true }).extend({
    member_count: z.number().int().optional(),
  }),
  owner_user_id: z.string().uuid(),
});

const SuspendResponseSchema = z.object({
  org: z.object({
    id: z.string().uuid(),
    status: z.string(),
    suspended_at: z.string().nullable(),
    suspended_by: z.string().uuid().nullable(),
  }),
});

const EndImpersonationResponseSchema = z.object({
  session: z.object({
    id: z.string().uuid(),
    ended_at: z.string().nullable(),
  }),
});

export async function getAdminMe(): Promise<AdminMe> {
  return apiRequest({
    method: 'GET',
    path: '/admin-console-api/admin/me',
    schema: AdminMeSchema,
  });
}

export async function listAdminOrganizations(params: {
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<AdminOrgList> {
  const usp = new URLSearchParams();
  if (params.search) usp.set('search', params.search);
  if (params.page) usp.set('page', String(params.page));
  if (params.pageSize) usp.set('page_size', String(params.pageSize));
  const qs = usp.toString();
  return apiRequest({
    method: 'GET',
    path: `/admin-console-api/admin/organizations${qs ? `?${qs}` : ''}`,
    schema: OrgListResponseSchema,
  });
}

export async function getAdminOrganization(id: string): Promise<AdminOrgDetail> {
  return apiRequest({
    method: 'GET',
    path: `/admin-console-api/admin/organizations/${encodeURIComponent(id)}`,
    schema: OrgDetailResponseSchema,
  });
}

export async function provisionOrganization(body: {
  name: string;
  slug: string;
  owner_email: string;
  owner_full_name: string;
}) {
  return apiRequest({
    method: 'POST',
    path: '/admin-console-api/admin/organizations',
    body,
    schema: ProvisionResponseSchema,
  });
}

export async function suspendOrganization(id: string, reason?: string) {
  return apiRequest({
    method: 'POST',
    path: `/admin-console-api/admin/organizations/${encodeURIComponent(id)}/suspend`,
    body: { reason: reason ?? null },
    schema: SuspendResponseSchema,
  });
}

export async function unsuspendOrganization(id: string) {
  return apiRequest({
    method: 'POST',
    path: `/admin-console-api/admin/organizations/${encodeURIComponent(id)}/unsuspend`,
    body: {},
    schema: SuspendResponseSchema,
  });
}

export async function impersonate(body: {
  user_id: string;
  org_id: string;
  reason: string;
}): Promise<ImpersonateResponse> {
  return apiRequest({
    method: 'POST',
    path: '/admin-console-api/admin/impersonate',
    body,
    schema: ImpersonateResponseSchema,
  });
}

export async function endImpersonation(sessionId: string) {
  return apiRequest({
    method: 'POST',
    path: '/admin-console-api/admin/impersonate/end',
    body: { session_id: sessionId },
    schema: EndImpersonationResponseSchema,
  });
}

export async function getImpersonationHistory(params: {
  adminUserId?: string;
  page?: number;
}): Promise<ImpersonationHistory> {
  const usp = new URLSearchParams();
  if (params.adminUserId) usp.set('admin_user_id', params.adminUserId);
  if (params.page) usp.set('page', String(params.page));
  const qs = usp.toString();
  return apiRequest({
    method: 'GET',
    path: `/admin-console-api/admin/impersonation-history${qs ? `?${qs}` : ''}`,
    schema: ImpersonationHistorySchema,
  });
}
