/**
 * QuoteCreatePage — minimal new-quote form. Picks a customer from the
 * existing customer list, captures contact info, service type, currency,
 * and mode, then POSTs `/quotes-api/quotes` which returns the draft row.
 * Redirects to `/quotes/:id` on success.
 *
 * Bare React state + `QuoteCreateSchema.safeParse` at submit per the R-01
 * forms reconcile. No react-hook-form.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { ErrorState } from '@/components/ui/ErrorState';
import { customerKeys } from '@/lib/queryKeys/customers';
import { listCustomers } from '@/lib/services/customersService';
import { createQuote } from '@/lib/services/quotesService';
import {
  QuoteCreateSchema,
  QuoteModeSchema,
  QuoteServiceTypeSchema,
  type QuoteCreate,
  type QuoteMode,
  type QuoteServiceType,
} from '@/lib/types';

type FieldErrors = Partial<Record<keyof QuoteCreate, string[] | undefined>>;

interface FormState {
  customer_id: string;
  customer_name: string;
  contact_name: string;
  contact_email: string;
  service_type: QuoteServiceType;
  mode: QuoteMode;
  currency_code: string;
  notes: string;
}

function emptyForm(): FormState {
  return {
    customer_id: '',
    customer_name: '',
    contact_name: '',
    contact_email: '',
    service_type: 'co_pack',
    mode: 'new_quote',
    currency_code: 'USD',
    notes: '',
  };
}

export default function QuoteCreatePage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [customerSearch, setCustomerSearch] = useState('');

  const customersQuery = useQuery({
    queryKey: [...customerKeys.list(), { q: customerSearch }],
    queryFn: () => listCustomers(customerSearch ? { q: customerSearch } : {}),
    staleTime: 30_000,
  });

  const customers = useMemo(() => customersQuery.data?.items ?? [], [customersQuery.data]);

  const createMutation = useMutation({
    mutationFn: (body: QuoteCreate) => createQuote(body),
    onSuccess: (data) => {
      toast.success(`Quote ${data.quote_number} created`);
      navigate(`/quotes/${data.id}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create quote');
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const candidate: QuoteCreate = {
      customer_id: form.customer_id,
      customer_name: form.customer_name,
      service_type: form.service_type,
      mode: form.mode,
      origin: 'management',
      materials_only: false,
      currency_code: form.currency_code || undefined,
      contact_name: form.contact_name.trim() === '' ? null : form.contact_name,
      contact_email: form.contact_email.trim() === '' ? null : form.contact_email,
      notes: form.notes.trim() === '' ? null : form.notes,
    };
    const parsed = QuoteCreateSchema.safeParse(candidate);
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
        <Link to="/quotes" className="hover:underline">
          Quotes
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">New</span>
      </nav>

      <h1 className="text-2xl font-semibold">New quote</h1>

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
              const id = e.target.value;
              const c = customers.find((cust) => cust.id === id);
              setForm({
                ...form,
                customer_id: id,
                customer_name: c?.display_name ?? '',
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

        <Field label="Contact name" error={errors.contact_name}>
          <input
            type="text"
            value={form.contact_name}
            onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Contact email" error={errors.contact_email}>
          <input
            type="email"
            value={form.contact_email}
            onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <fieldset className="space-y-1">
          <legend className="text-xs uppercase tracking-wide text-fg-subtle">Service type</legend>
          {QuoteServiceTypeSchema.options.map((opt) => (
            <label key={opt} className="ml-2 inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="service_type"
                value={opt}
                checked={form.service_type === opt}
                onChange={() => setForm({ ...form, service_type: opt })}
              />
              {opt}
            </label>
          ))}
        </fieldset>

        <Field label="Mode" error={errors.mode}>
          <select
            value={form.mode}
            onChange={(e) => setForm({ ...form, mode: e.target.value as QuoteMode })}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {QuoteModeSchema.options.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Currency" error={errors.currency_code}>
          <input
            type="text"
            maxLength={3}
            value={form.currency_code}
            onChange={(e) => setForm({ ...form, currency_code: e.target.value.toUpperCase() })}
            className="w-24 rounded-md border border-border bg-bg px-2 py-1 text-sm uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
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

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Link
            to="/quotes"
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
            {createMutation.isPending ? 'Creating…' : 'Create quote'}
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
