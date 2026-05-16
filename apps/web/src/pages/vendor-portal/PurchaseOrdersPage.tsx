/**
 * PurchaseOrdersPage — vendor's POs list (Phase 22).
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { vendorPortalKeys } from '@/lib/queryKeys/vendorPortal';
import { listPortalPurchaseOrders } from '@/lib/services/vendorPortalService';
import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';

export default function PurchaseOrdersPage() {
  const q = useQuery({
    queryKey: vendorPortalKeys.poList({}),
    queryFn: () => listPortalPurchaseOrders({}),
  });

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Purchase Orders</h1>
      {q.isLoading && <p className="text-fg-muted">Loading…</p>}
      {q.isError && <p className="text-red-600">Failed to load purchase orders.</p>}
      {q.data && q.data.items.length === 0 && (
        <p className="text-fg-muted">No purchase orders yet.</p>
      )}
      {q.data && q.data.items.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-muted">
              <th className="px-3 py-2">PO #</th>
              <th className="px-3 py-2">Issued</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((po) => (
              <tr key={po.id} className="border-b border-border hover:bg-bg-subtle">
                <td className="px-3 py-2">
                  <Link
                    to={`/vendor-portal/purchase-orders/${po.id}`}
                    className="font-medium text-brand hover:underline"
                  >
                    {po.po_number}
                  </Link>
                </td>
                <td className="px-3 py-2">{formatDate(po.issue_date)}</td>
                <td className="px-3 py-2">{po.status}</td>
                <td className="px-3 py-2 text-right">
                  {formatMoney(po.total_cents ?? 0, {
                    currency: (po.currency_code as string | undefined) ?? 'USD',
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
