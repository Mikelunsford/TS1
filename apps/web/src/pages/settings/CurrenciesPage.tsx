/**
 * CurrenciesPage — Settings > Currencies.
 *
 * Renders all global currency rows and lets the operator toggle `is_active`.
 * The `public.currencies` table is global (no `org_id`); toggling visibility
 * is the only mutation we expose here. The schema fields (symbol, decimal_sep,
 * cent_precision, etc.) are managed via migrations.
 *
 * Wave 3 / Phase 3 sales chassis. Patterns mirror CRM list pages: useQuery
 * for fetch, useMutation for toggle, optimistic invalidate on success.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { currencyKeys } from '@/lib/queryKeys/finance';
import { listCurrencies, updateCurrency } from '@/lib/services/currenciesService';
import type { Currency } from '@/lib/types';

export default function CurrenciesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: currencyKeys.list(),
    queryFn: () => listCurrencies(),
    staleTime: 30_000,
  });

  const toggleMutation = useMutation({
    mutationFn: (vars: { code: string; next: boolean }) =>
      updateCurrency(vars.code, { is_active: vars.next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: currencyKeys.all });
    },
    onError: () => toast.error('Failed to update currency'),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Currencies</h1>
        <p className="text-sm text-fg-muted">
          Enable the currencies your organization will quote, invoice, and pay in. The list of
          available currencies is managed by the platform.
        </p>
      </header>

      {query.isLoading && <TableSkeleton rows={6} cols={5} />}
      {query.error && <ErrorState title="Could not load currencies" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No currencies available"
          description="No currency rows are configured on this platform."
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
                  Symbol
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Precision
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Enabled
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((c: Currency) => {
                const busy =
                  toggleMutation.isPending && toggleMutation.variables?.code === c.code;
                return (
                  <tr key={c.code} className="hover:bg-bg-muted">
                    <td className="px-3 py-2 font-mono">{c.code}</td>
                    <td className="px-3 py-2">{c.label}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono">{c.symbol}</span>
                      <span className="ml-2 text-xs text-fg-subtle">
                        ({c.symbol_position})
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono">{c.cent_precision}</td>
                    <td className="px-3 py-2 text-right">
                      <label className="inline-flex items-center gap-2">
                        <span className="sr-only">Toggle {c.code} enabled</span>
                        <input
                          type="checkbox"
                          checked={c.is_active}
                          disabled={busy}
                          onChange={(e) =>
                            toggleMutation.mutate({ code: c.code, next: e.target.checked })
                          }
                          data-testid={`currency-toggle-${c.code}`}
                          className="h-4 w-4"
                        />
                        <span
                          className={
                            c.is_active ? 'text-xs text-fg' : 'text-xs text-fg-subtle'
                          }
                        >
                          {c.is_active ? 'Active' : 'Disabled'}
                        </span>
                      </label>
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
