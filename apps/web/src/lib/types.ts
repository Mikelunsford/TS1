import { z } from 'zod';

/**
 * The Zod canon. This file is BYTE-MIRRORED into
 *   supabase/functions/_shared/types.ts.
 *
 * The CI contract test (`pnpm test:contract`) asserts every exported schema
 * is structurally identical between the two locations. Drift fails the build.
 *
 * Wave 0 ships the minimum schemas needed for the placeholder shell to
 * compile and the contract test to pass:
 *
 *  - Org           : organizations row (subset)
 *  - Profile       : profiles row (subset)
 *  - Membership    : org_memberships row
 *  - Role          : the six-role enum
 *  - ApiEnvelope   : { data } | { error }
 *
 * Wave 1+ extends this canon as modules ship.
 *
 * See TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §0, §8
 *     TS1/09-api/00-API-CONTRACT.md
 *     TS1/03-workspace/00-SHARED-CONTEXT.md
 */

// =========================================================================
// Primitives
// =========================================================================

export const UuidSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });
export const CentsSchema = z.union([z.number().int(), z.string()]); // wire format

// =========================================================================
// Roles
// =========================================================================

export const RoleSchema = z.enum([
  'org_owner',
  'org_admin',
  'sales',
  'ops',
  'accounting',
  'viewer',
  'customer_user',
]);
export type Role = z.infer<typeof RoleSchema>;

// =========================================================================
// Organizations
// =========================================================================

export const OrgSchema = z.object({
  id: UuidSchema,
  slug: z.string().min(1).max(63),
  name: z.string().min(1),
  is_suspended: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Org = z.infer<typeof OrgSchema>;

// =========================================================================
// Profiles
// =========================================================================

export const ProfileSchema = z.object({
  id: UuidSchema, // matches auth.users.id
  email: z.string().email(),
  full_name: z.string().nullable(),
  avatar_url: z.string().url().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Profile = z.infer<typeof ProfileSchema>;

// =========================================================================
// Org Memberships
// =========================================================================

export const MembershipSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  user_id: UuidSchema,
  role: RoleSchema,
  customer_id: UuidSchema.nullable(),
  vendor_id: UuidSchema.nullable(),
  created_at: TimestampSchema,
});
export type Membership = z.infer<typeof MembershipSchema>;

// =========================================================================
// API envelope
// =========================================================================

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  request_id: z.string().optional(),
});

export const ApiOkSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ data, meta: z.unknown().optional() });

export const ApiErrSchema = z.object({ error: ApiErrorSchema });

// =========================================================================
// Health check (Wave 0)
// =========================================================================

export const HealthSchema = z.object({
  ok: z.literal(true),
  bundle: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

// =========================================================================
// Tenants / host resolution (Wave 1)
// =========================================================================

/**
 * Returned by `GET /tenants-api/tenants/resolve-host?host=<host>` (public,
 * verify_jwt=false). Vercel middleware calls this on cold page requests to
 * translate a tenant subdomain (or verified vanity domain) into an org_id
 * before the SPA boots. See TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §7.
 */
export const HostResolveSchema = z.object({
  org_id: UuidSchema,
  slug: z.string().min(1).max(63),
  display_name: z.string().min(1),
  default_locale: z.string().min(1),
  default_timezone: z.string().min(1),
  default_currency_code: z.string().length(3),
  primary_color: z.string(),
  accent_color: z.string(),
});
export type HostResolve = z.infer<typeof HostResolveSchema>;

// =========================================================================
// Auth (Wave 1)
// =========================================================================

/** Subset of org_memberships returned alongside `/auth-api/me`. */
export const MeMembershipSchema = z.object({
  org_id: UuidSchema,
  slug: z.string().min(1).max(63),
  display_name: z.string().min(1),
  role: RoleSchema,
});
export type MeMembership = z.infer<typeof MeMembershipSchema>;

/** Returned by `GET /auth-api/me`. */
export const AuthMeSchema = z.object({
  user_id: UuidSchema,
  email: z.string().email(),
  display_name: z.string().nullable(),
  active_org_id: UuidSchema.nullable(),
  active_role: RoleSchema.nullable(),
  memberships: z.array(MeMembershipSchema),
});
export type AuthMe = z.infer<typeof AuthMeSchema>;

/** Request body for `POST /auth-api/sessions/switch-org`. */
export const SwitchOrgRequestSchema = z.object({
  org_id: UuidSchema,
});
export type SwitchOrgRequest = z.infer<typeof SwitchOrgRequestSchema>;

/** Response from `POST /auth-api/sessions/switch-org`. */
export const SwitchOrgResponseSchema = z.object({
  active_org_id: UuidSchema,
  active_role: RoleSchema,
});
export type SwitchOrgResponse = z.infer<typeof SwitchOrgResponseSchema>;

// =========================================================================
// Branding (Wave 1)
// =========================================================================

/** Returned by `GET /tenants-api/branding` (authenticated, caller's org). */
export const BrandingReadSchema = z.object({
  org_id: UuidSchema,
  logo_url: z.string().nullable(),
  icon_url: z.string().nullable(),
  email_logo_url: z.string().nullable(),
  primary_color: z.string(),
  accent_color: z.string(),
  on_primary: z.string(),
  font_family: z.string(),
  app_name_override: z.string().nullable(),
  support_url: z.string().nullable(),
});
export type BrandingRead = z.infer<typeof BrandingReadSchema>;
