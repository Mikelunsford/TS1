import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ItemCategoryPicker } from '@/components/inventory/ItemCategoryPicker';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { itemKeys } from '@/lib/queryKeys/inventory';
import { listItems, type ItemListFilters } from '@/lib/services/itemsService';

/**
 * Items list — filter by category + free-text q, optional archive toggle,
 * paginated by `next_cursor`. Mirrors CustomersListPage's URL-state pattern:
 * filters live in the query string so they survive reload and back-button.
 */
export default function ItemsListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const categoryId = searchParams.get('category_id') ?? '';
  const showArchived = searchParams.get('archived') === '1';
  const cursor = searchParams.get('cursor') ?? undefined;

  // Local input state so typing doesn't re-fetch on every keystroke; commit on
  // submit. Same convention as CustomersListPage.
  const [qInput, setQInput] = useState(q);

  const filters: ItemListFilters = {};
  if (q) filters.q = q;
  if (categoryId) filters.category_id = categoryId;
  if (!showArchived) filters.is_active = true;
  if (cursor) filters.cursor = cursor;

  const query = useQuery({
    queryKey: [...itemKeys.list(), filters] as const,
    queryFn: () => listItems(filters),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  function update(next: Record<string, string | undefined>): void {
    const sp = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    // Any filter change resets pagination.
    if ('q' in next || 'category_id' in next || 'archived' in next) sp.delete('cursor');
    setSearchParams(sp, { replace: true });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Items</h1>
          <p className="text-sm text-fg-muted">
            Products, services, labor, and other line-item building blocks.
          </p>
        </div>
        <Link
          to="/items/categories"
          className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
        >
          Manage categories
        </Link>
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Item filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: qInput });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="items-q" className="text-xs uppercase tracking-wide text-fg-subtle">
            Search
          </label>
          <input
            id="items-q"
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Code or description"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="items-category"
            className="text-xs uppercase tracking-wide text-fg-subtle"
          >
            Category
          </label>
          <ItemCategoryPicker
            id="items-category"
            value={categoryId || null}
            onChange={(v) => update({ category_id: v ?? '' })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => update({ archived: e.target.checked ? '1' : '' })}
            className="rounded border-border"
          />
          Show archived
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
        >
          Apply
        </button>
      </form>

      {query.isLoading && <TableSkeleton rows={6} cols={5} />}
      {query.error && <ErrorState title="Could not load items" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No items found"
          description={
            q || categoryId
              ? 'Try clearing filters to see all items.'
              : 'Items added through the API or imports will appear here.'
          }
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
                  Description
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Kind
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Unit price
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((item) => (
                <tr key={item.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2 font-mono">
                    <Link
                      to={`/items/${item.id}`}
                      className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      {item.item_code}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{item.description}</td>
                  <td className="px-3 py-2">
                    <Badge>{item.item_kind}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    <MoneyDisplay
                      cents={item.unit_price_cents}
                      currency={item.currency_code}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {item.is_active ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Archived</Badge>
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
    </div>
  );
}
