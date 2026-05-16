/**
 * Portal-domain query keys (Phase 21 — Wave 10 Session 4).
 * Used by all customer-portal-api wrappers. Keys are scoped to the
 * caller's role; the AuthContext is the cache boundary on sign-in.
 */
export const portalKeys = {
  all: ['portal'] as const,
  me: () => [...portalKeys.all, 'me'] as const,
  invoices: () => [...portalKeys.all, 'invoices'] as const,
  invoiceList: (filters: Record<string, unknown> = {}) =>
    [...portalKeys.invoices(), 'list', filters] as const,
  invoice: (id: string) => [...portalKeys.invoices(), 'detail', id] as const,
  quotes: () => [...portalKeys.all, 'quotes'] as const,
  quoteList: (filters: Record<string, unknown> = {}) =>
    [...portalKeys.quotes(), 'list', filters] as const,
  quote: (id: string) => [...portalKeys.quotes(), 'detail', id] as const,
  projects: () => [...portalKeys.all, 'projects'] as const,
  projectList: (filters: Record<string, unknown> = {}) =>
    [...portalKeys.projects(), 'list', filters] as const,
  project: (id: string) => [...portalKeys.projects(), 'detail', id] as const,
  payments: () => [...portalKeys.all, 'payments'] as const,
  paymentList: (filters: Record<string, unknown> = {}) =>
    [...portalKeys.payments(), 'list', filters] as const,
  statement: (asOf: string | null, currency: string | null) =>
    [...portalKeys.all, 'statement', asOf, currency] as const,
};
