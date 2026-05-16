/**
 * PaymentCreatePage — record a payment against an invoice.
 *
 * Required fields: customer_id (CustomerPicker via search), invoice_id
 * (InvoicePicker), amount_cents (MoneyInput, capped at invoice.balance_cents),
 * currency_code (auto-pinned to the chosen invoice's currency_code; the BE
 * `assert_invoice_payment_currency` trigger rejects mismatches at 0052),
 * paid_at (DatePicker, default today).
 *
 * Optional: payment_method_id, reference, description, external_ref.
 *
 * Bare React state + `PaymentCreateSchema.safeParse` at submit, per
 * the R-01 forms reconcile.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { InvoicePicker } from '@/components/payments/InvoicePicker';
import { PaymentMethodPicker } from '@/components/payments/PaymentMethodPicker';
import { ErrorState } from '@/components/ui/ErrorState';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { customerKeys } from '@/lib/queryKeys/customers';
import { invoiceKeys } from '@/lib/queryKeys/invoices';
import { listCustomers } from '@/lib/services/customersService';
import { getInvoice } from '@/lib/services/invoicesService';
import { createPayment } from '@/lib/services/paymentsService';
import { formatMoney } from '@/lib/money';
import {
  PaymentCreateSchema,
  type Invoice,
  type PaymentCreate,
} from '@/lib/types';

type FieldErrors = Partial<Record<keyof PaymentCreate, string[] | undefined>>;

interface FormState {
  customer_id: string;
  invoice_id: string;
  amount_cents: number;
  currency_code: string;
  paid_at: string;
  payment_method_id: string;
  reference: string;
  description: string;
  external_ref: string;
}

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function emptyForm(): FormState {
  return {
    customer_id: '',
    invoice_id: '',
    amount_cents: 0,
    currency_code: 'USD',
    paid_at: todayIso(),
    payment_method_id: '',
    reference: '',
    description: '',
    external_ref: '',
  };
}

export default function PaymentCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillInvoiceId = searchParams.get('invoice_id') ?? '';

  const [form, setForm] = useState<FormState>(emptyForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // If a prefill invoice was passed via querystring, fetch it once and pin
  // the form to that invoice.
  const prefillQuery = useQuery({
    queryKey: invoiceKeys.detail(prefillInvoiceId),
    queryFn: () => getInvoice(prefillInvoiceId),
    enabled: prefillInvoiceId.length > 0 && !selectedInvoice,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (prefillQuery.data && !selectedInvoice) {
      setSelectedInvoice(prefillQuery.data);
      const inv = prefillQuery.data;
      setForm((prev) => ({
        ...prev,
        invoice_id: inv.id,
        customer_id: inv.customer_id,
        currency_code: inv.currency_code,
        amount_cents:
          inv.balance_cents !== null && inv.balance_cents !== undefined
            ? Number(inv.balance_cents)
            : prev.amount_cents,
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
    mutationFn: (body: PaymentCreate) => createPayment(body),
    onSuccess: (data) => {
      toast.success(`Payment ${data.payment_number} recorded`);
      navigate(`/payments/${data.id}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to record payment');
    },
  });

  const balanceCents = selectedInvoice?.balance_cents != null
    ? Number(selectedInvoice.balance_cents)
    : null;
  const overBalance = balanceCents !== null && form.amount_cents > balanceCents;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const candidate: PaymentCreate = {
      customer_id: form.customer_id,
      invoice_id: form.invoice_id,
      amount_cents: form.amount_cents,
      currency_code: form.currency_code,
      paid_at: form.paid_at ? new Date(form.paid_at).toISOString() : undefined,
      payment_method_id: form.payment_method_id || undefined,
      reference: form.reference.trim() === '' ? undefined : form.reference,
      description: form.description.trim() === '' ? undefined : form.description,
      external_ref: form.external_ref.trim() === '' ? undefined : form.external_ref,
    };
    const parsed = PaymentCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }
    if (overBalance) {
      setErrors({
        amount_cents: [`Amount exceeds invoice balance (${formatMoney(balanceCents ?? 0, { currency: form.currency_code })}).`],
      });
      return;
    }
    setErrors({});
    createMutation.mutate(parsed.data);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/payments" className="hover:underline">
          Payments
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">New</span>
      </nav>

      <h1 className="text-2xl font-semibold">Record payment</h1>

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
              // Reset invoice if customer changes.
              setSelectedInvoice(null);
              setForm((prev) => ({ ...prev, customer_id: e.target.value, invoice_id: '' }));
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

        <Field label="Invoice" error={errors.invoice_id}>
          <InvoicePicker
            value={form.invoice_id}
            {...(form.customer_id ? { customerId: form.customer_id } : {})}
            onSelect={(inv) => {
              setSelectedInvoice(inv);
              if (inv) {
                setForm((prev) => ({
                  ...prev,
                  invoice_id: inv.id,
                  customer_id: inv.customer_id,
                  currency_code: inv.currency_code,
                  amount_cents:
                    inv.balance_cents != null
                      ? Number(inv.balance_cents)
                      : prev.amount_cents,
                }));
              } else {
                setForm((prev) => ({ ...prev, invoice_id: '' }));
              }
            }}
            data-testid="invoice-picker"
          />
          {selectedInvoice && balanceCents !== null && (
            <span className="text-xs text-fg-muted">
              Balance: {formatMoney(balanceCents, { currency: form.currency_code })}
            </span>
          )}
        </Field>

        <Field label="Amount" error={errors.amount_cents}>
          <MoneyInput
            value={form.amount_cents}
            onChange={(c) => setForm({ ...form, amount_cents: c })}
            currency={form.currency_code}
            aria-label="Payment amount"
          />
          {overBalance && (
            <span className="text-xs text-danger" data-testid="over-balance-error">
              Amount exceeds invoice balance.
            </span>
          )}
        </Field>

        <Field label="Currency (pinned to invoice)" error={errors.currency_code}>
          <input
            type="text"
            value={form.currency_code}
            readOnly
            aria-readonly="true"
            data-testid="currency-readonly"
            className="w-24 cursor-not-allowed rounded-md border border-border bg-bg-muted px-2 py-1 font-mono text-sm uppercase text-fg-muted"
          />
        </Field>

        <Field label="Paid at" error={errors.paid_at}>
          <input
            type="date"
            value={form.paid_at}
            onChange={(e) => setForm({ ...form, paid_at: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Payment method" error={errors.payment_method_id}>
          <PaymentMethodPicker
            value={form.payment_method_id}
            onChange={(id) => setForm({ ...form, payment_method_id: id })}
            data-testid="method-picker"
          />
        </Field>

        <Field label="Reference" error={errors.reference}>
          <input
            type="text"
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            placeholder="Check #, transaction id, etc."
            maxLength={120}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="Description" error={errors.description}>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            maxLength={2000}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <Field label="External reference" error={errors.external_ref}>
          <input
            type="text"
            value={form.external_ref}
            onChange={(e) => setForm({ ...form, external_ref: e.target.value })}
            maxLength={120}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Link
            to="/payments"
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
            {createMutation.isPending ? 'Recording…' : 'Record payment'}
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
