/**
 * JournalEntryDetailPage — Wave 8 / Phase 12. Header + lines table +
 * workflow buttons (Post / Reverse). Reverse opens a confirm modal and
 * shows the resulting mirror entry on success.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { JEStatusBadge } from '@/components/finance/JEStatusBadge';
import { JEWorkflowButtons } from '@/components/finance/JEWorkflowButtons';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { journalEntryKeys } from '@/lib/queryKeys/journalEntries';
// Phase 16 (Wave 10 Session 2) — B1 owns this block.
import { CollaborationSection } from '@/components/collaboration/CollaborationSection';
// End Phase 16 (Wave 10 Session 2).
import {
  getJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  sumLines,
} from '@/lib/services/journalEntriesService';

export default function JournalEntryDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCapabilities();
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('');

  const query = useQuery({
    queryKey: journalEntryKeys.detail(id),
    queryFn: () => getJournalEntry(id),
    enabled: id.length > 0,
    staleTime: 10_000,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: journalEntryKeys.detail(id) });
    void qc.invalidateQueries({ queryKey: journalEntryKeys.all });
  }

  const postMutation = useMutation({
    mutationFn: () => postJournalEntry(id),
    onSuccess: () => {
      toast.success('Journal entry posted');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Post failed'),
  });

  const reverseMutation = useMutation({
    mutationFn: (reason: string | undefined) =>
      reverseJournalEntry(id, reason ? { reason } : {}),
    onSuccess: (data) => {
      toast.success(`Reversed — mirror entry ${data.entry_number} created`);
      setReverseOpen(false);
      setReverseReason('');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Reverse failed'),
  });

  const je = query.data;
  const normalizedLines = je
    ? je.lines.map((l) => ({
        ...l,
        debit_cents: Number(l.debit_cents),
        credit_cents: Number(l.credit_cents),
      }))
    : [];
  const totals = je
    ? sumLines(normalizedLines)
    : { debit: 0, credit: 0, balanced: false, diff: 0 };

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/finance/journal-entries" className="hover:underline">
          Journal entries
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{je?.entry_number ?? '…'}</span>
      </nav>

      {query.isLoading && <Skeleton className="h-32 w-full" />}
      {query.error && <ErrorState title="Could not load entry" error={query.error} />}

      {je && (
        <>
          <section className="space-y-3 rounded-md border border-border bg-bg p-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold" data-testid="je-entry-number">
                  {je.entry_number}
                </h1>
                <p className="text-sm text-fg-muted">Entry date {formatDate(je.entry_date)}</p>
              </div>
              <JEStatusBadge status={je.status} />
            </header>

            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Currency</dt>
                <dd className="font-mono text-fg">{je.currency_code}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Source type</dt>
                <dd className="text-fg-muted">{je.source_type ?? '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Source id</dt>
                <dd className="font-mono text-xs text-fg-muted">{je.source_id ?? '—'}</dd>
              </div>
              {je.posted_at && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-fg-subtle">Posted at</dt>
                  <dd className="text-fg">{formatDate(je.posted_at)}</dd>
                </div>
              )}
              {je.reversed_at && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-fg-subtle">Reversed at</dt>
                  <dd className="text-fg">{formatDate(je.reversed_at)}</dd>
                </div>
              )}
              {je.reversed_by_entry_id && (
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-fg-subtle">
                    Reversed by entry
                  </dt>
                  <dd className="font-mono text-xs">
                    <Link
                      to={`/finance/journal-entries/${je.reversed_by_entry_id}`}
                      className="text-brand hover:underline"
                      data-testid="je-reversed-by-link"
                    >
                      {je.reversed_by_entry_id}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>

            {je.description && <p className="text-sm text-fg">{je.description}</p>}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <JEWorkflowButtons
                status={je.status}
                onPost={() => postMutation.mutate()}
                onReverse={() => setReverseOpen(true)}
                pending={{
                  post: postMutation.isPending,
                  reverse: reverseMutation.isPending,
                }}
              />
              {je.status === 'draft' && can('finance.journal_entries.write') && (
                <button
                  type="button"
                  onClick={() => navigate(`/finance/journal-entries/${je.id}/edit`)}
                  className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
                  data-testid="je-edit"
                >
                  Edit
                </button>
              )}
            </div>
          </section>

          <section
            aria-labelledby="je-lines-heading"
            className="space-y-3 rounded-md border border-border bg-bg p-4"
          >
            <h2 id="je-lines-heading" className="text-lg font-semibold">
              Lines
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">#</th>
                    <th scope="col" className="px-3 py-2 font-medium">Account</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Debit</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Credit</th>
                    <th scope="col" className="px-3 py-2 font-medium">Memo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {normalizedLines.map((line) => (
                    <tr key={line.id} data-testid={`je-detail-line-${line.id}`}>
                      <td className="px-3 py-2 text-fg-muted">{line.position + 1}</td>
                      <td className="px-3 py-2 font-mono text-xs text-fg">
                        {line.account_id.slice(0, 8)}…
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {line.debit_cents > 0 ? (
                          <MoneyDisplay cents={line.debit_cents} currency={je.currency_code} />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {line.credit_cents > 0 ? (
                          <MoneyDisplay cents={line.credit_cents} currency={je.currency_code} />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">{line.memo ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-bg-muted text-sm">
                  <tr>
                    <th scope="row" colSpan={2} className="px-3 py-2 text-right font-medium">
                      Totals
                    </th>
                    <td className="px-3 py-2 text-right font-mono" data-testid="je-detail-total-debit">
                      <MoneyDisplay cents={totals.debit} currency={je.currency_code} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono" data-testid="je-detail-total-credit">
                      <MoneyDisplay cents={totals.credit} currency={je.currency_code} />
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {totals.balanced ? (
                        <span className="text-success">Balanced</span>
                      ) : (
                        <span className="text-danger">Out of balance</span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {reverseOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="je-reverse-heading"
              className="fixed inset-0 z-30 flex items-center justify-center bg-fg/40 px-4"
              data-testid="je-reverse-dialog"
            >
              <div className="w-full max-w-md space-y-4 rounded-md border border-border bg-bg p-5 shadow-lg">
                <h2 id="je-reverse-heading" className="text-lg font-semibold">
                  Reverse journal entry
                </h2>
                <p className="text-sm text-fg-muted">
                  This will create a mirror entry and mark this entry reversed. Continue?
                </p>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs uppercase tracking-wide text-fg-subtle">
                    Reason (optional)
                  </span>
                  <textarea
                    value={reverseReason}
                    onChange={(e) => setReverseReason(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
                    data-testid="je-reverse-reason"
                  />
                </label>
                <div className="flex justify-end gap-2 border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => setReverseOpen(false)}
                    className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={reverseMutation.isPending}
                    onClick={() =>
                      reverseMutation.mutate(
                        reverseReason.trim() === '' ? undefined : reverseReason.trim(),
                      )
                    }
                    className="rounded-md border border-danger/40 bg-bg px-3 py-1 text-sm text-danger hover:bg-danger/5 disabled:opacity-50"
                    data-testid="je-reverse-confirm"
                  >
                    {reverseMutation.isPending ? 'Reversing…' : 'Reverse entry'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    {/* Phase 16 (Wave 10 Session 2) — B1 owns this block. */}
    {id && <CollaborationSection entityType="journal_entry" entityId={id} idPrefix="je-collab" />}
    {/* End Phase 16 (Wave 10 Session 2). */}

    </div>
  );
}
