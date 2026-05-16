/**
 * JournalEntryEditor — in-memory debit/credit line editor. Owned by
 * the parent form page (JournalEntryFormPage). On submit the parent
 * sends `lines` as part of the create/patch body (BE applies a full
 * replace on patch). Constraints (mirrored from `JournalEntryLineInputSchema`):
 *
 *   - exactly one of debit_cents / credit_cents > 0 per line
 *   - >= 2 lines
 *   - SPA-side balance check (sum Dr === sum Cr) before submit; BE 422 is
 *     the backstop with a diff
 *
 * The editor is disabled when `editable=false` (i.e. parent status !== draft).
 */
import { Plus, Trash2 } from 'lucide-react';

import { AccountPicker } from '@/components/finance/AccountPicker';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { MoneyInput } from '@/components/ui/MoneyInput';

import { emptyJELine, type JEEditorLine } from './journalEntryEditorHelpers';

export type { JEEditorLine };

export interface JournalEntryEditorProps {
  lines: JEEditorLine[];
  onChange: (lines: JEEditorLine[]) => void;
  currency: string;
  editable: boolean;
  readOnlyReason?: string;
}

export function JournalEntryEditor({
  lines,
  onChange,
  currency,
  editable,
  readOnlyReason,
}: JournalEntryEditorProps) {
  const totalDebit = lines.reduce((s, l) => s + (l.debit_cents || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit_cents || 0), 0);
  const diff = totalDebit - totalCredit;
  const balanced = diff === 0 && totalDebit > 0;

  function patchLine(idx: number, patch: Partial<JEEditorLine>) {
    const cur = lines[idx];
    if (!cur) return;
    const merged: JEEditorLine = { ...cur, ...patch };
    // Enforce mutual-exclusivity of debit/credit per line.
    if (patch.debit_cents !== undefined && patch.debit_cents > 0) {
      merged.credit_cents = 0;
    }
    if (patch.credit_cents !== undefined && patch.credit_cents > 0) {
      merged.debit_cents = 0;
    }
    const next = lines.slice();
    next[idx] = merged;
    onChange(next);
  }

  function addLine() {
    onChange([...lines, emptyJELine()]);
  }

  function removeLine(idx: number) {
    if (lines.length <= 2) return;
    onChange(lines.filter((_, i) => i !== idx));
  }

  return (
    <section
      aria-labelledby="je-lines-heading"
      className="space-y-3 rounded-md border border-border bg-bg p-4"
      data-testid="je-editor"
    >
      <header className="flex items-center justify-between">
        <h2 id="je-lines-heading" className="text-lg font-semibold">
          Lines
        </h2>
        {!editable && readOnlyReason && (
          <span className="text-xs text-fg-muted">{readOnlyReason}</span>
        )}
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Account
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Debit
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Credit
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Memo
              </th>
              {editable && <th scope="col" className="w-10 px-2 py-2" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line, idx) => (
              <tr key={idx} data-testid={`je-line-${idx}`}>
                <td className="px-3 py-2">
                  <AccountPicker
                    value={line.account_id}
                    onChange={(id) => patchLine(idx, { account_id: id })}
                    disabled={!editable}
                    data-testid={`je-line-${idx}-account`}
                    aria-label={`Line ${idx + 1} account`}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <MoneyInput
                    value={line.debit_cents}
                    onChange={(c) => patchLine(idx, { debit_cents: c })}
                    currency={currency}
                    disabled={!editable}
                    aria-label={`Line ${idx + 1} debit`}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <MoneyInput
                    value={line.credit_cents}
                    onChange={(c) => patchLine(idx, { credit_cents: c })}
                    currency={currency}
                    disabled={!editable}
                    aria-label={`Line ${idx + 1} credit`}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={line.memo}
                    onChange={(e) => patchLine(idx, { memo: e.target.value })}
                    disabled={!editable}
                    maxLength={2000}
                    className="w-full rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                    aria-label={`Line ${idx + 1} memo`}
                  />
                </td>
                {editable && (
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length <= 2}
                      aria-label="Delete line"
                      className="rounded-md p-1 text-fg-muted hover:bg-danger/10 hover:text-danger disabled:opacity-30"
                      data-testid={`je-line-${idx}-delete`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border bg-bg-muted text-sm">
            <tr>
              <th scope="row" className="px-3 py-2 text-right font-medium">
                Totals
              </th>
              <td className="px-3 py-2 text-right font-mono" data-testid="je-total-debit">
                <MoneyDisplay cents={totalDebit} currency={currency} />
              </td>
              <td className="px-3 py-2 text-right font-mono" data-testid="je-total-credit">
                <MoneyDisplay cents={totalCredit} currency={currency} />
              </td>
              <td className="px-3 py-2 text-right text-xs" data-testid="je-balance-status">
                {balanced ? (
                  <span className="text-success">Balanced</span>
                ) : (
                  <span className="text-danger">
                    Diff:{' '}
                    <span className="font-mono">
                      <MoneyDisplay cents={Math.abs(diff)} currency={currency} />
                    </span>
                  </span>
                )}
              </td>
              {editable && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {editable && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
            data-testid="je-add-line"
          >
            <Plus className="h-4 w-4" /> Add line
          </button>
        </div>
      )}
    </section>
  );
}
