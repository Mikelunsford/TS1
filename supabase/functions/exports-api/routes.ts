/**
 * exports-api — route table.
 *
 * Phase 20 (Wave 10): per-entity CSV streaming endpoints.
 *
 * The 8 "headline" entities from the Phase 20 spec (gated by feature flags
 * where applicable):
 *
 *   vendors                — vendors.read + procurement.enabled
 *   purchase_orders        — purchase_orders.read + procurement.enabled
 *                            ?expand=lines for line-level export
 *   vendor_bills           — vendor_bills.read + procurement.enabled
 *   expenses               — expenses.read + finance.expenses
 *   journal_entries        — finance.journal_entries.read
 *                            ?expand=lines for line-level export
 *   chart_of_accounts      — finance.coa.read + finance.chart_of_accounts
 *   warehouses             — inventory.warehouses.read + inventory.enabled
 *   stock_movements        — inventory.stock.read + inventory.enabled
 *
 * Plus convenience exports so `<ExportButton>` works on every existing list
 * page (customers, items, leads, opportunities, contacts, quotes, projects,
 * invoices, payments, credit_notes, receiving_orders, production_runs,
 * shipments). These reuse the same factory and capability gates as the
 * read endpoints in each domain bundle.
 *
 * Format negotiation: only `?format=csv` is honored today. XLSX and async
 * job queueing are deferred.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import { exportVendors } from './handlers/vendors.ts';
import { exportPurchaseOrders } from './handlers/purchase-orders.ts';
import { exportVendorBills } from './handlers/vendor-bills.ts';
import { exportExpenses } from './handlers/expenses.ts';
import { exportJournalEntries } from './handlers/journal-entries.ts';
import { exportChartOfAccounts } from './handlers/chart-of-accounts.ts';
import { exportWarehouses } from './handlers/warehouses.ts';
import { exportStockMovements } from './handlers/stock-movements.ts';
import {
  exportContacts,
  exportCreditNotes,
  exportCustomers,
  exportInvoices,
  exportItems,
  exportLeads,
  exportOpportunities,
  exportPayments,
  exportProductionRuns,
  exportProjects,
  exportQuotes,
  exportReceivingOrders,
  exportShipments,
} from './handlers/misc.ts';

const BUNDLE = 'exports-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // ----- 8 Phase-20-spec headline entities --------------------------------
  { method: 'GET', path: '/exports/vendors', handler: exportVendors },
  { method: 'GET', path: '/exports/purchase_orders', handler: exportPurchaseOrders },
  { method: 'GET', path: '/exports/vendor_bills', handler: exportVendorBills },
  { method: 'GET', path: '/exports/expenses', handler: exportExpenses },
  { method: 'GET', path: '/exports/journal_entries', handler: exportJournalEntries },
  { method: 'GET', path: '/exports/chart_of_accounts', handler: exportChartOfAccounts },
  { method: 'GET', path: '/exports/warehouses', handler: exportWarehouses },
  { method: 'GET', path: '/exports/stock_movements', handler: exportStockMovements },

  // ----- Convenience exports for every other list page -------------------
  { method: 'GET', path: '/exports/customers', handler: exportCustomers },
  { method: 'GET', path: '/exports/items', handler: exportItems },
  { method: 'GET', path: '/exports/leads', handler: exportLeads },
  { method: 'GET', path: '/exports/opportunities', handler: exportOpportunities },
  { method: 'GET', path: '/exports/contacts', handler: exportContacts },
  { method: 'GET', path: '/exports/quotes', handler: exportQuotes },
  { method: 'GET', path: '/exports/projects', handler: exportProjects },
  { method: 'GET', path: '/exports/invoices', handler: exportInvoices },
  { method: 'GET', path: '/exports/payments', handler: exportPayments },
  { method: 'GET', path: '/exports/credit_notes', handler: exportCreditNotes },
  { method: 'GET', path: '/exports/receiving_orders', handler: exportReceivingOrders },
  { method: 'GET', path: '/exports/production_runs', handler: exportProductionRuns },
  { method: 'GET', path: '/exports/shipments', handler: exportShipments },
];
