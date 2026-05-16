/**
 * StockAdjustPage — manual sign-bearing adjustment form. POSTs to
 * /inventory-api/stock-movements/adjustment. BE enforces non-zero
 * delta and validates that warehouse + item belong to caller's org.
 *
 * Wave 8f / Phase 13. Per the Wave 8d invariants, movement_type is
 * pinned server-side to 'adjustment' and reference_type to 'manual'.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { WarehousePicker } from '@/components/inventory/WarehousePicker';
import { StockLevelBadge } from '@/components/inventory/StockLevelBadge';
import { stockLevelKeys } from '@/lib/queryKeys/stock';
import { adjustStock, listStockLevels } from '@/lib/services/stockService';
import { listItems } from '@/lib/services/itemsService';
import { StockMovementAdjustmentSchema } from '@/lib/types';

export default function StockAdjustPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [warehouseId, setWarehouseId] = useState(params.get('warehouse_id') ?? '');
  const [itemId, setItemId] = useState(params.get('item_id') ?? '');
  const [delta, setDelta] = useState('');
  const [notes, setNotes] = useState('');
  const [topError, setTopError] = useState<string | null>(null);

  // Item picker — short list of inventoried items.
  const itemsQuery = useQuery({
    queryKey: ['inventory', 'items', 'lookup', { is_inventoried: true, limit: 200 }],
    queryFn: () => listItems({ is_inventoried: true, is_active: true, limit: 200 }),
    staleTime: 60_000,
  });
  const items = itemsQuery.data?.items ?? [];

  // Current stock level for the chosen pair (for context).
  const levelFilters: Record<string, string | number | boolean> = {};
  if (warehouseId) levelFilters.warehouse_id = warehouseId;
  if (itemId) levelFilters.item_id = itemId;
  const levelQuery = useQuery({
    queryKey: stockLevelKeys.list(levelFilters),
    queryFn: () =>
      listStockLevels({ warehouse_id: warehouseId, item_id: itemId, limit: 1 }),
    enabled: Boolean(warehouseId && itemId),
  });
  const currentLevel = levelQuery.data?.items?.[0];

  useEffect(() => {
    setDelta('');
  }, [warehouseId, itemId]);

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = StockMovementAdjustmentSchema.safeParse({
        item_id: itemId,
        warehouse_id: warehouseId,
        quantity_delta: Number(delta),
        ...(notes.trim() ? { notes } : {}),
      });
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues.map((iss) => iss.message).join('; ') || 'Validation failed',
        );
      }
      return adjustStock(parsed.data);
    },
    onSuccess: () => {
      toast.success('Stock adjusted');
      navigate(`/stock?warehouse_id=${warehouseId}&item_id=${itemId}`);
    },
    onError: (err) => setTopError(err instanceof Error ? err.message : 'Adjust failed'),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);
    mutation.mutate();
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/stock" className="hover:underline">Stock</Link>
        <span aria-hidden> / </span>
        <span className="text-fg">Adjust</span>
      </nav>

      <h1 className="text-2xl font-semibold">Adjust stock</h1>
      <p className="text-sm text-fg-muted">
        Record a manual increase or decrease. Use a negative value to remove
        stock. The change is append-only — corrections require a follow-up
        adjustment with the opposite sign.
      </p>

      <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-border bg-bg p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-fg-subtle">Warehouse</span>
          <WarehousePicker
            value={warehouseId}
            onChange={(id) => setWarehouseId(id)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-fg-subtle">Item</span>
          <select
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            data-testid="adjust-item-select"
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">Select an item…</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.item_code} — {it.description}
              </option>
            ))}
          </select>
        </label>

        {currentLevel && (
          <div className="rounded-md border border-border bg-bg-muted p-2 text-sm">
            <span className="mr-2 text-xs uppercase tracking-wide text-fg-subtle">Current:</span>
            <StockLevelBadge
              qoh={currentLevel.quantity_on_hand}
              qreserved={currentLevel.quantity_reserved}
              qavailable={currentLevel.quantity_available}
            />
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-fg-subtle">
            Quantity delta (signed)
          </span>
          <input
            type="number"
            step="any"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="e.g. 10 or -5"
            className="w-32 rounded-md border border-border bg-bg px-2 py-1 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            data-testid="adjust-delta"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-fg-subtle">Notes (optional)</span>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>

        {topError && (
          <p role="alert" className="text-sm text-danger">
            {topError}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Link
            to="/stock"
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={mutation.isPending || !warehouseId || !itemId || !delta}
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            data-testid="adjust-submit"
          >
            {mutation.isPending ? 'Saving…' : 'Record adjustment'}
          </button>
        </div>
      </form>
    </div>
  );
}
