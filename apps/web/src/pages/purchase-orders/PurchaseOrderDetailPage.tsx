/**
 * PurchaseOrderDetailPage — header + line editor + workflow buttons.
 * Lines come back inline on the GET response. Optimistic mutation pattern
 * mirrors InvoiceDetailPage.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { POLineEditor } from '@/components/procurement/POLineEditor';
import { POReceiveDialog } from '@/components/procurement/POReceiveDialog';
import { PurchaseOrderStatusBadge } from '@/components/procurement/PurchaseOrderStatusBadge';
import { PurchaseOrderWorkflowButtons } from '@/components/procurement/PurchaseOrderWorkflowButtons';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { purchaseOrderKeys } from '@/lib/queryKeys/purchaseOrders';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  getPurchaseOrder,
  submitPurchaseOrder,
} from '@/lib/services/purchaseOrdersService';

export default function PurchaseOrderDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCapabilities();
  const [showReceive, setShowReceive] = useState(false);

  const query = useQuery({
    queryKey: purchaseOrderKeys.detail(id),
    queryFn: () => getPurchaseOrder(id),
    enabled: id.length > 0,
    staleTime: 10_000,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: purchaseOrderKeys.detail(id) });
    void qc.invalidateQueries({ queryKey: purchaseOrderKeys.all });
  }

  const submitMutation = useMutation({
    mutationFn: () => submitPurchaseOrder(id),
    onSuccess: () => {
      toast.success('PO submitted');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Submit failed'),
  });

  const approveMutation = useMutation({
    mutationFn: () => approvePurchaseOrder(id),
    onSuccess: () => {
      toast.success('PO approved');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Approve failed'),
  });

  const closeMutation = useMutation({
    mutationFn: () => closePurchaseOrder(id),
    onSuccess: () => {
      toast.success('PO closed');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Close failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelPurchaseOrder(id),
    onSuccess: () => {
      toast.success('PO cancelled');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Cancel failed'),
  });

  const po = query.data;

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/purchase-orders" className="hover:underline">
          Purchase orders
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{po?.po_number ?? '…'}</span>
      </nav>

      {query.isLoading && <Skeleton className="h-32 w-full" />}
      {query.error && <ErrorState title="Could not load PO" error={query.error} />}

      {po && (
        <>
          <section
            aria-labelledby="po-header-heading"
            className="space-y-3 rounded-md border border-border bg-bg p-4"
          >
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1
                  id="po-header-heading"
                  className="text-2xl font-semibold"
                  data-testid="po-number"
                >
                  {po.po_number}
                </h1>
                <p className="text-sm text-fg-muted">
                  Issued {formatDate(po.issue_date)}
                  {po.expected_date && ` · Expected ${formatDate(po.expected_date)}`}
                </p>
              </div>
              <PurchaseOrderStatusBadge status={po.status} />
            </header>

            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Currency</dt>
                <dd className="font-mono text-fg">{po.currency_code}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Subtotal</dt>
                <dd className="font-mono text-fg">
                  <MoneyDisplay cents={po.subtotal_cents} currency={po.currency_code} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Tax + shipping</dt>
                <dd className="font-mono text-fg">
                  <MoneyDisplay
                    cents={Number(po.tax_cents) + Number(po.shipping_cents)}
                    currency={po.currency_code}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Total</dt>
                <dd className="font-mono text-lg font-semibold text-fg">
                  <MoneyDisplay cents={po.total_cents} currency={po.currency_code} />
                </dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <PurchaseOrderWorkflowButtons
                status={po.status}
                onSubmit={() => submitMutation.mutate()}
                onApprove={() => approveMutation.mutate()}
                onReceive={() => setShowReceive(true)}
                onClose={() => closeMutation.mutate()}
                onCancel={() => cancelMutation.mutate()}
                pending={{
                  submit: submitMutation.isPending,
                  approve: approveMutation.isPending,
                  closePending: closeMutation.isPending,
                  cancelPending: cancelMutation.isPending,
                }}
              />
              {po.status === 'draft' && can('purchase_orders.write') && (
                <button
                  type="button"
                  onClick={() => navigate(`/purchase-orders/${po.id}/edit`)}
                  className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
                  data-testid="po-edit"
                >
                  Edit header
                </button>
              )}
            </div>
          </section>

          <POLineEditor
            poId={po.id}
            lines={po.lines}
            currency={po.currency_code}
            editable={po.status === 'draft' && can('purchase_orders.write')}
            readOnlyReason="Lines are locked once the PO leaves draft."
          />

          {po.notes && (
            <section className="rounded-md border border-border bg-bg p-4 text-sm text-fg-muted">
              <h2 className="mb-2 text-xs uppercase tracking-wide text-fg-subtle">Notes</h2>
              <p className="whitespace-pre-line">{po.notes}</p>
            </section>
          )}

          <POReceiveDialog
            open={showReceive}
            poId={po.id}
            currency={po.currency_code}
            lines={po.lines}
            onClose={() => setShowReceive(false)}
          />
        </>
      )}
    </div>
  );
}
