/**
 * crm-api — request/response Zod re-exports.
 *
 * The single source of truth for these schemas is
 * `../_shared/types.ts`, mirrored byte-for-byte into
 * `apps/web/src/lib/types.ts`. This file just re-exports the
 * crm-api-specific names so handler imports stay terse.
 *
 * See TS1/09-api/00-API-CONTRACT.md §3 (CRM entities).
 */

export {
  AddressSchema,
  CustomerKindSchema,
  CustomerCreateSchema,
  CustomerPatchSchema,
  CustomerSchema,
  ContactUpsertSchema,
  ContactSchema,
  LeadCreateSchema,
  LeadPatchSchema,
  LeadConvertSchema,
  LeadSchema,
  LeadSourceSchema,
  LeadStatusSchema,
  OpportunityCreateSchema,
  OpportunityPatchSchema,
  OpportunityStageSchema,
  OpportunityStageUpdateSchema,
  OpportunitySchema,
  ActivityCreateSchema,
  ActivityPatchSchema,
  ActivityKindSchema,
  ActivityEntityTypeSchema,
  ActivitySchema,
  ListMetaSchema,
} from '../_shared/types.ts';
