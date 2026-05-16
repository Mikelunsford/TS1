/**
 * VendorBillsPage — vendor's issued bills (Phase 22).
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { vendorPortalKeys } from '@/lib/queryKeys/vendorPortal';
import { listPortalVendorBills } from '@/lib/services/vendorPortalService';
import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';

export default function VendorBillsPage() {
  const q = useQuery({
    queryKey: vendorPortalKeys.billsList({}),
    queryFn: () => listPortalVendorBills({}),
  });

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Bills</h1>
      {q.isLoading && <p className="text-fg-muted">Loading…</p>}
      {q.isError && <p className="text-red-600">Failed to load bills.</p>}
      {q.data && q.data.items.length === 0 && (
        <p className="text-fg-muted">No bills issued yet.</p>
      )}
      {q.data && q.data.items.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-muted">
              <th className="px-3 py-2">Bill #</th>
              <th className="px-3 py-2">Issued</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((b) => (
              <tr key={b.id} className="border-b border-border hover:bg-bg-subtle">
                <td className="px-3 py-2">
                  <Link
                    to={`/vendor-portal/vendor-bills/${b.id}`}
                    className="font-medium text-brand hover:underline"
                  >
                    {b.bill_number}
                  </Link>
                </td>
                <td className="px-3 py-2">{formatDate(b.issue_date)}</td>
                <td className="px-3 py-2">{formatDate(b.due_date)}</td>
                <td className="px-3 py-2">{b.status}</td>
                <td className="px-3 py-2 text-right">
                  {formatMoney(b.balance_cents ?? 0, {
                    currency: (b.currency_code as string | undefined) ?? 'USD',
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
