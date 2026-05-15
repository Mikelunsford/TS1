/**
 * Opportunities service shim. See `leadsService.ts` header for the rationale.
 *
 * TODO(W2): replace re-exports with real impl after Backend lands.
 */
export {
  listOpportunities,
  getOpportunity,
  updateOpportunityStage,
} from './__stubs__/crm';
