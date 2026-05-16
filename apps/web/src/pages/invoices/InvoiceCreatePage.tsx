/**
 * InvoiceCreatePage — minimal new-invoice form. Picks a customer, due date,
 * and currency (the three required server-side fields per
 * `InvoiceCreateSchema`). Optional fields: issue_date (defaults to today on
 * the server when omitted), project_id, quote_id, notes, recurring,
 * external_ref.
 *
 * Bare React state + `InvoiceCreateSchema.safeParse` at submit per the R-01
 * forms reconcile. No react-hook-form.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { ErrorState } from '@/components/ui/ErrorState';
import { customerKeys } from '@/lib/queryKeys/customers';
import { listCustomers } from '@/lib/services/customersService';
import { createInvoice } from '@/lib/services/invoicesService';
import {
  InvoiceCreateSchema,
  InvoiceRecurringSchema,
  type InvoiceCreate,
  type InvoiceRecurring,
} from '@/lib/types';

type FieldErrors = Partial<Record<keyof InvoiceCreate, string[] | undefined>>;

interface FormState {
  customer_id: string;
  customer_name_snapshot: string;
  due_date: string;
  issue_date: string;
  currency_code: string;
  project_id: string;
  quote_id: string;
  notes: string;
  external_ref: string;
  recurring: InvoiceRecurring | '';
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): FormState {
  return {
    customer_id: '',
    customer_name_snapshot: '',
    due_date: '',
    issue_date: todayIso(),
    currency_code: 'USD',
    project_id: '',
    quote_id: '',
    notes: '',
    external_ref: '',
    recurring: '',
  };
}

export default function InvoiceCreatePage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');

  const customersQuery = useQuery({
    queryKey: [...customerKeys.list(), { q: customerSearch }],
    queryFn: () => listCustomers(customerSearch ? { q: customerSearch } : {}),
    staleTime: 30_000,
  });

  const customers = useMemo(() => customersQuery.data?.items ?? [], [customersQuery.data]);

  const createMutation = useMutation({
    mutationFn: (body: InvoiceCreate) => createInvoice(body),
    onSuccess: (data) => {
      toast.success(`Invoice ${data.invoice_number} created`);
      navigate(`/invoices/${data.id}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create invoice');
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);

    const candidate: InvoiceCreate = {
      customer_id: form.customer_id,
      due_date: form.due_date,
      currency_code: form.currency_code,
      issue_date: form.issue_date || undefined,
      customer_name_snapshot:
        form.customer_name_snapshot.trim() === '' ? undefined : form.customer_name_snapshot,
      project_id: form.project_id.trim() === '' ? null : form.project_id,
      quote_id: form.quote_id.trim() === '' ? null : form.quote_id,
      notes: form.notes.trim() === '' ? null : form.notes,
      external_ref: form.external_ref.trim() === '' ? null : form.external_ref,
      recurring: form.recurring === '' ? null : form.recurring,
    };

    const parsed = InvoiceCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      setTopError('Please fix the highlighted fields.');
      return;
    }
    setErrors({});
    createMutation.mutate(parsed.data);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/invoices" className="hover:underline">
          Invoices
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">New</span>
      </nav>

      <h1 className="text-2xl font-semibold">New invoice</h1>

      <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-border bg-bg p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="inv-customer-search" className="text-xs uppercase tracking-wide text-fg-subtle">
            Customer
          </label>
          <input
            id="inv-customer-search"
            type="search"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="Search customers…"
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {customersQuery.error && (
            <ErrorState title="Could not load customers" error={customersQuery.error} />
          )}
          <select
            value={form.customer_id}
            onChange={(e) => {
              const id = e.target.value;
              const c = customers.find((cust) => cust.id === id);
              setForm({
                ...form,
                customer_id: id,
                customer_name_snapshot: c?.display_name ?? '',
                currency_code: c?.default_currency_code ?? form.currency_code,
              });
            }}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            data-testid="customer-select"
          >
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name}
                {c.customer_number ? ` (${c.customer_number})` : ''}
              </option>
            ))}
          </select>
          {errors.customer_id && (
            <span className="text-xs text-danger">{errors.customer_id[0]}</span>
          )}
        </div>

        <Field label="Due date" error={errors.due_date} required>
          <input
            type="date"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            required
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            data-testid="due-date-input"
          />
        </Field>

        <Field label="Issue date" error={errors.issue_date}>
          <input
            type="date"
            value={form.issue_date}
            onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Currency" error={errors.currency_code} required>
          <input
            type="text"
            maxLength={3}
            value={form.currency_code}
            onChange={(e) => setForm({ ...form, currency_code: e.target.value.toUpperCase() })}
            className="w-24 rounded-md border border-border bg-bg px-2 py-1 text-sm uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Project ID (optional)" error={errors.project_id}>
          <input
            type="text"
            value={form.project_id}
            onChange={(e) => setForm({ ...form, project_id: e.target.value })}
            placeholder="(UUID)"
            className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Quote ID (optional)" error={errors.quote_id}>
          <input
            type="text"
            value={form.quote_id}
            onChange={(e) => setForm({ ...form, quote_id: e.target.value })}
            placeholder="(UUID)"
            className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Recurring" error={errors.recurring}>
          <select
            value={form.recurring}
            onChange={(e) =>
              setForm({ ...form, recurring: e.target.value as InvoiceRecurring | '' })
            }
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">One-off (no recurrence)</option>
            {InvoiceRecurringSchema.options.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>

        <Field label="External reference" error={errors.external_ref}>
          <input
            type="text"
            maxLength={120}
            value={form.external_ref}
            onChange={(e) => setForm({ ...form, external_ref: e.target.value })}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Notes" error={errors.notes}>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        {topError && (
          <p role="alert" className="text-sm text-danger">
            {topError}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Link
            to="/invoices"
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            data-testid="create-submit"
          >
            {createMutation.isPending ? 'Creating…' : 'Create invoice'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  error,
  children,
  required,
}: {
  label: string;
  error: string[] | undefined;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs uppercase tracking-wide text-fg-subtle">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
      {error && error.length > 0 && (
        <span className="text-xs text-danger">{error.join(', ')}</span>
      )}
    </label>
  );
}
