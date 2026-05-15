/**
 * ExchangeRatesPage — Settings > Exchange rates.
 *
 * Insert manual exchange rates and view recent rates filtered by
 * base/quote/date range. The rate is `numeric(18,8)` on the DB; we send a
 * positive number and the server/Edge function persists.
 *
 * Forms: bare React state + Zod `safeParse`. No react-hook-form.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { exchangeRateKeys } from '@/lib/queryKeys/finance';
import {
  createExchangeRate,
  listExchangeRates,
  type ExchangeRateListFilters,
} from '@/lib/services/exchangeRatesService';
import {
  ExchangeRateInsertSchema,
  type ExchangeRate,
  type ExchangeRateInsert,
} from '@/lib/types';

type FieldErrors = Partial<Record<keyof ExchangeRateInsert, string[] | undefined>>;

function todayIso(): string {
  // YYYY-MM-DD in local time. Sufficient for a default; the user can change it.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface FormState {
  base_code: string;
  quote_code: string;
  /** Display as text so users can keep typing without the input clamping. */
  rate: string;
  as_of: string;
  source: string;
}

function emptyForm(): FormState {
  return {
    base_code: '',
    quote_code: '',
    rate: '',
    as_of: todayIso(),
    source: 'manual',
  };
}

function asNumber(rate: number | string): number {
  return typeof rate === 'number' ? rate : Number(rate);
}

export default function ExchangeRatesPage() {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<ExchangeRateListFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<ExchangeRateListFilters>({});

  // `exactOptionalPropertyTypes` is on; mutate filters by stripping vs. setting undefined.
  function setFilterField<K extends keyof ExchangeRateListFilters>(
    key: K,
    value: ExchangeRateListFilters[K] | undefined,
  ): void {
    setFilters((prev) => {
      const next: ExchangeRateListFilters = { ...prev };
      if (value === undefined || value === '') {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  const query = useQuery({
    queryKey: [...exchangeRateKeys.list(), appliedFilters],
    queryFn: () => listExchangeRates(appliedFilters),
    staleTime: 15_000,
  });

  const [form, setForm] = useState<FormState>(emptyForm());
  const [errors, setErrors] = useState<FieldErrors>({});

  const createMutation = useMutation({
    mutationFn: (body: ExchangeRateInsert) => createExchangeRate(body),
    onSuccess: () => {
      toast.success('Exchange rate recorded');
      setForm({ ...emptyForm(), source: form.source });
      setErrors({});
      void queryClient.invalidateQueries({ queryKey: exchangeRateKeys.all });
    },
    onError: () => toast.error('Failed to record exchange rate'),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rateNum = Number(form.rate);
    const candidate = {
      base_code: form.base_code.toUpperCase(),
      quote_code: form.quote_code.toUpperCase(),
      rate: Number.isFinite(rateNum) ? rateNum : 0,
      as_of: form.as_of,
      source: form.source || 'manual',
    };
    const parsed = ExchangeRateInsertSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors);
      return;
    }
    setErrors({});
    createMutation.mutate(parsed.data);
  };

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedFilters(filters);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Exchange rates</h1>
        <p className="text-sm text-fg-muted">
          Record manual FX rates between currency pairs. Rates are stored to 8 decimal places
          (numeric(18,8)) and pinned to a specific date.
        </p>
      </header>

      <section
        aria-labelledby="er-new-heading"
        className="space-y-3 rounded-md border border-border bg-bg p-4"
      >
        <h2 id="er-new-heading" className="text-lg font-semibold">
          Record rate
        </h2>
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-5">
          <div className="flex flex-col gap-1">
            <label htmlFor="er-base" className="text-xs uppercase tracking-wide text-fg-subtle">
              Base
            </label>
            <input
              id="er-base"
              type="text"
              required
              maxLength={3}
              value={form.base_code}
              onChange={(e) =>
                setForm({ ...form, base_code: e.target.value.toUpperCase().slice(0, 3) })
              }
              placeholder="USD"
              className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="er-base-input"
            />
            {errors.base_code && (
              <span className="text-xs text-danger">{errors.base_code[0]}</span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="er-quote" className="text-xs uppercase tracking-wide text-fg-subtle">
              Quote
            </label>
            <input
              id="er-quote"
              type="text"
              required
              maxLength={3}
              value={form.quote_code}
              onChange={(e) =>
                setForm({ ...form, quote_code: e.target.value.toUpperCase().slice(0, 3) })
              }
              placeholder="EUR"
              className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="er-quote-input"
            />
            {errors.quote_code && (
              <span className="text-xs text-danger">{errors.quote_code[0]}</span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="er-rate" className="text-xs uppercase tracking-wide text-fg-subtle">
              Rate
            </label>
            <input
              id="er-rate"
              type="number"
              required
              inputMode="decimal"
              step="0.00000001"
              min="0"
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
              placeholder="0.92000000"
              className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              data-testid="er-rate-input"
            />
            {errors.rate && <span className="text-xs text-danger">{errors.rate[0]}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="er-as-of" className="text-xs uppercase tracking-wide text-fg-subtle">
              As of
            </label>
            <input
              id="er-as-of"
              type="date"
              required
              value={form.as_of}
              onChange={(e) => setForm({ ...form, as_of: e.target.value })}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
            {errors.as_of && <span className="text-xs text-danger">{errors.as_of[0]}</span>}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="er-source" className="text-xs uppercase tracking-wide text-fg-subtle">
              Source
            </label>
            <input
              id="er-source"
              type="text"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder="manual"
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="sm:col-span-5">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
              data-testid="er-submit"
            >
              {createMutation.isPending ? 'Saving…' : 'Record rate'}
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <form
          onSubmit={applyFilters}
          className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-bg p-3"
          role="search"
          aria-label="Exchange rate filters"
        >
          <div className="flex flex-col gap-1">
            <label
              htmlFor="er-filter-base"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              Base
            </label>
            <input
              id="er-filter-base"
              type="text"
              maxLength={3}
              value={filters.base_code ?? ''}
              onChange={(e) =>
                setFilterField(
                  'base_code',
                  e.target.value ? e.target.value.toUpperCase().slice(0, 3) : undefined,
                )
              }
              className="w-20 rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="er-filter-quote"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              Quote
            </label>
            <input
              id="er-filter-quote"
              type="text"
              maxLength={3}
              value={filters.quote_code ?? ''}
              onChange={(e) =>
                setFilterField(
                  'quote_code',
                  e.target.value ? e.target.value.toUpperCase().slice(0, 3) : undefined,
                )
              }
              className="w-20 rounded-md border border-border bg-bg px-2 py-1 font-mono text-sm uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="er-filter-from"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              From
            </label>
            <input
              id="er-filter-from"
              type="date"
              value={filters.from ?? ''}
              onChange={(e) => setFilterField('from', e.target.value || undefined)}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="er-filter-to"
              className="text-xs uppercase tracking-wide text-fg-subtle"
            >
              To
            </label>
            <input
              id="er-filter-to"
              type="date"
              value={filters.to ?? ''}
              onChange={(e) => setFilterField('to', e.target.value || undefined)}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
          >
            Apply
          </button>
          {Object.keys(appliedFilters).length > 0 && (
            <button
              type="button"
              onClick={() => {
                setFilters({});
                setAppliedFilters({});
              }}
              className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
            >
              Clear
            </button>
          )}
        </form>

        {query.isLoading && <TableSkeleton rows={4} cols={5} />}
        {query.error && (
          <ErrorState title="Could not load exchange rates" error={query.error} />
        )}
        {query.data && query.data.items.length === 0 && (
          <EmptyState
            title="No exchange rates"
            description="Record your first FX rate above. Multi-currency invoices will use these to convert totals."
          />
        )}

        {query.data && query.data.items.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Pair
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Rate
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    As of
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Source
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {query.data.items.map((r: ExchangeRate) => (
                  <tr key={r.id} className="hover:bg-bg-muted">
                    <td className="px-3 py-2 font-mono">
                      {r.base_code} → {r.quote_code}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {asNumber(r.rate).toFixed(8)}
                    </td>
                    <td className="px-3 py-2">{formatDate(r.as_of)}</td>
                    <td className="px-3 py-2 text-fg-muted">{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
