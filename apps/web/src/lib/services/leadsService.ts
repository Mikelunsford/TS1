/**
 * Leads service shim. Wave 2 frontend ships before Backend's leadsService
 * lands; this file re-exports stub implementations so the pages import from a
 * stable canonical path. See `__stubs__/crm.ts`.
 *
 * TODO(W2): once Backend's PR adds the real implementation, replace this
 * re-export with the real impl in this file. Pages should not need to change.
 */
export { listLeads, getLead, updateLead, convertLead } from './__stubs__/crm';
