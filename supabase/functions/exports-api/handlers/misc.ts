/**
 * exports-api — minimal CSV streams for the remaining entities not in the
 * Phase 20 "8 new entity" spec (customers, items, leads, opportunities,
 * contacts, quotes, projects, invoices, payments, credit_notes,
 * receiving_orders, production_runs, shipments).
 *
 * These exist so the `<ExportButton>` component renders working downloads on
 * every list page; the column projections are intentionally pragmatic (top-
 * level scalars only — no nested addresses or lines). Phase-21-and-later
 * waves may extend with per-entity columnar exports.
 */
import { makeExportHandler } from './_factory.ts';

interface CustomerRow {
  id: string;
  org_id: string;
  display_name: string;
  client_type: string;
  client_status: string;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  currency_code: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export const exportCustomers = makeExportHandler<CustomerRow>({
  slug: 'customers',
  table: 'customers',
  cols:
    'id, org_id, display_name, client_type, client_status, email, phone, tax_id, ' +
    'currency_code, is_archived, created_at, updated_at',
  headers: [
    'id',
    'display_name',
    'client_type',
    'client_status',
    'email',
    'phone',
    'tax_id',
    'currency_code',
    'is_archived',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.display_name,
    r.client_type,
    r.client_status,
    r.email,
    r.phone,
    r.tax_id,
    r.currency_code,
    r.is_archived,
    r.created_at,
    r.updated_at,
  ],
  cap: 'crm.customers.read',
});

interface ItemRow {
  id: string;
  org_id: string;
  item_code: string;
  description: string;
  item_kind: string;
  unit_price_cents: number | string | null;
  unit_cost_cents: number | string | null;
  currency_code: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const exportItems = makeExportHandler<ItemRow>({
  slug: 'items',
  table: 'items',
  cols:
    'id, org_id, item_code, description, item_kind, unit_price_cents, unit_cost_cents, ' +
    'currency_code, is_active, created_at, updated_at',
  headers: [
    'id',
    'item_code',
    'description',
    'item_kind',
    'unit_price_cents',
    'unit_cost_cents',
    'currency_code',
    'is_active',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.item_code,
    r.description,
    r.item_kind,
    r.unit_price_cents,
    r.unit_cost_cents,
    r.currency_code,
    r.is_active,
    r.created_at,
    r.updated_at,
  ],
  cap: 'inventory.items.read',
  // items table has no deleted_at — uses is_active for archive.
  skipSoftDeleteFilter: true,
});

interface LeadRow {
  id: string;
  org_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  lead_source: string | null;
  status: string;
  est_value_cents: number | string | null;
  currency_code: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export const exportLeads = makeExportHandler<LeadRow>({
  slug: 'leads',
  table: 'leads',
  cols:
    'id, org_id, display_name, email, phone, company_name, lead_source, status, ' +
    'est_value_cents, currency_code, assigned_to, created_at, updated_at',
  headers: [
    'id',
    'display_name',
    'email',
    'phone',
    'company_name',
    'lead_source',
    'status',
    'est_value_cents',
    'currency_code',
    'assigned_to',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.display_name,
    r.email,
    r.phone,
    r.company_name,
    r.lead_source,
    r.status,
    r.est_value_cents,
    r.currency_code,
    r.assigned_to,
    r.created_at,
    r.updated_at,
  ],
  cap: 'crm.leads.read',
  skipSoftDeleteFilter: true,
});

interface OpportunityRow {
  id: string;
  org_id: string;
  name: string | null;
  customer_id: string | null;
  stage: string;
  est_value_cents: number | string | null;
  currency_code: string | null;
  expected_close_date: string | null;
  probability: number | string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export const exportOpportunities = makeExportHandler<OpportunityRow>({
  slug: 'opportunities',
  table: 'opportunities',
  cols:
    'id, org_id, name, customer_id, stage, est_value_cents, currency_code, ' +
    'expected_close_date, probability, assigned_to, created_at, updated_at',
  headers: [
    'id',
    'name',
    'customer_id',
    'stage',
    'est_value_cents',
    'currency_code',
    'expected_close_date',
    'probability',
    'assigned_to',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.name,
    r.customer_id,
    r.stage,
    r.est_value_cents,
    r.currency_code,
    r.expected_close_date,
    r.probability,
    r.assigned_to,
    r.created_at,
    r.updated_at,
  ],
  cap: 'crm.opportunities.read',
  skipSoftDeleteFilter: true,
});

interface ContactRow {
  id: string;
  org_id: string;
  customer_id: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export const exportContacts = makeExportHandler<ContactRow>({
  slug: 'contacts',
  table: 'contacts',
  cols:
    'id, org_id, customer_id, display_name, email, phone, title, is_primary, created_at, updated_at',
  headers: [
    'id',
    'customer_id',
    'display_name',
    'email',
    'phone',
    'title',
    'is_primary',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.customer_id,
    r.display_name,
    r.email,
    r.phone,
    r.title,
    r.is_primary,
    r.created_at,
    r.updated_at,
  ],
  cap: 'crm.contacts.read',
  skipSoftDeleteFilter: true,
});

interface QuoteRow {
  id: string;
  org_id: string;
  quote_number: string;
  customer_id: string;
  status: string;
  currency_code: string;
  subtotal_cents: number | string;
  tax_cents: number | string;
  total_cents: number | string;
  issue_date: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export const exportQuotes = makeExportHandler<QuoteRow>({
  slug: 'quotes',
  table: 'quotes',
  cols:
    'id, org_id, quote_number, customer_id, status, currency_code, subtotal_cents, ' +
    'tax_cents, total_cents, issue_date, valid_until, created_at, updated_at',
  headers: [
    'id',
    'quote_number',
    'customer_id',
    'status',
    'currency_code',
    'subtotal_cents',
    'tax_cents',
    'total_cents',
    'issue_date',
    'valid_until',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.quote_number,
    r.customer_id,
    r.status,
    r.currency_code,
    r.subtotal_cents,
    r.tax_cents,
    r.total_cents,
    r.issue_date,
    r.valid_until,
    r.created_at,
    r.updated_at,
  ],
  cap: 'quotes.read',
});

interface ProjectRow {
  id: string;
  org_id: string;
  project_number: string;
  name: string;
  customer_id: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  currency_code: string | null;
  budget_cents: number | string | null;
  created_at: string;
  updated_at: string;
}

export const exportProjects = makeExportHandler<ProjectRow>({
  slug: 'projects',
  table: 'projects',
  cols:
    'id, org_id, project_number, name, customer_id, status, start_date, end_date, ' +
    'currency_code, budget_cents, created_at, updated_at',
  headers: [
    'id',
    'project_number',
    'name',
    'customer_id',
    'status',
    'start_date',
    'end_date',
    'currency_code',
    'budget_cents',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.project_number,
    r.name,
    r.customer_id,
    r.status,
    r.start_date,
    r.end_date,
    r.currency_code,
    r.budget_cents,
    r.created_at,
    r.updated_at,
  ],
  cap: 'projects.read',
});

interface InvoiceRow {
  id: string;
  org_id: string;
  invoice_number: string;
  customer_id: string;
  status: string;
  currency_code: string;
  subtotal_cents: number | string;
  tax_cents: number | string;
  total_cents: number | string;
  paid_cents: number | string | null;
  balance_cents: number | string | null;
  issue_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export const exportInvoices = makeExportHandler<InvoiceRow>({
  slug: 'invoices',
  table: 'invoices',
  cols:
    'id, org_id, invoice_number, customer_id, status, currency_code, subtotal_cents, ' +
    'tax_cents, total_cents, paid_cents, balance_cents, issue_date, due_date, created_at, updated_at',
  headers: [
    'id',
    'invoice_number',
    'customer_id',
    'status',
    'currency_code',
    'subtotal_cents',
    'tax_cents',
    'total_cents',
    'paid_cents',
    'balance_cents',
    'issue_date',
    'due_date',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.invoice_number,
    r.customer_id,
    r.status,
    r.currency_code,
    r.subtotal_cents,
    r.tax_cents,
    r.total_cents,
    r.paid_cents,
    r.balance_cents,
    r.issue_date,
    r.due_date,
    r.created_at,
    r.updated_at,
  ],
  cap: 'invoices.read',
});

interface PaymentRow {
  id: string;
  org_id: string;
  payment_number: string | null;
  customer_id: string | null;
  status: string;
  currency_code: string;
  amount_cents: number | string;
  payment_method_id: string | null;
  received_at: string | null;
  created_at: string;
  updated_at: string;
}

export const exportPayments = makeExportHandler<PaymentRow>({
  slug: 'payments',
  table: 'payments',
  cols:
    'id, org_id, payment_number, customer_id, status, currency_code, amount_cents, ' +
    'payment_method_id, received_at, created_at, updated_at',
  headers: [
    'id',
    'payment_number',
    'customer_id',
    'status',
    'currency_code',
    'amount_cents',
    'payment_method_id',
    'received_at',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.payment_number,
    r.customer_id,
    r.status,
    r.currency_code,
    r.amount_cents,
    r.payment_method_id,
    r.received_at,
    r.created_at,
    r.updated_at,
  ],
  cap: 'payments.read',
});

interface CreditNoteRow {
  id: string;
  org_id: string;
  credit_note_number: string;
  customer_id: string;
  status: string;
  currency_code: string;
  total_cents: number | string;
  applied_cents: number | string | null;
  balance_cents: number | string | null;
  issue_date: string | null;
  created_at: string;
  updated_at: string;
}

export const exportCreditNotes = makeExportHandler<CreditNoteRow>({
  slug: 'credit_notes',
  table: 'credit_notes',
  cols:
    'id, org_id, credit_note_number, customer_id, status, currency_code, total_cents, ' +
    'applied_cents, balance_cents, issue_date, created_at, updated_at',
  headers: [
    'id',
    'credit_note_number',
    'customer_id',
    'status',
    'currency_code',
    'total_cents',
    'applied_cents',
    'balance_cents',
    'issue_date',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.credit_note_number,
    r.customer_id,
    r.status,
    r.currency_code,
    r.total_cents,
    r.applied_cents,
    r.balance_cents,
    r.issue_date,
    r.created_at,
    r.updated_at,
  ],
  cap: 'credit_notes.read',
});

interface ReceivingOrderRow {
  id: string;
  org_id: string;
  ro_number: string;
  po_id: string | null;
  vendor_id: string | null;
  warehouse_id: string | null;
  status: string;
  received_at: string | null;
  created_at: string;
  updated_at: string;
}

export const exportReceivingOrders = makeExportHandler<ReceivingOrderRow>({
  slug: 'receiving_orders',
  table: 'receiving_orders',
  cols:
    'id, org_id, ro_number, po_id, vendor_id, warehouse_id, status, received_at, ' +
    'created_at, updated_at',
  headers: [
    'id',
    'ro_number',
    'po_id',
    'vendor_id',
    'warehouse_id',
    'status',
    'received_at',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.ro_number,
    r.po_id,
    r.vendor_id,
    r.warehouse_id,
    r.status,
    r.received_at,
    r.created_at,
    r.updated_at,
  ],
  cap: 'receiving.read',
});

interface ProductionRunRow {
  id: string;
  org_id: string;
  run_number: string;
  project_id: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export const exportProductionRuns = makeExportHandler<ProductionRunRow>({
  slug: 'production_runs',
  table: 'production_runs',
  cols:
    'id, org_id, run_number, project_id, status, started_at, finished_at, created_at, updated_at',
  headers: [
    'id',
    'run_number',
    'project_id',
    'status',
    'started_at',
    'finished_at',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.run_number,
    r.project_id,
    r.status,
    r.started_at,
    r.finished_at,
    r.created_at,
    r.updated_at,
  ],
  cap: 'production.read',
});

interface ShipmentRow {
  id: string;
  org_id: string;
  shipment_number: string;
  customer_id: string | null;
  project_id: string | null;
  warehouse_id: string | null;
  status: string;
  shipped_at: string | null;
  delivered_at: string | null;
  carrier: string | null;
  tracking_number: string | null;
  created_at: string;
  updated_at: string;
}

export const exportShipments = makeExportHandler<ShipmentRow>({
  slug: 'shipments',
  table: 'shipments',
  cols:
    'id, org_id, shipment_number, customer_id, project_id, warehouse_id, status, ' +
    'shipped_at, delivered_at, carrier, tracking_number, created_at, updated_at',
  headers: [
    'id',
    'shipment_number',
    'customer_id',
    'project_id',
    'warehouse_id',
    'status',
    'shipped_at',
    'delivered_at',
    'carrier',
    'tracking_number',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.shipment_number,
    r.customer_id,
    r.project_id,
    r.warehouse_id,
    r.status,
    r.shipped_at,
    r.delivered_at,
    r.carrier,
    r.tracking_number,
    r.created_at,
    r.updated_at,
  ],
  cap: 'shipping.read',
});
