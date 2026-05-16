import { useQuery } from '@tanstack/react-query';

import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { portalKeys } from '@/lib/queryKeys/portal';
import { listPortalPayments } from '@/lib/services/portalService';

export default function PortalPaymentsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: portalKeys.paymentList({ page_size: 50 }),
    queryFn: () => listPortalPayments({ page_size: 50 }),
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Payment history</h1>
      </header>

      {isLoading && <p className="text-fg-muted">Loading payments…</p>}
      {isError && <p className="text-red-600">Failed to load payments.</p>}
      {data && data.items.length === 0 && <p className="text-fg-muted">No payments yet.</p>}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-3 py-2">Payment #</th>
                <th className="px-3 py-2">Invoice</th>
                <th className="px-3 py-2">Paid on</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((rawRow) => {
                const row = rawRow as Record<string, unknown> & {
                  id: string;
                  payment_number: string;
                  invoice_number: string | null;
                  paid_at: string;
                  amount_cents: number;
                  reference: string | null;
                  currency_code: string;
                };
                return (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-3 py-2">{row.payment_number}</td>
                    <td className="px-3 py-2">{row.invoice_number ?? '—'}</td>
                    <td className="px-3 py-2">{formatDate(row.paid_at)}</td>
                    <td className="px-3 py-2 text-fg-muted">{row.reference ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {formatMoney(row.amount_cents, { currency: row.currency_code })}
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
