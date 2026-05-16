/**
 * NumberingConfigEditor — Phase 15. Reads/writes numbering_sequences via
 * settings-api. If Phase 14 hasn't shipped, the BE returns items=[] with
 * meta.phase14_pending, and we render an empty state.
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
        Numbering configuration is not yet available. It lights up once Phase 14
        ships.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((row) => (
        <NumberingRowEditor
          key={row.kind}
          row={row}
          onSaved={() => qc.invalidateQueries({ queryKey: settingsKeys.numbering() })}
        />
      ))}
    </div>
  );
}

function NumberingRowEditor({ row, onSaved }: { row: NumberingRow; onSaved: () => void }) {
  const [prefix, setPrefix] = useState(row.prefix ?? '');
  const [pad, setPad] = useState(row.pad ?? 4);
  const [autoReset, setAutoReset] = useState<'never' | 'yearly' | 'monthly'>(
    (row.auto_reset as 'never' | 'yearly' | 'monthly' | null) ?? 'never',
  );
  const dirty = prefix !== (row.prefix ?? '') || pad !== (row.pad ?? 4) || autoReset !== (row.auto_reset ?? 'never');

  const mutation = useMutation({
    mutationFn: () => updateNumbering(row.kind, { prefix, pad, auto_reset: autoReset }),
    onSuccess: () => {
      toast.success(`Updated ${row.kind} numbering`);
      onSaved();
    },
    onError: () => toast.error('Save failed'),
  });

  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <div className="text-sm font-medium text-fg">{row.kind}</div>
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
          Pad
          <input
            type="number"
            min={0}
            max={12}
            className="mt-0.5 block w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
            value={pad}
            onChange={(e) => setPad(Number(e.target.value))}
          />
        </label>
        <label className="text-xs text-fg-muted">
          Auto-reset
          <select
            className="mt-0.5 block w-full rounded-md border border-border bg-bg px-2 py-1 text-sm"
            value={autoReset}
            onChange={(e) => setAutoReset(e.target.value as 'never' | 'yearly' | 'monthly')}
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
