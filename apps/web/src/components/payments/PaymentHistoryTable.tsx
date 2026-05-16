/**
 * PaymentHistoryTable — embeddable payment list scoped by invoice or customer.
 *
 * Exported so FE-A's InvoiceDetailPage (Payments tab) can consume the same
 * surface as the standalone PaymentsListPage. Renders a simple table with
 * payment_number, paid_at, amount, method link, voided badge.
 *
 * `scope` chooses the filter: either invoice_id or customer_id is set.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { paymentKeys } from '@/lib/queryKeys/payments';
import { listPayments } from '@/lib/services/paymentsService';

export interface PaymentHistoryTableProps {
  scope: { invoice_id: string } | { customer_id: string };
  emptyMessage?: string;
}

export function PaymentHistoryTable({ scope, emptyMessage }: PaymentHistoryTableProps) {
  const filters = 'invoice_id' in scope ? { invoice_id: scope.invoice_id } : { customer_id: scope.customer_id };
  const query = useQuery({
    queryKey: paymentKeys.list(filters),
    queryFn: () => listPayments(filters),
    staleTime: 15_000,
  });

  if (query.isLoading) return <Skeleton className="h-24 w-full" />;
  if (query.error) return <ErrorState title="Could not load payments" error={query.error} />;
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="No payments yet"
        description={emptyMessage ?? 'Record a payment to see it here.'}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Payment #
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Paid at
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Amount
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Reference
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((p) => (
            <tr key={p.id} className="hover:bg-bg-muted">
              <td className="px-3 py-2 font-mono">
                <Link
                  to={`/payments/${p.id}`}
                  className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                >
                  {p.payment_number}
                </Link>
              </td>
              <td className="px-3 py-2 text-fg-muted">{formatDate(p.paid_at)}</td>
              <td className="px-3 py-2 text-right font-mono">
                {formatMoney(p.amount_cents, { currency: p.currency_code })}
              </td>
              <td className="px-3 py-2 text-fg-muted">{p.reference ?? '—'}</td>
              <td className="px-3 py-2">
                {p.voided_at ? (
                  <span className="inline-flex items-center rounded-md bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger ring-1 ring-danger/30">
                    Voided
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-success/30">
                    Posted
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
