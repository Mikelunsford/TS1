/**
 * PaymentMethodsPage — Settings > Payment methods.
 *
 * CRUD over `payment_methods` (org-scoped). Each row has a code, label, and
 * an `is_default` flag (partial unique index on `(org_id) WHERE is_default`).
 *
 * Forms: bare React state + Zod `safeParse` on submit. No react-hook-form.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { paymentMethodKeys } from '@/lib/queryKeys/finance';
import {
  createPaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  updatePaymentMethod,
} from '@/lib/services/paymentMethodsService';
import {
  PaymentMethodCreateSchema,
  type PaymentMethod,
  type PaymentMethodCreate,
} from '@/lib/types';

type FieldErrors = Partial<Record<keyof PaymentMethodCreate, string[] | undefined>>;

function emptyForm(): PaymentMethodCreate {
  return {
    code: '',
    label: '',
    description: null,
    is_default: false,
    is_active: true,
  };
}

export default function PaymentMethodsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: paymentMethodKeys.list(),
    queryFn: () => listPaymentMethods(),
    staleTime: 15_000,
  });

  const [form, setForm] = useState<PaymentMethodCreate>(emptyForm());
  const [errors, setErrors] = useState<FieldErrors>({});

  const createMutation = useMutation({
    mutationFn: (body: PaymentMethodCreate) => createPaymentMethod(body),
    onSuccess: () => {
      toast.success('Payment method created');
      setForm(emptyForm());
      setErrors({});
      void queryClient.invalidateQueries({ queryKey: paymentMethodKeys.all });
    },
    onError: () => toast.error('Failed to create payment method'),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => updatePaymentMethod(id, { is_default: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: paymentMethodKeys.all });
    },
    onError: () => toast.error('Failed to set default'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (vars: { id: string; next: boolean }) =>
      updatePaymentMethod(vars.id, { is_active: vars.next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: paymentMethodKeys.all });
    },
    onError: () => toast.error('Failed to update payment method'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePaymentMethod(id),
    onSuccess: () => {
      toast.success('Payment method deleted');
      void queryClient.invalidateQueries({ queryKey: paymentMethodKeys.all });
    },
    onError: () => toast.error('Failed to delete payment method'),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const candidate: PaymentMethodCreate = {
      ...form,
      description:
        form.description && form.description.toString().trim() !== ''
          ? form.description
          : null,
    };
    const parsed = PaymentMethodCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors);
      return;
    }
    setErrors({});
    createMutation.mutate(parsed.data);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Payment methods</h1>
        <p className="text-sm text-fg-muted">
          Methods customers can use to settle invoices. The default method is pre-selected on new
          invoices.
        </p>
      </header>

      <section
        aria-labelledby="pm-new-heading"
        className="space-y-3 rounded-md border border-border bg-bg p-4"
      >
        <h2 id="pm-new-heading" className="text-lg font-semibold">
          New payment method
        </h2>
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="pm-code" className="text-xs uppercase tracking-wide text-fg-subtle">
              Code
            </label>
            <input
              id="pm-code"
              type="text"
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="pm-code-input"
            />
            {errors.code && <span className="text-xs text-danger">{errors.code[0]}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pm-label" className="text-xs uppercase tracking-wide text-fg-subtle">
              Label
            </label>
            <input
              id="pm-label"
              type="text"
              required
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="pm-label-input"
            />
            {errors.label && <span className="text-xs text-danger">{errors.label[0]}</span>}
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor="pm-desc" className="text-xs uppercase tracking-wide text-fg-subtle">
              Description
            </label>
            <input
              id="pm-desc"
              type="text"
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
            />
            Set as default
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
              data-testid="pm-submit"
            >
              {createMutation.isPending ? 'Saving…' : 'Create payment method'}
            </button>
          </div>
        </form>
      </section>

      {query.isLoading && <TableSkeleton rows={4} cols={5} />}
      {query.error && <ErrorState title="Could not load payment methods" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No payment methods yet"
          description="Create your first payment method above (e.g. Bank transfer, ACH, Stripe)."
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Code
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Label
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Description
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((m: PaymentMethod) => (
                <tr key={m.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2 font-mono">{m.code}</td>
                  <td className="px-3 py-2">{m.label}</td>
                  <td className="px-3 py-2">
                    {m.description ?? <span className="text-fg-subtle">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-fg-muted">
                    {[m.is_default ? 'default' : null, m.is_active ? 'active' : 'inactive']
                      .filter(Boolean)
                      .join(' · ')}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-2">
                      {!m.is_default && (
                        <button
                          type="button"
                          onClick={() => setDefaultMutation.mutate(m.id)}
                          className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg hover:bg-bg-muted"
                        >
                          Set default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          toggleActiveMutation.mutate({ id: m.id, next: !m.is_active })
                        }
                        className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg hover:bg-bg-muted"
                      >
                        {m.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete payment method "${m.label}"?`)) {
                            deleteMutation.mutate(m.id);
                          }
                        }}
                        className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-danger hover:bg-bg-muted"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
