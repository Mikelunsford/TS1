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
