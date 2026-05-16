/**
 * PaymentsPage — payments received from the org (Phase 22).
 *
 * Derived from vendor_bills with paid_cents > 0; vendor_bills carry
 * paid_at directly per the Wave 7 procurement schema.
 */
import { useQuery } from '@tanstack/react-query';

import { vendorPortalKeys } from '@/lib/queryKeys/vendorPortal';
import { listPortalPayments } from '@/lib/services/vendorPortalService';
import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';

export default function PaymentsPage() {
  const q = useQuery({
    queryKey: vendorPortalKeys.payments({}),
    queryFn: () => listPortalPayments({}),
  });

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Payments received</h1>
      {q.isLoading && <p className="text-fg-muted">Loading…</p>}
      {q.isError && <p className="text-red-600">Failed to load payments.</p>}
      {q.data && q.data.items.length === 0 && (
        <p className="text-fg-muted">No payments recorded yet.</p>
      )}
      {q.data && q.data.items.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-muted">
              <th className="px-3 py-2">Bill #</th>
              <th className="px-3 py-2">Paid on</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Of total</th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((p) => (
              <tr key={p.id} className="border-b border-border hover:bg-bg-subtle">
                <td className="px-3 py-2 font-medium">{p.bill_number}</td>
                <td className="px-3 py-2">{p.paid_at ? formatDate(p.paid_at) : '—'}</td>
                <td className="px-3 py-2 text-right">
                  {formatMoney(p.paid_cents, { currency: p.currency_code })}
                </td>
                <td className="px-3 py-2 text-right text-fg-muted">
                  {formatMoney(p.total_cents, { currency: p.currency_code })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
