/**
 * Real capability matrix — closes F-Wave4-08 (carry from F-Wave3-03 carry from
 * F-Wave2-03). Each `requireCap(caller, cap)` call site in every edge bundle
 * resolves through this single source of truth.
 *
 * Design notes:
 *
 * 1. **Caps enumerate the API surface, not the database.** A cap like
 *    `crm.customers.write` says "this caller is allowed to invoke a write
 *    endpoint on the customers resource"; it does NOT bypass RLS. Every
 *    handler still combines its query with explicit `.eq('org_id', caller.orgId)`
 *    per Pattern A in TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §2.3.
 *
 * 2. **The matrix is computed from rules** so a new cap entry doesn't require
 *    editing every role's set. `allow(role, cap)` encodes the role-membership
 *    policy; `RoleCapabilities[role]` is the materialized Set used by `can()`.
 *
 * 3. **Backwards-compat with the Wave 3 role stop-gap.** Every cap that today's
 *    handlers reference resolves the same allow/deny for every role as the
 *    previous bundle-local `requireCap` did. The matrix only diverges by
 *    accepting Wave 4 caps the previous stop-gap had no opinion on
 *    (`quotes.*`, `projects.*`).
 *
 * 4. **Future caps are pre-declared.** Phase 7 invoicing, Phase 8 payments,
 *    Phase 10 procurement, Phase 11 expenses, Phase 12 GL, Phase 15 settings
 *    caps are all enumerated here so new bundles call `requireCap` without
 *    needing to amend the matrix. Their role policy follows the same rule
 *    table as today's caps.
 *
 * Wave / phase boundary: do NOT remove a cap from this enum. If a cap stops
 * being used by handlers, leave it; clients import `Capability` for typing.
 */

import type { Role } from './types.ts';

/**
 * Closed enum of all capabilities the application gates on. Adding a cap is
 * a one-line addition here; the role policy in `allow()` decides who gets it.
 *
 * Naming: `<domain>.<resource>.<action>` with action one of
 * `read | write | approve | convert | send | close | void | cancel | post | reverse | refund | issue | apply | submit | invite | role_change`.
 */
export const ALL_CAPABILITIES = [
  // ---- CRM (Wave 2 + Wave 3 carry) ----
  'crm.customers.read',
  'crm.customers.write',
  'crm.contacts.read',
  'crm.contacts.write',
  'crm.leads.read',
  'crm.leads.write',
  'crm.leads.convert',
  'crm.opportunities.read',
  'crm.opportunities.write',
  'crm.activities.read',
  'crm.activities.write',

  // ---- Finance / reference (Wave 3) ----
  'finance.currencies.read',
  'finance.currencies.write',
  'finance.taxes.read',
  'finance.taxes.write',
  'finance.payment_methods.read',
  'finance.payment_methods.write',
  'finance.exchange_rates.read',
  'finance.exchange_rates.write',

  // ---- Inventory (Wave 3) ----
  'inventory.items.read',
  'inventory.items.write',
  'inventory.item_categories.read',
  'inventory.item_categories.write',
  'inventory.units.read',
  'inventory.units.write',
  'inventory.warehouses.read',
  'inventory.warehouses.write',
  'inventory.stock.read',
  'inventory.stock.write',

  // ---- Quoting (Wave 4 / Phase 4) ----
  'quotes.read',
  'quotes.write',
  'quotes.approve',
  'quotes.send',
  'quotes.convert',

  // ---- Projects (Wave 4 / Phase 5) ----
  'projects.read',
  'projects.write',
  'projects.close',

  // ---- Forward-compat (Phase 7+) ----
  'invoices.read',
  'invoices.write',
  'invoices.send',
  'invoices.void',
  'invoices.refund',
  'invoices.cancel',
  'payments.read',
  'payments.write',
  'payments.void',
  'credit_notes.read',
  'credit_notes.write',
  'credit_notes.issue',
  'credit_notes.apply',
  'expenses.read',
  'expenses.write',
  'expenses.submit',
  'expenses.approve',
  'finance.coa.read',
  'finance.coa.write',
  'finance.journal_entries.read',
  'finance.journal_entries.write',
  'finance.journal_entries.post',
  'finance.journal_entries.reverse',
  'vendors.read',
  'vendors.write',
  'purchase_orders.read',
  'purchase_orders.write',
  'purchase_orders.approve',
  'purchase_orders.receive',
  'purchase_orders.cancel',
  'purchase_orders.send',
  'vendor_bills.read',
  'vendor_bills.write',
  'vendor_bills.approve',
  'vendor_bills.pay',
  'receiving.read',
  'receiving.write',
  'production.read',
  'production.write',
  'shipping.read',
  'shipping.write',
  'org.settings.read',
  'org.settings.write',
  'org.branding.read',
  'org.branding.write',
  'org.feature_flags.read',
  'org.feature_flags.write',
  'org.users.read',
  'org.users.write',
  'org.users.invite',
  'org.users.role_change',
  'org.audit_log.read',
  'attachments.read',
  'attachments.write',
  'comments.read',
  'comments.write',
  'notifications.read',
  'views.saved.read',
  'views.saved.write',
  'dashboard.read',
  'search.global',
  'exports.read',
  'exports.write',
] as const;

export type Capability = (typeof ALL_CAPABILITIES)[number];

const READ_SUFFIX = /\.(read)$/;
const WRITE_FAMILY = /\.(write|approve|convert|send|close|void|cancel|post|reverse|refund|issue|apply|submit|invite|role_change|pay|receive)$/;

/**
 * Role policy. Returns true if `role` is allowed `cap`. The matrix is built
 * by iterating `ALL_CAPABILITIES` and asking this function for each (role, cap)
 * pair. To add a cap, list it in `ALL_CAPABILITIES`; to change a role's reach,
 * edit this function.
 *
 * Behavior parity with the Wave 3 bundle-local `requireCap` stop-gap: every cap
 * a Wave 3 handler called resolves identically here. New caps for Wave 4
 * (quotes.*, projects.*) follow the same rule shape.
 */
function allow(role: Role, cap: Capability): boolean {
  // Owners and admins have full reach.
  if (role === 'org_owner' || role === 'org_admin') return true;

  const isRead = READ_SUFFIX.test(cap);
  const isWriteFamily = WRITE_FAMILY.test(cap);

  switch (role) {
    case 'sales':
      // Sales reaches CRM + quoting fully, reads inventory + finance reference,
      // and can read projects. Phase 4 lights up sales-on-quotes.
      if (cap.startsWith('crm.')) return true;
      if (cap.startsWith('quotes.')) return true;
      if (cap.startsWith('projects.')) return isRead;
      if (cap.startsWith('inventory.')) return isRead;
      if (cap.startsWith('finance.')) return isRead; // sales sees rates/taxes but doesn't edit
      if (cap.startsWith('vendors.')) return isRead;
      if (cap === 'attachments.read' || cap === 'attachments.write') return true;
      if (cap === 'comments.read' || cap === 'comments.write') return true;
      if (cap === 'notifications.read') return true;
      if (cap === 'dashboard.read') return true;
      if (cap === 'search.global') return true;
      if (cap.startsWith('views.saved.')) return true;
      if (cap.startsWith('exports.')) return isRead;
      return false;

    case 'ops':
      // Ops drives inventory, receiving, production, shipping, and project work.
      if (cap.startsWith('inventory.')) return true;
      if (cap.startsWith('projects.')) return true;
      if (cap.startsWith('quotes.')) return isRead;
      if (cap.startsWith('receiving.') || cap.startsWith('production.') || cap.startsWith('shipping.')) return true;
      if (cap.startsWith('purchase_orders.')) return true;
      if (cap.startsWith('vendors.')) return isRead;
      if (cap.startsWith('crm.')) return isRead;
      if (cap.startsWith('finance.')) return isRead;
      if (cap === 'attachments.read' || cap === 'attachments.write') return true;
      if (cap === 'comments.read' || cap === 'comments.write') return true;
      if (cap === 'notifications.read') return true;
      if (cap === 'dashboard.read') return true;
      if (cap === 'search.global') return true;
      if (cap.startsWith('views.saved.')) return true;
      if (cap.startsWith('exports.')) return isRead;
      return false;

    case 'accounting':
      // Accounting drives finance, invoicing, payments, credit notes, GL, expenses, vendor bills.
      if (cap.startsWith('finance.')) return true;
      if (cap.startsWith('invoices.')) return true;
      if (cap.startsWith('payments.')) return true;
      if (cap.startsWith('credit_notes.')) return true;
      if (cap.startsWith('expenses.')) return true;
      if (cap.startsWith('vendor_bills.')) return true;
      if (cap.startsWith('purchase_orders.')) return isRead;
      if (cap.startsWith('vendors.')) return isRead;
      if (cap.startsWith('quotes.')) return isRead;
      if (cap.startsWith('projects.')) return isRead;
      if (cap.startsWith('crm.')) return isRead;
      if (cap.startsWith('inventory.')) return isRead;
      if (cap === 'attachments.read' || cap === 'attachments.write') return true;
      if (cap === 'comments.read' || cap === 'comments.write') return true;
      if (cap === 'notifications.read') return true;
      if (cap === 'dashboard.read') return true;
      if (cap === 'search.global') return true;
      if (cap.startsWith('views.saved.')) return true;
      if (cap.startsWith('exports.')) return true;
      return false;

    case 'viewer':
      // Pure read role across every domain.
      if (cap === 'notifications.read') return true;
      if (cap === 'dashboard.read') return true;
      if (cap === 'search.global') return true;
      if (cap.startsWith('views.saved.')) return isRead;
      return isRead && !isWriteFamily;

    case 'customer_user':
      // Portal user. Reads scoped to own customer_id (Pattern C RLS does the row scope).
      if (cap === 'notifications.read') return true;
      if (cap === 'comments.read' || cap === 'comments.write') return true; // own threads
      if (cap === 'attachments.read') return true;
      if (cap === 'views.saved.read') return true;
      if (cap.startsWith('crm.customers.') && isRead) return true;
      if (cap.startsWith('crm.contacts.') && isRead) return true;
      if (cap.startsWith('quotes.') && isRead) return true;
      if (cap === 'quotes.write') return true; // accept/decline endpoints route through write cap
      if (cap.startsWith('projects.') && isRead) return true;
      if (cap.startsWith('invoices.') && isRead) return true;
      if (cap.startsWith('payments.') && isRead) return true;
      if (cap.startsWith('credit_notes.') && isRead) return true;
      return false;

    default:
      return false;
  }
}

function build(role: Role): Set<Capability> {
  const set = new Set<Capability>();
  for (const cap of ALL_CAPABILITIES) {
    if (allow(role, cap)) set.add(cap);
  }
  return set;
}

export const RoleCapabilities: Record<Role, Set<Capability>> = {
  org_owner: build('org_owner'),
  org_admin: build('org_admin'),
  sales: build('sales'),
  ops: build('ops'),
  accounting: build('accounting'),
  viewer: build('viewer'),
  customer_user: build('customer_user'),
};

export function can(role: Role | null, cap: Capability): boolean {
  if (!role) return false;
  return RoleCapabilities[role].has(cap);
}
