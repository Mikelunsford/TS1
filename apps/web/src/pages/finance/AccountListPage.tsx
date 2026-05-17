/**
 * AccountListPage — Wave 8 / Phase 12. Chart-of-accounts list with
 * filters on account_type / is_active / parent_id. System-seeded rows
 * (is_system=true) are visually flagged and not archivable.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ExportButton } from '@/components/exports/ExportButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { FilterChip } from '@/components/ui/FilterChip';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { chartOfAccountKeys } from '@/lib/queryKeys/chartOfAccounts';
import {
  archiveChartOfAccount,
  listChartOfAccounts,
  type ChartOfAccountListFilters,
} from '@/lib/services/chartOfAccountsService';
import { ChartOfAccountTypeSchema } from '@/lib/types';

const TYPE_VALUES = ChartOfAccountTypeSchema.options;

export default function AccountListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const accountType = searchParams.get('account_type') ?? '';
  const isActiveParam = searchParams.get('is_active') ?? '';
  const parentId = searchParams.get('parent_id') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  const { can } = useCapabilities();
  const canWrite = can('finance.coa.write');

  const filters: ChartOfAccountListFilters = {};
  if (accountType) {
    filters.account_type = accountType as NonNullable<ChartOfAccountListFilters['account_type']>;
  }
  if (isActiveParam === 'true') filters.is_active = true;
  if (isActiveParam === 'false') filters.is_active = false;
  if (parentId) filters.parent_id = parentId;
  if (cursor) filters.cursor = cursor;

  const qc = useQueryClient();
  const query = useQuery({
    queryKey: chartOfAccountKeys.list(filters),
    queryFn: () => listChartOfAccounts(filters),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveChartOfAccount(id),
    onSuccess: () => {
      toast.success('Account archived');
      void qc.invalidateQueries({ queryKey: chartOfAccountKeys.all });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Archive failed'),
  });

  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);

  function update(next: Record<string, string | undefined>): void {
    const sp = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    if (Object.keys(next).some((k) => k !== 'cursor')) sp.delete('cursor');
    setSearchParams(sp, { replace: true });
  }

  function toggleType(value: string) {
    update({ account_type: accountType === value ? '' : value });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Chart of accounts</h1>
          <p className="text-sm text-fg-muted">
            General-ledger accounts. System-seeded accounts are immutable.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton entity="chart_of_accounts" />
          {canWrite && (
            <Link
              to="/finance/accounts/new"
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
              data-testid="new-account-link"
            >
              New account
            </Link>
          )}
        </div>
      </header>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Type filter"
        data-testid="type-chips"
      >
        {TYPE_VALUES.map((t) => (
          <FilterChip
            key={t}
            label={t}
            active={accountType === t}
            onClick={() => toggleType(t)}
            testId={`type-chip-${t}`}
          />
        ))}
        <select
          value={isActiveParam}
          onChange={(e) => update({ is_active: e.target.value })}
          className="ml-2 rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          aria-label="Active filter"
          data-testid="is-active-select"
        >
          <option value="">All</option>
          <option value="true">Active only</option>
          <option value="false">Archived only</option>
        </select>
      </div>

      {query.isLoading && <TableSkeleton rows={6} cols={5} />}
      {query.error && <ErrorState title="Could not load accounts" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState title="No accounts found" description="Adjust the filters or seed the chassis COA." />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Code</th>
                <th scope="col" className="px-3 py-2 font-medium">Label</th>
                <th scope="col" className="px-3 py-2 font-medium">Type</th>
                <th scope="col" className="px-3 py-2 font-medium">Currency</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((acc) => (
                <tr
                  key={acc.id}
                  className="hover:bg-bg-muted"
                  data-testid={`account-row-${acc.id}`}
                >
                  <td className="px-3 py-2 font-mono">
                    <Link
                      to={`/finance/accounts/${acc.id}`}
                      className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      {acc.account_code}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-fg">
                    {acc.label}
                    {acc.is_system && (
                      <span
                        className="ml-2 inline-flex items-center rounded-md bg-bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle ring-1 ring-border"
                        data-testid={`account-${acc.id}-system-badge`}
                        title="System-seeded account — immutable"
                      >
                        System
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 capitalize text-fg-muted">{acc.account_type}</td>
                  <td className="px-3 py-2 font-mono text-fg-muted">{acc.currency_code ?? '—'}</td>
                  <td className="px-3 py-2 text-fg-muted">
                    {acc.is_active ? 'Active' : 'Archived'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canWrite && acc.is_active && !acc.is_system && (
                      <button
                        type="button"
                        onClick={() => setConfirmArchive(acc.id)}
                        className="rounded-md border border-border bg-bg px-2 py-0.5 text-xs text-fg hover:bg-bg-muted"
                        data-testid={`account-${acc.id}-archive`}
                      >
                        Archive
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {query.data?.next_cursor && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => update({ cursor: query.data?.next_cursor ?? undefined })}
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Next page
          </button>
        </div>
      )}

      {confirmArchive && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="coa-archive-heading"
          className="fixed inset-0 z-30 flex items-center justify-center bg-fg/40 px-4"
        >
          <div className="w-full max-w-md space-y-3 rounded-md border border-border bg-bg p-4 shadow-lg">
            <h2 id="coa-archive-heading" className="text-lg font-semibold">Archive account?</h2>
            <p className="text-sm text-fg-muted">
              Archived accounts remain on existing journal entries but can no longer be selected
              on new lines.
            </p>
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setConfirmArchive(null)}
                className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={archiveMutation.isPending}
                onClick={() => {
                  archiveMutation.mutate(confirmArchive, {
                    onSettled: () => setConfirmArchive(null),
                  });
                }}
                className="rounded-md border border-danger/40 bg-bg px-3 py-1 text-sm text-danger hover:bg-danger/5 disabled:opacity-50"
                data-testid="account-archive-confirm"
              >
                {archiveMutation.isPending ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
