/**
 * Default org feature flags for newly-provisioned organizations (Wave 11C).
 *
 * Closes the second half of R-W11-PROVISION-01: the admin-console-api
 * provisionOrganization handler now seeds an exhaustive set of feature
 * flags so new orgs come up in a known state, instead of having an empty
 * org_feature_flags row-set that forces every feature read through the
 * "absent → false" fallback in feature-flags.ts.
 *
 * Source of truth: introspected against prod 2026-05-16 (`SELECT DISTINCT
 * flag_key FROM org_feature_flags`) — see migration 0074 header. Keep this
 * list in lockstep with any new flag_key that ships in a future wave; the
 * `seed_org_default_flags` migration could replace this in the future, but
 * shipping defaults from the handler keeps the wave-11 PR forward-only
 * without a second migration slot.
 *
 * Policy:
 *   - Standard ERP-tier baseline ON   : finance.* / sales.* / inventory /
 *                                       crm.* / collaboration / ux.*
 *   - Paid plugins OFF                : plugins.3pl / plugins.production /
 *                                       plugins.shipping
 *   - procurement.enabled ON          : included in baseline (Wave 7 ships
 *                                       receiving + POs)
 *
 * DO NOT clone Team1's feature_flags into new orgs — Team1 has plugins
 * enabled that are not in the standard tier (Wave 10 KitStak provisioning
 * intentionally hand-set those).
 */

export const DEFAULT_FEATURE_FLAGS: Record<string, boolean> = {
  // Finance baseline
  'finance.chart_of_accounts': true,
  'finance.expenses': true,
  'finance.taxes': true,
  // Sales baseline
  'sales.invoices': true,
  'sales.credit_notes': true,
  // CRM baseline
  'crm.leads': true,
  'crm.opportunities': true,
  // Inventory + Procurement baseline
  'inventory.enabled': true,
  'procurement.enabled': true,
  // Collaboration + UX
  'collaboration.enabled': true,
  'ux.realtime': true,
  'ux.notifications_email': true,
  'ux.comments': true,
  'ux.saved_views': true,
  // Paid plugins — explicit OFF
  'plugins.3pl': false,
  'plugins.production': false,
  'plugins.shipping': false,
};
