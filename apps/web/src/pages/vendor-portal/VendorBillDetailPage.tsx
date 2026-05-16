/**
 * VendorBillDetailPage — vendor's bill detail (Phase 22).
 */
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { vendorPortalKeys } from '@/lib/queryKeys/vendorPortal';
import { getPortalVendorBill } from '@/lib/services/vendorPortalService';
import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';

export default function VendorBillDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: vendorPortalKeys.billDetail(id),
    queryFn: () => getPortalVendorBill(id),
    enabled: id.length > 0,
  });

  if (q.isLoading) return <p className="p-6 text-fg-muted">Loading…</p>;
  if (q.isError || !q.data) return <p className="p-6 text-red-600">Failed to load bill.</p>;

  const b = q.data;
  const currency = (b.currency_code as string | undefined) ?? 'USD';

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{b.bill_number}</h1>
        <p className="text-sm text-fg-muted">Status {b.status}</p>
      </header>
      <section className="rounded-md border border-border bg-bg p-4">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-fg-muted">Issued</dt>
          <dd>{formatDate(b.issue_date)}</dd>
          <dt className="text-fg-muted">Due</dt>
          <dd>{formatDate(b.due_date)}</dd>
          <dt className="text-fg-muted">Subtotal</dt>
          <dd>{formatMoney(b.subtotal_cents ?? 0, { currency })}</dd>
          <dt className="text-fg-muted">Tax</dt>
          <dd>{formatMoney(b.tax_cents ?? 0, { currency })}</dd>
          <dt className="text-fg-muted font-semibold">Total</dt>
          <dd className="font-semibold">{formatMoney(b.total_cents ?? 0, { currency })}</dd>
          <dt className="text-fg-muted">Paid</dt>
          <dd>{formatMoney(b.paid_cents ?? 0, { currency })}</dd>
          <dt className="text-fg-muted font-semibold">Balance</dt>
          <dd className="font-semibold">{formatMoney(b.balance_cents ?? 0, { currency })}</dd>
        </dl>
      </section>
    </div>
  );
}
