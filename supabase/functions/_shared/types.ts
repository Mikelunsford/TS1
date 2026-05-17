import { z } from 'https://esm.sh/zod@3.23.8';

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
  // Phase 22 (Wave 10 Session 4) — C2 owns this entry.
  'vendor_user',
  // End Phase 22 (Wave 10 Session 4).
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

// =========================================================================
// CRM — common primitives (Wave 2)
// =========================================================================

/**
 * Address shape used by customers + opportunities. JSONB on the wire; the DB
 * column is `jsonb` so we permit unknown extra keys for forward compat.
 * See TS1/09-api/00-API-CONTRACT.md §3.1.
 */
export const AddressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postal: z.string().max(40).optional(),
  country: z.string().max(80).optional(),
});
export type Address = z.infer<typeof AddressSchema>;

export const CustomerKindSchema = z.enum(['company', 'individual']);
export type CustomerKind = z.infer<typeof CustomerKindSchema>;

export const LeadStatusSchema = z.enum([
  'new',
  'contacted',
  'qualified',
  'disqualified',
  'converted',
]);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const LeadSourceSchema = z.enum([
  'inbound',
  'outbound',
  'referral',
  'event',
  'import',
  'other',
]);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

export const OpportunityStageSchema = z.enum([
  'prospect',
  'discovery',
  'proposal',
  'negotiation',
  'won',
  'lost',
  'abandoned',
]);
export type OpportunityStage = z.infer<typeof OpportunityStageSchema>;

export const ActivityKindSchema = z.enum(['call', 'meeting', 'email', 'note', 'task']);
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

export const ActivityEntityTypeSchema = z.enum([
  'customer',
  'contact',
  'lead',
  'opportunity',
  'quote',
  'project',
  'invoice',
]);
export type ActivityEntityType = z.infer<typeof ActivityEntityTypeSchema>;

/** Cursor-paginated list response wrapper. See API contract §0.5. */
export const ListMetaSchema = z.object({
  next_cursor: z.string().nullable(),
});
export type ListMeta = z.infer<typeof ListMetaSchema>;

// =========================================================================
// CRM — Customers (Wave 2)
// =========================================================================

/** Request body for `POST /crm-api/customers`. */
export const CustomerCreateSchema = z.object({
  display_name: z.string().min(1).max(200),
  kind: CustomerKindSchema.default('company'),
  primary_email: z.string().email().nullable().optional(),
  primary_phone: z.string().max(64).nullable().optional(),
  tax_id: z.string().max(64).nullable().optional(),
  billing_address: AddressSchema.nullable().optional(),
  shipping_address: AddressSchema.nullable().optional(),
  default_currency_code: z.string().length(3).optional(),
  tags: z.array(z.string()).default([]),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});
export type CustomerCreate = z.infer<typeof CustomerCreateSchema>;

/** Request body for `PATCH /crm-api/customers/:id`. All keys optional. */
export const CustomerPatchSchema = CustomerCreateSchema.partial();
export type CustomerPatch = z.infer<typeof CustomerPatchSchema>;

/** Response row for customer endpoints. */
export const CustomerSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  customer_number: z.string().nullable(),
  display_name: z.string().min(1),
  kind: CustomerKindSchema,
  client_status: z.string(),
  primary_email: z.string().nullable(),
  primary_phone: z.string().nullable(),
  tax_id: z.string().nullable(),
  billing_address: AddressSchema.nullable(),
  shipping_address: AddressSchema.nullable(),
  default_currency_code: z.string().nullable(),
  is_archived: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Customer = z.infer<typeof CustomerSchema>;

// =========================================================================
// CRM — Contacts (Wave 2)
// =========================================================================

/** Request body for `POST /crm-api/contacts` and `PATCH /crm-api/contacts/:id`. */
export const ContactUpsertSchema = z.object({
  customer_id: UuidSchema,
  first_name: z.string().min(1).max(80),
  last_name: z.string().max(80).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  title: z.string().max(120).nullable().optional(),
  is_primary: z.boolean().default(false),
});
export type ContactUpsert = z.infer<typeof ContactUpsertSchema>;

/** Response row for contact endpoints. */
export const ContactSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  customer_id: UuidSchema,
  first_name: z.string().min(1),
  last_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  is_primary: z.boolean(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Contact = z.infer<typeof ContactSchema>;

// =========================================================================
// CRM — Leads (Wave 2)
// =========================================================================

/** Request body for `POST /crm-api/leads`. */
export const LeadCreateSchema = z.object({
  display_name: z.string().min(1).max(200),
  company_name: z.string().max(200).nullable().optional(),
  source: LeadSourceSchema.default('inbound'),
  primary_email: z.string().email().nullable().optional(),
  primary_phone: z.string().max(64).nullable().optional(),
  owner_user_id: UuidSchema.nullable().optional(),
  status: z.enum(['new', 'contacted', 'qualified', 'disqualified']).default('new'),
  estimated_value_cents: z.number().int().nonnegative().default(0),
  currency_code: z.string().length(3).nullable().optional(),
  expected_close_date: z.string().date().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type LeadCreate = z.infer<typeof LeadCreateSchema>;

/** Request body for `PATCH /crm-api/leads/:id`. All keys optional. */
export const LeadPatchSchema = LeadCreateSchema.partial();
export type LeadPatch = z.infer<typeof LeadPatchSchema>;

/**
 * Request body for `POST /crm-api/leads/:id/convert`.
 * Transactionally creates an opportunity (and optionally a customer) from the
 * lead, then patches the lead with `converted_*` fields and status='converted'.
 * Uses the DEFERRABLE fk_leads_opportunity FK from migration 0047.
 */
export const LeadConvertSchema = z.object({
  create_customer: z.boolean().default(false),
  customer_id: UuidSchema.nullable().optional(),
  opportunity_name: z.string().min(1).max(200),
  opportunity_amount_cents: z.number().int().nonnegative().default(0),
  opportunity_currency_code: z.string().length(3).optional(),
});
export type LeadConvert = z.infer<typeof LeadConvertSchema>;

/** Response row for lead endpoints. */
export const LeadSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  lead_number: z.string().min(1),
  display_name: z.string().min(1),
  company_name: z.string().nullable(),
  source: z.string().nullable(),
  status: LeadStatusSchema,
  primary_email: z.string().nullable(),
  primary_phone: z.string().nullable(),
  owner_user_id: UuidSchema.nullable(),
  estimated_value_cents: z.number().int().nonnegative(),
  currency_code: z.string().nullable(),
  expected_close_date: z.string().nullable(),
  converted_customer_id: UuidSchema.nullable(),
  converted_opportunity_id: UuidSchema.nullable(),
  converted_at: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Lead = z.infer<typeof LeadSchema>;

// =========================================================================
// CRM — Opportunities (Wave 2)
// =========================================================================

/** Request body for `POST /crm-api/opportunities`. */
export const OpportunityCreateSchema = z.object({
  customer_id: UuidSchema,
  lead_id: UuidSchema.nullable().optional(),
  display_name: z.string().min(1).max(200),
  amount_cents: z.number().int().nonnegative(),
  currency_code: z.string().length(3),
  stage: z
    .enum(['prospect', 'discovery', 'proposal', 'negotiation', 'won', 'lost'])
    .default('prospect'),
  probability_pct: z.number().min(0).max(100).default(0),
  expected_close_date: z.string().date().nullable().optional(),
  owner_user_id: UuidSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type OpportunityCreate = z.infer<typeof OpportunityCreateSchema>;

/** Request body for `PATCH /crm-api/opportunities/:id`. All keys optional. */
export const OpportunityPatchSchema = OpportunityCreateSchema.partial();
export type OpportunityPatch = z.infer<typeof OpportunityPatchSchema>;

/** Request body for `PUT /crm-api/opportunities/:id/stage`. */
export const OpportunityStageUpdateSchema = z.object({
  stage: OpportunityStageSchema,
  close_reason: z.string().max(500).nullable().optional(),
});
export type OpportunityStageUpdate = z.infer<typeof OpportunityStageUpdateSchema>;

/** Response row for opportunity endpoints. */
export const OpportunitySchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  opportunity_number: z.string().min(1),
  customer_id: UuidSchema,
  lead_id: UuidSchema.nullable(),
  display_name: z.string().min(1),
  stage: OpportunityStageSchema,
  amount_cents: z.number().int().nonnegative(),
  currency_code: z.string().nullable(),
  probability_pct: z.number(),
  expected_close_date: z.string().nullable(),
  closed_at: z.string().nullable(),
  close_reason: z.string().nullable(),
  owner_user_id: UuidSchema.nullable(),
  notes: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

// =========================================================================
// CRM — Activities (Wave 2)
// =========================================================================

/** Request body for `POST /crm-api/activities`. */
export const ActivityCreateSchema = z.object({
  entity_type: ActivityEntityTypeSchema,
  entity_id: UuidSchema,
  kind: ActivityKindSchema,
  subject: z.string().min(1).max(200),
  body: z.string().nullable().optional(),
  occurred_at: TimestampSchema.optional(),
  due_at: TimestampSchema.nullable().optional(),
  completed_at: TimestampSchema.nullable().optional(),
});
export type ActivityCreate = z.infer<typeof ActivityCreateSchema>;

/** Request body for `PATCH /crm-api/activities/:id`. All keys optional. */
export const ActivityPatchSchema = z.object({
  subject: z.string().min(1).max(200).optional(),
  body: z.string().nullable().optional(),
  due_at: TimestampSchema.nullable().optional(),
  completed_at: TimestampSchema.nullable().optional(),
  status: z.enum(['open', 'completed', 'cancelled']).optional(),
});
export type ActivityPatch = z.infer<typeof ActivityPatchSchema>;

/** Response row for activity endpoints. */
export const ActivitySchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  entity_type: ActivityEntityTypeSchema,
  entity_id: UuidSchema,
  kind: ActivityKindSchema,
  subject: z.string().min(1),
  body: z.string().nullable(),
  status: z.enum(['open', 'completed', 'cancelled']),
  due_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Activity = z.infer<typeof ActivitySchema>;

// =========================================================================
// Finance — Currencies (Wave 3, Phase 3 sales chassis)
// =========================================================================

/**
 * Currency display configuration. `public.currencies` is a global table
 * (no `org_id`); rows are shared across all orgs. POST upserts by `code`.
 * See TS1/09-api/00-API-CONTRACT.md §7.
 */
export const CurrencySchema = z.object({
  code: z.string().length(3),
  label: z.string().min(1),
  symbol: z.string().min(1),
  symbol_position: z.enum(['before', 'after']),
  decimal_sep: z.string().min(1).max(4),
  thousand_sep: z.string().max(4),
  cent_precision: z.number().int().min(0).max(6),
  zero_format: z.boolean(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Currency = z.infer<typeof CurrencySchema>;

/** Upsert body for `POST /finance-api/currencies`. */
export const CurrencyUpsertSchema = z.object({
  code: z.string().length(3),
  label: z.string().min(1).max(80),
  symbol: z.string().min(1).max(8),
  symbol_position: z.enum(['before', 'after']).default('before'),
  decimal_sep: z.string().min(1).max(4).default('.'),
  thousand_sep: z.string().max(4).default(','),
  cent_precision: z.number().int().min(0).max(6).default(2),
  zero_format: z.boolean().default(false),
  is_active: z.boolean().default(true),
});
export type CurrencyUpsert = z.infer<typeof CurrencyUpsertSchema>;

/** Patch body for `PATCH /finance-api/currencies/:code`. `code` is immutable. */
export const CurrencyPatchSchema = CurrencyUpsertSchema.omit({ code: true }).partial();
export type CurrencyPatch = z.infer<typeof CurrencyPatchSchema>;

// =========================================================================
// Finance — Exchange Rates (Wave 3)
// =========================================================================

/** Response row for exchange rate endpoints. */
export const ExchangeRateSchema = z.object({
  id: UuidSchema,
  base_code: z.string().length(3),
  quote_code: z.string().length(3),
  rate: z.union([z.number(), z.string()]),
  as_of: z.string(),
  source: z.string(),
  created_at: TimestampSchema,
  created_by: UuidSchema.nullable(),
});
export type ExchangeRate = z.infer<typeof ExchangeRateSchema>;

/**
 * Insert body for `POST /finance-api/exchange-rates`. Server rejects
 * duplicates of `(base_code, quote_code, as_of)` with 409 STATE_CONFLICT.
 */
export const ExchangeRateInsertSchema = z.object({
  base_code: z.string().length(3),
  quote_code: z.string().length(3),
  rate: z.number().positive(),
  as_of: z.string().date(),
  source: z.string().max(64).default('manual'),
});
export type ExchangeRateInsert = z.infer<typeof ExchangeRateInsertSchema>;

// =========================================================================
// Finance — Taxes (Wave 3)
// =========================================================================

/**
 * Tax row. NOTE: DB stores `rate` as `numeric(7,6)` (0..1; e.g. 0.0875 = 8.75%).
 * The API contract §7 proposed `rate_bp` (basis points); the schema and the
 * contract diverged during 0049. We expose `rate` (0..1 decimal) on the wire
 * to match the DB. F-Wave3-XX may align later.
 */
export const TaxSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string().min(1),
  label: z.string().min(1),
  rate: z.union([z.number(), z.string()]),
  jurisdiction: z.string().nullable(),
  is_compound: z.boolean(),
  is_inclusive: z.boolean(),
  is_default: z.boolean(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Tax = z.infer<typeof TaxSchema>;

/** Create body for `POST /finance-api/taxes`. */
export const TaxCreateSchema = z.object({
  code: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  rate: z.number().min(0).max(1),
  jurisdiction: z.string().max(120).nullable().optional(),
  is_compound: z.boolean().default(false),
  is_inclusive: z.boolean().default(false),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
});
export type TaxCreate = z.infer<typeof TaxCreateSchema>;

/** Patch body for `PATCH /finance-api/taxes/:id`. All keys optional. */
export const TaxPatchSchema = TaxCreateSchema.partial();
export type TaxPatch = z.infer<typeof TaxPatchSchema>;

// =========================================================================
// Finance — Payment Methods (Wave 3)
// =========================================================================

/** Payment method row. Org-scoped; partial unique on `(org_id) WHERE is_default`. */
export const PaymentMethodSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullable(),
  is_default: z.boolean(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

/** Create body for `POST /finance-api/payment-methods`. */
export const PaymentMethodCreateSchema = z.object({
  code: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
});
export type PaymentMethodCreate = z.infer<typeof PaymentMethodCreateSchema>;

/** Patch body for `PATCH /finance-api/payment-methods/:id`. All keys optional. */
export const PaymentMethodPatchSchema = PaymentMethodCreateSchema.partial();
export type PaymentMethodPatch = z.infer<typeof PaymentMethodPatchSchema>;

// =========================================================================
// Inventory — Item Kind (Wave 3)
// =========================================================================

export const ItemKindSchema = z.enum(['labor', 'material', 'pass_through', 'fee', 'service']);
export type ItemKind = z.infer<typeof ItemKindSchema>;

// =========================================================================
// Inventory — Item Categories (Wave 3)
// =========================================================================

/**
 * Item category row. Org-scoped; `parent_id` allows a self-referential tree.
 * The list endpoint returns a flat array; the SPA composes the tree.
 */
export const ItemCategorySchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string().min(1),
  label: z.string().min(1),
  parent_id: UuidSchema.nullable(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type ItemCategory = z.infer<typeof ItemCategorySchema>;

/** Create body for `POST /inventory-api/item-categories`. */
export const ItemCategoryCreateSchema = z.object({
  code: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  parent_id: UuidSchema.nullable().optional(),
  is_active: z.boolean().default(true),
});
export type ItemCategoryCreate = z.infer<typeof ItemCategoryCreateSchema>;

/** Patch body for `PATCH /inventory-api/item-categories/:id`. All keys optional. */
export const ItemCategoryPatchSchema = ItemCategoryCreateSchema.partial();
export type ItemCategoryPatch = z.infer<typeof ItemCategoryPatchSchema>;

// =========================================================================
// Inventory — Units (Wave 3)
// =========================================================================

/** Unit of measure row. Org-scoped. */
export const UnitSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string().min(1),
  label: z.string().min(1),
  family: z.string().nullable(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Unit = z.infer<typeof UnitSchema>;

/** Create body for `POST /inventory-api/units`. */
export const UnitCreateSchema = z.object({
  code: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  family: z.string().max(40).nullable().optional(),
  is_active: z.boolean().default(true),
});
export type UnitCreate = z.infer<typeof UnitCreateSchema>;

/** Patch body for `PATCH /inventory-api/units/:id`. All keys optional. */
export const UnitPatchSchema = UnitCreateSchema.partial();
export type UnitPatch = z.infer<typeof UnitPatchSchema>;

// =========================================================================
// Inventory — Items (Wave 3)
// =========================================================================

/**
 * Item row (renamed from pricing_menu in migration 0049). The legacy
 * free-text `category` column remains alongside the new `category_id` FK
 * for back-compat with the 34 pre-Wave-0 seed rows; new rows should
 * populate `category_id`. The SPA category picker reads `category_id`.
 */
export const ItemSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  item_code: z.string().min(1),
  description: z.string().min(1),
  /** @deprecated free-text category; use `category_id` for new rows. */
  category: z.string().nullable(),
  category_id: UuidSchema.nullable(),
  item_kind: ItemKindSchema,
  markup_pct: z.union([z.number(), z.string()]).nullable(),
  unit_price_cents: CentsSchema,
  unit_cost_cents: CentsSchema,
  currency_code: z.string().nullable(),
  unit_id: UuidSchema.nullable(),
  tax_id: UuidSchema.nullable(),
  is_inventoried: z.boolean(),
  reorder_point: z.union([z.number(), z.string()]).nullable(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Item = z.infer<typeof ItemSchema>;

/** Create body for `POST /inventory-api/items`. */
export const ItemCreateSchema = z.object({
  item_code: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  item_kind: ItemKindSchema.default('material'),
  category_id: UuidSchema.nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  markup_pct: z.number().nullable().optional(),
  unit_price_cents: z.number().int().nonnegative().default(0),
  unit_cost_cents: z.number().int().nonnegative().default(0),
  currency_code: z.string().length(3).nullable().optional(),
  unit_id: UuidSchema.nullable().optional(),
  tax_id: UuidSchema.nullable().optional(),
  is_inventoried: z.boolean().default(false),
  reorder_point: z.number().nullable().optional(),
  is_active: z.boolean().default(true),
});
export type ItemCreate = z.infer<typeof ItemCreateSchema>;

/** Patch body for `PATCH /inventory-api/items/:id`. All keys optional. */
export const ItemPatchSchema = ItemCreateSchema.partial();
export type ItemPatch = z.infer<typeof ItemPatchSchema>;

// =========================================================================
// Quoting + Projects — workflow enums (Wave 4 / Phase 4 + 5)
// =========================================================================

/**
 * Quote state — prod `quote_state` enum (verified 2026-05-15,
 * schema_migrations=0050). The Wave 4 dispatch text proposed extra states
 * (sent / accepted / declined / converted_to_project) that DO NOT exist on
 * the enum; R-W4-PF-01 (closed) documents the reconcile.
 */
export const QuoteStateSchema = z.enum([
  'draft',
  'submitted',
  'revise_requested',
  'approved',
  'project_pending',
  'cancelled',
]);
export type QuoteState = z.infer<typeof QuoteStateSchema>;

/** Quote origin — prod `quote_origin` enum. Defaults to `management`. */
export const QuoteOriginSchema = z.enum(['management', 'customer_intake']);
export type QuoteOrigin = z.infer<typeof QuoteOriginSchema>;

/** Quote mode — prod `quote_mode` enum. */
export const QuoteModeSchema = z.enum([
  'new_quote',
  'revision',
  'reorder',
  'feasibility_only',
  'scope_shift',
]);
export type QuoteMode = z.infer<typeof QuoteModeSchema>;

/** Quote service type — prod `service_type` enum (3PL surface). */
export const QuoteServiceTypeSchema = z.enum(['co_pack', 'cross_dock']);
export type QuoteServiceType = z.infer<typeof QuoteServiceTypeSchema>;

/** Project state — prod `project_state` enum. */
export const ProjectStateSchema = z.enum([
  'pending',
  'ready_to_build',
  'in_production',
  'ready_to_ship',
  'completed',
  'cancelled',
]);
export type ProjectState = z.infer<typeof ProjectStateSchema>;

/** Phase status — `project_phases.status` text CHECK constraint values. */
export const PhaseStatusSchema = z.enum([
  'pending',
  'active',
  'completed',
  'cancelled',
]);
export type PhaseStatus = z.infer<typeof PhaseStatusSchema>;

// =========================================================================
// Quoting — Quotes (Wave 4)
// =========================================================================

/**
 * Quote row. Reflects the prod `public.quotes` shape after migration 0050.
 * Notes:
 *   - `customer_name` is denormalized NOT NULL on the DB (stamped at create).
 *   - There are no `contact_id` / `tax_inclusive` / `discount_pct` / `terms` /
 *     `notes_internal` / `notes_customer` / `sent_at` / `accepted_at` columns;
 *     the dispatch text proposed them but the cloud table does not have them.
 *   - `tax_rate_snapshot` is `numeric(7,6)` decimal in [0,1] (R-W3-03 close).
 */
export const QuoteSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  quote_number: z.string().min(1),
  customer_id: UuidSchema,
  customer_name: z.string().min(1),
  contact_name: z.string().nullable(),
  contact_email: z.string().nullable(),
  service_type: QuoteServiceTypeSchema,
  status: QuoteStateSchema,
  origin: QuoteOriginSchema,
  mode: QuoteModeSchema,
  materials_only: z.boolean(),
  requires_approval: z.boolean(),
  job_type_id: UuidSchema.nullable(),
  opportunity_id: UuidSchema.nullable(),
  project_id: UuidSchema.nullable(),
  currency_code: z.string().length(3),
  exchange_rate: z.union([z.number(), z.string()]).nullable(),
  tax_id: UuidSchema.nullable(),
  tax_rate_snapshot: z.union([z.number(), z.string()]).nullable(),
  subtotal_cents: CentsSchema,
  tax_cents: CentsSchema,
  discount_cents: CentsSchema,
  total_cents: CentsSchema,
  notes: z.string().nullable(),
  valid_until: z.string().nullable(),
  state_changed_at: TimestampSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Quote = z.infer<typeof QuoteSchema>;

/** Request body for `POST /quotes-api/quotes` (creates a draft). */
export const QuoteCreateSchema = z.object({
  customer_id: UuidSchema,
  customer_name: z.string().min(1).max(200),
  contact_name: z.string().max(200).nullable().optional(),
  contact_email: z.string().email().nullable().optional(),
  service_type: QuoteServiceTypeSchema,
  origin: QuoteOriginSchema.default('management'),
  mode: QuoteModeSchema.default('new_quote'),
  materials_only: z.boolean().default(false),
  job_type_id: UuidSchema.nullable().optional(),
  opportunity_id: UuidSchema.nullable().optional(),
  currency_code: z.string().length(3).optional(),
  tax_id: UuidSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  valid_until: TimestampSchema.nullable().optional(),
});
export type QuoteCreate = z.infer<typeof QuoteCreateSchema>;

/** Request body for `PATCH /quotes-api/quotes/:id`. Only allowed while draft. */
export const QuotePatchSchema = QuoteCreateSchema.partial();
export type QuotePatch = z.infer<typeof QuotePatchSchema>;

/** Empty body acceptable for /submit, /approve. The wire still posts `{}`. */
export const QuoteSubmitSchema = z.object({}).strict();
export type QuoteSubmit = z.infer<typeof QuoteSubmitSchema>;

export const QuoteApproveSchema = z.object({}).strict();
export type QuoteApprove = z.infer<typeof QuoteApproveSchema>;

/** Reason text for revise / decline. */
export const QuoteRequestRevisionsSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type QuoteRequestRevisions = z.infer<typeof QuoteRequestRevisionsSchema>;

export const QuoteDeclineSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type QuoteDecline = z.infer<typeof QuoteDeclineSchema>;

/** Body for `/send` and `/accept` — no state change; activity row only. */
export const QuoteSendSchema = z.object({
  to_email: z.string().email().optional(),
  message: z.string().max(8000).optional(),
});
export type QuoteSend = z.infer<typeof QuoteSendSchema>;

export const QuoteAcceptSchema = z.object({
  note: z.string().max(2000).optional(),
});
export type QuoteAccept = z.infer<typeof QuoteAcceptSchema>;

/**
 * Body for `POST /quotes/:id/convert-to-project`. Calls the existing
 * `convert_quote_to_project(uuid, text, timestamptz)` SECURITY DEFINER RPC.
 */
export const QuoteConvertSchema = z.object({
  project_name: z.string().min(1).max(200),
  due_date: TimestampSchema.nullable().optional(),
});
export type QuoteConvert = z.infer<typeof QuoteConvertSchema>;

/** Body for `POST /quotes/:id/duplicate`. Empty; server clones the quote. */
export const QuoteDuplicateSchema = z.object({}).strict();
export type QuoteDuplicate = z.infer<typeof QuoteDuplicateSchema>;

// =========================================================================
// Quoting — Quote Versions (Wave 4)
// =========================================================================

/**
 * Quote version mirror row. Populated by the `create_v1_for_quote` AFTER
 * INSERT trigger + `mirror_quote_to_current_version` AFTER UPDATE trigger
 * (regenerated in migration 0050).
 */
export const QuoteVersionSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  quote_id: UuidSchema,
  version_number: z.number().int().nonnegative(),
  status: QuoteStateSchema,
  service_type: QuoteServiceTypeSchema,
  mode: QuoteModeSchema,
  materials_only: z.boolean(),
  requires_approval: z.boolean(),
  job_type_id: UuidSchema.nullable(),
  opportunity_id: UuidSchema.nullable(),
  currency_code: z.string().length(3),
  exchange_rate: z.union([z.number(), z.string()]).nullable(),
  tax_id: UuidSchema.nullable(),
  tax_rate_snapshot: z.union([z.number(), z.string()]).nullable(),
  subtotal_cents: CentsSchema,
  tax_cents: CentsSchema,
  discount_cents: CentsSchema,
  total_cents: CentsSchema,
  notes: z.string().nullable(),
  valid_until: z.string().nullable(),
  created_at: TimestampSchema,
});
export type QuoteVersion = z.infer<typeof QuoteVersionSchema>;

// =========================================================================
// Quoting — Quote Line Items (Wave 4)
// =========================================================================

/**
 * Quote line row. Prod columns: `quantity` numeric, `unit` text (free-form,
 * not `unit_id`), `discount_cents`, `tax_amount_cents`, `tax_rate_snapshot`,
 * `line_total_cents`. No `updated_at` column. The `item_id` rename (was
 * `pricing_item_id` pre-0050) is the new normal.
 */
export const QuoteLineSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  quote_id: UuidSchema,
  quote_version_id: UuidSchema.nullable(),
  item_id: UuidSchema.nullable(),
  description: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
  unit: z.string().nullable(),
  unit_price_cents: CentsSchema,
  unit_cost_cents: CentsSchema,
  discount_cents: CentsSchema,
  tax_id: UuidSchema.nullable(),
  tax_rate_snapshot: z.union([z.number(), z.string()]).nullable(),
  tax_amount_cents: CentsSchema,
  line_total_cents: CentsSchema,
  position: z.number().int().nonnegative(),
  created_at: TimestampSchema,
});
export type QuoteLine = z.infer<typeof QuoteLineSchema>;

/** Body for inserting / updating a single line. */
export const QuoteLineUpsertSchema = z.object({
  item_id: UuidSchema.nullable().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive(),
  unit: z.string().max(40).nullable().optional(),
  unit_price_cents: z.number().int().nonnegative(),
  unit_cost_cents: z.number().int().nonnegative().default(0),
  discount_cents: z.number().int().nonnegative().default(0),
  tax_id: UuidSchema.nullable().optional(),
  position: z.number().int().nonnegative(),
});
export type QuoteLineUpsert = z.infer<typeof QuoteLineUpsertSchema>;

/**
 * Bulk-replace body. The handler deletes every existing line for the quote
 * and inserts the supplied set (per F-Wave4-13: legacy
 * `replace_quote_line_items` RPC stays dormant). After replace, the handler
 * recomputes parent quote totals via `taxTotalCents` and stamps the header.
 */
export const QuoteLineReplaceSchema = z.object({
  lines: z.array(QuoteLineUpsertSchema).max(500),
});
export type QuoteLineReplace = z.infer<typeof QuoteLineReplaceSchema>;

/** Reorder payload — array of line ids in their new order. */
export const QuoteLineReorderSchema = z.object({
  line_ids: z.array(UuidSchema).min(1).max(500),
});
export type QuoteLineReorder = z.infer<typeof QuoteLineReorderSchema>;

// =========================================================================
// Projects (Wave 4 / Phase 5)
// =========================================================================

/**
 * Project row. Reflects the prod `public.projects` shape. Notes:
 *   - DB column is `name` on projects; the wire contract leaves it as `name`
 *     to match (the `customers.name → customers.display_name` rename in
 *     Wave 6 / migration 0054 closed the customers carryover; projects.name
 *     is a separate row-naming concern and intentionally left as-is).
 *   - DB has the full project_state lifecycle stamps already:
 *     bom_finalized_at, ready_to_build_at, sent_to_production_at,
 *     production_started_at, production_completed_at, ready_to_ship_at,
 *     shipping_completed_at. Handlers stamp the relevant one on each
 *     transition.
 *   - `quote_id` is the source-quote FK (not `source_quote_id`).
 */
export const ProjectSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  project_number: z.string().min(1),
  quote_id: UuidSchema.nullable(),
  customer_id: UuidSchema.nullable(),
  customer_name: z.string().nullable(),
  name: z.string().min(1),
  status: ProjectStateSchema,
  currency_code: z.string().length(3),
  total_cents: CentsSchema,
  budget_cents: CentsSchema,
  due_date: z.string().nullable(),
  invoice_id: UuidSchema.nullable(),
  bom_finalized_at: z.string().nullable(),
  bom_finalized_by: UuidSchema.nullable(),
  ready_to_build_at: z.string().nullable(),
  sent_to_production_at: z.string().nullable(),
  production_started_at: z.string().nullable(),
  production_completed_at: z.string().nullable(),
  ready_to_ship_at: z.string().nullable(),
  shipping_completed_at: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

/** Body for `POST /projects-api/projects` — direct create (rare; usually quote-convert). */
export const ProjectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  customer_id: UuidSchema.nullable().optional(),
  customer_name: z.string().max(200).nullable().optional(),
  quote_id: UuidSchema.nullable().optional(),
  currency_code: z.string().length(3).optional(),
  total_cents: z.number().int().nonnegative().default(0),
  budget_cents: z.number().int().nonnegative().default(0),
  due_date: TimestampSchema.nullable().optional(),
});
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;

/** Body for `PATCH /projects-api/projects/:id`. All keys optional. */
export const ProjectPatchSchema = ProjectCreateSchema.partial();
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>;

/** Body for `POST /projects/:id/close`. */
export const ProjectCloseSchema = z.object({
  reason: z.string().max(2000).optional(),
});
export type ProjectClose = z.infer<typeof ProjectCloseSchema>;

/**
 * Body for `POST /projects/:id/reopen`. Reopen drops the project back to
 * the most-recent pre-completion stamp (in_production by default, or
 * ready_to_ship if the project completed via ship-out). Caller may force
 * the target state if their UI knows better.
 */
export const ProjectReopenSchema = z.object({
  to: z.enum(['in_production', 'ready_to_ship']).default('in_production'),
});
export type ProjectReopen = z.infer<typeof ProjectReopenSchema>;

// =========================================================================
// Project Phases (Wave 4 / Phase 5)
// =========================================================================

/**
 * Project phase row. Prod table `project_phases` from migration 0042;
 * `status` is text + CHECK (not an enum). `planned_*_at` and `actual_*_at`
 * are timestamptz on the DB.
 */
export const ProjectPhaseSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  project_id: UuidSchema,
  position: z.number().int().nonnegative(),
  name: z.string().min(1),
  description: z.string().nullable(),
  status: PhaseStatusSchema,
  planned_start_at: z.string().nullable(),
  planned_end_at: z.string().nullable(),
  actual_start_at: z.string().nullable(),
  actual_end_at: z.string().nullable(),
  budget_cents: CentsSchema,
  notes: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type ProjectPhase = z.infer<typeof ProjectPhaseSchema>;

/** Body for `POST /projects/:project_id/phases`. */
export const ProjectPhaseCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  position: z.number().int().nonnegative(),
  planned_start_at: TimestampSchema.nullable().optional(),
  planned_end_at: TimestampSchema.nullable().optional(),
  budget_cents: z.number().int().nonnegative().default(0),
  notes: z.string().max(8000).nullable().optional(),
});
export type ProjectPhaseCreate = z.infer<typeof ProjectPhaseCreateSchema>;

/** Body for `PATCH /projects/:project_id/phases/:phase_id`. */
export const ProjectPhasePatchSchema = ProjectPhaseCreateSchema.partial();
export type ProjectPhasePatch = z.infer<typeof ProjectPhasePatchSchema>;

/** Body for `POST /projects/:project_id/phases/reorder`. */
export const ProjectPhaseReorderSchema = z.object({
  phase_ids: z.array(UuidSchema).min(1).max(200),
});
export type ProjectPhaseReorder = z.infer<typeof ProjectPhaseReorderSchema>;

/**
 * Body for `PUT /projects/:project_id/phases/:phase_id/status`. The state
 * machine validator (`assertTransition('phase', ...)`) gates the change.
 */
export const ProjectPhaseStatusUpdateSchema = z.object({
  status: PhaseStatusSchema,
});
export type ProjectPhaseStatusUpdate = z.infer<typeof ProjectPhaseStatusUpdateSchema>;

// =========================================================================
// Invoicing — workflow enums (Wave 5 / Phase 7)
// =========================================================================

/**
 * Invoice state — prod `invoices.status` text CHECK (verified 2026-05-15,
 * schema_migrations=0052). Nine values; `refunded` and `cancelled` are
 * terminal.
 */
export const InvoiceStateSchema = z.enum([
  'draft',
  'pending',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'refunded',
  'cancelled',
  'on_hold',
]);
export type InvoiceState = z.infer<typeof InvoiceStateSchema>;

/** Invoice payment status — prod `invoices.payment_status` text CHECK. */
export const InvoicePaymentStatusSchema = z.enum(['unpaid', 'partially_paid', 'paid']);
export type InvoicePaymentStatus = z.infer<typeof InvoicePaymentStatusSchema>;

/**
 * Invoice recurring cadence — prod `invoices.recurring` text CHECK
 * (nullable; non-recurring rows leave the column NULL).
 */
export const InvoiceRecurringSchema = z.enum([
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'annually',
]);
export type InvoiceRecurring = z.infer<typeof InvoiceRecurringSchema>;

/**
 * Credit note state — prod `credit_notes.status` text CHECK. Four values;
 * `voided` is terminal.
 */
export const CreditNoteStatusSchema = z.enum(['draft', 'issued', 'applied', 'voided']);
export type CreditNoteStatus = z.infer<typeof CreditNoteStatusSchema>;

/**
 * Credit note reason — prod `credit_notes.reason` text CHECK (nullable).
 * Five values. Used at create time; not the void reason.
 */
export const CreditNoteReasonSchema = z.enum([
  'refund',
  'adjustment',
  'write_off',
  'duplicate',
  'other',
]);
export type CreditNoteReason = z.infer<typeof CreditNoteReasonSchema>;

// =========================================================================
// Invoicing — Invoices (Wave 5 / Phase 7)
// =========================================================================

/**
 * Invoice row. Reflects the prod `public.invoices` shape after migration
 * 0052. Drifts from API-contract §6 reconciled DB-wins (5.4 docs reconcile):
 *   - DB column is `customer_name_snapshot` (not `customer_name`).
 *   - Single `notes` column (no `notes_customer`/`terms`).
 *   - No `tax_inclusive` column; no per-line `discount_pct` (cents only).
 *   - `recurring` is a nullable text CHECK on the invoice row itself, not a
 *     separate recurring-config table.
 *   - `balance_cents` is bigint NULL populated by the recompute trigger
 *     (`recompute_invoice_totals` RPC + triggers added in 0052).
 *   - Lifecycle stamps: `sent_at`, `paid_at`, `cancelled_at`, `pending_at`,
 *     `on_hold_at`, `state_changed_at`. Handlers update the relevant column
 *     on each transition (the state-machine audit row is written by the
 *     `trg_invoices_audit_state` trigger — do NOT insert audit_log rows
 *     manually).
 */
export const InvoiceSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  invoice_number: z.string().min(1),
  customer_id: UuidSchema,
  customer_name_snapshot: z.string().min(1),
  project_id: UuidSchema.nullable(),
  quote_id: UuidSchema.nullable(),
  status: InvoiceStateSchema,
  payment_status: InvoicePaymentStatusSchema,
  recurring: InvoiceRecurringSchema.nullable(),
  content: z.string().nullable(),
  notes: z.string().nullable(),
  issue_date: z.string(),
  due_date: z.string(),
  state_changed_at: TimestampSchema,
  approved: z.boolean(),
  is_overdue: z.boolean(),
  converted_from_type: z.enum(['quote', 'project']).nullable(),
  converted_from_id: UuidSchema.nullable(),
  currency_code: z.string().length(3),
  exchange_rate: z.union([z.number(), z.string()]).nullable(),
  subtotal_cents: CentsSchema,
  discount_cents: CentsSchema,
  tax_cents: CentsSchema,
  total_cents: CentsSchema,
  paid_cents: CentsSchema,
  balance_cents: CentsSchema.nullable(),
  tax_id: UuidSchema.nullable(),
  tax_rate_snapshot: z.union([z.number(), z.string()]).nullable(),
  pdf_path: z.string().nullable(),
  external_ref: z.string().nullable(),
  sent_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  cancellation_reason: z.string().nullable(),
  pending_at: z.string().nullable(),
  on_hold_at: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Invoice = z.infer<typeof InvoiceSchema>;

/**
 * Request body for `POST /invoicing-api/invoices` (creates a draft).
 * Required: customer_id, due_date, currency_code. issue_date defaults to
 * today on the server when omitted.
 */
export const InvoiceCreateSchema = z.object({
  customer_id: UuidSchema,
  due_date: z.string().date(),
  currency_code: z.string().length(3),
  quote_id: UuidSchema.nullable().optional(),
  project_id: UuidSchema.nullable().optional(),
  issue_date: z.string().date().optional(),
  customer_name_snapshot: z.string().min(1).max(200).optional(),
  notes: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  recurring: InvoiceRecurringSchema.nullable().optional(),
  exchange_rate: z.number().positive().nullable().optional(),
  tax_id: UuidSchema.nullable().optional(),
  tax_rate_snapshot: z.number().min(0).max(1).nullable().optional(),
  external_ref: z.string().max(120).nullable().optional(),
});
export type InvoiceCreate = z.infer<typeof InvoiceCreateSchema>;

/** Patch body for `PATCH /invoicing-api/invoices/:id`. Only allowed while draft. */
export const InvoicePatchSchema = InvoiceCreateSchema.partial();
export type InvoicePatch = z.infer<typeof InvoicePatchSchema>;

/** Body shapes for the invoice action endpoints. */
export const InvoiceSubmitSchema = z.object({}).strict();
export type InvoiceSubmit = z.infer<typeof InvoiceSubmitSchema>;

export const InvoiceSendSchema = z.object({
  email: z.string().email().optional(),
  message: z.string().max(8000).optional(),
});
export type InvoiceSend = z.infer<typeof InvoiceSendSchema>;

export const InvoiceVoidSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type InvoiceVoid = z.infer<typeof InvoiceVoidSchema>;

export const InvoiceHoldSchema = z.object({
  reason: z.string().max(2000).optional(),
});
export type InvoiceHold = z.infer<typeof InvoiceHoldSchema>;

export const InvoiceReleaseSchema = z.object({
  reason: z.string().max(2000).optional(),
});
export type InvoiceRelease = z.infer<typeof InvoiceReleaseSchema>;

export const InvoiceDuplicateSchema = z.object({}).strict();
export type InvoiceDuplicate = z.infer<typeof InvoiceDuplicateSchema>;

export const InvoiceConvertFromQuoteSchema = z.object({
  quote_id: UuidSchema,
  due_date: z.string().date(),
});
export type InvoiceConvertFromQuote = z.infer<typeof InvoiceConvertFromQuoteSchema>;

export const InvoiceConvertFromProjectSchema = z.object({
  project_id: UuidSchema,
  due_date: z.string().date(),
});
export type InvoiceConvertFromProject = z.infer<typeof InvoiceConvertFromProjectSchema>;

// =========================================================================
// Invoicing — Invoice Versions (Wave 5)
// =========================================================================

/**
 * Invoice version mirror row. Populated by the `create_v1_for_invoice`
 * AFTER INSERT trigger + `mirror_invoice_to_current_version` AFTER UPDATE
 * trigger (added in migration 0052).
 */
export const InvoiceVersionSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  invoice_id: UuidSchema,
  version_number: z.number().int().nonnegative(),
  status: InvoiceStateSchema,
  payment_status: InvoicePaymentStatusSchema,
  issue_date: z.string(),
  due_date: z.string(),
  notes: z.string().nullable(),
  currency_code: z.string().length(3),
  subtotal_cents: CentsSchema,
  discount_cents: CentsSchema,
  tax_cents: CentsSchema,
  total_cents: CentsSchema,
  paid_cents: CentsSchema,
  created_at: TimestampSchema,
});
export type InvoiceVersion = z.infer<typeof InvoiceVersionSchema>;

// =========================================================================
// Invoicing — Invoice Line Items (Wave 5)
// =========================================================================

/**
 * Invoice line row. Mirrors `quote_line_items` shape (prod columns:
 * `quantity` numeric, `unit` text, `discount_cents`, `tax_amount_cents`,
 * `tax_rate_snapshot`, `line_total_cents`). Has `updated_at` (the quote
 * version does not). The DB recompute trigger on AIUD rolls totals up to
 * the parent invoice automatically — handlers do NOT need to recompute.
 */
export const InvoiceLineSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  invoice_id: UuidSchema,
  invoice_version_id: UuidSchema.nullable(),
  item_id: UuidSchema.nullable(),
  description: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
  unit: z.string().nullable(),
  unit_price_cents: CentsSchema,
  unit_cost_cents: CentsSchema,
  discount_cents: CentsSchema,
  tax_id: UuidSchema.nullable(),
  tax_rate_snapshot: z.union([z.number(), z.string()]).nullable(),
  tax_amount_cents: CentsSchema,
  line_total_cents: CentsSchema,
  position: z.number().int().nonnegative(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

/** Body for inserting / updating a single invoice line. */
export const InvoiceLineUpsertSchema = z.object({
  item_id: UuidSchema.nullable().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive(),
  unit: z.string().max(40).nullable().optional(),
  unit_price_cents: z.number().int().nonnegative(),
  unit_cost_cents: z.number().int().nonnegative().default(0),
  discount_cents: z.number().int().nonnegative().default(0),
  tax_id: UuidSchema.nullable().optional(),
  position: z.number().int().nonnegative(),
});
export type InvoiceLineUpsert = z.infer<typeof InvoiceLineUpsertSchema>;

/** Bulk-replace body. Parent invoice must be in `draft` state. */
export const InvoiceLineReplaceSchema = z.object({
  lines: z.array(InvoiceLineUpsertSchema).max(500),
});
export type InvoiceLineReplace = z.infer<typeof InvoiceLineReplaceSchema>;

/** Reorder payload — array of line ids in their new order. */
export const InvoiceLineReorderSchema = z.object({
  line_ids: z.array(UuidSchema).min(1).max(500),
});
export type InvoiceLineReorder = z.infer<typeof InvoiceLineReorderSchema>;

// =========================================================================
// Payments (Wave 5 / Phase 8)
// =========================================================================

/**
 * Payment row. Reflects the prod `public.payments` shape (verified
 * 2026-05-15, schema_migrations=0052). `amount_cents > 0` (CHECK
 * constraint). `voided_at`/`void_reason` stamped by void endpoint. The
 * recompute trigger handles invoice rollup automatically.
 */
export const PaymentSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  payment_number: z.string().min(1),
  customer_id: UuidSchema,
  invoice_id: UuidSchema,
  payment_method_id: UuidSchema.nullable(),
  paid_at: TimestampSchema,
  amount_cents: CentsSchema,
  currency_code: z.string().length(3),
  exchange_rate: z.union([z.number(), z.string()]).nullable(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  external_ref: z.string().nullable(),
  cleared_at: z.string().nullable(),
  voided_at: z.string().nullable(),
  void_reason: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Payment = z.infer<typeof PaymentSchema>;

/**
 * Body for `POST /invoicing-api/payments`. amount_cents must be > 0.
 * paid_at defaults to server-side now() when omitted.
 *
 * Wave 8 / Phase 12 / closes R-W5-PAY-01: optional `allocations[]` array
 * lets a single payment land against multiple invoices. When present,
 * SUM(allocations.amount_cents) must equal body.amount_cents (handler
 * enforces 422 on mismatch) and every invoice_id must belong to the
 * caller's org with currency_code matching the payment. The handler
 * inserts the payment with invoice_id := allocations[0].invoice_id
 * (1:1 FK is still NOT NULL) and then bulk-inserts payment_allocations
 * rows. When `allocations` is omitted, the legacy single-invoice path
 * is unchanged.
 */
export const PaymentAllocationInputSchema = z.object({
  invoice_id: UuidSchema,
  amount_cents: z.number().int().positive(),
}).strict();
export type PaymentAllocationInput = z.infer<typeof PaymentAllocationInputSchema>;

export const PaymentCreateSchema = z.object({
  customer_id: UuidSchema,
  invoice_id: UuidSchema,
  amount_cents: z.number().int().positive(),
  currency_code: z.string().length(3),
  paid_at: TimestampSchema.optional(),
  payment_method_id: UuidSchema.nullable().optional(),
  reference: z.string().max(120).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  external_ref: z.string().max(120).nullable().optional(),
  exchange_rate: z.number().positive().nullable().optional(),
  allocations: z.array(PaymentAllocationInputSchema).min(1).optional(),
});
export type PaymentCreate = z.infer<typeof PaymentCreateSchema>;

/**
 * Body for `POST /invoicing-api/payments/:id/allocate`. Adds allocation
 * rows to an existing payment. SUM(new allocations) + SUM(existing
 * allocations) + (if no allocations existed yet, the legacy 1:1
 * amount_cents) must not exceed the payment's amount_cents — handler
 * returns 422 otherwise.
 */
export const PaymentAllocateSchema = z.object({
  allocations: z.array(PaymentAllocationInputSchema).min(1),
}).strict();
export type PaymentAllocate = z.infer<typeof PaymentAllocateSchema>;

/**
 * payment_allocations row. Mirrors public.payment_allocations
 * (migration 0059). One row per (payment, invoice) live allocation.
 */
export const PaymentAllocationSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  payment_id: UuidSchema,
  invoice_id: UuidSchema,
  amount_cents: CentsSchema,
  notes: z.string().nullable(),
  created_at: TimestampSchema,
  created_by: UuidSchema.nullable(),
  updated_at: TimestampSchema,
  updated_by: UuidSchema.nullable(),
  deleted_at: TimestampSchema.nullable(),
});
export type PaymentAllocation = z.infer<typeof PaymentAllocationSchema>;

/**
 * Patch body for `PATCH /invoicing-api/payments/:id`. Allowed only while
 * voided_at IS NULL. amount_cents stays positive if supplied.
 */
export const PaymentPatchSchema = z.object({
  paid_at: TimestampSchema.optional(),
  amount_cents: z.number().int().positive().optional(),
  payment_method_id: UuidSchema.nullable().optional(),
  reference: z.string().max(120).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  external_ref: z.string().max(120).nullable().optional(),
  exchange_rate: z.number().positive().nullable().optional(),
});
export type PaymentPatch = z.infer<typeof PaymentPatchSchema>;

export const PaymentVoidSchema = z.object({
  void_reason: z.string().min(1).max(2000),
});
export type PaymentVoid = z.infer<typeof PaymentVoidSchema>;

// =========================================================================
// Credit Notes (Wave 5 / Phase 8)
// =========================================================================

/**
 * Credit note row. Reflects the prod `public.credit_notes` shape. Status
 * CHECK is 4 values (draft/issued/applied/voided). `reason` is a nullable
 * text CHECK of (refund | adjustment | write_off | duplicate | other) —
 * NOT the same surface as a free-text void reason. There is no
 * `void_reason` column; voids stamp `voided_at` only.
 */
export const CreditNoteSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  credit_note_number: z.string().min(1),
  customer_id: UuidSchema,
  invoice_id: UuidSchema.nullable(),
  issue_date: z.string(),
  status: CreditNoteStatusSchema,
  reason: CreditNoteReasonSchema.nullable(),
  currency_code: z.string().length(3),
  amount_cents: CentsSchema,
  applied_cents: CentsSchema,
  notes: z.string().nullable(),
  voided_at: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type CreditNote = z.infer<typeof CreditNoteSchema>;

/**
 * Create body for `POST /invoicing-api/credit-notes`. The CHECK constraint
 * `applied_cents <= amount_cents` is enforced server-side; create always
 * starts with applied_cents=0 and status='draft'.
 */
export const CreditNoteCreateSchema = z.object({
  customer_id: UuidSchema,
  currency_code: z.string().length(3),
  amount_cents: z.number().int().nonnegative(),
  invoice_id: UuidSchema.nullable().optional(),
  reason: CreditNoteReasonSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  issue_date: z.string().date().optional(),
});
export type CreditNoteCreate = z.infer<typeof CreditNoteCreateSchema>;

/** Empty body acceptable for /issue. */
export const CreditNoteIssueSchema = z.object({}).strict();
export type CreditNoteIssue = z.infer<typeof CreditNoteIssueSchema>;

/**
 * Apply payload. `invoice_id` MUST belong to the caller's org; amount_cents
 * must be positive and not exceed (credit_note.amount_cents -
 * credit_note.applied_cents). The DB CHECK
 * `applied_cents <= amount_cents` is the floor; server-side validates
 * before bumping applied_cents.
 */
export const CreditNoteApplySchema = z.object({
  invoice_id: UuidSchema,
  amount_cents: z.number().int().positive(),
});
export type CreditNoteApply = z.infer<typeof CreditNoteApplySchema>;

/**
 * Void payload. There is no `void_reason` column on credit_notes (verified
 * 2026-05-15); the reason text is logged in a notes-only fashion server-
 * side and the row stamps `voided_at`. Schema requires a reason string for
 * caller-side accountability even though the DB column is absent.
 */
export const CreditNoteVoidSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type CreditNoteVoid = z.infer<typeof CreditNoteVoidSchema>;

// ============================================================================
// Wave 7 / Phase 10 — Vendors / Purchase orders / PO line items / Vendor bills
// ============================================================================
//
// All four tables already exist in prod from Wave 0 chassis. Schemas here are
// reconciled DB-wins (verified 2026-05-16, schema_migrations=0058). Notable:
//   - vendors.name (NOT display_name; F-Wave6-03 only renamed customers)
//   - purchase_orders.status CHECK 7 values incl `partial_received` (not
//     `partially_received`) and `closed` as a post-`received` terminal
//   - vendor_bills.status CHECK 7 values incl `partially_paid`+`overdue`
//   - po_line_items.quantity / quantity_received are numeric (use number,
//     not bigint; line totals computed from quantity × unit_cost_cents)
//   - vendor_bills.balance_cents is set by the BIU trigger added in 0058
//     (handler-side reads only; never write directly)
//   - vendor_bills has no line items table in prod — header totals only

export const VendorSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  name: z.string().min(1).max(255),
  legal_name: z.string().max(255).nullable(),
  email: z.string().email().nullable(),
  phone: z.string().max(64).nullable(),
  website: z.string().max(255).nullable(),
  tax_id: z.string().max(64).nullable(),
  currency_code: z.string().length(3).nullable(),
  payment_terms_days: z.number().int().nonnegative(),
  billing_address: z.record(z.unknown()),
  external_ref: z.string().max(255).nullable(),
  notes: z.string().nullable(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  deleted_at: TimestampSchema.nullable(),
});
export type Vendor = z.infer<typeof VendorSchema>;

export const VendorCreateSchema = z.object({
  name: z.string().min(1).max(255),
  legal_name: z.string().max(255).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  tax_id: z.string().max(64).nullable().optional(),
  currency_code: z.string().length(3).nullable().optional(),
  payment_terms_days: z.number().int().nonnegative().optional(),
  billing_address: z.record(z.unknown()).optional(),
  external_ref: z.string().max(255).nullable().optional(),
  notes: z.string().nullable().optional(),
}).strict();
export type VendorCreate = z.infer<typeof VendorCreateSchema>;

export const VendorPatchSchema = VendorCreateSchema.partial().extend({
  is_active: z.boolean().optional(),
}).strict();
export type VendorPatch = z.infer<typeof VendorPatchSchema>;

export const PurchaseOrderStateSchema = z.enum([
  'draft', 'submitted', 'approved', 'partial_received', 'received', 'cancelled', 'closed',
]);
export type PurchaseOrderState = z.infer<typeof PurchaseOrderStateSchema>;

export const PurchaseOrderSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  po_number: z.string(),
  vendor_id: UuidSchema,
  project_id: UuidSchema.nullable(),
  status: PurchaseOrderStateSchema,
  issue_date: z.string().date(),
  expected_date: z.string().date().nullable(),
  currency_code: z.string().length(3),
  subtotal_cents: CentsSchema,
  tax_cents: CentsSchema,
  shipping_cents: CentsSchema,
  total_cents: CentsSchema,
  notes: z.string().nullable(),
  state_changed_at: TimestampSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  deleted_at: TimestampSchema.nullable(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

export const PurchaseOrderCreateSchema = z.object({
  vendor_id: UuidSchema,
  project_id: UuidSchema.nullable().optional(),
  issue_date: z.string().date().optional(),
  expected_date: z.string().date().nullable().optional(),
  currency_code: z.string().length(3).optional(),
  tax_cents: z.number().int().nonnegative().optional(),
  shipping_cents: z.number().int().nonnegative().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(z.object({
    item_id: UuidSchema.nullable().optional(),
    description: z.string().min(1).max(2000),
    quantity: z.number().positive(),
    unit: z.string().max(32).nullable().optional(),
    unit_cost_cents: z.number().int().nonnegative(),
    position: z.number().int().nonnegative().optional(),
  })).optional(),
}).strict();
export type PurchaseOrderCreate = z.infer<typeof PurchaseOrderCreateSchema>;

export const PurchaseOrderPatchSchema = z.object({
  project_id: UuidSchema.nullable().optional(),
  issue_date: z.string().date().optional(),
  expected_date: z.string().date().nullable().optional(),
  currency_code: z.string().length(3).optional(),
  tax_cents: z.number().int().nonnegative().optional(),
  shipping_cents: z.number().int().nonnegative().optional(),
  notes: z.string().nullable().optional(),
}).strict();
export type PurchaseOrderPatch = z.infer<typeof PurchaseOrderPatchSchema>;

export const POLineItemSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  po_id: UuidSchema,
  item_id: UuidSchema.nullable(),
  description: z.string(),
  quantity: z.number(),
  quantity_received: z.number(),
  unit: z.string().nullable(),
  unit_cost_cents: CentsSchema,
  line_total_cents: CentsSchema,
  position: z.number().int().nonnegative(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type POLineItem = z.infer<typeof POLineItemSchema>;

export const POLineItemCreateSchema = z.object({
  item_id: UuidSchema.nullable().optional(),
  description: z.string().min(1).max(2000),
  quantity: z.number().positive(),
  unit: z.string().max(32).nullable().optional(),
  unit_cost_cents: z.number().int().nonnegative(),
  position: z.number().int().nonnegative().optional(),
}).strict();
export type POLineItemCreate = z.infer<typeof POLineItemCreateSchema>;

export const POLineItemPatchSchema = z.object({
  description: z.string().min(1).max(2000).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().max(32).nullable().optional(),
  unit_cost_cents: z.number().int().nonnegative().optional(),
  position: z.number().int().nonnegative().optional(),
}).strict();
export type POLineItemPatch = z.infer<typeof POLineItemPatchSchema>;

/** POST /purchase-orders/:id/receive — partial-receive payload. */
export const PurchaseOrderReceiveSchema = z.object({
  lines: z.array(z.object({
    po_line_item_id: UuidSchema,
    quantity_received: z.number().nonnegative(),
  })).min(1),
}).strict();
export type PurchaseOrderReceive = z.infer<typeof PurchaseOrderReceiveSchema>;

export const VendorBillStateSchema = z.enum([
  'draft', 'pending', 'approved', 'partially_paid', 'paid', 'overdue', 'cancelled',
]);
export type VendorBillState = z.infer<typeof VendorBillStateSchema>;

export const VendorBillSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  bill_number: z.string(),
  vendor_id: UuidSchema,
  po_id: UuidSchema.nullable(),
  vendor_ref: z.string().nullable(),
  status: VendorBillStateSchema,
  issue_date: z.string().date(),
  due_date: z.string().date(),
  currency_code: z.string().length(3),
  subtotal_cents: CentsSchema,
  tax_cents: CentsSchema,
  total_cents: CentsSchema,
  paid_cents: CentsSchema,
  balance_cents: CentsSchema.nullable(),
  notes: z.string().nullable(),
  approved_at: TimestampSchema.nullable(),
  approved_by: UuidSchema.nullable(),
  paid_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  deleted_at: TimestampSchema.nullable(),
});
export type VendorBill = z.infer<typeof VendorBillSchema>;

export const VendorBillCreateSchema = z.object({
  vendor_id: UuidSchema,
  po_id: UuidSchema.nullable().optional(),
  vendor_ref: z.string().max(255).nullable().optional(),
  issue_date: z.string().date().optional(),
  due_date: z.string().date(),
  currency_code: z.string().length(3).optional(),
  subtotal_cents: z.number().int().nonnegative(),
  tax_cents: z.number().int().nonnegative().optional(),
  total_cents: z.number().int().nonnegative(),
  notes: z.string().nullable().optional(),
}).strict();
export type VendorBillCreate = z.infer<typeof VendorBillCreateSchema>;

export const VendorBillPatchSchema = VendorBillCreateSchema.omit({
  vendor_id: true, total_cents: true, subtotal_cents: true,
}).partial().extend({
  subtotal_cents: z.number().int().nonnegative().optional(),
  total_cents: z.number().int().nonnegative().optional(),
}).strict();
export type VendorBillPatch = z.infer<typeof VendorBillPatchSchema>;

/** POST /vendor-bills/:id/pay — amount payload (defaults to full balance). */
export const VendorBillPaySchema = z.object({
  amount_cents: z.number().int().positive().optional(),
}).strict();
export type VendorBillPay = z.infer<typeof VendorBillPaySchema>;

// ============================================================================
// Wave 7 / Phase 11 — Expense categories / Expenses
// ============================================================================
//
// Both tables exist in prod from Wave 0 chassis. expenses is single-line —
// no expense_line_items table (D-W7-7). total_cents := amount_cents + tax_cents
// computed by the BIU trigger added in 0058. RLS includes
// expenses_insert_self (any staff inserts own draft) + expenses_update_self_draft
// (own draft/submitted/rejected) + expenses_approve_fin (accounting approve).

export const ExpenseCategorySchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string().min(1).max(64),
  label: z.string().min(1).max(255),
  default_account_id: UuidSchema.nullable(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type ExpenseCategory = z.infer<typeof ExpenseCategorySchema>;

export const ExpenseCategoryCreateSchema = z.object({
  code: z.string().min(1).max(64),
  label: z.string().min(1).max(255),
  default_account_id: UuidSchema.nullable().optional(),
}).strict();
export type ExpenseCategoryCreate = z.infer<typeof ExpenseCategoryCreateSchema>;

export const ExpenseCategoryPatchSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  default_account_id: UuidSchema.nullable().optional(),
  is_active: z.boolean().optional(),
}).strict();
export type ExpenseCategoryPatch = z.infer<typeof ExpenseCategoryPatchSchema>;

export const ExpenseStateSchema = z.enum([
  'draft', 'submitted', 'approved', 'rejected', 'reimbursed', 'paid',
]);
export type ExpenseStateZ = z.infer<typeof ExpenseStateSchema>;

export const ExpenseSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  expense_number: z.string(),
  category_id: UuidSchema.nullable(),
  vendor_id: UuidSchema.nullable(),
  project_id: UuidSchema.nullable(),
  account_id: UuidSchema.nullable(),
  spent_at: z.string().date(),
  description: z.string().nullable(),
  status: ExpenseStateSchema,
  currency_code: z.string().length(3),
  amount_cents: CentsSchema,
  tax_cents: CentsSchema,
  tax_id: UuidSchema.nullable(),
  total_cents: CentsSchema,
  paid_at: TimestampSchema.nullable(),
  receipt_url: z.string().nullable(),
  notes: z.string().nullable(),
  submitted_by: UuidSchema.nullable(),
  approved_by: UuidSchema.nullable(),
  approved_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  deleted_at: TimestampSchema.nullable(),
});
export type Expense = z.infer<typeof ExpenseSchema>;

export const ExpenseCreateSchema = z.object({
  category_id: UuidSchema.nullable().optional(),
  vendor_id: UuidSchema.nullable().optional(),
  project_id: UuidSchema.nullable().optional(),
  account_id: UuidSchema.nullable().optional(),
  spent_at: z.string().date().optional(),
  description: z.string().nullable().optional(),
  currency_code: z.string().length(3).optional(),
  amount_cents: z.number().int().nonnegative(),
  tax_cents: z.number().int().nonnegative().optional(),
  tax_id: UuidSchema.nullable().optional(),
  receipt_url: z.string().max(2048).nullable().optional(),
  notes: z.string().nullable().optional(),
}).strict();
export type ExpenseCreate = z.infer<typeof ExpenseCreateSchema>;

export const ExpensePatchSchema = ExpenseCreateSchema.partial().strict();
export type ExpensePatch = z.infer<typeof ExpensePatchSchema>;

/** POST /expenses/:id/reject — body carries the rejection reason. */
export const ExpenseRejectSchema = z.object({
  reason: z.string().min(1).max(2000),
}).strict();
export type ExpenseReject = z.infer<typeof ExpenseRejectSchema>;

// ============================================================================
// Wave 8 / Phase 12 — Chart of Accounts
// ============================================================================
//
// public.chart_of_accounts exists in prod from the Wave 0 chassis (verified
// 2026-05-16, schema_migrations=0058). account_type CHECK is 6 values
// (asset/liability/equity/revenue/expense/cogs). parent_id is a self-FK ON
// DELETE SET NULL — moves and deletes preserve the tree. is_system marks
// chassis-seeded accounts that handlers refuse to edit/archive.

export const ChartOfAccountTypeSchema = z.enum([
  'asset', 'liability', 'equity', 'revenue', 'expense', 'cogs',
]);
export type ChartOfAccountType = z.infer<typeof ChartOfAccountTypeSchema>;

export const ChartOfAccountSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  account_code: z.string().min(1).max(64),
  label: z.string().min(1).max(255),
  account_type: ChartOfAccountTypeSchema,
  parent_id: UuidSchema.nullable(),
  currency_code: z.string().length(3).nullable(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  is_system: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type ChartOfAccount = z.infer<typeof ChartOfAccountSchema>;

export const ChartOfAccountCreateSchema = z.object({
  account_code: z.string().min(1).max(64),
  label: z.string().min(1).max(255),
  account_type: ChartOfAccountTypeSchema,
  parent_id: UuidSchema.nullable().optional(),
  currency_code: z.string().length(3).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  is_active: z.boolean().optional(),
}).strict();
export type ChartOfAccountCreate = z.infer<typeof ChartOfAccountCreateSchema>;

export const ChartOfAccountPatchSchema = z.object({
  account_code: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(255).optional(),
  account_type: ChartOfAccountTypeSchema.optional(),
  parent_id: UuidSchema.nullable().optional(),
  currency_code: z.string().length(3).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  is_active: z.boolean().optional(),
}).strict();
export type ChartOfAccountPatch = z.infer<typeof ChartOfAccountPatchSchema>;

// ============================================================================
// Wave 8 / Phase 12 — Journal Entries
// ============================================================================
//
// public.journal_entries + public.journal_entry_lines exist in prod from the
// Wave 0 chassis (verified 2026-05-16). status text CHECK is 3 values
// (draft/posted/reversed). source_type text CHECK is 6 values
// (invoice/payment/expense/credit_note/manual/vendor_bill). Lines have CHECKs
// preventing both debit and credit > 0 simultaneously and requiring at least
// one > 0. check_journal_balance(p_entry_id uuid) RPC raises an exception on
// imbalance — the post handler calls it and converts the raise to a 422.

export const JournalEntryStateSchema = z.enum(['draft', 'posted', 'reversed']);
export type JournalEntryStateZ = z.infer<typeof JournalEntryStateSchema>;

export const JournalEntrySourceTypeSchema = z.enum([
  'invoice', 'payment', 'expense', 'credit_note', 'manual', 'vendor_bill',
]);
export type JournalEntrySourceType = z.infer<typeof JournalEntrySourceTypeSchema>;

export const JournalEntryLineSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  journal_entry_id: UuidSchema,
  account_id: UuidSchema,
  debit_cents: CentsSchema,
  credit_cents: CentsSchema,
  memo: z.string().nullable(),
  position: z.number().int().nonnegative(),
});
export type JournalEntryLine = z.infer<typeof JournalEntryLineSchema>;

/** Input shape for a journal entry line on create/patch. */
export const JournalEntryLineInputSchema = z.object({
  account_id: UuidSchema,
  debit_cents: z.number().int().nonnegative(),
  credit_cents: z.number().int().nonnegative(),
  memo: z.string().max(2000).nullable().optional(),
  position: z.number().int().nonnegative().optional(),
}).strict().refine(
  (l) => (l.debit_cents > 0) !== (l.credit_cents > 0),
  { message: 'exactly one of debit_cents / credit_cents must be > 0' },
);
export type JournalEntryLineInput = z.infer<typeof JournalEntryLineInputSchema>;

export const JournalEntrySchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  entry_number: z.string(),
  entry_date: z.string().date(),
  description: z.string().nullable(),
  status: JournalEntryStateSchema,
  source_type: JournalEntrySourceTypeSchema.nullable(),
  source_id: UuidSchema.nullable(),
  currency_code: z.string().length(3),
  posted_at: TimestampSchema.nullable(),
  reversed_at: TimestampSchema.nullable(),
  reversed_by_entry_id: UuidSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

export const JournalEntryCreateSchema = z.object({
  entry_date: z.string().date().optional(),
  description: z.string().max(4000).nullable().optional(),
  source_type: JournalEntrySourceTypeSchema.optional(),
  source_id: UuidSchema.nullable().optional(),
  currency_code: z.string().length(3).optional(),
  lines: z.array(JournalEntryLineInputSchema).min(2),
}).strict();
export type JournalEntryCreate = z.infer<typeof JournalEntryCreateSchema>;

export const JournalEntryPatchSchema = z.object({
  entry_date: z.string().date().optional(),
  description: z.string().max(4000).nullable().optional(),
  source_type: JournalEntrySourceTypeSchema.optional(),
  source_id: UuidSchema.nullable().optional(),
  currency_code: z.string().length(3).optional(),
  lines: z.array(JournalEntryLineInputSchema).min(2).optional(),
}).strict();
export type JournalEntryPatch = z.infer<typeof JournalEntryPatchSchema>;

/** POST /journal-entries/:id/post — empty body (strict). */
export const JournalEntryPostSchema = z.object({}).strict();
export type JournalEntryPost = z.infer<typeof JournalEntryPostSchema>;

/** POST /journal-entries/:id/reverse — optional reversal reason text. */
export const JournalEntryReverseSchema = z.object({
  reason: z.string().min(1).max(2000).optional(),
}).strict();
export type JournalEntryReverse = z.infer<typeof JournalEntryReverseSchema>;

// ============================================================================
// Wave 8d / Phase 13 — Inventory: Warehouses
// ============================================================================
//
// public.warehouses exists in prod from the Wave 0 chassis (0038). UNIQUE
// (org_id, code). is_default at most one true per org enforced handler-side
// (no partial unique index on the table). Address stored as jsonb.

export const WarehouseSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string().min(1).max(64),
  label: z.string().min(1).max(255),
  address: z.record(z.unknown()),
  is_default: z.boolean(),
  is_active: z.boolean(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Warehouse = z.infer<typeof WarehouseSchema>;

export const WarehouseCreateSchema = z.object({
  code: z.string().min(1).max(64),
  label: z.string().min(1).max(255),
  address: z.record(z.unknown()).optional(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
}).strict();
export type WarehouseCreate = z.infer<typeof WarehouseCreateSchema>;

export const WarehousePatchSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(255).optional(),
  address: z.record(z.unknown()).optional(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
}).strict();
export type WarehousePatch = z.infer<typeof WarehousePatchSchema>;

// ============================================================================
// R-W8F-OBS-02/03 — Optional expand-embed mini schemas
// ============================================================================
//
// Compact projections of items + projects used as the embedded shape when
// callers pass ?expand=item or ?expand=project on the ops-api / inventory-api
// detail GETs. Keep these minimal — they exist to let detail pages render a
// human-readable label without a second client-side fetch, not to mirror the
// full row. Adding fields here is a wire-shape change; review on both sides.

export const ItemMiniSchema = z.object({
  id: UuidSchema,
  item_code: z.string(),
  description: z.string(),
  item_kind: ItemKindSchema,
});
export type ItemMini = z.infer<typeof ItemMiniSchema>;

export const ProjectMiniSchema = z.object({
  id: UuidSchema,
  project_number: z.string(),
  name: z.string(),
  status: ProjectStateSchema,
});
export type ProjectMini = z.infer<typeof ProjectMiniSchema>;

// ============================================================================
// Wave 8d / Phase 13 — Inventory: Stock Levels
// ============================================================================
//
// public.stock_levels exists in prod from the Wave 0 chassis (0038). UNIQUE
// (item_id, warehouse_id). quantity_available is a GENERATED column
// (quantity_on_hand - quantity_reserved) — never written by handlers.
// READ-ONLY surface; writes flow through stock_movements + recompute trigger.

export const StockLevelSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  item_id: UuidSchema,
  warehouse_id: UuidSchema,
  quantity_on_hand: z.union([z.string(), z.number()]),
  quantity_reserved: z.union([z.string(), z.number()]),
  quantity_available: z.union([z.string(), z.number()]),
  last_counted_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  // R-W8F-OBS-02 — populated when caller passes ?expand=item.
  item: ItemMiniSchema.nullable().optional(),
});
export type StockLevel = z.infer<typeof StockLevelSchema>;

// ============================================================================
// Wave 8d / Phase 13 — Inventory: Stock Movements
// ============================================================================
//
// public.stock_movements exists from 0038. movement_type text CHECK 7 values;
// reference_type text CHECK 5 values. RLS is SELECT-only for authenticated —
// writes flow through the service-role boundary (admin client). Append-only:
// no UPDATE / DELETE policies. The recompute trigger keeps stock_levels.

export const StockMovementTypeSchema = z.enum([
  'receipt',
  'shipment',
  'adjustment',
  'transfer_in',
  'transfer_out',
  'consumption',
  'return',
]);
export type StockMovementType = z.infer<typeof StockMovementTypeSchema>;

export const StockMovementReferenceTypeSchema = z.enum([
  'receiving_order',
  'shipment',
  'production_consumption',
  'purchase_order',
  'manual',
]);
export type StockMovementReferenceType = z.infer<typeof StockMovementReferenceTypeSchema>;

export const StockMovementSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  item_id: UuidSchema,
  warehouse_id: UuidSchema,
  movement_type: StockMovementTypeSchema,
  quantity: z.union([z.string(), z.number()]),
  unit_cost_cents: CentsSchema,
  reference_type: StockMovementReferenceTypeSchema.nullable(),
  reference_id: UuidSchema.nullable(),
  notes: z.string().nullable(),
  occurred_at: TimestampSchema,
  created_at: TimestampSchema,
  created_by: UuidSchema.nullable(),
});
export type StockMovement = z.infer<typeof StockMovementSchema>;

/**
 * POST /stock-movements/adjustment — manual sign-bearing adjustment.
 * `quantity_delta` may be negative (decrease) or positive (increase).
 * The handler INSERTs a stock_movements row with movement_type='adjustment'
 * and reference_type='manual'; the recompute trigger updates stock_levels.
 */
export const StockMovementAdjustmentSchema = z.object({
  item_id: UuidSchema,
  warehouse_id: UuidSchema,
  quantity_delta: z.number(),
  unit_cost_cents: z.number().int().nonnegative().optional(),
  notes: z.string().max(2000).nullable().optional(),
  occurred_at: TimestampSchema.optional(),
}).strict().refine((v) => v.quantity_delta !== 0, {
  message: 'quantity_delta must be non-zero',
});
export type StockMovementAdjustment = z.infer<typeof StockMovementAdjustmentSchema>;

// ============================================================================
// Wave 8d / Phase 13 — Receiving Orders (ops-api)
// ============================================================================
//
// public.receiving_orders exists in prod from 0003. status is the
// `receiving_order_state` pg enum (4 values). source is the `bom_source`
// pg enum but the column CHECK restricts to ('customer_supplied','t1_purchase')
// — from_inventory items don't get ROs. ro_number text UNIQUE — yielded by
// next_doc_number(org, 'receiving_order').

export const ReceivingOrderStateSchema = z.enum([
  'open', 'partial', 'received', 'cancelled',
]);
export type ReceivingOrderStateZ = z.infer<typeof ReceivingOrderStateSchema>;

export const ReceivingOrderSourceSchema = z.enum([
  'customer_supplied', 't1_purchase',
]);
export type ReceivingOrderSource = z.infer<typeof ReceivingOrderSourceSchema>;

export const ReceivingOrderSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  ro_number: z.string(),
  project_id: UuidSchema,
  bom_item_id: UuidSchema.nullable(),
  source: ReceivingOrderSourceSchema,
  status: ReceivingOrderStateSchema,
  expected_qty: z.union([z.string(), z.number()]),
  received_qty: z.union([z.string(), z.number()]),
  pallets_in: z.number().int().nullable(),
  vendor: z.string().nullable(),
  expected_at: TimestampSchema.nullable(),
  notes: z.string().nullable(),
  received_at: TimestampSchema.nullable(),
  cancelled_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  // R-W8F-OBS-03 — populated when caller passes ?expand=project.
  project: ProjectMiniSchema.nullable().optional(),
});
export type ReceivingOrder = z.infer<typeof ReceivingOrderSchema>;

export const ReceivingOrderCreateSchema = z.object({
  project_id: UuidSchema,
  bom_item_id: UuidSchema.nullable().optional(),
  source: ReceivingOrderSourceSchema,
  expected_qty: z.number().positive(),
  pallets_in: z.number().int().nonnegative().nullable().optional(),
  vendor: z.string().max(255).nullable().optional(),
  expected_at: TimestampSchema.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
}).strict();
export type ReceivingOrderCreate = z.infer<typeof ReceivingOrderCreateSchema>;

export const ReceivingOrderPatchSchema = z.object({
  bom_item_id: UuidSchema.nullable().optional(),
  source: ReceivingOrderSourceSchema.optional(),
  expected_qty: z.number().positive().optional(),
  pallets_in: z.number().int().nonnegative().nullable().optional(),
  vendor: z.string().max(255).nullable().optional(),
  expected_at: TimestampSchema.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
}).strict();
export type ReceivingOrderPatch = z.infer<typeof ReceivingOrderPatchSchema>;

/**
 * POST /receiving-orders/:id/receive — body carries the absolute
 * cumulative received quantity (NOT a delta). If received_qty < expected_qty
 * the handler transitions status to `partial`; if >= it transitions to
 * `received` and stamps received_at.
 */
export const ReceivingOrderReceiveSchema = z.object({
  received_qty: z.number().nonnegative(),
  notes: z.string().max(4000).nullable().optional(),
}).strict();
export type ReceivingOrderReceive = z.infer<typeof ReceivingOrderReceiveSchema>;

// ============================================================================
// Wave 8d / Phase 13 — Production Runs (ops-api)
// ============================================================================
//
// public.production_runs exists in prod from 0004. status is the
// `production_run_state` pg enum (4 values). UNIQUE INDEX
// uniq_active_run_per_project — at most one non-terminal run per project.
// run_number text UNIQUE — yielded by next_doc_number(org, 'production_run').

export const ProductionRunStateSchema = z.enum([
  'scheduled', 'in_progress', 'completed', 'cancelled',
]);
export type ProductionRunStateZ = z.infer<typeof ProductionRunStateSchema>;

export const ProductionRunSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  run_number: z.string(),
  project_id: UuidSchema,
  status: ProductionRunStateSchema,
  scheduled_for: TimestampSchema.nullable(),
  started_at: TimestampSchema.nullable(),
  completed_at: TimestampSchema.nullable(),
  cancelled_at: TimestampSchema.nullable(),
  qty_target: z.union([z.string(), z.number()]),
  notes: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  // R-W8F-OBS-03 — populated when caller passes ?expand=project.
  project: ProjectMiniSchema.nullable().optional(),
});
export type ProductionRun = z.infer<typeof ProductionRunSchema>;

export const ProductionRunCreateSchema = z.object({
  project_id: UuidSchema,
  qty_target: z.number().positive(),
  scheduled_for: TimestampSchema.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
}).strict();
export type ProductionRunCreate = z.infer<typeof ProductionRunCreateSchema>;

export const ProductionRunPatchSchema = z.object({
  qty_target: z.number().positive().optional(),
  scheduled_for: TimestampSchema.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
}).strict();
export type ProductionRunPatch = z.infer<typeof ProductionRunPatchSchema>;

// ============================================================================
// Wave 8d / Phase 13 — Shipments (ops-api)
// ============================================================================
//
// public.shipments exists from 0005. status is the `shipment_state` pg enum
// (4 values). UNIQUE INDEX uniq_active_shipment_per_project — at most one
// non-terminal shipment per project. shipment_number text UNIQUE — yielded
// by next_doc_number(org, 'shipment'). carrier_name NOT NULL with btrim>0.

export const ShipmentStateSchema = z.enum([
  'scheduled', 'loading', 'shipped', 'cancelled',
]);
export type ShipmentStateZ = z.infer<typeof ShipmentStateSchema>;

export const ShipmentSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  shipment_number: z.string(),
  project_id: UuidSchema,
  status: ShipmentStateSchema,
  qty_shipped: z.union([z.string(), z.number()]),
  carrier_name: z.string(),
  tracking_number: z.string().nullable(),
  scheduled_pickup_at: TimestampSchema.nullable(),
  loading_started_at: TimestampSchema.nullable(),
  shipped_at: TimestampSchema.nullable(),
  cancelled_at: TimestampSchema.nullable(),
  cancellation_reason: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  // R-W8F-OBS-03 — populated when caller passes ?expand=project.
  project: ProjectMiniSchema.nullable().optional(),
});
export type Shipment = z.infer<typeof ShipmentSchema>;

export const ShipmentCreateSchema = z.object({
  project_id: UuidSchema,
  qty_shipped: z.number().positive(),
  carrier_name: z.string().min(1).max(255),
  tracking_number: z.string().max(255).nullable().optional(),
  scheduled_pickup_at: TimestampSchema.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
}).strict();
export type ShipmentCreate = z.infer<typeof ShipmentCreateSchema>;

export const ShipmentPatchSchema = z.object({
  qty_shipped: z.number().positive().optional(),
  carrier_name: z.string().min(1).max(255).optional(),
  tracking_number: z.string().max(255).nullable().optional(),
  scheduled_pickup_at: TimestampSchema.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
}).strict();
export type ShipmentPatch = z.infer<typeof ShipmentPatchSchema>;

/** POST /shipments/:id/cancel — body carries an optional cancellation reason. */
export const ShipmentCancelSchema = z.object({
  cancellation_reason: z.string().min(1).max(2000).optional(),
}).strict();
export type ShipmentCancel = z.infer<typeof ShipmentCancelSchema>;

// ============================================================================
// Wave 8e / Phase 18 — Period close + financial reports.
// ============================================================================
//
// public.period_close lives on prod from migration 0062. status uses the
// `period_close_state` pg enum (open / in_review / closed / reopened).
// The /close + /reopen endpoints invoke dedicated RPCs (close_period,
// reopen_period); the state-stamp PATCH only handles open ↔ in_review.

export const PeriodCloseStateSchema = z.enum([
  'open', 'in_review', 'closed', 'reopened',
]);
export type PeriodCloseStateZ = z.infer<typeof PeriodCloseStateSchema>;

export const PeriodCloseSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  period_start: z.string().date(),
  period_end: z.string().date(),
  status: PeriodCloseStateSchema,
  closed_at: TimestampSchema.nullable(),
  closed_by_user_id: UuidSchema.nullable(),
  reopened_at: TimestampSchema.nullable(),
  reopened_by_user_id: UuidSchema.nullable(),
  notes: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type PeriodClose = z.infer<typeof PeriodCloseSchema>;

/** POST /period-closes — open a new period_close row at status='open'. */
export const PeriodCloseCreateInputSchema = z.object({
  period_start: z.string().date(),
  period_end: z.string().date(),
  notes: z.string().max(4000).nullable().optional(),
}).strict();
export type PeriodCloseCreateInput = z.infer<typeof PeriodCloseCreateInputSchema>;

/** PATCH /period-closes/:id — state stamp (open <-> in_review) + notes. */
export const PeriodClosePatchInputSchema = z.object({
  status: z.enum(['open', 'in_review']).optional(),
  notes: z.string().max(4000).nullable().optional(),
}).strict();
export type PeriodClosePatchInput = z.infer<typeof PeriodClosePatchInputSchema>;

/** POST /period-closes/:id/close — body carries optional close notes. */
export const PeriodCloseClosePayloadSchema = z.object({
  notes: z.string().max(4000).nullable().optional(),
}).strict();
export type PeriodCloseClosePayload = z.infer<typeof PeriodCloseClosePayloadSchema>;

/** POST /period-closes/:id/reopen — reason REQUIRED for audit. */
export const PeriodCloseReopenPayloadSchema = z.object({
  reason: z.string().min(1).max(2000),
}).strict();
export type PeriodCloseReopenPayload = z.infer<typeof PeriodCloseReopenPayloadSchema>;

// ---- Reports: query inputs ----

export const TrialBalanceQuerySchema = z.object({
  as_of: z.string().date(),
  currency: z.string().min(3).max(3).default('USD'),
}).strict();
export type TrialBalanceQuery = z.infer<typeof TrialBalanceQuerySchema>;

export const ProfitLossQuerySchema = z.object({
  start: z.string().date(),
  end: z.string().date(),
  currency: z.string().min(3).max(3).default('USD'),
}).strict();
export type ProfitLossQuery = z.infer<typeof ProfitLossQuerySchema>;

export const BalanceSheetQuerySchema = z.object({
  as_of: z.string().date(),
  currency: z.string().min(3).max(3).default('USD'),
}).strict();
export type BalanceSheetQuery = z.infer<typeof BalanceSheetQuerySchema>;

// ---- Reports: row outputs ----

export const TrialBalanceRowSchema = z.object({
  account_id: UuidSchema,
  account_code: z.string(),
  account_name: z.string(),
  account_type: z.string(),
  debit_total_cents: z.number().int(),
  credit_total_cents: z.number().int(),
  balance_cents: z.number().int(),
});
export type TrialBalanceRow = z.infer<typeof TrialBalanceRowSchema>;

export const TrialBalanceReportSchema = z.object({
  as_of: z.string().date(),
  currency: z.string(),
  rows: z.array(TrialBalanceRowSchema),
  total_debit_cents: z.number().int(),
  total_credit_cents: z.number().int(),
  is_balanced: z.boolean(),
});
export type TrialBalanceReport = z.infer<typeof TrialBalanceReportSchema>;

export const ProfitLossRowSchema = z.object({
  account_id: UuidSchema.nullable(),
  account_code: z.string(),
  account_name: z.string(),
  account_type: z.string(),
  revenue_cents: z.number().int(),
  expense_cents: z.number().int(),
  net_income_cents: z.number().int(),
  is_total: z.boolean(),
});
export type ProfitLossRow = z.infer<typeof ProfitLossRowSchema>;

export const ProfitLossReportSchema = z.object({
  period_start: z.string().date(),
  period_end: z.string().date(),
  currency: z.string(),
  rows: z.array(ProfitLossRowSchema),
  total_revenue_cents: z.number().int(),
  total_expense_cents: z.number().int(),
  net_income_cents: z.number().int(),
});
export type ProfitLossReport = z.infer<typeof ProfitLossReportSchema>;

export const BalanceSheetRowSchema = z.object({
  account_id: UuidSchema.nullable(),
  account_code: z.string(),
  account_name: z.string(),
  account_type: z.string(),
  balance_cents: z.number().int(),
  is_total: z.boolean(),
});
export type BalanceSheetRow = z.infer<typeof BalanceSheetRowSchema>;

export const BalanceSheetReportSchema = z.object({
  as_of: z.string().date(),
  currency: z.string(),
  rows: z.array(BalanceSheetRowSchema),
  total_assets_cents: z.number().int(),
  total_liabilities_cents: z.number().int(),
  total_equity_cents: z.number().int(),
  retained_earnings_cents: z.number().int(),
  is_balanced: z.boolean(),
});
export type BalanceSheetReport = z.infer<typeof BalanceSheetReportSchema>;

// =========================================================================
// Wave 10 / Phase 18 polish — extended reports + dashboard KPIs.
// Wave10-A1 owns this block. SECURITY DEFINER RPCs ar_aging,
// sales_by_customer, sales_by_item, cash_position, expense_by_category
// ship in migration 0067 (Agent A3). Wire envelopes mirror the Wave 8e
// {trial-balance, profit-loss, balance-sheet} shape: `{ ok: true, data:
// { ...filters, rows, totals } }`.
// =========================================================================

// ---- AR aging report ----

export const ArAgingQuerySchema = z.object({
  as_of: z.string().date(),
  currency: z.string().min(3).max(3).default('USD'),
}).strict();
export type ArAgingQuery = z.infer<typeof ArAgingQuerySchema>;

export const ArAgingRowSchema = z.object({
  customer_id: UuidSchema,
  customer_name: z.string(),
  current_cents: z.number().int(),
  days_1_30_cents: z.number().int(),
  days_31_60_cents: z.number().int(),
  days_61_90_cents: z.number().int(),
  days_over_90_cents: z.number().int(),
  total_cents: z.number().int(),
});
export type ArAgingRow = z.infer<typeof ArAgingRowSchema>;

export const ArAgingReportSchema = z.object({
  as_of: z.string().date(),
  currency: z.string(),
  rows: z.array(ArAgingRowSchema),
  total_current_cents: z.number().int(),
  total_days_1_30_cents: z.number().int(),
  total_days_31_60_cents: z.number().int(),
  total_days_61_90_cents: z.number().int(),
  total_days_over_90_cents: z.number().int(),
  total_outstanding_cents: z.number().int(),
});
export type ArAgingReport = z.infer<typeof ArAgingReportSchema>;

// ---- Sales-by-customer report ----

export const SalesByCustomerQuerySchema = z.object({
  start: z.string().date(),
  end: z.string().date(),
  currency: z.string().min(3).max(3).default('USD'),
}).strict();
export type SalesByCustomerQuery = z.infer<typeof SalesByCustomerQuerySchema>;

export const SalesByCustomerRowSchema = z.object({
  customer_id: UuidSchema,
  customer_name: z.string(),
  invoice_count: z.number().int(),
  subtotal_cents: z.number().int(),
  tax_cents: z.number().int(),
  total_cents: z.number().int(),
});
export type SalesByCustomerRow = z.infer<typeof SalesByCustomerRowSchema>;

export const SalesByCustomerReportSchema = z.object({
  period_start: z.string().date(),
  period_end: z.string().date(),
  currency: z.string(),
  rows: z.array(SalesByCustomerRowSchema),
  total_invoice_count: z.number().int(),
  total_subtotal_cents: z.number().int(),
  total_tax_cents: z.number().int(),
  total_sales_cents: z.number().int(),
});
export type SalesByCustomerReport = z.infer<typeof SalesByCustomerReportSchema>;

// ---- Sales-by-item report ----

export const SalesByItemQuerySchema = z.object({
  start: z.string().date(),
  end: z.string().date(),
  currency: z.string().min(3).max(3).default('USD'),
}).strict();
export type SalesByItemQuery = z.infer<typeof SalesByItemQuerySchema>;

export const SalesByItemRowSchema = z.object({
  item_id: UuidSchema.nullable(),
  item_code: z.string().nullable(),
  item_name: z.string(),
  quantity: z.number(),
  subtotal_cents: z.number().int(),
  total_cents: z.number().int(),
});
export type SalesByItemRow = z.infer<typeof SalesByItemRowSchema>;

export const SalesByItemReportSchema = z.object({
  period_start: z.string().date(),
  period_end: z.string().date(),
  currency: z.string(),
  rows: z.array(SalesByItemRowSchema),
  total_quantity: z.number(),
  total_subtotal_cents: z.number().int(),
  total_sales_cents: z.number().int(),
});
export type SalesByItemReport = z.infer<typeof SalesByItemReportSchema>;

// ---- Cash-position report ----

export const CashPositionQuerySchema = z.object({
  as_of: z.string().date(),
  currency: z.string().min(3).max(3).default('USD'),
}).strict();
export type CashPositionQuery = z.infer<typeof CashPositionQuerySchema>;

export const CashPositionRowSchema = z.object({
  account_id: UuidSchema,
  account_code: z.string(),
  account_name: z.string(),
  balance_cents: z.number().int(),
});
export type CashPositionRow = z.infer<typeof CashPositionRowSchema>;

export const CashPositionReportSchema = z.object({
  as_of: z.string().date(),
  currency: z.string(),
  rows: z.array(CashPositionRowSchema),
  total_cash_cents: z.number().int(),
});
export type CashPositionReport = z.infer<typeof CashPositionReportSchema>;

// ---- Expense-by-category report ----

export const ExpenseByCategoryQuerySchema = z.object({
  start: z.string().date(),
  end: z.string().date(),
  currency: z.string().min(3).max(3).default('USD'),
}).strict();
export type ExpenseByCategoryQuery = z.infer<typeof ExpenseByCategoryQuerySchema>;

export const ExpenseByCategoryRowSchema = z.object({
  category_id: UuidSchema.nullable(),
  category_name: z.string(),
  expense_count: z.number().int(),
  total_cents: z.number().int(),
});
export type ExpenseByCategoryRow = z.infer<typeof ExpenseByCategoryRowSchema>;

export const ExpenseByCategoryReportSchema = z.object({
  period_start: z.string().date(),
  period_end: z.string().date(),
  currency: z.string(),
  rows: z.array(ExpenseByCategoryRowSchema),
  total_expense_count: z.number().int(),
  total_expenses_cents: z.number().int(),
});
export type ExpenseByCategoryReport = z.infer<typeof ExpenseByCategoryReportSchema>;

// ---- Dashboard summary (Wave 10) ----

export const DashboardArAgingSummarySchema = z.object({
  current_cents: z.number().int(),
  days_1_30_cents: z.number().int(),
  days_31_60_cents: z.number().int(),
  days_61_90_cents: z.number().int(),
  days_over_90_cents: z.number().int(),
});
export type DashboardArAgingSummary = z.infer<typeof DashboardArAgingSummarySchema>;

export const DashboardSummarySchema = z.object({
  as_of: z.string().date(),
  currency: z.string(),
  period_start: z.string().date(),
  period_end: z.string().date(),
  ar_aging_summary: DashboardArAgingSummarySchema,
  cash_on_hand_cents: z.number().int(),
  mtd_revenue_cents: z.number().int(),
  mtd_expense_cents: z.number().int(),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

// =========================================================================
// End Wave 10 / Phase 18 polish block.
// =========================================================================
