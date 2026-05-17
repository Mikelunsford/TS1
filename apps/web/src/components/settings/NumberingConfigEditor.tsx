/**
 * NumberingConfigEditor — Phase 15. Reads/writes numbering_sequences via
 * settings-api. Field names mirror the prod DB columns
 * (doc_type / pad_width / reset_period) — see R-W11-NUMBERING-01 closeout.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { settingsKeys } from '@/lib/queryKeys/settings';
import { listNumbering, updateNumbering, type NumberingRow } from '@/lib/services/settingsService';

export function NumberingConfigEditor() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: settingsKeys.numbering(),
    queryFn: listNumbering,
    staleTime: 60_000,
  });

  if (q.isLoading) return <p className="text-sm text-fg-muted">Loading numbering…</p>;
  if (q.isError) return <p className="text-sm text-rose-600">Could not load numbering.</p>;

  const items = q.data ?? [];
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-muted px-4 py-6 text-sm text-fg-muted">
        No numbering sequences are configured for this workspace yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((row) => (
        <NumberingRowEditor
          key={row.doc_type}
          row={row}
          onSaved={() => qc.invalidateQueries({ queryKey: settingsKeys.numbering() })}
        />
      ))}
    </div>
  );
}

function NumberingRowEditor({ row, onSaved }: { row: NumberingRow; onSaved: () => void }) {
  const [prefix, setPrefix] = useState(row.prefix ?? '');
  const [padWidth, setPadWidth] = useState(row.pad_width ?? 5);
  const [resetPeriod, setResetPeriod] = useState<'never' | 'yearly' | 'monthly'>(
    row.reset_period ?? 'yearly',
  );
  const dirty =
    prefix !== (row.prefix ?? '')
    || padWidth !== (row.pad_width ?? 5)
    || resetPeriod !== (row.reset_period ?? 'yearly');

  const mutation = useMutation({
    mutationFn: () =>
      updateNumbering(row.doc_type, { prefix, pad_width: padWidth, reset_period: resetPeriod }),
    onSuccess: () => {
      toast.success(`Updated ${row.doc_type} numbering`);
      onSaved();
    },
    onError: () => toast.error('Save failed'),
  });

  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <div className="text-sm font-medium text-fg">{row.doc_type}</div>
      <div className="mt-2 grid grid-cols-3 gap-3">
        <label className="text-xs text-fg-muted">
          Prefix
          <input
            type="text"
            className="mt-0.5 block w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </label>
        <label className="text-xs text-fg-muted">
          Pad width
          <input
            type="number"
            min={0}
            max={12}
            className="mt-0.5 block w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
            value={padWidth}
            onChange={(e) => setPadWidth(Number(e.target.value))}
          />
        </label>
        <label className="text-xs text-fg-muted">
          Reset period
          <select
            className="mt-0.5 block w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
            value={resetPeriod}
            onChange={(e) => setResetPeriod(e.target.value as 'never' | 'yearly' | 'monthly')}
          >
            <option value="never">Never</option>
            <option value="yearly">Yearly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="rounded-md bg-fg px-3 py-1 text-xs text-bg disabled:opacity-50"
          disabled={!dirty || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </button>
        {row.current_value != null ? (
          <span className="text-xs text-fg-subtle">current: {row.current_value}</span>
        ) : null}
      </div>
    </div>
  );
}
