/**
 * JournalEntryFormPage — Wave 8 / Phase 12. Draft create only.
 * (Patching existing drafts happens from the detail page's "Edit" affordance,
 * which routes here in edit mode via the `entryId` prop / param.)
 *
 * Constraints:
 *   - >= 2 lines
 *   - exactly one of debit/credit > 0 per line
 *   - sum Dr === sum Cr (SPA-side balance check before POST; BE 422 backstop)
 *
 * Validates via Zod at submit.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { JournalEntryEditor } from '@/components/finance/JournalEntryEditor';
import {
  emptyJELine,
  type JEEditorLine,
} from '@/components/finance/journalEntryEditorHelpers';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { journalEntryKeys } from '@/lib/queryKeys/journalEntries';
import {
  createJournalEntry,
  getJournalEntry,
  sumLines,
  updateJournalEntry,
} from '@/lib/services/journalEntriesService';
import {
  JournalEntryCreateSchema,
  JournalEntryPatchSchema,
  type JournalEntryCreate,
  type JournalEntryLineInput,
  type JournalEntryPatch,
} from '@/lib/types';

interface FormState {
  entry_date: string;
  description: string;
  currency_code: string;
  lines: JEEditorLine[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): FormState {
  return {
    entry_date: todayIso(),
    description: '',
    currency_code: 'USD',
    lines: [emptyJELine(), emptyJELine()],
  };
}

export default function JournalEntryFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id) && id !== 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm());

  const existing = useQuery({
    queryKey: id ? journalEntryKeys.detail(id) : ['journal-entries', 'new'],
    queryFn: () => getJournalEntry(id!),
    enabled: isEdit,
  });

  useEffect(() => {
    if (isEdit && existing.data) {
      setForm({
        entry_date: existing.data.entry_date,
        description: existing.data.description ?? '',
        currency_code: existing.data.currency_code,
        lines: existing.data.lines.map((l) => ({
          account_id: l.account_id,
          debit_cents: Number(l.debit_cents),
          credit_cents: Number(l.credit_cents),
          memo: l.memo ?? '',
        })),
      });
    }
  }, [isEdit, existing.data]);

  const createMutation = useMutation({
    mutationFn: (body: JournalEntryCreate) => createJournalEntry(body),
    onSuccess: (data) => {
      toast.success(`Journal entry ${data.entry_number} created`);
      void qc.invalidateQueries({ queryKey: journalEntryKeys.all });
      navigate(`/finance/journal-entries/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Create failed'),
  });

  const patchMutation = useMutation({
    mutationFn: (body: JournalEntryPatch) => updateJournalEntry(id!, body),
    onSuccess: (data) => {
      toast.success('Journal entry updated');
      void qc.invalidateQueries({ queryKey: journalEntryKeys.detail(data.id) });
      void qc.invalidateQueries({ queryKey: journalEntryKeys.all });
      navigate(`/finance/journal-entries/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Save failed'),
  });

  const submitting = createMutation.isPending || patchMutation.isPending;
  const balance = sumLines(form.lines);
  const allLinesValid = form.lines.every(
    (l) =>
      l.account_id !== '' &&
      (l.debit_cents > 0) !== (l.credit_cents > 0) &&
      l.debit_cents + l.credit_cents > 0,
  );
  const canSubmit = form.lines.length >= 2 && allLinesValid && balance.balanced;

  function buildLines(): JournalEntryLineInput[] {
    return form.lines.map((l, idx) => ({
      account_id: l.account_id,
      debit_cents: l.debit_cents,
      credit_cents: l.credit_cents,
      memo: l.memo.trim() === '' ? null : l.memo.trim(),
      position: idx,
    }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!balance.balanced) {
      toast.error('Entry is not balanced (debit must equal credit)');
      return;
    }
    try {
      if (isEdit) {
        const body = JournalEntryPatchSchema.parse({
          entry_date: form.entry_date,
          description: form.description.trim() === '' ? null : form.description.trim(),
          currency_code: form.currency_code,
          lines: buildLines(),
        } satisfies JournalEntryPatch);
        patchMutation.mutate(body);
      } else {
        const body = JournalEntryCreateSchema.parse({
          entry_date: form.entry_date,
          description: form.description.trim() === '' ? null : form.description.trim(),
          currency_code: form.currency_code,
          lines: buildLines(),
        } satisfies JournalEntryCreate);
        createMutation.mutate(body);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Validation failed');
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/finance/journal-entries" className="hover:underline">
          Journal entries
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">
          {isEdit ? existing.data?.entry_number ?? '…' : 'New'}
        </span>
      </nav>

      <h1 className="text-2xl font-semibold">
        {isEdit ? 'Edit journal entry' : 'New journal entry'}
      </h1>

      {existing.isLoading && <Skeleton className="h-64 w-full" />}
      {existing.error && <ErrorState title="Could not load entry" error={existing.error} />}

      {(!isEdit || existing.data) && (
        <form onSubmit={submit} className="space-y-4" data-testid="je-form">
          <section className="grid gap-3 rounded-md border border-border bg-bg p-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs uppercase tracking-wide text-fg-subtle">Entry date</span>
              <input
                type="date"
                required
                value={form.entry_date}
                onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
                className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
                data-testid="je-entry-date"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs uppercase tracking-wide text-fg-subtle">Currency</span>
              <input
                type="text"
                maxLength={3}
                required
                value={form.currency_code}
                onChange={(e) =>
                  setForm({ ...form, currency_code: e.target.value.toUpperCase() })
                }
                className="rounded-md border border-border bg-bg px-2 py-1 text-sm font-mono uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-3">
              <span className="text-xs uppercase tracking-wide text-fg-subtle">Description</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                maxLength={4000}
                className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </label>
          </section>

          <JournalEntryEditor
            lines={form.lines}
            onChange={(lines) => setForm({ ...form, lines })}
            currency={form.currency_code || 'USD'}
            editable
          />

          <div className="flex items-center justify-end gap-3">
            {!balance.balanced && (
              <span className="text-xs text-danger" data-testid="je-form-imbalance-warning">
                Entry must be balanced before submitting.
              </span>
            )}
            <Link
              to={isEdit && id ? `/finance/journal-entries/${id}` : '/finance/journal-entries'}
              className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
              data-testid="je-form-submit"
            >
              {submitting ? 'Saving…' : isEdit ? 'Save draft' : 'Create draft'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
