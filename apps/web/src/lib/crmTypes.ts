/**
 * CRM (Wave 2) Zod schemas + inferred types.
 *
 * These live OUT of `lib/types.ts` deliberately: that file is byte-mirrored
 * to `supabase/functions/_shared/types.ts` by the contract parity test, and
 * the Backend agent owns the wire-side mirror. Once Backend PR lands these
 * shapes in `_shared/types.ts`, we can fold this file back into `lib/types.ts`
 * (or just re-export). Keeping them split avoids tight coupling across the
 * two parallel-dispatched PRs.
 *
 * See TS1/09-api/00-API-CONTRACT.md §3.3 (leads), §3.4 (opportunities).
 * Stage / status enums match migration 0032's CHECK constraints.
 */
import { z } from 'zod';

import { CentsSchema, TimestampSchema, UuidSchema } from './types';

// =========================================================================
// Leads
// =========================================================================

export const LeadStatusSchema = z.enum([
  'new',
  'contacted',
  'qualified',
  'disqualified',
  'converted',
]);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const LEAD_STATUS_VALUES: readonly LeadStatus[] = [
  'new',
  'contacted',
  'qualified',
  'disqualified',
  'converted',
] as const;

export const LeadSourceSchema = z.enum([
  'inbound',
  'outbound',
  'referral',
  'event',
  'import',
  'other',
]);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

export const LeadSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  display_name: z.string().min(1).max(200),
  status: LeadStatusSchema,
  source: LeadSourceSchema,
  primary_email: z.string().email().nullable(),
  primary_phone: z.string().max(64).nullable(),
  assigned_to: UuidSchema.nullable(),
  notes: z.string().nullable(),
  converted_opportunity_id: UuidSchema.nullable(),
  converted_customer_id: UuidSchema.nullable(),
  converted_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Lead = z.infer<typeof LeadSchema>;

export const LeadUpdateSchema = z.object({
  display_name: z.string().min(1).max(200).optional(),
  status: LeadStatusSchema.optional(),
  source: LeadSourceSchema.optional(),
  primary_email: z.string().email().nullable().optional(),
  primary_phone: z.string().max(64).nullable().optional(),
  assigned_to: UuidSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type LeadUpdate = z.infer<typeof LeadUpdateSchema>;

export const LeadConvertRequestSchema = z.object({
  opportunity_name: z.string().min(1).max(200),
  amount_cents: CentsSchema,
  currency_code: z.string().length(3),
  create_customer: z.boolean(),
});
export type LeadConvertRequest = z.infer<typeof LeadConvertRequestSchema>;

export const LeadConvertResponseSchema = z.object({
  lead_id: UuidSchema,
  opportunity_id: UuidSchema,
  opportunity_number: z.string(),
  customer_id: UuidSchema.nullable(),
});
export type LeadConvertResponse = z.infer<typeof LeadConvertResponseSchema>;

export const LeadListFiltersSchema = z.object({
  status: LeadStatusSchema.optional(),
  source: LeadSourceSchema.optional(),
  assigned_to: UuidSchema.optional(),
  q: z.string().optional(),
});
export type LeadListFilters = z.infer<typeof LeadListFiltersSchema>;

// =========================================================================
// Opportunities
// =========================================================================

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

export const OPPORTUNITY_STAGE_VALUES: readonly OpportunityStage[] = [
  'prospect',
  'discovery',
  'proposal',
  'negotiation',
  'won',
  'lost',
  'abandoned',
] as const;

export const OpportunitySchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  customer_id: UuidSchema.nullable(),
  lead_id: UuidSchema.nullable(),
  display_name: z.string().min(1).max(200),
  stage: OpportunityStageSchema,
  amount_cents: CentsSchema,
  currency_code: z.string().length(3),
  probability_pct: z.number().int().min(0).max(100),
  expected_close_date: z.string().nullable(),
  assigned_to: UuidSchema.nullable(),
  opportunity_number: z.string(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

export const OpportunityStageUpdateSchema = z.object({
  stage: OpportunityStageSchema,
});
export type OpportunityStageUpdate = z.infer<typeof OpportunityStageUpdateSchema>;

export const OpportunityListFiltersSchema = z.object({
  stage: OpportunityStageSchema.optional(),
  assigned_to: UuidSchema.optional(),
  q: z.string().optional(),
});
export type OpportunityListFilters = z.infer<typeof OpportunityListFiltersSchema>;
