/**
 * ExpenseDetailPage — header + workflow buttons. Rejection reason is
 * parsed out of `notes` via the regex `\[REJECTED .* by .*\]: (.*)$`
 * (constitutional invariant — BE handler appends this marker).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ExpenseStatusBadge } from '@/components/expenses/ExpenseStatusBadge';
import { ExpenseWorkflowButtons } from '@/components/expenses/ExpenseWorkflowButtons';
import { SourceJETimeline } from '@/components/finance/SourceJETimeline';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { expenseKeys } from '@/lib/queryKeys/expenses';
// Phase 16 (Wave 10 Session 2) — B1 owns this block.
import { CollaborationSection } from '@/components/collaboration/CollaborationSection';
// End Phase 16 (Wave 10 Session 2).
import {
  approveExpense,
  getExpense,
  parseExpenseRejection,
  payExpense,
  reimburseExpense,
  rejectExpense,
  submitExpense,
} from '@/lib/services/expensesService';

export default function ExpenseDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCapabilities();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const query = useQuery({
    queryKey: expenseKeys.detail(id),
    queryFn: () => getExpense(id),
    enabled: id.length > 0,
    staleTime: 10_000,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: expenseKeys.detail(id) });
    void qc.invalidateQueries({ queryKey: expenseKeys.all });
  }

  const submitMutation = useMutation({
    mutationFn: () => submitExpense(id),
    onSuccess: () => {
      toast.success('Expense submitted');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Submit failed'),
  });

  const approveMutation = useMutation({
    mutationFn: () => approveExpense(id),
    onSuccess: () => {
      toast.success('Expense approved');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Approve failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => rejectExpense(id, { reason }),
    onSuccess: () => {
      toast.success('Expense rejected');
      setRejectOpen(false);
      setRejectReason('');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Reject failed'),
  });

  const reimburseMutation = useMutation({
    mutationFn: () => reimburseExpense(id),
    onSuccess: () => {
      toast.success('Expense reimbursed');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Reimburse failed'),
  });

  const payMutation = useMutation({
    mutationFn: () => payExpense(id),
    onSuccess: () => {
      toast.success('Expense paid');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Pay failed'),
  });

  const expense = query.data;
  const rejection = expense && expense.status === 'rejected'
    ? parseExpenseRejection(expense.notes)
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/expenses" className="hover:underline">
          Expenses
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{expense?.expense_number ?? '…'}</span>
      </nav>

      {query.isLoading && <Skeleton className="h-32 w-full" />}
      {query.error && <ErrorState title="Could not load expense" error={query.error} />}

      {expense && (
        <>
          <section className="space-y-3 rounded-md border border-border bg-bg p-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold" data-testid="expense-number">
                  {expense.expense_number}
                </h1>
                <p className="text-sm text-fg-muted">Spent {formatDate(expense.spent_at)}</p>
              </div>
              <ExpenseStatusBadge status={expense.status} />
            </header>

            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Currency</dt>
                <dd className="font-mono text-fg">{expense.currency_code}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Amount</dt>
                <dd className="font-mono text-fg">
                  <MoneyDisplay cents={expense.amount_cents} currency={expense.currency_code} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Tax</dt>
                <dd className="font-mono text-fg">
                  <MoneyDisplay cents={expense.tax_cents} currency={expense.currency_code} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Total</dt>
                <dd className="font-mono text-lg font-semibold text-fg">
                  <MoneyDisplay cents={expense.total_cents} currency={expense.currency_code} />
                </dd>
              </div>
            </dl>

            {expense.description && (
              <p className="text-sm text-fg">{expense.description}</p>
            )}

            {expense.receipt_url && (
              <p className="text-sm">
                <span className="text-xs uppercase tracking-wide text-fg-subtle">Receipt: </span>
                <a
                  className="text-brand hover:underline"
                  href={expense.receipt_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {expense.receipt_url}
                </a>
              </p>
            )}

            {rejection && (
              <div
                className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm"
                data-testid="rejection-reason"
              >
                <p className="font-medium text-danger">Rejection reason</p>
                <p className="mt-1 text-fg">{rejection}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <ExpenseWorkflowButtons
                status={expense.status}
                onSubmit={() => submitMutation.mutate()}
                onApprove={() => approveMutation.mutate()}
                onReject={() => setRejectOpen(true)}
                onReimburse={() => reimburseMutation.mutate()}
                onPay={() => payMutation.mutate()}
                pending={{
                  submit: submitMutation.isPending,
                  approve: approveMutation.isPending,
                  reject: rejectMutation.isPending,
                  reimburse: reimburseMutation.isPending,
                  pay: payMutation.isPending,
                }}
              />
              {(expense.status === 'draft' || expense.status === 'rejected') &&
                can('expenses.write') && (
                  <button
                    type="button"
                    onClick={() => navigate(`/expenses/${expense.id}/edit`)}
                    className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
                    data-testid="expense-edit"
                  >
                    Edit
                  </button>
                )}
            </div>
          </section>

          {expense.notes && (
            <section className="rounded-md border border-border bg-bg p-4 text-sm text-fg-muted">
              <h2 className="mb-2 text-xs uppercase tracking-wide text-fg-subtle">Notes</h2>
              <p className="whitespace-pre-line">{expense.notes}</p>
            </section>
          )}

          <SourceJETimeline sourceType="expense" sourceId={expense.id} />

          {rejectOpen && (
            <div
              role="dialog"
              aria-modal
              aria-labelledby="exp-reject-heading"
              className="fixed inset-0 z-30 flex items-center justify-center bg-fg/40 px-4"
              data-testid="reject-dialog"
            >
              <div className="w-full max-w-md space-y-4 rounded-md border border-border bg-bg p-5 shadow-lg">
                <h2 id="exp-reject-heading" className="text-lg font-semibold">
                  Reject expense
                </h2>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs uppercase tracking-wide text-fg-subtle">Reason</span>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={4}
                    required
                    className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
                    data-testid="reject-reason-input"
                  />
                </label>
                <div className="flex justify-end gap-2 border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => setRejectOpen(false)}
                    className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={rejectReason.trim() === '' || rejectMutation.isPending}
                    onClick={() => rejectMutation.mutate(rejectReason.trim())}
                    className="rounded-md border border-danger/40 bg-bg px-3 py-1 text-sm text-danger hover:bg-danger/5 disabled:opacity-50"
                    data-testid="reject-submit"
                  >
                    {rejectMutation.isPending ? 'Rejecting…' : 'Reject'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    {/* Phase 16 (Wave 10 Session 2) — B1 owns this block. */}
    {id && <CollaborationSection entityType="expense" entityId={id} idPrefix="expense-collab" />}
    {/* End Phase 16 (Wave 10 Session 2). */}

    </div>
  );
}
