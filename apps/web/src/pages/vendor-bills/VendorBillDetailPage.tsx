/**
 * VendorBillDetailPage — header + workflow buttons + pay dialog. Bills
 * are header-only; no line editor here.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { SourceJETimeline } from '@/components/finance/SourceJETimeline';
import { VendorBillPayDialog } from '@/components/procurement/VendorBillPayDialog';
import { VendorBillStatusBadge } from '@/components/procurement/VendorBillStatusBadge';
import { VendorBillWorkflowButtons } from '@/components/procurement/VendorBillWorkflowButtons';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { vendorBillKeys } from '@/lib/queryKeys/vendorBills';
// Phase 16 (Wave 10 Session 2) — B1 owns this block.
import { CollaborationSection } from '@/components/collaboration/CollaborationSection';
// End Phase 16 (Wave 10 Session 2).
import {
  approveVendorBill,
  cancelVendorBill,
  getVendorBill,
  submitVendorBill,
} from '@/lib/services/vendorBillsService';

export default function VendorBillDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCapabilities();
  const [showPay, setShowPay] = useState(false);

  const query = useQuery({
    queryKey: vendorBillKeys.detail(id),
    queryFn: () => getVendorBill(id),
    enabled: id.length > 0,
    staleTime: 10_000,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: vendorBillKeys.detail(id) });
    void qc.invalidateQueries({ queryKey: vendorBillKeys.all });
  }

  const submitMutation = useMutation({
    mutationFn: () => submitVendorBill(id),
    onSuccess: () => {
      toast.success('Bill submitted');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Submit failed'),
  });

  const approveMutation = useMutation({
    mutationFn: () => approveVendorBill(id),
    onSuccess: () => {
      toast.success('Bill approved');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Approve failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelVendorBill(id),
    onSuccess: () => {
      toast.success('Bill cancelled');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Cancel failed'),
  });

  const bill = query.data;

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/vendor-bills" className="hover:underline">
          Vendor bills
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{bill?.bill_number ?? '…'}</span>
      </nav>

      {query.isLoading && <Skeleton className="h-32 w-full" />}
      {query.error && <ErrorState title="Could not load vendor bill" error={query.error} />}

      {bill && (
        <>
          <section className="space-y-3 rounded-md border border-border bg-bg p-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold" data-testid="vb-number">
                  {bill.bill_number}
                </h1>
                <p className="text-sm text-fg-muted">
                  Issued {formatDate(bill.issue_date)} · Due {formatDate(bill.due_date)}
                </p>
              </div>
              <VendorBillStatusBadge status={bill.status} />
            </header>

            <dl className="grid gap-3 text-sm sm:grid-cols-5">
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Currency</dt>
                <dd className="font-mono text-fg">{bill.currency_code}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Subtotal</dt>
                <dd className="font-mono text-fg">
                  <MoneyDisplay cents={bill.subtotal_cents} currency={bill.currency_code} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Tax</dt>
                <dd className="font-mono text-fg">
                  <MoneyDisplay cents={bill.tax_cents} currency={bill.currency_code} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Total</dt>
                <dd className="font-mono text-fg">
                  <MoneyDisplay cents={bill.total_cents} currency={bill.currency_code} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Balance</dt>
                <dd className="font-mono text-lg font-semibold text-fg">
                  <MoneyDisplay cents={bill.balance_cents} currency={bill.currency_code} />
                </dd>
              </div>
            </dl>

            {bill.vendor_ref && (
              <p className="text-sm text-fg-muted">
                Vendor reference: <span className="font-mono text-fg">{bill.vendor_ref}</span>
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <VendorBillWorkflowButtons
                status={bill.status}
                onSubmit={() => submitMutation.mutate()}
                onApprove={() => approveMutation.mutate()}
                onPay={() => setShowPay(true)}
                onCancel={() => cancelMutation.mutate()}
                pending={{
                  submit: submitMutation.isPending,
                  approve: approveMutation.isPending,
                  cancelPending: cancelMutation.isPending,
                }}
              />
              {bill.status === 'draft' && can('vendor_bills.write') && (
                <button
                  type="button"
                  onClick={() => navigate(`/vendor-bills/${bill.id}/edit`)}
                  className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
                  data-testid="vb-edit"
                >
                  Edit
                </button>
              )}
            </div>
          </section>

          {bill.notes && (
            <section className="rounded-md border border-border bg-bg p-4 text-sm text-fg-muted">
              <h2 className="mb-2 text-xs uppercase tracking-wide text-fg-subtle">Notes</h2>
              <p className="whitespace-pre-line">{bill.notes}</p>
            </section>
          )}

          <SourceJETimeline sourceType="vendor_bill" sourceId={bill.id} />

          <VendorBillPayDialog open={showPay} bill={bill} onClose={() => setShowPay(false)} />
        </>
      )}
    {/* Phase 16 (Wave 10 Session 2) — B1 owns this block. */}
    {id && <CollaborationSection entityType="vendor_bill" entityId={id} idPrefix="vendorbill-collab" />}
    {/* End Phase 16 (Wave 10 Session 2). */}

    </div>
  );
}
