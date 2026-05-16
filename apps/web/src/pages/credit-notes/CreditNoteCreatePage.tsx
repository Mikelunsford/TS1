/**
 * CreditNoteCreatePage — minimal new-credit-note form. Creates as
 * `status='draft'` (BE pins) ready to be transitioned via the detail page.
 *
 * Required: customer_id, currency_code, amount_cents.
 * Optional: invoice_id, reason, notes, issue_date.
 *
 * Bare React state + `CreditNoteCreateSchema.safeParse` at submit.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { InvoicePicker } from '@/components/payments/InvoicePicker';
import { ErrorState } from '@/components/ui/ErrorState';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { customerKeys } from '@/lib/queryKeys/customers';
import { invoiceKeys } from '@/lib/queryKeys/invoices';
import { createCreditNote } from '@/lib/services/creditNotesService';
import { listCustomers } from '@/lib/services/customersService';
import { getInvoice } from '@/lib/services/invoicesService';
import {
  CreditNoteCreateSchema,
  CreditNoteReasonSchema,
  type CreditNoteCreate,
  type CreditNoteReason,
  type Invoice,
} from '@/lib/types';

type FieldErrors = Partial<Record<keyof CreditNoteCreate, string[] | undefined>>;

interface FormState {
  customer_id: string;
  currency_code: string;
  amount_cents: number;
  invoice_id: string;
  reason: '' | CreditNoteReason;
  notes: string;
  issue_date: string;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyForm(): FormState {
  return {
    customer_id: '',
    currency_code: 'USD',
    amount_cents: 0,
    invoice_id: '',
    reason: '',
    notes: '',
    issue_date: todayIso(),
  };
}

export default function CreditNoteCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillInvoiceId = searchParams.get('invoice_id') ?? '';

  const [form, setForm] = useState<FormState>(emptyForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const prefillQuery = useQuery({
    queryKey: invoiceKeys.detail(prefillInvoiceId),
    queryFn: () => getInvoice(prefillInvoiceId),
    enabled: prefillInvoiceId.length > 0 && !selectedInvoice,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (prefillQuery.data && !selectedInvoice) {
      const inv = prefillQuery.data;
      setSelectedInvoice(inv);
      setForm((prev) => ({
        ...prev,
        invoice_id: inv.id,
        customer_id: inv.customer_id,
        currency_code: inv.currency_code,
      }));
    }
  }, [prefillQuery.data, selectedInvoice]);

  const customersQuery = useQuery({
    queryKey: [...customerKeys.list(), { q: customerSearch }],
    queryFn: () => listCustomers(customerSearch ? { q: customerSearch } : {}),
    staleTime: 30_000,
  });
  const customers = useMemo(() => customersQuery.data?.items ?? [], [customersQuery.data]);

  const createMutation = useMutation({
    mutationFn: (body: CreditNoteCreate) => createCreditNote(body),
    onSuccess: (data) => {
      toast.success(`Credit note ${data.credit_note_number} created`);
      navigate(`/credit-notes/${data.id}`);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to create credit note'),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const candidate: CreditNoteCreate = {
      customer_id: form.customer_id,
      currency_code: form.currency_code,
      amount_cents: form.amount_cents,
      invoice_id: form.invoice_id || undefined,
      reason: form.reason || undefined,
      notes: form.notes.trim() === '' ? undefined : form.notes,
      issue_date: form.issue_date || undefined,
    };
    const parsed = CreditNoteCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }
    setErrors({});
    createMutation.mutate(parsed.data);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/credit-notes" className="hover:underline">
          Credit notes
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">New</span>
      </nav>

      <h1 className="text-2xl font-semibold">New credit note</h1>

      <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-border bg-bg p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="customer-search" className="text-xs uppercase tracking-wide text-fg-subtle">
            Customer
          </label>
          <input
            id="customer-search"
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
              setForm({ ...form, customer_id: e.target.value });
              const c = customers.find((x) => x.id === e.target.value);
              if (c?.default_currency_code) {
                setForm((prev) => ({
                  ...prev,
                  customer_id: e.target.value,
                  currency_code: c.default_currency_code as string,
                }));
              }
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

        <Field label="Invoice (optional)" error={errors.invoice_id}>
          <InvoicePicker
            value={form.invoice_id}
            {...(form.customer_id ? { customerId: form.customer_id } : {})}
            onSelect={(inv) => {
              setSelectedInvoice(inv);
              if (inv) {
                setForm((prev) => ({
                  ...prev,
                  invoice_id: inv.id,
                  currency_code: inv.currency_code,
                }));
              } else {
                setForm((prev) => ({ ...prev, invoice_id: '' }));
              }
            }}
            data-testid="invoice-picker"
          />
        </Field>

        <Field label="Currency" error={errors.currency_code}>
          <input
            type="text"
            maxLength={3}
            value={form.currency_code}
            onChange={(e) => setForm({ ...form, currency_code: e.target.value.toUpperCase() })}
            readOnly={selectedInvoice !== null}
            aria-readonly={selectedInvoice !== null}
            className="w-24 rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Amount" error={errors.amount_cents}>
          <MoneyInput
            value={form.amount_cents}
            onChange={(c) => setForm({ ...form, amount_cents: c })}
            currency={form.currency_code}
            aria-label="Credit amount"
          />
        </Field>

        <Field label="Reason" error={errors.reason}>
          <select
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value as FormState['reason'] })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">(none)</option>
            {CreditNoteReasonSchema.options.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Issue date" error={errors.issue_date}>
          <input
            type="date"
            value={form.issue_date}
            onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Notes" error={errors.notes}>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            maxLength={4000}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Link
            to="/credit-notes"
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
            {createMutation.isPending ? 'Creating…' : 'Create credit note'}
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
}: {
  label: string;
  error: string[] | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs uppercase tracking-wide text-fg-subtle">{label}</span>
      {children}
      {error && error.length > 0 && (
        <span className="text-xs text-danger">{error.join(', ')}</span>
      )}
    </label>
  );
}
