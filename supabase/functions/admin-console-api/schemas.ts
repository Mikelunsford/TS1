/**
 * admin-console-api — request/response schemas (Phase 23 — Wave 10 Session 4).
 *
 * Naming matches the SPA mirror in apps/web/src/lib/admin-types.ts (which
 * inlines the same shapes for SPA Zod runtime parses).
 */

import { z } from 'https://esm.sh/zod@3.23.8';

// ---- Requests ---------------------------------------------------------------

export const ProvisionOrgSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'lowercase letters/digits/hyphens; cannot start or end with hyphen'),
  owner_email: z.string().email(),
  owner_full_name: z.string().min(1).max(120),
});
export type ProvisionOrgInput = z.infer<typeof ProvisionOrgSchema>;

export const SuspendOrgSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});
export type SuspendOrgInput = z.infer<typeof SuspendOrgSchema>;

export const ImpersonateSchema = z.object({
  user_id: z.string().uuid(),
  org_id: z.string().uuid(),
  reason: z.string().min(1, 'reason is required for audit trail').max(500),
});
export type ImpersonateInput = z.infer<typeof ImpersonateSchema>;

export const EndImpersonationSchema = z.object({
  session_id: z.string().uuid(),
});
export type EndImpersonationInput = z.infer<typeof EndImpersonationSchema>;

// ---- Responses --------------------------------------------------------------

export const AdminMeResponseSchema = z.object({
  user_id: z.string().uuid(),
  is_platform_admin: z.literal(true),
  granted_at: z.string(),
  granted_by: z.string().uuid(),
});

export const AdminOrgRowSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  display_name: z.string(),
  status: z.string(),
  suspended_at: z.string().nullable(),
  suspended_by: z.string().uuid().nullable(),
  created_at: z.string(),
  member_count: z.number().int().nonnegative(),
});

export const AdminOrgListResponseSchema = z.object({
  items: z.array(AdminOrgRowSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
});

export const AdminOrgDetailResponseSchema = z.object({
  org: AdminOrgRowSchema,
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
  feature_flags: z.array(
    z.object({ flag_key: z.string(), enabled: z.boolean() }),
  ),
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

export const ImpersonateResponseSchema = z.object({
  session_id: z.string().uuid(),
  access_token: z.string(),
  refresh_token: z.string().nullable(),
  expires_in: z.number().int().positive(),
  // Wave 11 (R-W10-P23-OBS-01) — ISO timestamp the SPA banner uses to
  // enforce the 15-minute TTL.
  expires_at: z.string().optional(),
  impersonated_user_id: z.string().uuid(),
  org_id: z.string().uuid(),
});

export const ImpersonationHistoryItemSchema = z.object({
  id: z.string().uuid(),
  admin_user_id: z.string().uuid(),
  impersonated_user_id: z.string().uuid(),
  org_id: z.string().uuid(),
  reason: z.string(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
});

export const ImpersonationHistoryResponseSchema = z.object({
  items: z.array(ImpersonationHistoryItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
});
