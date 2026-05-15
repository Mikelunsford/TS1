/**
 * TEMPORARY service stubs for Wave 2 CRM. The Backend agent (Wave 2 Step 3.2)
 * is shipping `leadsService.ts` and `opportunitiesService.ts` on a parallel
 * branch. Until that PR merges and this branch rebases, these stubs let the
 * frontend pages typecheck and run unit tests.
 *
 * TODO(W2): remove this file once Backend's leadsService.ts and
 * opportunitiesService.ts land on main. Pages import from
 * `@/lib/services/leadsService` / `@/lib/services/opportunitiesService` —
 * the real services should expose the same exported names + shapes below.
 *
 * Each function preserves the wire contract from
 * TS1/09-api/00-API-CONTRACT.md §3.3, §3.4 so tests against these stubs
 * remain valid once the real implementations land.
 */
import { apiRequest } from '../../apiClient';
import {
  LeadConvertResponseSchema,
  LeadSchema,
  OpportunitySchema,
  type Lead,
  type LeadConvertRequest,
  type LeadConvertResponse,
  type LeadListFilters,
  type LeadUpdate,
  type Opportunity,
  type OpportunityListFilters,
  type OpportunityStageUpdate,
} from '../../crmTypes';
import { ApiOkSchema } from '../../types';

const LeadListSchema = ApiOkSchema(LeadSchema.array()).shape.data;
const OpportunityListSchema = ApiOkSchema(OpportunitySchema.array()).shape.data;

// =========================================================================
// Leads
// =========================================================================

export async function listLeads(filters: LeadListFilters = {}): Promise<Lead[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return apiRequest({
    method: 'GET',
    path: `/crm-api/leads${qs ? `?${qs}` : ''}`,
    schema: LeadListSchema,
  });
}

export async function getLead(id: string): Promise<Lead> {
  return apiRequest({ method: 'GET', path: `/crm-api/leads/${id}`, schema: LeadSchema });
}

export async function updateLead(args: { id: string } & LeadUpdate): Promise<Lead> {
  const { id, ...body } = args;
  return apiRequest({ method: 'PATCH', path: `/crm-api/leads/${id}`, body, schema: LeadSchema });
}

export async function convertLead(
  args: { id: string } & LeadConvertRequest,
): Promise<LeadConvertResponse> {
  const { id, ...body } = args;
  return apiRequest({
    method: 'POST',
    path: `/crm-api/leads/${id}/convert`,
    body,
    schema: LeadConvertResponseSchema,
  });
}

// =========================================================================
// Opportunities
// =========================================================================

export async function listOpportunities(
  filters: OpportunityListFilters = {},
): Promise<Opportunity[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return apiRequest({
    method: 'GET',
    path: `/crm-api/opportunities${qs ? `?${qs}` : ''}`,
    schema: OpportunityListSchema,
  });
}

export async function getOpportunity(id: string): Promise<Opportunity> {
  return apiRequest({
    method: 'GET',
    path: `/crm-api/opportunities/${id}`,
    schema: OpportunitySchema,
  });
}

export async function updateOpportunityStage(
  args: { id: string } & OpportunityStageUpdate,
): Promise<Opportunity> {
  const { id, stage } = args;
  return apiRequest({
    method: 'PATCH',
    path: `/crm-api/opportunities/${id}/stage`,
    body: { stage },
    schema: OpportunitySchema,
  });
}
