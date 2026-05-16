/**
 * Customer payments + credit notes tabs (Wave 5 / 5.3b) — FE-B owns this block.
 *
 * Read-only embedded lists for the CustomerDetailPage. Split out into its
 * own module so the CustomerDetailPage file doesn't grow another two
 * inline component subtrees. RLS still enforces the customer_user scope;
 * the SPA just provides UX over the same query.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { CreditNoteStatusBadge } from '@/components/credit-notes/CreditNoteStatusBadge';
import { PaymentHistoryTable } from '@/components/payments/PaymentHistoryTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { creditNoteKeys } from '@/lib/queryKeys/creditNotes';
import { listCreditNotes } from '@/lib/services/creditNotesService';

export function CustomerPaymentsTab({ customerId }: { customerId: string }) {
  return <PaymentHistoryTable scope={{ customer_id: customerId }} emptyMessage="This customer has no recorded payments." />;
}

export function CustomerCreditNotesTab({ customerId }: { customerId: string }) {
  const query = useQuery({
    queryKey: creditNoteKeys.list({ customer_id: customerId }),
    queryFn: () => listCreditNotes({ customer_id: customerId }),
    staleTime: 15_000,
  });

  if (query.isLoading) return <Skeleton className="h-24 w-full" />;
  if (query.error) return <ErrorState title="Could not load credit notes" error={query.error} />;
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="No credit notes"
        description="Issue a credit note to refund or adjust this customer's invoices."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Credit note #
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Issued
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Amount
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Applied
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((cn) => (
            <tr key={cn.id} className="hover:bg-bg-muted">
              <td className="px-3 py-2 font-mono">
                <Link to={`/credit-notes/${cn.id}`} className="text-brand hover:underline">
                  {cn.credit_note_number}
                </Link>
              </td>
              <td className="px-3 py-2">
                <CreditNoteStatusBadge status={cn.status} />
              </td>
              <td className="px-3 py-2 text-fg-muted">{formatDate(cn.issue_date)}</td>
              <td className="px-3 py-2 text-right font-mono">
                {formatMoney(cn.amount_cents, { currency: cn.currency_code })}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {formatMoney(cn.applied_cents, { currency: cn.currency_code })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
