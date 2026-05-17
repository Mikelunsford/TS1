/**
 * StockOverviewPage — two-tab view (Levels | Movements) for warehouse stock.
 *
 * Levels tab: rows from /stock-levels with item lookup for display name +
 * StockLevelBadge color (red < 0, amber <= reorder_point, green otherwise).
 * Movements tab: reusable StockMovementsList — timeline filtered by warehouse
 * and/or item.
 *
 * Both lists honor URL params (`tab`, `warehouse_id`, `item_id`,
 * `movement_type`) so deep links survive a refresh.
 *
 * Wave 8f / Phase 13. See TS1/09-api/00-API-CONTRACT.md §9.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { ExportButton } from '@/components/exports/ExportButton';
import { StockLevelBadge } from '@/components/inventory/StockLevelBadge';
import { StockMovementsList } from '@/components/inventory/StockMovementsList';
import { WarehousePicker } from '@/components/inventory/WarehousePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { stockLevelKeys } from '@/lib/queryKeys/stock';
import { listStockLevels, type StockLevelListFilters } from '@/lib/services/stockService';
import { listItems } from '@/lib/services/itemsService';

type Tab = 'levels' | 'movements';

export default function StockOverviewPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'movements' ? 'movements' : 'levels';
  const warehouseId = params.get('warehouse_id') ?? '';
  const itemId = params.get('item_id') ?? '';
  const movementType = params.get('movement_type') ?? '';
  const lowStock = params.get('low_stock') === '1';

  const { can } = useCapabilities();
  const canAdjust = can('inventory.stock.write');

  function setParam(k: string, v: string): void {
    const sp = new URLSearchParams(params);
    if (v) sp.set(k, v);
    else sp.delete(k);
    setParams(sp, { replace: true });
  }

  // R-W8F-OBS-02 — `expand: ['item']` makes BE embed an ItemMini on each
  // level row, so we can render full description regardless of the cached
  // 200-item lookup page below.
  const levelFilters: StockLevelListFilters = {
    ...(warehouseId && { warehouse_id: warehouseId }),
    ...(itemId && { item_id: itemId }),
    ...(lowStock && { low_stock: true }),
    expand: ['item'],
  };

  const levelsQuery = useQuery({
    queryKey: stockLevelKeys.list(levelFilters),
    queryFn: () => listStockLevels(levelFilters),
    staleTime: 15_000,
    enabled: tab === 'levels',
    placeholderData: keepPreviousData,
  });

  // For nicer display: fetch a small page of items to map id → description.
  const itemsQuery = useQuery({
    queryKey: ['inventory', 'items', 'lookup', { limit: 200 }],
    queryFn: () => listItems({ limit: 200 }),
    staleTime: 60_000,
  });
  const itemNameById = new Map(
    (itemsQuery.data?.items ?? []).map((it) => [it.id, it.description] as const),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Stock</h1>
          <p className="text-sm text-fg-muted">
            Stock levels and append-only movement history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton entity="stock_movements" label="Export movements" />
          {canAdjust && (
            <Link
              to="/stock/adjust"
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
              data-testid="adjust-stock-link"
            >
              Adjust stock
            </Link>
          )}
        </div>
      </header>

      <div className="flex gap-2 border-b border-border" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'levels'}
          className={`px-3 py-2 text-sm ${tab === 'levels' ? 'border-b-2 border-brand font-medium text-fg' : 'text-fg-muted hover:text-fg'}`}
          onClick={() => setParam('tab', 'levels')}
          data-testid="stock-tab-levels"
        >
          Levels
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'movements'}
          className={`px-3 py-2 text-sm ${tab === 'movements' ? 'border-b-2 border-brand font-medium text-fg' : 'text-fg-muted hover:text-fg'}`}
          onClick={() => setParam('tab', 'movements')}
          data-testid="stock-tab-movements"
        >
          Movements
        </button>
      </div>

      <section className="flex flex-wrap items-end gap-3" aria-label="Filters">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-fg-subtle">Warehouse</span>
          <WarehousePicker
            value={warehouseId}
            onChange={(id) => setParam('warehouse_id', id)}
            placeholder="All warehouses"
          />
        </div>
        {tab === 'levels' && (
          <label className="flex items-center gap-2 pb-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={lowStock}
              onChange={(e) => setParam('low_stock', e.target.checked ? '1' : '')}
            />
            Out of stock only
          </label>
        )}
        {tab === 'movements' && (
          <div className="flex flex-col gap-1">
            <label htmlFor="movement-type" className="text-xs uppercase tracking-wide text-fg-subtle">
              Type
            </label>
            <select
              id="movement-type"
              value={movementType}
              onChange={(e) => setParam('movement_type', e.target.value)}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">All</option>
              <option value="receipt">Receipt</option>
              <option value="shipment">Shipment</option>
              <option value="adjustment">Adjustment</option>
              <option value="transfer_in">Transfer in</option>
              <option value="transfer_out">Transfer out</option>
              <option value="consumption">Consumption</option>
              <option value="return">Return</option>
            </select>
          </div>
        )}
      </section>

      {tab === 'levels' && (
        <>
          {levelsQuery.isLoading && <TableSkeleton rows={5} cols={4} />}
          {levelsQuery.error && (
            <ErrorState title="Could not load stock levels" error={levelsQuery.error} />
          )}
          {levelsQuery.data && levelsQuery.data.items.length === 0 && (
            <EmptyState
              title="No stock yet"
              description="Stock levels appear here once movements are recorded."
            />
          )}
          {levelsQuery.data && levelsQuery.data.items.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Item</th>
                    <th scope="col" className="px-3 py-2 font-medium">Warehouse</th>
                    <th scope="col" className="px-3 py-2 font-medium text-right">On hand</th>
                    <th scope="col" className="px-3 py-2 font-medium text-right">Reserved</th>
                    <th scope="col" className="px-3 py-2 font-medium text-right">Available</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {levelsQuery.data.items.map((row) => (
                    <tr key={row.id} className="hover:bg-bg-muted">
                      <td className="px-3 py-2">
                        {row.item?.description
                          ?? itemNameById.get(row.item_id)
                          ?? (
                            <span className="font-mono text-xs text-fg-muted">{row.item_id.slice(0, 8)}…</span>
                          )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{row.warehouse_id.slice(0, 8)}…</td>
                      <td className="px-3 py-2 text-right font-mono">{String(row.quantity_on_hand)}</td>
                      <td className="px-3 py-2 text-right font-mono">{String(row.quantity_reserved)}</td>
                      <td className="px-3 py-2 text-right">
                        <StockLevelBadge
                          qoh={row.quantity_on_hand}
                          qreserved={row.quantity_reserved}
                          qavailable={row.quantity_available}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'movements' && (
        <StockMovementsList
          {...(itemId ? { itemId } : {})}
          {...(warehouseId ? { warehouseId } : {})}
          {...(movementType ? { movementType } : {})}
          limit={50}
        />
      )}
    </div>
  );
}
