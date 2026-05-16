/**
 * exports-api — /exports/expenses CSV stream.
 * Gated on expenses.read + finance.expenses feature flag.
 * Filters: ?status, ?category_id, ?vendor_id, ?project_id, ?start/?end (created_at).
 */
import { makeExportHandler } from './_factory.ts';

interface ExpenseRow {
  id: string;
  org_id: string;
  expense_number: string | null;
  category_id: string | null;
  vendor_id: string | null;
  project_id: string | null;
  account_id: string | null;
  spent_at: string;
  description: string | null;
  status: string;
  currency_code: string;
  amount_cents: number | string;
  tax_cents: number | string;
  tax_id: string | null;
  total_cents: number | string;
  paid_at: string | null;
  receipt_url: string | null;
  notes: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export const exportExpenses = makeExportHandler<ExpenseRow>({
  slug: 'expenses',
  table: 'expenses',
  cols:
    'id, org_id, expense_number, category_id, vendor_id, project_id, account_id, ' +
    'spent_at, description, status, currency_code, amount_cents, tax_cents, tax_id, ' +
    'total_cents, paid_at, receipt_url, notes, submitted_by, approved_by, approved_at, ' +
    'created_at, updated_at',
  headers: [
    'id',
    'expense_number',
    'category_id',
    'vendor_id',
    'project_id',
    'account_id',
    'spent_at',
    'description',
    'status',
    'currency_code',
    'amount_cents',
    'tax_cents',
    'tax_id',
    'total_cents',
    'paid_at',
    'receipt_url',
    'notes',
    'submitted_by',
    'approved_by',
    'approved_at',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.expense_number,
    r.category_id,
    r.vendor_id,
    r.project_id,
    r.account_id,
    r.spent_at,
    r.description,
    r.status,
    r.currency_code,
    r.amount_cents,
    r.tax_cents,
    r.tax_id,
    r.total_cents,
    r.paid_at,
    r.receipt_url,
    r.notes,
    r.submitted_by,
    r.approved_by,
    r.approved_at,
    r.created_at,
    r.updated_at,
  ],
  cap: 'expenses.read',
  flagKey: 'finance.expenses',
  applyFilters: (qb, url) => {
    const status = url.searchParams.get('status');
    const categoryId = url.searchParams.get('category_id');
    const vendorId = url.searchParams.get('vendor_id');
    const projectId = url.searchParams.get('project_id');
    if (status) qb = qb.eq('status', status);
    if (categoryId) qb = qb.eq('category_id', categoryId);
    if (vendorId) qb = qb.eq('vendor_id', vendorId);
    if (projectId) qb = qb.eq('project_id', projectId);
    return qb;
  },
});
