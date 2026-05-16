/**
 * InvoiceDetailPage — header summary + 5 tabs (overview / line items /
 * payments / credit notes / versions / history). The workflow buttons are
 * centralized in `InvoiceWorkflowButtons` (cap + transition gating). The
 * line editor is `InvoiceLineEditor` (drag-reorder, replace bulk POST).
 * Payments + Credit Notes tabs are read-only stubs that link OUT to
 * FE-B-owned pages.
 *
 * See TS1/09-api/00-API-CONTRACT.md §6 and the Wave 5 / 5.3a dispatch.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { SourceJETimeline } from '@/components/finance/SourceJETimeline';
import { ConvertFromProjectDialog } from '@/components/invoices/ConvertFromProjectDialog';
import { ConvertFromQuoteDialog } from '@/components/invoices/ConvertFromQuoteDialog';
import { InvoiceLineEditor } from '@/components/invoices/InvoiceLineEditor';
import { InvoiceStatusBadge } from '@/components/invoices/InvoiceStatusBadge';
import { InvoiceTotalsCard } from '@/components/invoices/InvoiceTotalsCard';
import { InvoiceWorkflowButtons } from '@/components/invoices/InvoiceWorkflowButtons';
import { PaymentStatusBadge } from '@/components/invoices/PaymentStatusBadge';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { creditNoteKeys } from '@/lib/queryKeys/creditNotes';
import { invoiceKeys } from '@/lib/queryKeys/invoices';
import { paymentKeys } from '@/lib/queryKeys/payments';
import { listCreditNotes } from '@/lib/services/creditNotesService';
import {
  duplicateInvoice,
  getInvoice,
  getInvoicePdf,
  holdInvoice,
  listInvoiceVersions,
  releaseInvoice,
  sendInvoice,
  submitInvoice,
  voidInvoice,
} from '@/lib/services/invoicesService';
import { listPayments } from '@/lib/services/paymentsService';

type Tab = 'overview' | 'lines' | 'payments' | 'credit_notes' | 'journal' | 'versions' | 'history';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'lines', label: 'Line items' },
  { id: 'payments', label: 'Payments' },
  { id: 'credit_notes', label: 'Credit notes' },
  { id: 'journal', label: 'Journal entries' },
  { id: 'versions', label: 'Versions' },
  { id: 'history', label: 'History' },
];

export default function InvoiceDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCapabilities();

  const invoiceQuery = useQuery({
    queryKey: invoiceKeys.detail(id),
    queryFn: () => getInvoice(id),
    enabled: id.length > 0,
    staleTime: 10_000,
  });

  const invoice = invoiceQuery.data;
  const [tab, setTab] = useState<Tab>('overview');
  const [showConvertQuote, setShowConvertQuote] = useState(false);
  const [showConvertProject, setShowConvertProject] = useState(false);

  function invalidate() {
    void qc.invalidateQueries({ queryKey: invoiceKeys.detail(id) });
    void qc.invalidateQueries({ queryKey: invoiceKeys.all });
  }

  const submitMutation = useMutation({
    mutationFn: () => submitInvoice(id),
    onSuccess: () => {
      toast.success('Invoice submitted');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Submit failed'),
  });

  const sendMutation = useMutation({
    mutationFn: () => sendInvoice(id),
    onSuccess: () => {
      toast.success('Invoice sent');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Send failed'),
  });

  const holdMutation = useMutation({
    mutationFn: () => holdInvoice(id),
    onSuccess: () => {
      toast.success('Invoice held');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Hold failed'),
  });

  const releaseMutation = useMutation({
    mutationFn: () => releaseInvoice(id),
    onSuccess: () => {
      toast.success('Invoice released');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Release failed'),
  });

  const voidMutation = useMutation({
    mutationFn: () => voidInvoice(id, { reason: 'Voided from SPA' }),
    onSuccess: () => {
      toast.success('Invoice voided');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Void failed'),
  });

  const duplicateMutation = useMutation({
    mutationFn: () => duplicateInvoice(id),
    onSuccess: (data) => {
      toast.success(`Duplicated as ${data.invoice_number}`);
      navigate(`/invoices/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Duplicate failed'),
  });

  const pdfMutation = useMutation({
    mutationFn: () => getInvoicePdf(id),
    onSuccess: () => {
      toast.message('PDF endpoint reserved', {
        description: 'Phase 19 will wire actual rendering.',
      });
    },
    onError: () => {
      // Server intentionally returns 501 today — surface the same UX.
      toast.message('PDF not yet available', {
        description: 'Phase 19 will wire actual rendering.',
      });
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/invoices" className="hover:underline">
          Invoices
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{invoice?.invoice_number ?? '…'}</span>
      </nav>

      {invoiceQuery.isLoading && <Skeleton className="h-32 w-full" />}
      {invoiceQuery.error && (
        <ErrorState title="Could not load invoice" error={invoiceQuery.error} />
      )}

      {invoice && (
        <>
          <section
            aria-labelledby="invoice-header-heading"
            className="space-y-3 rounded-md border border-border bg-bg p-4"
          >
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1
                  id="invoice-header-heading"
                  className="text-2xl font-semibold"
                  data-testid="invoice-number"
                >
                  {invoice.invoice_number}
                </h1>
                <p className="text-sm text-fg-muted">
                  Issued {formatDate(invoice.issue_date)} · Due {formatDate(invoice.due_date)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <InvoiceStatusBadge status={invoice.status} />
                <PaymentStatusBadge status={invoice.payment_status} />
              </div>
            </header>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Customer</dt>
                <dd className="text-fg">{invoice.customer_name_snapshot}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Currency</dt>
                <dd className="font-mono text-fg">{invoice.currency_code}</dd>
              </div>
              {invoice.external_ref && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-fg-subtle">External ref</dt>
                  <dd className="text-fg">{invoice.external_ref}</dd>
                </div>
              )}
              {invoice.recurring && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-fg-subtle">Recurring</dt>
                  <dd className="text-fg">{invoice.recurring}</dd>
                </div>
              )}
            </dl>

            <InvoiceTotalsCard
              currency={invoice.currency_code}
              subtotal_cents={invoice.subtotal_cents}
              discount_cents={invoice.discount_cents}
              tax_cents={invoice.tax_cents}
              total_cents={invoice.total_cents}
              paid_cents={invoice.paid_cents}
              balance_cents={invoice.balance_cents}
            />

            <div className="border-t border-border pt-3">
              <InvoiceWorkflowButtons
                status={invoice.status}
                onSubmit={() => submitMutation.mutate()}
                onSend={() => sendMutation.mutate()}
                onHold={() => holdMutation.mutate()}
                onRelease={() => releaseMutation.mutate()}
                onVoid={() => voidMutation.mutate()}
                onDuplicate={() => duplicateMutation.mutate()}
                onConvertFromQuote={() => setShowConvertQuote(true)}
                onConvertFromProject={() => setShowConvertProject(true)}
                onDownloadPdf={() => pdfMutation.mutate()}
                pending={{
                  submit: submitMutation.isPending,
                  send: sendMutation.isPending,
                  hold: holdMutation.isPending,
                  release: releaseMutation.isPending,
                  voidPending: voidMutation.isPending,
                  duplicate: duplicateMutation.isPending,
                  pdf: pdfMutation.isPending,
                }}
              />
            </div>
          </section>

          <nav
            className="flex flex-wrap gap-1 border-b border-border"
            role="tablist"
            aria-label="Invoice sections"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  '-mb-px rounded-t-md border border-transparent px-3 py-1.5 text-sm',
                  tab === t.id
                    ? 'border-border border-b-bg bg-bg font-medium text-fg'
                    : 'text-fg-muted hover:text-fg',
                )}
                data-testid={`tab-${t.id}`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === 'overview' && (
            <section className="space-y-2 rounded-md border border-border bg-bg p-4 text-sm text-fg-muted">
              <p>
                {invoice.notes ?? 'No notes.'}
              </p>
            </section>
          )}

          {tab === 'lines' && (
            <InvoiceLineEditor
              invoiceId={invoice.id}
              currency={invoice.currency_code}
              editable={invoice.status === 'draft' && can('invoices.write')}
              readOnlyReason="Line items are locked once the invoice leaves draft."
            />
          )}

          {tab === 'payments' && <PaymentsTab invoiceId={invoice.id} currency={invoice.currency_code} />}

          {tab === 'credit_notes' && (
            <CreditNotesTab invoiceId={invoice.id} currency={invoice.currency_code} />
          )}

          {tab === 'journal' && (
            <SourceJETimeline sourceType="invoice" sourceId={invoice.id} />
          )}

          {tab === 'versions' && <VersionsTab invoiceId={invoice.id} currency={invoice.currency_code} />}

          {tab === 'history' && (
            <section className="rounded-md border border-border bg-bg p-4 text-sm text-fg-muted">
              {/* TODO(Phase 17): wire audit_log surfacing here. */}
              History will surface audit_log entries in Phase 17.
            </section>
          )}
        </>
      )}

      <ConvertFromQuoteDialog
        open={showConvertQuote}
        onClose={() => setShowConvertQuote(false)}
      />
      <ConvertFromProjectDialog
        open={showConvertProject}
        onClose={() => setShowConvertProject(false)}
      />
    </div>
  );
}

function PaymentsTab({ invoiceId, currency }: { invoiceId: string; currency: string }) {
  const query = useQuery({
    queryKey: [...paymentKeys.list({ invoice_id: invoiceId })],
    queryFn: () => listPayments({ invoice_id: invoiceId }),
    staleTime: 10_000,
  });

  const items = query.data?.items ?? [];

  return (
    <section
      aria-label="Payments"
      className="space-y-3 rounded-md border border-border bg-bg p-4"
      data-testid="payments-tab"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Payments</h2>
        <Link
          to={`/payments/new?invoice_id=${invoiceId}`}
          className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          data-testid="record-payment-link"
        >
          Record payment
        </Link>
      </header>
      {query.isLoading && <p className="text-sm text-fg-muted">Loading payments…</p>}
      {query.error && <ErrorState title="Could not load payments" error={query.error} />}
      {!query.isLoading && items.length === 0 && (
        <p className="text-sm text-fg-muted">No payments recorded.</p>
      )}
      {items.length > 0 && (
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
            <tr>
              <th className="px-3 py-2">Payment #</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 font-mono">{p.payment_number}</td>
                <td className="px-3 py-2 text-fg-muted">{formatDate(p.paid_at)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  <MoneyDisplay cents={p.amount_cents} currency={currency} />
                </td>
                <td className="px-3 py-2 text-fg-muted">{p.reference ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CreditNotesTab({ invoiceId, currency }: { invoiceId: string; currency: string }) {
  const query = useQuery({
    queryKey: [...creditNoteKeys.list({ invoice_id: invoiceId })],
    queryFn: () => listCreditNotes({ invoice_id: invoiceId }),
    staleTime: 10_000,
  });

  const items = query.data?.items ?? [];

  return (
    <section
      aria-label="Credit notes"
      className="space-y-3 rounded-md border border-border bg-bg p-4"
      data-testid="credit-notes-tab"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Credit notes</h2>
        <Link
          to={`/credit-notes/new?invoice_id=${invoiceId}`}
          className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          data-testid="apply-credit-link"
        >
          Apply credit
        </Link>
      </header>
      {query.isLoading && <p className="text-sm text-fg-muted">Loading credit notes…</p>}
      {query.error && <ErrorState title="Could not load credit notes" error={query.error} />}
      {!query.isLoading && items.length === 0 && (
        <p className="text-sm text-fg-muted">No credit notes.</p>
      )}
      {items.length > 0 && (
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
            <tr>
              <th className="px-3 py-2">Credit note #</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Issued</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((cn) => (
              <tr key={cn.id}>
                <td className="px-3 py-2 font-mono">{cn.credit_note_number}</td>
                <td className="px-3 py-2">{cn.status}</td>
                <td className="px-3 py-2 text-right font-mono">
                  <MoneyDisplay cents={cn.amount_cents} currency={currency} />
                </td>
                <td className="px-3 py-2 text-fg-muted">{formatDate(cn.issue_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function VersionsTab({ invoiceId, currency }: { invoiceId: string; currency: string }) {
  const query = useQuery({
    queryKey: invoiceKeys.versions(invoiceId),
    queryFn: () => listInvoiceVersions(invoiceId),
    staleTime: 30_000,
  });

  const items = (query.data?.items ?? []).slice().sort((a, b) => b.version_number - a.version_number);

  return (
    <section
      aria-label="Versions"
      className="space-y-3 rounded-md border border-border bg-bg p-4"
      data-testid="versions-tab"
    >
      <h2 className="text-lg font-semibold">Versions</h2>
      {query.isLoading && <p className="text-sm text-fg-muted">Loading versions…</p>}
      {query.error && <ErrorState title="Could not load versions" error={query.error} />}
      {!query.isLoading && items.length === 0 && (
        <p className="text-sm text-fg-muted">No versions recorded.</p>
      )}
      {items.length > 0 && (
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
            <tr>
              <th className="px-3 py-2">v#</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Payment</th>
              <th className="px-3 py-2 text-right">Subtotal</th>
              <th className="px-3 py-2 text-right">Tax</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Captured</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((v) => (
              <tr key={v.id}>
                <td className="px-3 py-2 font-mono">v{v.version_number}</td>
                <td className="px-3 py-2">{v.status}</td>
                <td className="px-3 py-2">{v.payment_status}</td>
                <td className="px-3 py-2 text-right font-mono">
                  <MoneyDisplay cents={v.subtotal_cents} currency={currency} />
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  <MoneyDisplay cents={v.tax_cents} currency={currency} />
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  <MoneyDisplay cents={v.total_cents} currency={currency} />
                </td>
                <td className="px-3 py-2 text-fg-muted">{formatDate(v.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
