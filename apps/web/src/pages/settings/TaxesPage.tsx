/**
 * TaxesPage — Settings > Taxes.
 *
 * Lists org-scoped tax rates and lets the operator create / edit / archive
 * them. `rate` is stored on the wire as decimal 0..1 (e.g. 0.0875 for 8.75%);
 * the UI displays and accepts percentage form via `RateInputPercent`.
 *
 * Forms use bare React state + Zod `safeParse` on submit, per the Wave 3
 * R-01 reconciliation. No react-hook-form.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { RateInputPercent } from '@/components/settings/RateInputPercent';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { taxKeys } from '@/lib/queryKeys/finance';
import {
  archiveTax,
  createTax,
  listTaxes,
  updateTax,
} from '@/lib/services/taxesService';
import {
  TaxCreateSchema,
  type Tax,
  type TaxCreate,
} from '@/lib/types';

type FieldErrors = Partial<Record<keyof TaxCreate, string[] | undefined>>;

function emptyForm(): TaxCreate {
  return {
    code: '',
    label: '',
    rate: 0,
    jurisdiction: null,
    is_compound: false,
    is_inclusive: false,
    is_default: false,
    is_active: true,
  };
}

function asNumber(rate: number | string): number {
  return typeof rate === 'number' ? rate : Number(rate);
}

export default function TaxesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: taxKeys.list(),
    queryFn: () => listTaxes(),
    staleTime: 15_000,
  });

  const [form, setForm] = useState<TaxCreate>(emptyForm());
  const [errors, setErrors] = useState<FieldErrors>({});

  const createMutation = useMutation({
    mutationFn: (body: TaxCreate) => createTax(body),
    onSuccess: () => {
      toast.success('Tax created');
      setForm(emptyForm());
      setErrors({});
      void queryClient.invalidateQueries({ queryKey: taxKeys.all });
    },
    onError: () => toast.error('Failed to create tax'),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveTax(id),
    onSuccess: () => {
      toast.success('Tax archived');
      void queryClient.invalidateQueries({ queryKey: taxKeys.all });
    },
    onError: () => toast.error('Failed to archive tax'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (vars: { id: string; next: boolean }) =>
      updateTax(vars.id, { is_active: vars.next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taxKeys.all });
    },
    onError: () => toast.error('Failed to update tax'),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Coerce empty jurisdiction string to null so the optional field is valid.
    const candidate: TaxCreate = {
      ...form,
      jurisdiction:
        form.jurisdiction && form.jurisdiction.toString().trim() !== ''
          ? form.jurisdiction
          : null,
    };
    const parsed = TaxCreateSchema.safeParse(candidate);
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
        <h1 className="text-2xl font-semibold">Taxes</h1>
        <p className="text-sm text-fg-muted">
          Tax rates available on quotes and invoices. The rate is stored as a decimal (0..1) on
          the wire; enter the percentage you want and we&apos;ll convert.
        </p>
      </header>

      <section
        aria-labelledby="taxes-new-heading"
        className="space-y-3 rounded-md border border-border bg-bg p-4"
      >
        <h2 id="taxes-new-heading" className="text-lg font-semibold">
          New tax
        </h2>
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="tax-code" className="text-xs uppercase tracking-wide text-fg-subtle">
              Code
            </label>
            <input
              id="tax-code"
              type="text"
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="tax-code-input"
            />
            {errors.code && <span className="text-xs text-danger">{errors.code[0]}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="tax-label" className="text-xs uppercase tracking-wide text-fg-subtle">
              Label
            </label>
            <input
              id="tax-label"
              type="text"
              required
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="tax-label-input"
            />
            {errors.label && <span className="text-xs text-danger">{errors.label[0]}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="tax-rate" className="text-xs uppercase tracking-wide text-fg-subtle">
              Rate (%)
            </label>
            <RateInputPercent
              id="tax-rate"
              value={form.rate}
              onChange={(n) => setForm({ ...form, rate: n })}
              data-testid="tax-rate-input"
              aria-label="Rate in percent"
            />
            {errors.rate && <span className="text-xs text-danger">{errors.rate[0]}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="tax-jurisdiction"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              Jurisdiction
            </label>
            <input
              id="tax-jurisdiction"
              type="text"
              value={form.jurisdiction ?? ''}
              onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}
              placeholder="e.g. CA-SF or EU-DE"
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <fieldset className="flex flex-wrap gap-4 sm:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_compound}
                onChange={(e) => setForm({ ...form, is_compound: e.target.checked })}
              />
              Compound
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_inclusive}
                onChange={(e) => setForm({ ...form, is_inclusive: e.target.checked })}
              />
              Inclusive
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
              />
              Default
            </label>
          </fieldset>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
              data-testid="tax-submit"
            >
              {createMutation.isPending ? 'Saving…' : 'Create tax'}
            </button>
          </div>
        </form>
      </section>

      {query.isLoading && <TableSkeleton rows={4} cols={6} />}
      {query.error && <ErrorState title="Could not load taxes" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No taxes yet"
          description="Create your first tax above. Taxes can be applied to line items on quotes and invoices."
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
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Rate
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Jurisdiction
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Flags
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((t: Tax) => {
                const ratePct = (asNumber(t.rate) * 100).toFixed(2);
                return (
                  <tr key={t.id} className="hover:bg-bg-muted">
                    <td className="px-3 py-2 font-mono">{t.code}</td>
                    <td className="px-3 py-2">{t.label}</td>
                    <td className="px-3 py-2 text-right font-mono">{ratePct}%</td>
                    <td className="px-3 py-2">
                      {t.jurisdiction ?? <span className="text-fg-subtle">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-muted">
                      {[
                        t.is_default ? 'default' : null,
                        t.is_compound ? 'compound' : null,
                        t.is_inclusive ? 'inclusive' : null,
                        t.is_active ? 'active' : 'archived',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            toggleActiveMutation.mutate({ id: t.id, next: !t.is_active })
                          }
                          className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg hover:bg-bg-muted"
                        >
                          {t.is_active ? 'Disable' : 'Enable'}
                        </button>
                        {t.is_active && (
                          <button
                            type="button"
                            onClick={() => archiveMutation.mutate(t.id)}
                            className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg hover:bg-bg-muted"
                          >
                            Archive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
