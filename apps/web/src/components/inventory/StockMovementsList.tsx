/**
 * StockMovementsList — append-only timeline of stock_movements rows.
 *
 * Reusable read-only component: accepts optional itemId / warehouseId
 * filters and renders the latest 50 movements descending by occurred_at.
 *
 * stock_movements is APPEND-ONLY on the BE (no UPDATE / DELETE RLS).
 *
 * Wave 8f / Phase 13.
 */
import { useQuery } from '@tanstack/react-query';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { stockMovementKeys } from '@/lib/queryKeys/stock';
import { listStockMovements, type StockMovementListFilters } from '@/lib/services/stockService';

export interface StockMovementsListProps {
  itemId?: string;
  warehouseId?: string;
  movementType?: string;
  referenceType?: string;
  referenceId?: string;
  limit?: number;
}

const TYPE_LABELS: Record<string, string> = {
  receipt: 'Receipt',
  shipment: 'Shipment',
  adjustment: 'Adjustment',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  consumption: 'Consumption',
  return: 'Return',
};

export function StockMovementsList(props: StockMovementsListProps) {
  const filters: StockMovementListFilters = {
    ...(props.itemId && { item_id: props.itemId }),
    ...(props.warehouseId && { warehouse_id: props.warehouseId }),
    ...(props.movementType && { movement_type: props.movementType }),
    ...(props.referenceType && { reference_type: props.referenceType }),
    ...(props.referenceId && { reference_id: props.referenceId }),
    ...(props.limit && { limit: props.limit }),
  };
  const query = useQuery({
    queryKey: stockMovementKeys.list(filters),
    queryFn: () => listStockMovements(filters),
    staleTime: 15_000,
  });

  if (query.isLoading) return <TableSkeleton rows={4} cols={5} />;
  if (query.error) return <ErrorState title="Could not load stock movements" error={query.error} />;
  if (!query.data || query.data.items.length === 0) {
    return (
      <EmptyState
        title="No stock movements"
        description="Movements will appear here once stock is received, shipped, or adjusted."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">When</th>
            <th scope="col" className="px-3 py-2 font-medium">Type</th>
            <th scope="col" className="px-3 py-2 font-medium text-right">Quantity</th>
            <th scope="col" className="px-3 py-2 font-medium">Reference</th>
            <th scope="col" className="px-3 py-2 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border" data-testid="stock-movements-tbody">
          {query.data.items.map((m) => (
            <tr key={m.id} className="hover:bg-bg-muted">
              <td className="px-3 py-2 text-fg-muted">{formatDate(m.occurred_at)}</td>
              <td className="px-3 py-2">{TYPE_LABELS[m.movement_type] ?? m.movement_type}</td>
              <td className="px-3 py-2 text-right font-mono">{String(m.quantity)}</td>
              <td className="px-3 py-2 text-xs text-fg-muted">
                {m.reference_type ?? '—'}
              </td>
              <td className="px-3 py-2 text-xs text-fg-muted">{m.notes ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
